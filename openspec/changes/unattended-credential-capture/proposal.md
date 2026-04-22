## Why

当前 credential 抓取依赖本地电脑常开 + 手机 WiFi 与电脑同网段，**一旦换 WiFi 或电脑关机，credential 服务即中断**；而 credential TTL 只有 25 分钟，公众号自动发现新文章时 credential 大概率已过期，导致评论同步频繁失败、用户被迫频繁手动刷新，监控的"自动化"价值被严重削弱。

把 credential 抓取服务连同 Web 服务整体上云（腾讯云新加坡 VPS + 自有域名 + Caddy 自动 HTTPS），并把"等待 credential"做成可恢复暂态，可让评论监控真正实现 7×24 无人值守。

## What Changes

- 新增**远程 credential 抓取服务**：mitmproxy 监听 `0.0.0.0` + `--proxyauth user:pass`，对外通过 VPS 公网 IP + 自定义端口暴露，强制 Basic Auth；Web 服务通过 Caddy 反代 + Let's Encrypt 自动 HTTPS 暴露在自有域名上
- **BREAKING** Docker 镜像新增 mitmproxy 依赖与 Caddy 依赖；启动脚本支持通过环境变量传入 `MITM_PROXY_AUTH`、`PUBLIC_DOMAIN`、`CADDY_ACME_EMAIL`
- 评论监控任务新增 `awaiting_credential` 暂态：`tracking` 任务在同步时若该 fakeid 无可用 credential，则不再 emit `task-error`，而是切到 `awaiting_credential`（task 仍在 1.5h 生命周期内，只是暂停拉取）
- credential 到达事件（WS 推送）触发**主动 fan-out**：当某个 fakeid 收到新 credential 时，scheduler 立即唤醒该 fakeid 下所有 `awaiting_credential` 任务执行一次同步
- 顶部状态条新增"等待 credential"指示：当存在 `awaiting_credential` 任务时显示徽标，hover 展示等待哪些公众号、共多少篇
- 新增浏览器 Notification API 推送：tab 失焦且存在新增 `awaiting_credential` 任务时，弹一次系统通知（用户首次需授权）
- 文档：新增 `docs/deployment-vps-cloudflare-tunnel.md` 与 `docs/mobile-surfboard-setup.md` 描述部署与手机配置流程

## Capabilities

### New Capabilities
- `remote-credential-capture`: 远程 mitm credential 抓取服务的运行行为（鉴权、对外暴露策略、credential 推送、Web 服务隔离），与本地开发模式区分
- `awaiting-credential-notification`: 浏览器侧"等待 credential"的可视化与系统通知行为

### Modified Capabilities
- `article-comment-monitor`: 新增 `awaiting_credential` 任务状态、定义其进入/退出条件、与 credential 到达事件的联动

## Impact

- **代码**：
  - `Dockerfile`：新增 mitmproxy + Caddy 安装层；启动改为 entrypoint 脚本同时拉起 Caddy、mitmdump、Nuxt
  - `server/plugins/credential-service.ts`：mitmdump 启动参数加 `--listen-host 0.0.0.0` 与 `--proxyauth ${env}`；env 缺失时回退本地开发模式
  - `server/api/credential/status.get.ts`：返回字段新增 `mode: 'local' | 'remote'`、`publicHost`（仅 remote）
  - `utils/monitor/CommentMonitorScheduler.ts`：新增 `awaiting_credential` 分支与 `credential-arrived(fakeid)` 监听；移除现有 25min 机械式 `credential-expiring` 提醒
  - `composables/useCommentMonitor.ts`：响应新事件、控制 toast / Notification 触达
  - `store/v2/commentMonitorTask.ts`：`status` 类型并加 `awaiting_credential`；查询接口（如 `getCommentMonitorTasksByStatus`）配合扩展
  - `pages/dashboard/monitor.vue`：顶部状态条 + 任务卡片 status badge 增加新分支
- **依赖**：Docker 镜像层加 `mitmproxy`（apt 源或 pip）、`caddy`（官方 deb）
- **环境变量**：新增 `MITM_PROXY_AUTH`（`user:pass`）、`PUBLIC_DOMAIN`、`CADDY_ACME_EMAIL`、`CREDENTIAL_PUBLIC_HOST`（用于 UI 展示给用户）
- **数据迁移**：Dexie 表 `comment_monitor_task.status` 加新枚举值，无需 schema bump（字段已是 string 类型）
- **运维**：用户需自备域名（NS 托管在 Cloudflare DNS）+ 在 CF DNS 加 A 记录指向 VPS；手机端需安装 Surfboard 类 App
