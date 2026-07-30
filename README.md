<p align="center">
  <img src="./assets/logo.png" width="300" alt="logo">
</p>

<h1 align="center">wechat-article-monitor</h1>

<p align="center">
  微信公众号文章 / 评论自动化监控与导出工具
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node">
  <img src="https://img.shields.io/badge/Nuxt-3-00DC82.svg" alt="Nuxt 3">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6.svg" alt="TypeScript">
</p>

<p align="center">
  <img src="./assets/screenshots/monitor-dashboard.png" alt="监控面板截图" width="900">
</p>

---

## 简介

`wechat-article-monitor` 是一个 **本地优先 (local-first)** 的微信公众号内容采集与归档工具。所有抓取到的文章、评论、阅读量等数据全部存入浏览器端的 IndexedDB，不依赖任何外部数据库即可长期运行。

它既支持一次性的文章批量导出，也支持：

- **关注一组公众号 → 定时轮询 → 自动入库新文章**
- **对入库文章持续追踪评论变化、记录被屏蔽评论的时间线**
- **通过 mitmproxy 抓包服务自动续期凭据，让监控任务无人值守**

适用场景：

- 长期跟踪若干公众号的更新与评论动态
- 把感兴趣的文章归档为多种格式（HTML / Markdown / DOCX / PDF / Excel / JSON / TXT）
- 团队 / 个人内容研究、舆情观察、合规留档

## 核心特性

### 内容采集与监控

- **公众号订阅与文章发现**：关注列表中的公众号定时轮询，新文章自动入库、自动去重
- **评论持续监控**：对入库文章追踪评论增减，记录每条评论的首次出现时间与被屏蔽时间
- **统一监控面板**：所有监控任务在一个页面管理，调度状态、失败次数、最近一次执行时间一目了然
- **重发折叠**：公众号删稿重发时微信会把每次群发都返回一遍，且不一定打删除标记。同一个号下标题相同、发布时间相差 30 分钟以内的记录只显示最新一条（纯展示层过滤，可在设置中关闭）
- **离线可读**：抓取数据本地化存储，断网仍可浏览历史归档

### 多格式批量导出

- **HTML**（打包图片与样式，100% 还原原文排版）
- **Markdown / DOCX / PDF**
- **Excel / JSON / TXT**
- 支持图片消息、视频消息、合集
- 同步导出阅读量、点赞、转发、评论数据

### Credential 抓包服务

- 内置基于 mitmproxy 的本地 Python 服务，捕获微信客户端打开文章页时下发的凭据（`__biz` / `uin` / `key` / `pass_ticket` / `wap_sid2` / `appmsg_token`）
- 凭据有效期约 25 分钟，剩余时间实时显示在凭据面板
- 通过 WebSocket 与前端联动 (`server/api/credential/ws.ts`)，抓到新凭据立即推送
- 主流程（同步文章列表、阅读量、留言、监控）全部依赖它，**无需扫码登录公众号后台**

### 部署

- Docker 容器化
- Cloudflare Pages 一键部署

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Nuxt 3 (SPA) · Vue 3 · TypeScript · Nuxt UI · TailwindCSS · AG Grid Enterprise · Monaco Editor |
| 服务端 | Nitro · Puppeteer (PDF) · Cheerio · Turndown |
| 存储 | Dexie / IndexedDB |
| 调度 | p-queue · 自研 Poller / Scheduler |
| 抓包服务 | Python 3.12+ · mitmproxy |
| 工具链 | Biome · Yarn 1.22 |

## 快速开始

### 环境要求

- Node.js ≥ 22
- Yarn 1.22（通过 corepack 管理）
- Python 3.12+（credential 抓包服务依赖，主流程必需）

### 安装与启动

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn

# credential 抓包服务依赖
cd credential-service && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt && cd ..

cp .env.example .env
yarn dev
```

mitmproxy 由 Nuxt 启动时通过 `server/plugins/credential-service.ts` 自动拉起，优先使用 `credential-service/.venv/bin/mitmdump`，找不到则回退到 PATH 中的全局 `mitmdump`。监听端口由 `CREDENTIAL_MITM_PORT` 控制。

### 获取凭据

1. 打开 <http://localhost:3000>
2. 把手机（或电脑微信）的 HTTP 代理指向 `127.0.0.1:65000`，并安装信任 mitmproxy 根证书（代理生效后访问 <http://mitm.it> 下载）
3. 在微信客户端里打开目标公众号的任意一篇文章
4. 回到网页，凭据面板中会出现该公众号，点「添加公众号」即可开始同步

凭据约 25 分钟过期，过期后重复第 3 步续期即可。

### 凭据与扫码登录的分工

主流程走 Credential，不需要扫码登录公众号后台：

| 功能 | Credential | 扫码登录 |
| --- | :---: | :---: |
| 添加公众号（凭据面板） | 必需 | 否 |
| 同步历史文章列表 | 必需 | 否 |
| 下载正文 HTML | 否（走代理） | 否 |
| 阅读量 / 留言 | 必需 | 否 |
| 新文章发现 / 评论监控 | 必需 | 否 |
| 按名称搜索陌生公众号 | 否 | 必需 |
| Public API (`/api/public/v1/*`) | 否 | 必需 |

搜索是唯一的硬依赖，但可以绕开：只要在微信里打开过目标号的任意一篇文章，凭据面板里就会出现它，文章 URL 中的 `__biz` 就是程序内部使用的 `fakeid`。

### 生产构建

```bash
yarn build       # 生产构建（输出到 .output/）
yarn preview     # Cloudflare Pages 模式本地预览
yarn docker:build
```

## 配置

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `NUXT_AGGRID_LICENSE` | AG Grid Enterprise 授权 | - |
| `NITRO_KV_DRIVER` | 存储驱动（本地/Docker 用 `fs`，Cloudflare 用 `cloudflare-kv-binding`） | `fs` |
| `NITRO_KV_BASE` | KV 数据目录 | `.data/kv` |
| `CREDENTIAL_MITM_PORT` | mitmproxy 监听端口 | `65000` |
| `NUXT_DEBUG_MP_REQUEST` | 是否打印代理请求日志（仅开发） | `false` |
| `DEBUG_KEY` | 调试端点鉴权 | - |

完整变量见 [`.env.example`](./.env.example)。

## 项目结构

```
.
├── apis/                  客户端 API 封装
├── composables/           Vue 组合式 API（监控、下载、导出）
├── components/dashboard/  仪表盘 UI
├── pages/dashboard/       路由页面（监控面板等）
├── server/api/            Nitro 服务端代理 / credential WebSocket
├── store/v2/              Dexie 数据模型
├── utils/monitor/         调度器与 poller
├── utils/download/        下载与导出核心
└── credential-service/    Python mitmproxy 抓包服务
```

## 致谢

- [wechat-article/wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter) — 本项目的起点，原作者 [@Jock](https://github.com/wechat-article)
- [1061700625/WeChat_Article](https://github.com/1061700625/WeChat_Article) — 抓取原理参考

## 许可

[MIT](./LICENSE) © 2024 Jock · 2026 tomczhang

## 免责声明

本工具仅用于公开内容的本地归档与备份。通过本工具获取的微信公众号文章与评论内容，版权归原作者所有，请合理合规使用，严禁用于商业牟利、侵犯他人权益或违反平台规则的行为。

本程序不会利用抓取到的凭据或扫码登录的账号进行任何形式的私有爬虫，凭据与账号仅在使用者本机使用，不会上传至任何第三方服务。
