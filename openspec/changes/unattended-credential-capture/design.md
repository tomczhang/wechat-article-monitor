## Context

**当前架构（本地模式）**：

- `server/plugins/credential-service.ts` 在 Nuxt server 启动时 `spawn('mitmdump', ...)`，监听 `127.0.0.1:65000`，无任何鉴权
- mitmdump 把 Set-Cookie 写入本地 `credential-service/data/credentials.json`
- 该文件由 Node `watch()` 监听变化，通过 WebSocket 广播给浏览器 SPA
- 浏览器把 credential 写入 localStorage，下载/同步评论时按 `fakeid` 索引取用
- credential TTL = 25 分钟（`CREDENTIAL_LIVE_MINUTES`）；服务端缓存 30 分钟

**当前任务状态机（`store/v2/commentMonitorTask.ts`）**：

```
'tracking' ──tracking_end_at─▶ 'final_collecting' ──成功─▶ 'exporting' ──▶ 'done'
                                       │
                                       └──失败──▶ 'error' ──手动重试──▶ 'final_collecting'
```

`tracking` 期间每 60s 拉取一次评论；任何同步失败（包括 credential 过期）都 emit `task-error`，UI 弹 toast，整体调度器不停。
若错误为"未登录或登录已过期"则停掉整个调度器。

**约束**：

- 微信登录态被沙箱在微信 App 内，第三方无法读取 cookie；credential 必须由用户手机微信主动访问 `mp.weixin.qq.com/s` 并被 mitm 解密 Set-Cookie 拿到
- credential 与 `__biz`（=fakeid）一一绑定，**每个公众号需要单独抓一次**
- 用户不希望频繁切换 WiFi 时手动改代理；不希望买域名走备案
- 用户已有 2 核 4G 腾讯云新加坡 VPS

## Goals / Non-Goals

**Goals:**

- credential 服务可在 VPS 7×24 运行，与本地电脑开机状态完全解耦
- mitm 服务对外暴露但有 Basic Auth 保护，不被公网恶意利用
- Web 服务通过 Cloudflare Tunnel 暴露，VPS 不开 web 入站端口（攻击面最小化）
- 评论监控任务在缺 credential 时不再"失败"，而是进入可恢复暂态；credential 一到自动恢复
- 单镜像部署：`docker compose up -d` 完成 mitm + cloudflared + Nuxt 三件套启动
- 保留本地开发模式：`yarn dev` 仍能跑 mitm + Nuxt（无 cloudflared、无鉴权）

**Non-Goals:**

- 不实现外部通知通道（Bark / 企微 / TG webhook），本期只做浏览器内 Notification
- 不做手机端原生 App，依赖第三方 Surfboard / Shadowrocket / NekoBox 类工具
- 不重写 mitmproxy 的 `credential.py` 抓取逻辑（保持现有 Set-Cookie 提取行为）
- 不在 IndexedDB 做 schema 升级（`status` 字段类型已是 string，新增枚举值无需 migration）
- 不变更 credential TTL（25 分钟仍合理，本地与远程一致）
- 不实现"任务在多浏览器/多端共享"，credential 仍存 localStorage（远程化的是抓取通道，不是消费通道）

## Decisions

### 1. 部署形态：单 VPS 上跑三个进程，`docker compose` 编排

**选 supervisord 风格的 entrypoint 脚本，而非多容器**：单一镜像内用 supervisor 或 `dumb-init` 同时拉起 `cloudflared`、`mitmdump`、`node server/index.mjs`。

**理由：** 一个 compose service 单容器最简单；mitm 与 Nuxt 共享 `credential-service/data/` 目录；cloudflared 只是出站连接，不需要独立网络。多容器会引入卷共享 / 网络命名空间问题，不值。

**备选放弃：** docker-compose 三 service + 共享 volume —— 配置复杂、卷竞争写、watcher event 跨容器不稳。

### 2. mitm 鉴权：`--proxyauth ${MITM_PROXY_AUTH}`

启动参数追加 `--proxyauth ${env.MITM_PROXY_AUTH}`（格式 `user:pass`）。环境变量未设置时回退本地无鉴权模式（开发体验保留）。

**理由：** mitmproxy 内置支持 Basic Auth；iOS 系统 WiFi 代理与 Surfboard 都支持 user/pass；唯一短板是 Android 原生 WiFi 代理不支持 auth，但用户明确走 Surfboard 路线，无影响。

**备选放弃：**

- mTLS 客户端证书：手机端配置成本极高
- IP 白名单：用户出差/换 4G 时 IP 漂移
- 端口敲门：mitmproxy 不内置，要装 knockd

### 3. Web 暴露：自有域名 + Caddy 直连

用户已具备域名 `tommiao.com`（注册商阿里云，NS 已迁至 Cloudflare DNS），子域 `wechat.tommiao.com` 解析到新加坡 VPS 公网 IP（CF DNS only，**不走** CF 反代）。VPS 容器内运行 Caddy 监听 80/443，自动向 Let's Encrypt 申请并续签证书，反代到 Nuxt server `127.0.0.1:3000`。

**理由：**
- WSS 长连接无 100s 强断（CF Tunnel 免费档限制），credential 推送更稳
- 浏览器到 VPS 直连，少一跳，国内 + VPN 用户访问延迟更低
- Caddy 配置极简（`wechat.tommiao.com { reverse_proxy localhost:3000 }`）
- 域名 NS 在 Cloudflare、解析到境外 VPS、不走阿里云 DNS → 不触发任何备案校验
- 不依赖 cloudflared 出站隧道，不受 CF 政策约束

**备选放弃：**

- Cloudflare Tunnel：WSS 100s 强断需要客户端额外重连；多一个 cloudflared 进程；body 100MB 限制；CF 国内偶尔抽风
- nip.io + Caddy：用户已有自有域名，nip.io 不再必要
- 自签证书：浏览器警告，PWA / Service Worker 受限
- 直接 `http://VPS_IP:3000`：浏览器对非 HTTPS 的 WSS / Notification API 限制大

### 4. mitm 监听地址：`--listen-host 0.0.0.0`

环境变量 `MITM_LISTEN_HOST` 控制，默认本地 dev 用 `127.0.0.1`，Docker 用 `0.0.0.0`。Docker compose 把 mitm 端口映射到宿主机 65000。

### 5. credential WS 推送通路保持不变

mitm 把 credentials.json 写到容器内 `/app/credential-service/data/`，Nuxt server `watch()` 监听同一文件，通过现有 WS 广播给浏览器。**改动 0 行**。

**理由：** mitm 与 Nuxt 在同一容器同一文件系统，复用现有 watcher 即可；浏览器只通过 CF Tunnel 连 wss，不需感知 mitm 在哪。

### 6. `awaiting_credential` 状态：在 `tracking` 之外新增独立 status

```
                       ┌──新 cred 到达──┐
                       │                ▼
'tracking' ──缺 cred──▶ 'awaiting_credential' ──同步成功──▶ 'tracking'
   │                          │
   │                          └─── tracking_end_at 到 ──▶ 'final_collecting'
   │
   └──tracking_end_at─▶ 'final_collecting'
```

**为什么不复用 `tracking` 加 boolean 字段：**

- UI 已经按 status 渲染 badge / 进度条，新增独立状态比"主状态 + 子标志"更清晰
- `getCommentMonitorTasksByStatus('awaiting_credential')` 直接复用现有索引，scheduler 分支干净
- credential 到达事件可以直接 `getCommentMonitorTasksByStatus('awaiting_credential')` 找出待唤醒列表

**进入条件：** `syncTrackingTask` 调用前先 `findValidCredential(task.fakeid)`；若无：
- 不调用 sync API（避免一次必败的网络请求）
- `updateCommentMonitorTask(id, { status: 'awaiting_credential' })`
- emit `task-awaiting-credential(taskId, fakeid)`

**退出条件（两种）：**
1. `credential-arrived(fakeid)` 事件 → 调度器拉取所有 `awaiting_credential` 且 `fakeid === arrived_fakeid` 的任务，逐个 sync 一次；成功则 `status = 'tracking'`，失败保持 `awaiting_credential`
2. `now >= tracking_end_at` → 切到 `final_collecting`（即使没拿到任何 credential 也走最终采集流程，最终采集失败再进 `error`）

### 7. credential 到达事件的来源

`useAccountDiscovery` 已经 `useLocalStorage('auto-detect-credentials:credentials', [])`。Vue watch 该 ref 的变化，diff 出新增 `biz`，emit 应用层事件 `credential-arrived(fakeid)`。

**实现位置：** 不放进 `CommentMonitorScheduler`（scheduler 跑在 Web Worker / 后台时无 reactive 上下文），改放进 `useCommentMonitor` composable 中，通过 ref 桥接。

### 8. 浏览器 Notification

- 仅在 `document.hidden === true` 且 `Notification.permission === 'granted'` 时弹
- 触发条件：scheduler emit `task-awaiting-credential` 时
- 节流：同一个 fakeid 5 分钟内最多弹一次，避免新文章批量到达时炸用户
- 首次进监控页时检测 `Notification.permission === 'default'`，UI 给一个不打断的"开启系统通知"按钮（不强制）

### 9. 顶部状态条徽标

替换当前的"系统运行中"文字提示，改为常驻能力信息：

```
[● 评论监控中 · 3 个任务] [⚠ 2 篇等 cred] [● 凭证服务 · 远程]
                          ↑              ↑
                          hover 列出      点击打开 CredentialsDialog
                          公众号名 + 篇数
```

`⚠ N 篇等 cred` 来自 `tasks.value.filter(t => t.status === 'awaiting_credential').length` 的 computed。

### 10. 移除 25min 机械式 `credential-expiring`

旧的"每 25 分钟弹一次刷新提醒"被新的事件驱动模型完全取代——`awaiting_credential` 状态本身就是更准确的信号。删除 `CommentMonitorScheduler` 的 `credentialReminderId` setInterval 与 `credential-expiring` 事件、删除 `useCommentMonitor` 对应 toast。

### 11. status 接口扩展

`GET /api/credential/status` 返回字段新增：

```ts
{
  ...existing,
  mode: 'local' | 'remote',           // env CLOUDFLARE_TUNNEL_TOKEN 是否存在判定
  publicHost: string | null,           // env CREDENTIAL_PUBLIC_HOST，UI 展示给用户
  proxyAuthEnabled: boolean,           // env MITM_PROXY_AUTH 是否设置
  certUrl: string | null,              // 远程模式下 mitm CA 公钥下载地址，便于 UI 渲染二维码
}
```

`CredentialsDialog.vue` 用这些字段在远程模式下展示"代理地址 = `tcp://${publicHost}:${port}`，账号见环境变量"提示。

### 12. mitm CA 证书自服务（`/api/credential/cert`）

远程部署模式下新增 `GET /api/credential/cert?fmt=pem|crt` 路由，直接以 `application/x-pem-file` / `application/x-x509-ca-cert` 流式返回容器内 `~/.mitmproxy/mitmproxy-ca-cert.pem`。本地模式 `404`。

**设计理由：**

mitmproxy 默认走 `mitm.it` 分发证书，但 `mitm.it` 必须经过 mitm 代理才能解析——而用户首次配置时**还没装证书 + 还没配代理**，是一个先有鸡还是先有蛋的死结。改由 Nuxt 直接吐文件可破：浏览器 Dashboard 渲染一个二维码指向 `https://${tunnel}/api/credential/cert`，手机扫码用浏览器下载即可。

**为什么裸暴露不加 auth：**

`mitmproxy-ca-cert.pem` 只包含 CA **公钥**，**不含私钥**。任何第三方下载它装到自己手机上也无法签出能被你 mitm 信任的证书（缺私钥）。该路由对外公开**不会增加任何攻击面**，加 auth 反而让首次配置流程倒退回原来的死结。

**实现细节：**

- mitmdump 首次启动会自动生成 `~/.mitmproxy/` 下证书；handler 内若文件不存在返回 503 让用户稍后重试
- 路由 lazy-read 文件内容，不缓存（CA 几乎永不变，但偶尔重置时方便）
- `?fmt=pem` 返回 `mitmproxy-ca-cert.pem`（iOS / 多数浏览器）；`?fmt=crt` 转为 `application/x-x509-ca-cert` 同样内容（Android 偏好）

**未来增强（本期不做）：**

iOS `.mobileconfig` 配置描述文件可一次性把"装证书 + 信任开关 + WiFi 代理设置"打包，安装即用。等 v2 再做。

### 13. WeChat 出站不做代理注入

虽然 VPS 在新加坡，对 `mp.weixin.qq.com` 的请求理论上有被风控的可能，本期**不引入 `WECHAT_UPSTREAM_PROXY` 之类的可选代理注入**。

**理由：**
- 腾讯云新加坡 IP 段属于 Tencent ASN，相比普通海外 VPS 信誉好
- 当前调度量级（5 公众号 + 3 task 的典型场景，~240 次/小时）远低于风控阈值
- 增加 env 占位会让 `proxy-request.ts` 与下载链路引入条件分支，污染主流程
- 真正出问题再加不迟，那时也能更精准地选注入点

> **若实际部署后被风控**，应对路径：先观察 server log 的 401/freq_control 响应；若复现，单开后续 change 加代理注入或转 cookie 策略，而非现在预埋。

## Risks / Trade-offs

- **[mitm 公网暴露被扫]** → `--proxyauth` 强制 Basic Auth + VPS 防火墙限制 65000 端口（可选 `ufw allow from <user_ip>`）；mitmproxy 内置 auth 失败直接 407，不会泄露任何业务数据
- **[Cloudflare Tunnel 被墙]** → CF 在国内偶有不稳，作为兜底可在 entrypoint 同时支持"绑定 VPS 公网 IP + nip.io + Caddy"模式；本期不实现，记入 Open Questions
- **[手机 4G 流量上 mitm]** → 用户点开微信文章经 Surfboard → VPS → 微信服务器，意味着每次抓 cred 会消耗手机 + VPS 双向流量。单次文章约 1-3MB，可接受
- **[awaiting_credential 任务在 1.5h 窗口期都没等到]** → 仍按原逻辑切 final_collecting；最终采集若也失败则 task 进 error，与现状一致；不引入"无限等待"
- **[Notification 权限被用户拒绝]** → 仅静默回退到顶部徽标提示，不重复弹模态请求权限
- **[credential WS 在弱网下断开]** → 现有重连逻辑（如有）保持；本期不增强
- **[本地开发模式 regression]** → 所有新增 env 都要有合理 default，且加单元/手动测试覆盖"无 env 时 mitm 监听 127.0.0.1 且不要求 auth"

## Migration Plan

1. **代码合入**：在不改变本地 `yarn dev` 体验的前提下，所有新行为都条件化在新 env 上
2. **镜像构建**：CI 推一版 `wechat-article-exporter:vN.M-cloud` 镜像（包含 mitmproxy + Caddy）
3. **DNS 准备**（用户侧）：
   - CF DNS 加 A 记录 `wechat → <VPS 公网 IP>`，Proxy 选灰色云（DNS only）
   - `dig wechat.tommiao.com` 确认解析正确
4. **首次部署**：
   - 编辑 `.env`：填入 `PUBLIC_DOMAIN=wechat.tommiao.com`、`CADDY_ACME_EMAIL=<your_email>`、`MITM_PROXY_AUTH=user:pass`、`CREDENTIAL_PUBLIC_HOST=<VPS_IP>`、`NUXT_AGGRID_LICENSE` 等
   - `docker compose up -d`
   - VPS 防火墙开 80 / 443（Caddy + LE 申请证书必须）+ 65000（mitm）
   - 浏览器访问 `https://wechat.tommiao.com` 验证 HTTPS 自动签发完成
5. **手机配置**：按 `docs/mobile-surfboard-setup.md` 一次性配 Surfboard + 装 mitm 证书（扫 Dashboard 二维码）
6. **回滚**：`docker compose down` + 切回本地 `yarn dev`，Caddy/mitm 全部停用，本地模式不受影响；DNS 记录可保留无影响

## Open Questions

> 以下问题已在 spec 阶段决议（2026-04-21）：
>
> - **多用户/隔离**：明确为单用户场景，credential WS 全广播，不做隔离；未来若需多用户再开 change
> - **mitm 证书分发**：决定由 Nuxt 提供 `/api/credential/cert` 路由直接返回 CA 公钥；裸暴露无需 auth（详见 Decision 12）
> - **CF Tunnel 中国大陆稳定性**：用户具备 VPN 兜底，本期不做 nip.io + Caddy 备用路线
> - **Notification 节流**：固定 5 分钟窗口；未来若反馈有重复打扰再调整
>
> 当前无悬而未决的问题。
