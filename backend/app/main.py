"""FastAPI 入口。

生产/演示模式下后端同时托管前端构建产物（``frontend/dist``），
所以"一条命令起来"是真的只有一个进程、一个端口。
开发模式下前端跑 Vite（:3000），通过 proxy 转发到这里的 :8000。
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.api.routes import build_router
from app.services.engine import UpscaleEngine
from app.services.tasks import TaskManager


def _configure_logging() -> None:
    """Windows 控制台默认 GBK，日志里任何一个非 ASCII 字符都可能炸掉请求。

    旧版本就是被 ``print("❌ ...")`` 这么搞挂的。这里把标准流切到 UTF-8
    （无法切换时用 replace 兜底），并且统一走 logging，不再裸 print。
    """
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except Exception:
            pass
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


_configure_logging()
logger = logging.getLogger("realesrgan")

settings.ensure_dirs()
engine = UpscaleEngine(settings)
tasks = TaskManager(settings, engine)


@asynccontextmanager
async def lifespan(_: FastAPI):
    device = engine.device_info()
    logger.info("Real-ESRGAN web app %s", settings.version)
    logger.info("data dir      %s", settings.data_dir)
    logger.info("device        %s (%s)", device.get("name"), device.get("precision", "-"))
    logger.info("weights       %s", settings.weights_dir)
    removed = tasks.purge_expired()
    if removed:
        logger.info("purged %s expired task(s)", removed)
    yield


app = FastAPI(
    title="Real-ESRGAN Web",
    description="本地运行的真实图像超分辨率应用",
    version=settings.version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(build_router(settings, engine, tasks))


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error")
    return JSONResponse(status_code=500, content={"detail": f"服务端出错了：{type(exc).__name__}: {exc}"})


@app.get("/", include_in_schema=False)
def index():
    index_file = settings.frontend_dist / "index.html"
    if index_file.is_file():
        return FileResponse(index_file, headers={"Cache-Control": "no-cache"})
    return RedirectResponse(url="/docs")


# 前端构建产物（放在最后，避免抢占 /api 路由）
if (settings.frontend_dist / "index.html").is_file():
    app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="spa")
    logger.info("serving frontend from %s", settings.frontend_dist)
else:
    logger.warning("frontend build not found at %s (run `npm run build` in frontend/)", settings.frontend_dist)


def main() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
