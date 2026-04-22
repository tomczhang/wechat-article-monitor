# 编译层
FROM node:22-alpine AS build-env

# 安装 Yarn (pin a specific Yarn version)
RUN corepack enable
RUN corepack prepare yarn@1.22.22 --activate


# 设置工作目录
WORKDIR /app

# 复制 package.json 和 lock 文件，安装依赖
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true && yarn cache clean

# 复制源代码
COPY . .

# 构建 Nuxt 应用（生成 .output 目录）
ENV NODE_ENV=production \
    NITRO_KV_DRIVER=fs \
    NITRO_KV_BASE=.data/kv

RUN yarn build


# 运行时层
FROM node:22-slim

ARG VERSION=unknown

# 添加 LABEL 元数据
LABEL maintainer="findsource@proton.me" \
      version="${VERSION}" \
      description="wechat-article-exporter Docker Image" \
      org.opencontainers.image.source="https://github.com/wechat-article/wechat-article-exporter" \
      org.opencontainers.image.description="一个在线的微信公众号文章批量下载工具，支持下载阅读量与评论数据，支持私有化部署，通过浏览器进行使用，无需进行安装" \
      org.opencontainers.image.licenses="MIT"

# 系统依赖：
# - Chromium / 中文字体 / CA：PDF 导出与文章渲染（原有）
# - python3 / pip：跑 credential-service/credential.py + mitmproxy
# - gettext-base：entrypoint 用 envsubst 渲染 Caddyfile
# - curl / gnupg / debian-keyring：安装 Caddy 官方仓库
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium fonts-noto-cjk fonts-noto-color-emoji ca-certificates \
        python3 python3-pip python3-venv \
        gettext-base curl gnupg debian-keyring debian-archive-keyring apt-transport-https \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        > /etc/apt/sources.list.d/caddy-stable.list \
    && apt-get update && apt-get install -y --no-install-recommends caddy \
    && apt-get purge -y --auto-remove gnupg \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# 设置工作目录
WORKDIR /app

# 安装 credential-service 的 Python 依赖（mitmproxy + beautifulsoup4）
# Debian Bookworm 起 pip 默认拒绝向系统 site-packages 安装（PEP 668），
# 容器内用 --break-system-packages 是安全的（容器即沙箱）
COPY credential-service/requirements.txt /app/credential-service/requirements.txt
RUN pip install --break-system-packages --no-cache-dir -r /app/credential-service/requirements.txt

# 复制 credential 抓包脚本与构建输出
COPY credential-service/credential.py /app/credential-service/credential.py
COPY --from=build-env /app/.output ./

# 复制 Caddy 模板与入口脚本
COPY Caddyfile.template /etc/caddy/Caddyfile.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 创建运行时目录：KV / credential 数据 / Caddy 数据
RUN mkdir -p /app/.data/kv /app/credential-service/data /data/caddy

# 暴露端口：3000 Nuxt（不直接对外）/ 80,443 Caddy / 65000 mitm
EXPOSE 3000 80 443 65000

# 运行时环境变量
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HOME=/root

ENTRYPOINT ["/entrypoint.sh"]
