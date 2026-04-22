#!/usr/bin/env bash
# 容器入口：按需启动 Caddy（HTTPS 反代）+ 始终启动 Nuxt（mitmdump 由 Nuxt plugin 内部拉起）。
# 任一进程退出则脚本退出，让 Docker 重新拉起整个容器，避免出现"半死"状态。
set -eo pipefail

cleanup() {
    echo "[entrypoint] shutting down..."
    [[ -n "${CADDY_PID:-}" ]] && kill -TERM "$CADDY_PID" 2>/dev/null || true
    [[ -n "${NUXT_PID:-}" ]]  && kill -TERM "$NUXT_PID"  2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Caddy 仅在配置了域名时启动，纯 HTTP 调试场景可以省略
if [[ -n "${PUBLIC_DOMAIN:-}" ]]; then
    : "${CADDY_ACME_EMAIL:=admin@${PUBLIC_DOMAIN}}"
    export PUBLIC_DOMAIN CADDY_ACME_EMAIL
    echo "[entrypoint] rendering Caddyfile for ${PUBLIC_DOMAIN}"
    envsubst '${PUBLIC_DOMAIN} ${CADDY_ACME_EMAIL}' \
        < /etc/caddy/Caddyfile.template \
        > /etc/caddy/Caddyfile

    echo "[entrypoint] starting Caddy"
    caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
    CADDY_PID=$!
else
    echo "[entrypoint] PUBLIC_DOMAIN is empty, skipping Caddy (HTTP-only mode)"
fi

echo "[entrypoint] starting Nuxt server"
node server/index.mjs &
NUXT_PID=$!

# 任一子进程退出就让脚本退出（exit code 来自首个退出的子进程）
wait -n
EXIT_CODE=$?
echo "[entrypoint] a child process exited with code ${EXIT_CODE}, shutting down"
exit "$EXIT_CODE"
