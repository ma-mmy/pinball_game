#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.happy-pinball.pid"
LOG_FILE="$SCRIPT_DIR/happy-pinball.log"
GAME_PORT="${PORT:-8066}"
GAME_URL="http://localhost:${GAME_PORT}"

cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
    echo "未检测到 Node.js，请先安装 Node.js。" >&2
    exit 1
fi

if [[ -f "$PID_FILE" ]]; then
    OLD_PID="$(<"$PID_FILE")"
    if [[ "$OLD_PID" =~ ^[0-9]+$ ]] && kill -0 "$OLD_PID" 2>/dev/null; then
        OLD_CWD="$(readlink -f "/proc/$OLD_PID/cwd" 2>/dev/null || true)"
        OLD_CMD="$(tr '\0' ' ' < "/proc/$OLD_PID/cmdline" 2>/dev/null || true)"

        if [[ "$OLD_CWD" == "$SCRIPT_DIR" && "$OLD_CMD" == *"node server.js"* ]]; then
            echo "检测到正在运行的服务 (PID: $OLD_PID)，正在重启..."
            kill "$OLD_PID"
            for _ in {1..50}; do
                kill -0 "$OLD_PID" 2>/dev/null || break
                sleep 0.1
            done
            if kill -0 "$OLD_PID" 2>/dev/null; then
                kill -KILL "$OLD_PID"
            fi
        else
            echo "PID 文件指向其他进程，未停止该进程。" >&2
        fi
    fi
    rm -f "$PID_FILE"
fi

echo "正在启动开心弹珠机：$GAME_URL"
PORT="$GAME_PORT" nohup node server.js >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

sleep 0.5
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "服务启动失败，请查看日志：$LOG_FILE" >&2
    exit 1
fi

echo "启动成功 (PID: $SERVER_PID)"
echo "日志文件：$LOG_FILE"

if command -v xdg-open >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    xdg-open "$GAME_URL" >/dev/null 2>&1 || true
fi
