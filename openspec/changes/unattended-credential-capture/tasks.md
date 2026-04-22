## 1. 后端：mitm 远程化与启动模式

- [x] 1.1 在 `server/plugins/credential-service.ts` 中读取 env：`MITM_LISTEN_HOST`（默认 `127.0.0.1`）、`MITM_PROXY_AUTH`、`CREDENTIAL_PUBLIC_HOST`（不再需要 `CLOUDFLARE_TUNNEL_TOKEN`）
- [x] 1.2 重构 `startMitmProxy()`：根据 env 拼接 `--listen-host`、按需追加 `--proxyauth ${MITM_PROXY_AUTH}` 启动参数
- [x] 1.3 增加启动期校验：`MITM_LISTEN_HOST` 非 loopback 且 `MITM_PROXY_AUTH` 缺失时 `process.exit(1)` 并打印明确错误
- [x] 1.4 扩展 `getCredentialServiceState()` 返回 `mode`、`publicHost`、`proxyAuthEnabled`、`certUrl`；`status.get.ts` 通过 spread 自动透传新字段
- [x] 1.5 新增 `server/api/credential/cert.get.ts`：远程模式下根据 `?fmt=pem|crt` 流式返回 `~/.mitmproxy/mitmproxy-ca-cert.pem`；文件未就绪返回 503；本地模式返回 404；不要求任何 auth

## 2. 后端：评论监控状态机扩展

- [x] 2.1 `store/v2/commentMonitorTask.ts` 的 `CommentMonitorTask.status` union 加 `'awaiting_credential'`
- [x] 2.2 `utils/monitor/CommentMonitorScheduler.ts` 在 `tick()` 中：处理 `tracking` 任务前调用 `findValidCredential(task.fakeid)`，缺失则切到 `awaiting_credential` 并 emit `task-awaiting-credential`
- [x] 2.3 `tick()` 增加 `awaiting_credential` 分支：仅检测 `tracking_end_at` 到时切 `final_collecting`，不执行评论同步
- [x] 2.4 `CommentMonitorSchedulerEvents` 类型新增 `task-awaiting-credential(taskId, fakeid)` 与 `task-resumed(taskId)`；移除 `credential-expiring`
- [x] 2.5 移除 `CommentMonitorScheduler.start()` 中的 `credentialReminderId` setInterval 与 `stop()` 中对应清理；删除 `CREDENTIAL_REFRESH_INTERVAL_MS` 常量
- [x] 2.6 新增 `CommentMonitorScheduler.wakeAwaitingByFakeid(fakeid: string)` 方法：查询该 fakeid 下所有 `awaiting_credential` 任务并执行一次同步，成功则切回 `tracking`，失败保持 `awaiting_credential`

## 3. 前端：credential 到达事件桥接

- [x] 3.1 `composables/useCommentMonitor.ts` 通过 `useLocalStorage('auto-detect-credentials:credentials')` 监听 credential 列表，diff 出"新进入有效集合"的 fakeid 后调用 `scheduler.wakeAwaitingByFakeid(fakeid)`（避免与 `useAccountDiscovery` 循环依赖）
- [x] 3.2 替换 `s.on('credential-expiring', ...)` 为 `s.on('task-awaiting-credential', (taskId, fakeid) => ...)`：在 `awaiting-credential-notification` 规格定义的条件下触发 Notification
- [x] 3.3 实现 fakeid 维度的通知节流：用 `Map<string, number>` 记录每个 fakeid 上次推送时间戳，5 分钟窗口内不重复
- [x] 3.4 在 `useCommentMonitor` 暴露 `awaitingCredentialCount` computed 与 `awaitingByAccount` computed（按 fakeid 分组）

## 4. 前端：监控页 UI

- [x] 4.1 `pages/dashboard/monitor.vue` 顶部状态条新增"⚠ N 篇等 cred"徽标，绑定 `awaitingCredentialCount`；UPopover hover 渲染 `awaitingByAccount` 列表
- [x] 4.2 `getStatusLabel` 增加 `awaiting_credential` 映射 → 琥珀色 badge "等待凭证"
- [x] 4.3 任务卡片增加 `awaiting_credential` 分支模板：文案、立即重试按钮（复用 `fetchTaskComments`）、琥珀色进度条
- [x] 4.4 顶部状态条加"🔔 开启系统通知"按钮：仅当 `Notification.permission === 'default'` 且未 dismiss 时显示，点击后 `Notification.requestPermission()` 并写入 `localStorage['notification-prompt-dismissed'] = '1'`

## 5. 前端：CredentialsDialog 远程模式适配

- [x] 5.1 `components/global/CredentialsDialog.vue` 顶部读取 `/api/credential/status` 响应的 `mode`、`publicHost`、`proxyAuthEnabled`、`certUrl`
- [x] 5.2 `mode === 'remote'` 时：替换提示为"将手机代理（推荐 Surfboard）设为 `${proxyAddress}`"，并按需展示账号密码字段引用
- [x] 5.3 `mode === 'remote'` 时新增二维码（`qrcode` lib，canvas 渲染）指向 `${origin}${certUrl}`，文案含 iOS 证书信任开关 / Android 凭据安装指引
- [x] 5.4 `mode === 'local'` 时保持原有提示不变，不渲染二维码与远程指引

## 6. Docker 镜像：mitmproxy + Caddy 集成

- [x] 6.1 `Dockerfile` 运行时层：`apt-get install python3 python3-pip gettext-base`，从 cloudsmith 仓库装 Caddy 官方 deb；用 `pip install --break-system-packages` 装 `requirements.txt`
- [x] 6.2 拷贝 `credential-service/credential.py` 与 `requirements.txt` 到镜像 `/app/credential-service/`
- [x] 6.3 新增 `Caddyfile.template`：`${PUBLIC_DOMAIN} { reverse_proxy localhost:3000 }` + WS-friendly 配置；entrypoint 用 `envsubst` 渲染到 `/etc/caddy/Caddyfile`
- [x] 6.4 新增 `entrypoint.sh`：`wait -n` 编排 caddy（仅当 `PUBLIC_DOMAIN` 存在）+ Nuxt server；任一进程退出则脚本 exit；缺 `PUBLIC_DOMAIN` 时打印警告但不阻断 Nuxt 启动
- [x] 6.5 `Dockerfile` `ENTRYPOINT` 改为 `["/entrypoint.sh"]`；`EXPOSE 3000 80 443 65000`
- [x] 6.6 `.env.example` 追加 `MITM_LISTEN_HOST`、`MITM_PROXY_AUTH`、`CREDENTIAL_PUBLIC_HOST`、`PUBLIC_DOMAIN`、`CADDY_ACME_EMAIL` 五项及注释

## 7. Compose 编排

- [x] 7.1 新增 `compose.yaml`：单 service `app`，端口映射 `80:80` / `443:443` / `65000:65000`，build 上下文为仓库根
- [x] 7.2 volumes 持久化 4 份：credentials / kv / caddy / mitmproxy CA（让手机始终复用同一张 CA 证书）
- [x] 7.3 `restart: unless-stopped`；`env_file: .env`

## 8. 文档

- [x] 8.1 新增 `docs/deployment-vps-domain-caddy.md`：从零部署到 VPS 的完整步骤（DNS A 记录、`.env`、防火墙、`docker compose up`、健康检查、故障排查、安全提示）
- [x] 8.2 新增 `docs/mobile-surfboard-setup.md`：iOS Surfboard / Android NekoBox 配代理与装 mitm 证书的图文步骤；含 iOS 证书信任开关、Android 凭据安装、常见坑
- [x] 8.3 README.md 新增"远程部署"小节并链接到上述两份文档

## 9. 本地兼容性回归

- [ ] 9.1 `yarn dev` 启动：确认 mitm 仍监听 `127.0.0.1:65000`、不要求 auth、`/api/credential/status` 返回 `mode: 'local'`、CredentialsDialog 提示文案保持原样
- [ ] 9.2 已有 `tracking → final_collecting → done` 流程在没有 awaiting 暂态介入时行为不变
- [ ] 9.3 `auto_track_enabled = false` 的暂停语义仍优先于 credential 检查：暂停任务即使缺 credential 也不切 `awaiting_credential`，保持 `tracking`

## 10. 远程部署冒烟（人工）

- [ ] 10.1 在 VPS 执行 `docker compose up -d`，60 秒内 Caddy 完成 LE 签发，浏览器访问 `https://${PUBLIC_DOMAIN}` 返回 Dashboard，`/api/credential/status` 返回 `mode: 'remote'`
- [ ] 10.2 浏览器 Dashboard 远程模式扫二维码下载证书；手机 Surfboard 配代理（含 auth）+ 装证书 + iOS 信任开关；微信打开公众号文章，浏览器 Dashboard 在 5 秒内收到该公众号 credential
- [ ] 10.3 手动制造 `awaiting_credential`（先删 localStorage 中某 fakeid 的 cred，再触发自动发现该公众号的新文章），验证：
  - 任务进入 `awaiting_credential`
  - tab 失焦时收到一条系统通知
  - 手机微信打开该公众号一篇文章 → cred 到达 → 任务自动切回 `tracking` 并补完同步
- [ ] 10.4 关闭 VPS 容器，确认本地 `yarn dev` 模式不受任何影响
