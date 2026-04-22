## ADDED Requirements

### Requirement: 部署模式区分

系统 SHALL 通过环境变量自动识别"本地开发模式"与"远程部署模式"两种 credential 抓取服务运行形态，并在两种模式下保持核心抓取逻辑（mitm 解析 Set-Cookie、写入 credentials.json、WS 广播）完全一致。

#### Scenario: 本地开发模式
- **WHEN** 进程启动时检测不到 `MITM_PROXY_AUTH` 环境变量
- **THEN** mitmdump 监听 `127.0.0.1:${CREDENTIAL_MITM_PORT}` 且不要求 Basic Auth；`/api/credential/status` 返回 `mode: 'local'`、`proxyAuthEnabled: false`、`publicHost: null`

#### Scenario: 远程部署模式
- **WHEN** 进程启动时同时检测到 `MITM_PROXY_AUTH` 与 `MITM_LISTEN_HOST=0.0.0.0`
- **THEN** mitmdump 监听 `0.0.0.0:${CREDENTIAL_MITM_PORT}` 且追加 `--proxyauth ${MITM_PROXY_AUTH}` 启动参数；`/api/credential/status` 返回 `mode: 'remote'`、`proxyAuthEnabled: true`、`publicHost: ${CREDENTIAL_PUBLIC_HOST}`

#### Scenario: 部分配置时安全降级
- **WHEN** 设置了 `MITM_LISTEN_HOST=0.0.0.0` 但未设置 `MITM_PROXY_AUTH`
- **THEN** 进程启动失败并输出明确错误日志（`mitm 暴露公网时必须配置 MITM_PROXY_AUTH`），不允许"裸奔"启动

### Requirement: 远程模式的端口与暴露策略

远程部署模式下，系统 SHALL 通过自有域名 + Caddy 反代对外提供 HTTPS Web 服务，并通过独立的 mitm 端口对外提供代理服务。Caddy 自动向 Let's Encrypt 申请并续签证书。

#### Scenario: Caddy + mitm + Nuxt 共启动
- **WHEN** 容器启动且 `PUBLIC_DOMAIN` 与 `MITM_PROXY_AUTH` 均已设置
- **THEN** entrypoint 脚本同时拉起 `caddy run --config /etc/caddy/Caddyfile`、`mitmdump`、`node server/index.mjs` 三个进程；Caddy 监听 80/443，反代到 `127.0.0.1:3000`；任一进程退出 SHALL 触发容器整体退出（依赖 docker restart 策略恢复）

#### Scenario: PUBLIC_DOMAIN 缺失
- **WHEN** 容器启动且 `PUBLIC_DOMAIN` 未设置但 `MITM_PROXY_AUTH` 已设置
- **THEN** entrypoint 仅启动 mitmdump 与 Nuxt（不拉 Caddy），允许用户自行用其它方式（如外部 nginx）反代 Nuxt，但日志输出明确警告"未配置 PUBLIC_DOMAIN，Web 未自动暴露 HTTPS"

#### Scenario: HTTPS 证书自动签发
- **WHEN** 容器首次启动且 `PUBLIC_DOMAIN` 已设置、80/443 端口对外可达、域名已正确解析到 VPS IP
- **THEN** Caddy 在 60 秒内完成 Let's Encrypt 证书申请；浏览器访问 `https://${PUBLIC_DOMAIN}` 显示绿锁，请求转发到 Nuxt server 正常响应

### Requirement: credential WS 推送在远程模式下的复用

远程部署模式下，credentials.json 写入与 WS 广播链路 SHALL 与本地模式完全一致；浏览器通过 Caddy 反代建立 WSS 长连接（`wss://${PUBLIC_DOMAIN}/api/credential/ws`）消费 credential，不需要感知 mitm 在本地还是远程。

#### Scenario: 远程 credential 推送
- **WHEN** 手机通过 Surfboard 经 mitm 抓到一条新 credential 写入 `credentials.json`
- **THEN** 容器内 Nuxt server 的 file watcher 在 5 秒内感知到变化，通过 WS 把完整 credential 列表广播给所有连接的浏览器；浏览器写入 localStorage 与本地模式无差别

#### Scenario: WSS 长连接稳定性
- **WHEN** 浏览器通过 Caddy 建立 WSS 长连接消费 credential 推送
- **THEN** 连接 SHALL 保持长时间不被反代层主动关闭（不存在类似 CF Tunnel 的 100s 强断），仅在网络中断或 server 重启时断开

### Requirement: status 接口扩展

`GET /api/credential/status` SHALL 在原有 `running / proxyAddress / port / credentialCount` 字段基础上，新增 `mode`、`publicHost`、`proxyAuthEnabled`、`certUrl` 四个字段以驱动 UI 文案差异与证书下载入口。

#### Scenario: 远程模式下展示公网地址与证书入口
- **WHEN** 浏览器调用 `GET /api/credential/status` 且服务在远程模式运行
- **THEN** 响应体包含 `mode: 'remote'`、`publicHost: '<VPS 公网 IP 或域名>'`、`proxyAuthEnabled: true`、`certUrl: '/api/credential/cert?fmt=pem'`，CredentialsDialog 据此提示用户"代理地址 = `${publicHost}:${port}`，账号见环境变量"并渲染指向 `certUrl` 的二维码

#### Scenario: 本地模式下兼容老 UI
- **WHEN** 浏览器调用 `GET /api/credential/status` 且服务在本地模式运行
- **THEN** 响应体的 `mode: 'local'`、`publicHost: null`、`proxyAuthEnabled: false`、`certUrl: null`；CredentialsDialog 沿用原有"将系统代理设为 127.0.0.1:${port}"提示

### Requirement: mitm CA 证书自服务

远程部署模式下，系统 SHALL 提供 `GET /api/credential/cert?fmt=pem|crt` 路由直接返回 mitmproxy 的 CA 公钥证书（`mitmproxy-ca-cert.pem`），用于手机端浏览器扫码下载安装；本地模式 MUST 返回 404。

#### Scenario: 远程模式下下载 PEM 格式
- **WHEN** 客户端在远程模式下请求 `GET /api/credential/cert?fmt=pem`
- **THEN** 返回 200，`Content-Type: application/x-pem-file`，`Content-Disposition: attachment; filename="mitmproxy-ca-cert.pem"`，body 为容器内 `~/.mitmproxy/mitmproxy-ca-cert.pem` 的完整内容

#### Scenario: 远程模式下下载 CRT 格式
- **WHEN** 客户端请求 `GET /api/credential/cert?fmt=crt`
- **THEN** 返回 200，`Content-Type: application/x-x509-ca-cert`，`Content-Disposition: attachment; filename="mitmproxy-ca-cert.crt"`，body 与 PEM 完全一致（仅文件名与 MIME 不同，方便 Android 一键识别）

#### Scenario: 证书文件尚未生成
- **WHEN** mitmdump 刚启动尚未生成 CA 文件，客户端请求 cert 路由
- **THEN** 返回 503，body 为 `{ "error": "mitm CA not ready, retry later" }`

#### Scenario: 本地模式拒绝服务
- **WHEN** 服务在本地开发模式运行（`mode === 'local'`），客户端请求 `GET /api/credential/cert`
- **THEN** 返回 404；本地模式下用户应使用 mitm.it 或本机文件系统直接拿证书

#### Scenario: 不需要鉴权
- **WHEN** 任意客户端在远程模式下请求 cert 路由（不带 auth header / 不带 token）
- **THEN** 返回 200 + 证书内容；该端点 MUST NOT 要求任何鉴权——CA 公钥本身公开下载不增加攻击面，加 auth 反而破坏首次配置流程

### Requirement: 镜像与运维约束

Docker 镜像 SHALL 内置 `mitmproxy`、`caddy` 二进制及其依赖，并通过单一 entrypoint 脚本编排启动；compose 文件 SHALL 通过 `.env` 注入所有运行时配置。

#### Scenario: 镜像自包含
- **WHEN** 用户在干净的 Linux VPS 上执行 `docker compose up -d`
- **THEN** 不需要在宿主机额外安装任何依赖（含 Python / mitmproxy / Caddy），镜像启动 30 秒内完成 mitm + Caddy + Nuxt 全部就绪（首次 LE 证书签发可能额外耗 30-60 秒）

#### Scenario: 配置注入
- **WHEN** 用户编辑 `.env` 设置 `MITM_PROXY_AUTH=user:pass`、`PUBLIC_DOMAIN=wechat.tommiao.com`、`CADDY_ACME_EMAIL=me@example.com`、`CREDENTIAL_PUBLIC_HOST=1.2.3.4`、`NUXT_AGGRID_LICENSE=...`
- **THEN** 容器启动后 `/api/credential/status` 返回的 `publicHost` 与设置一致；mitm 用 `--proxyauth user:pass` 启动；Caddy 用 `PUBLIC_DOMAIN` 自动签发 LE 证书并反代到 Nuxt
