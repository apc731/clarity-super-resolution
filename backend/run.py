#!/usr/bin/env python
"""开发入口：``python run.py``（带热重载）。

正式演示建议用仓库根目录的 ``start.ps1`` / ``start.sh``：
它会先构建前端，再由这一个进程把界面和接口一起托管在一个端口上。
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.config import settings  # noqa: E402


def main() -> None:
    import uvicorn

    print(f"Real-ESRGAN Web  backend  http://{settings.host}:{settings.port}")
    print(f"API 文档                  http://{settings.host}:{settings.port}/docs")
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()
