#!/usr/bin/env bash
# 一条命令起服务（macOS / Linux）：构建前端 → 同一个进程托管界面 + 接口。
#
#   ./start.sh                 首次会自动构建前端
#   ./start.sh --rebuild       强制重新构建
#   PORT=9000 ./start.sh       换端口
#
# 需要：Python 环境里已装 torch 与 Real-ESRGAN 依赖，见 README。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PYTHON="${REALESRGAN_PYTHON:-}"
if [[ -z "$PYTHON" ]]; then
  for candidate in "$(command -v python3 || true)" "$(command -v python || true)"; do
    if [[ -n "$candidate" ]]; then PYTHON="$candidate"; break; fi
  done
fi
if [[ -z "$PYTHON" ]]; then
  echo "找不到 python3，请先安装或设置 REALESRGAN_PYTHON" >&2
  exit 1
fi

echo "python: $PYTHON"
if ! "$PYTHON" -c "import torch, fastapi, cv2" 2>/dev/null; then
  echo ""
  echo "依赖没装好。先看 README 的「安装」一节，或手动执行："
  echo "  $PYTHON -m pip install -r backend/requirements.txt"
  echo "  并确保 REALESRGAN_ROOT 指向 Real-ESRGAN 源码目录（或 pip install realesrgan basicsr）"
  exit 1
fi

if [[ "${1:-}" == "--rebuild" || ! -f frontend/dist/index.html ]]; then
  echo "构建前端…"
  cd frontend
  if [[ ! -d node_modules ]]; then npm ci; fi
  npm run build
  cd ..
fi

echo "启动中… 打开 http://127.0.0.1:${PORT:-8000}"
exec "$PYTHON" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port "${PORT:-8000}"
