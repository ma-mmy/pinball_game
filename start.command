#!/bin/zsh

set -e

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
    echo "未检测到 Node.js，请先安装 Node.js 后再启动。"
    read -r "REPLY?按回车键退出..."
    exit 1
fi

GAME_PORT="${PORT:-8066}"
GAME_URL="http://localhost:${GAME_PORT}"

echo "开心弹珠机正在启动：${GAME_URL}"
(sleep 1; open "$GAME_URL") &

PORT="$GAME_PORT" exec node server.js
