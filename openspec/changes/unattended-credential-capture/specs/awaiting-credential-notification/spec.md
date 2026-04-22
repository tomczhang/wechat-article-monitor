## ADDED Requirements

### Requirement: 顶部状态条等待提示

文章监控页 (`pages/dashboard/monitor.vue`) 顶部状态条 SHALL 在存在 `awaiting_credential` 状态任务时显示常驻徽标，标识当前有多少篇文章在等 credential，并支持 hover 展示等待哪些公众号。

#### Scenario: 存在等待任务
- **WHEN** 用户加载 / 切换到监控页且 `tasks.value.filter(t => t.status === 'awaiting_credential').length > 0`
- **THEN** 顶部状态条显示 `⚠ N 篇等 cred` 徽标（橙色 / 琥珀色基调），其中 `N` = 等待中的任务数量

#### Scenario: hover 显示明细
- **WHEN** 用户鼠标悬停在 `⚠ N 篇等 cred` 徽标上
- **THEN** 弹出 popover 列出每个公众号 nickname 及该公众号下等待的篇数（按 `fakeid` 分组），如"【小道消息】2 篇 / 【晚点 LatePost】1 篇"

#### Scenario: 没有等待任务
- **WHEN** `tasks.value.filter(t => t.status === 'awaiting_credential').length === 0`
- **THEN** 状态条不渲染该徽标（不留空位、不显示 0）

### Requirement: 浏览器系统通知

系统 SHALL 在 tab 失焦且新增 `awaiting_credential` 任务时，通过浏览器 Notification API 向用户推送系统级通知，引导用户去手机微信打开对应公众号文章以补 credential。

#### Scenario: 触发系统通知
- **WHEN** scheduler emit `task-awaiting-credential(taskId, fakeid)` 且同时满足：`document.hidden === true`、`Notification.permission === 'granted'`、该 fakeid 在最近 5 分钟内未推送过通知
- **THEN** 浏览器弹出系统通知，标题 "等待凭证 — ${nickname}"、正文 "${article_title} 暂无可用凭证，请在手机微信打开一篇该公众号文章"

#### Scenario: 通知节流
- **WHEN** 同一个 fakeid 在 5 分钟窗口内多次触发 `task-awaiting-credential`
- **THEN** 系统只在窗口内首次触发时弹一条通知，后续聚合为顶部徽标计数（避免新文章批量到达时炸用户）

#### Scenario: 权限未授权时静默
- **WHEN** `Notification.permission !== 'granted'`
- **THEN** 系统不调用 `new Notification(...)`，不阻塞、不抛错；用户仅看到顶部徽标提示

#### Scenario: tab 可见时不弹通知
- **WHEN** `document.hidden === false`
- **THEN** 不弹系统通知（用户已经在看页面，徽标足够），避免重复打扰

### Requirement: 通知权限引导

监控页 SHALL 在用户首次访问且 `Notification.permission === 'default'` 时提供一个非阻塞的"开启系统通知"提示，但 MUST NOT 自动弹出权限请求模态。

#### Scenario: 首次访问引导
- **WHEN** 用户加载监控页且 `Notification.permission === 'default'` 且本地存储未标记 `notification-prompt-dismissed`
- **THEN** 顶部状态条旁出现一个浅色不打扰的提示按钮"🔔 开启系统通知"，点击后调用 `Notification.requestPermission()`，无论用户允许还是拒绝都标记 dismissed 不再提示

#### Scenario: 已授权或已拒绝
- **WHEN** `Notification.permission === 'granted' || 'denied'`
- **THEN** 不再展示"开启系统通知"提示按钮

### Requirement: 移除 25 分钟机械提醒

旧的 `credential-expiring` 事件（每 25 分钟由 `CommentMonitorScheduler` setInterval 触发的 toast 提醒）SHALL 被本规格定义的"事件驱动 + 状态徽标"模型完全取代，从代码中移除。

#### Scenario: 旧 toast 不再出现
- **WHEN** 系统运行任意时长，无任务进入 `awaiting_credential`
- **THEN** UI 不应出现"凭证即将过期，请在手机微信中打开一篇被监控公众号的文章以刷新凭证"这条 toast；该提示仅在 `awaiting_credential` 实际发生时通过状态徽标 / 系统通知传达
