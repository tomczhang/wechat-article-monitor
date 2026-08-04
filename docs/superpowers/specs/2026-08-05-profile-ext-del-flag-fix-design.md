# `profile_ext_getmsg` 文章删除状态修复设计

## 背景与根因

`/api/web/mp/profile_ext_getmsg` 能正确返回公众号文章，但 `utils/profile-getmsg.ts` 将
`del_flag === 1` 转换成了 `is_deleted: true`。文章下载页默认隐藏 `is_deleted` 文章，导致正常文章被过滤。

真实响应和链接访问验证表明：

- `del_flag = 1` 的文章包含完整正文，可以正常访问；
- `del_flag = 4` 的文章不包含正文，属于已删除或不可访问状态；
- 当前缓存逻辑把两者的状态写反，因此样本中的九篇正常文章被隐藏，只显示一篇不可访问文章。

## 目标

1. 新同步数据将 `del_flag = 1` 识别为正常，将 `del_flag = 4` 识别为已删除。
2. 自动纠正已经写入 IndexedDB 的受影响记录。
3. 不改变文章下载页现有的“隐藏已删除文章”设置和交互。
4. 不误改由旧公众号后台接口、单篇下载或评论监控写入的文章。

## 数据模型与转换

在 `AppMsgEx` 上增加两个可选的内部字段；`AppMsgExWithFakeID` 会自动继承它们：

- `_source?: 'profile_ext'`：标记文章来自微信历史消息接口；
- `_profile_del_flag?: number`：保留微信返回的原始删除状态，避免以后再次猜测语义。

`utils/profile-getmsg.ts` 使用一个可独立测试的小函数转换删除状态：

- `Number(del_flag) === 4` 时 `is_deleted = true`；
- `del_flag = 1` 以及未知或缺失值时 `is_deleted = false`。

转换得到的每篇文章都写入 `_source` 和 `_profile_del_flag`。后续重新同步同一篇文章时，Dexie 的 `put` 会以
`${fakeid}:${aid}` 覆盖旧记录，并保留正确状态。

## 旧缓存迁移

新增 Dexie v8 升级，只处理没有 `_source` 且能保守识别为旧版 `profile_ext` 转换结果的记录。识别和修正逻辑提取为无数据库依赖的纯函数，供迁移和单元测试共用。记录必须同时满足：

- 记录不是单篇下载或评论监控占位记录（`_single` 不为真）；
- 记录尚未进入下载流程（`_status` 为空或缺失）；
- `album_id === ''` 且 `appmsg_album_infos` 是空数组；
- `ban_flag`、`checking`、`mediaapi_publish_status` 均为 `0`；
- `create_time === update_time`；
- `cover_img` 和四种 `pic_cdn_url_*` 均与 `cover` 相同；
- 删除状态与版权字段形成已知的旧错误组合之一：
  - `is_deleted === true`，且 `copyright_stat`、`copyright_type` 都是 `11`；
  - `is_deleted === false`，且 `copyright_stat`、`copyright_type` 都是 `100`。

满足全部条件时，迁移使用版权字段提供的正向证据纠正状态：

- `copyright_stat = copyright_type = 11` 的记录改为正常；
- `copyright_stat = copyright_type = 100` 的记录改为已删除；
- 只补写 `_source = 'profile_ext'`。旧缓存没有保存原始 `del_flag`，迁移不猜测或伪造 `_profile_del_flag`。

不满足全部条件的记录（包括未知版权值、已纠正状态、已下载记录和其他来源记录）视为来源不明确并保持不变；它们在下次正常同步时会由带来源标记的新数据覆盖。迁移失败只记录错误，不阻止数据库打开，与现有迁移策略一致。

## 数据流

1. 客户端调用 `profile_ext_getmsg`。
2. `convertProfileGetMsgResponse` 将响应转换为带来源和原始状态的 `AppMsgEx`。
3. `updateArticleCache` 按原有主键写入 IndexedDB。
4. 文章下载页按 `fakeid` 读取缓存。
5. `hideDeleted` 继续只过滤真正 `is_deleted = true` 的文章。

页面组件和接口协议不需要修改。

## 测试与验证

单元测试覆盖：

1. `del_flag = 1` 转换为 `is_deleted = false`；
2. `del_flag = 4` 转换为 `is_deleted = true`；
3. 缺失或未知 `del_flag` 默认可见；
4. 主文章和多图文子文章都保留原始状态与来源；
5. v8 迁移只纠正具备明确矛盾状态证据的旧转换器记录，且不伪造原始 `del_flag`；
6. v8 迁移不修改 `_single`、已下载、已纠正、未知版权值及其他来源记录。

端到端验证使用当前真实响应执行“添加公众号 → 选择公众号 → 查看文章列表”：默认隐藏已删除文章时应显示九篇
`del_flag = 1` 文章，不显示 `del_flag = 4` 文章；关闭该设置后十篇均可显示。

## 非目标

- 不改变微信历史消息分页逻辑；
- 不自动删除不可访问文章；
- 不调整“隐藏已删除文章”的默认值；
- 不重构文章下载页或账号同步流程。
