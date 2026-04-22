## ADDED Requirements

### Requirement: awaiting_credential 任务暂态

系统 SHALL 在 `tracking` 状态任务执行同步前先校验该任务的 `fakeid` 是否存在有效 credential（`findValidCredential(fakeid)`）；当 credential 缺失时，任务 MUST 进入新的 `awaiting_credential` 状态而非直接失败，且任务的 `tracking_end_at` 不变。

#### Scenario: 缺 credential 时进入暂态
- **WHEN** 调度器对一条 `tracking` 任务执行同步前调用 `findValidCredential(task.fakeid)` 返回 `undefined`
- **THEN** 系统跳过本次评论 API 调用，将该任务 `status` 更新为 `awaiting_credential`，emit `task-awaiting-credential(taskId, fakeid)` 事件；任务 `tracking_end_at`、`accumulated_comments`、`auto_track_enabled` 等字段保持不变

#### Scenario: 暂态任务被调度器跳过 sync
- **WHEN** 调度器 tick 处理 `tracking` 任务列表
- **THEN** `awaiting_credential` 状态的任务不被纳入同步循环（不再消耗 API 调用），仅由 `credential-arrived` 事件或 `tracking_end_at` 到时唤醒

#### Scenario: 暂态任务到达追踪结束时间
- **WHEN** `awaiting_credential` 状态任务的 `now >= tracking_end_at`
- **THEN** 系统将 status 切换到 `final_collecting`，进入与原有 `tracking → final_collecting` 完全一致的最终采集流程；最终采集若仍因 credential 缺失而失败，按原有逻辑进入 `error`

### Requirement: credential 到达时的主动唤醒

系统 SHALL 监听 credential WS 推送（即 `auto-detect-credentials:credentials` localStorage 的变化），当某个 `fakeid` 收到新 credential 时，主动唤醒该 `fakeid` 下所有 `awaiting_credential` 任务执行一次同步。

#### Scenario: 新 credential 触发唤醒
- **WHEN** WS 推送一组 credential 列表，且某个 `biz` (=fakeid) 此前不存在于本地有效 credential 集合中（或之前那条已过期）
- **THEN** 应用层 emit `credential-arrived(fakeid)` 事件；调度器查询 `awaiting_credential` 中 `fakeid` 匹配的所有任务，逐个执行一次评论同步

#### Scenario: 唤醒后同步成功
- **WHEN** 唤醒同步返回评论列表
- **THEN** 该任务 `status` 切回 `tracking`，按 `accumulated_comments` 合并去重逻辑写入新评论、更新 `last_sync_at`；继续按 1 分钟周期被纳入正常同步循环

#### Scenario: 唤醒后同步仍失败
- **WHEN** 唤醒同步抛错（如 credential 仍被服务端拒绝）
- **THEN** 任务保持 `awaiting_credential` 状态，等待下一次 credential 到达；emit `task-error` 仅在错误为非 credential 类（如网络错误）时触发

#### Scenario: 唤醒针对旧 credential 的去重
- **WHEN** WS 推送的 credential 列表与上次广播完全一致（即没有"新"的 fakeid 进入有效集合）
- **THEN** 系统不 emit `credential-arrived` 事件，避免对已经处于 `tracking` 的任务发起多余同步

### Requirement: 评论监控页对 awaiting_credential 的 UI 渲染

任务卡片 SHALL 为 `awaiting_credential` 状态渲染明确的 badge 与文案，引导用户去刷 credential，并提供"立即重试同步"的操作入口。

#### Scenario: badge 与文案
- **WHEN** 任务列表中某条任务 `status === 'awaiting_credential'`
- **THEN** 卡片右上角 badge 显示"等待凭证"（橙色 / 琥珀色），卡片正文显示"该公众号暂无可用凭证，请到手机微信打开一篇该公众号文章；凭证到达后自动恢复"

#### Scenario: 立即重试按钮
- **WHEN** 用户在 `awaiting_credential` 任务上点击"立即重试"
- **THEN** 系统强制对该任务执行一次同步：若 credential 已存在则成功 → 切回 `tracking`；若仍缺则保持 `awaiting_credential` 不变，弹一次 toast 提醒"暂无可用凭证"

#### Scenario: 暂态任务的进度条与剩余时间
- **WHEN** 任务处于 `awaiting_credential`
- **THEN** 进度条按 `tracking` 同样的逻辑根据 `(now - created_at) / (tracking_end_at - created_at)` 显示，颜色降级为琥珀色而非天蓝色，剩余时间文案保持"剩余 Xmin"

## REMOVED Requirements

### Requirement: 25 分钟机械式凭证提醒
**Reason**: 该提醒每 25 分钟无差别 emit 一次，与真实任务状态无关，被新的事件驱动 `awaiting_credential` 状态机完全取代。
**Migration**: 用户原本依赖该 toast 的"该刷 credential 了"信号现在由顶部状态条徽标 + 浏览器系统通知（详见 `awaiting-credential-notification` 规格）承担，且只在真正缺 credential 时触发，更精准。

## MODIFIED Requirements

### Requirement: 周期性评论同步
系统 SHALL 以固定 1 分钟周期对所有 `status = 'tracking'` 且 `auto_track_enabled = true` 的评论监控任务执行一次评论拉取与累积合并；同步前 MUST 先校验 credential，缺失时进入 `awaiting_credential` 暂态而非直接报错。

#### Scenario: 累积新评论
- **WHEN** 一次同步成功返回评论列表
- **THEN** 系统将新评论按 `content_id` 去重合并到 `accumulated_comments`，更新 `last_sync_at = now`；UI 列表显示该任务的"上次刷新 HH:mm:ss · 累计 N 条"

#### Scenario: 暂停的任务被跳过
- **WHEN** 任务的 `auto_track_enabled = false`
- **THEN** 该任务在本轮被跳过，不更新 `last_sync_at`；UI 显示"已暂停"标记

#### Scenario: 同步失败（非 credential 类）
- **WHEN** 一次同步抛错且错误不属于 credential 缺失或登录过期
- **THEN** 任务保持 `tracking` 状态等待下一轮重试，UI 通过 toast 提示该任务的错误信息

#### Scenario: 同步失败（credential 缺失）
- **WHEN** 同步前发现 `findValidCredential(task.fakeid) === undefined`，或同步过程中服务端返回 credential 相关错误
- **THEN** 任务进入 `awaiting_credential` 状态而非 `error`，详见 `awaiting_credential 任务暂态` 规格；不弹 toast 错误，由顶部徽标 / 系统通知统一传达

#### Scenario: 同步失败（登录过期）
- **WHEN** 一次同步抛错为"未登录或登录已过期"
- **THEN** 全局停止评论监控调度器并提示用户重新登录

#### Scenario: 标签页隐藏时暂停
- **WHEN** 浏览器标签页被切换到隐藏状态
- **THEN** `CommentMonitorScheduler` 暂停定时器；恢复可见时立即执行一次同步并恢复 1 分钟周期
