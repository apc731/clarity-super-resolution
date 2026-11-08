"""HTTP 接口。

和旧版的四个差别，都是"用户能直接感觉到"的差别：

* 上传会真的校验（类型、大小、能不能解码、像素上限），错误信息是人话。
* ``/api/tasks`` 的参数走 JSON body 的 Pydantic 模型，不再被当成 query 丢掉。
* 任务状态里带真实分块进度、ETA、耗时、输出尺寸——进度条不再是装饰。
* 结果文件通过 ``/api/tasks/{id}/file/{kind}`` 取，路径全部由服务端给出，
  前端不再拼 ``/uploads/xxx`` 这种会 404 的地址。
"""

from __future__ import annotations

import io
import logging
import mimetypes
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from app.config import Settings
from app.services.engine import DEFAULT_MODEL, EngineUnavailable, MODELS
from app.services.tasks import TaskManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

_FORMAT_EXT = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "BMP": ".bmp", "TIFF": ".tif"}


class EnhanceRequest(BaseModel):
    file_id: str = Field(..., description="上传接口返回的 file_id")
    original_name: str = Field(default="", description="原始文件名，仅用于下载时命名")
    model: str = Field(default=DEFAULT_MODEL, description="模型名称")
    outscale: float = Field(default=4.0, ge=1.0, le=8.0, description="输出放大倍数")
    face_enhance: bool = Field(default=False, description="是否启用人脸修复")


class EnhanceResponse(BaseModel):
    task_id: str
    status: str
    queue_position: int


def build_router(settings: Settings, engine, tasks: TaskManager) -> APIRouter:
    # ------------------------------------------------------------------ meta
    @router.get("/health")
    def health() -> dict:
        device = engine.device_info()
        return {
            "status": "ok" if device.get("ready") else "degraded",
            "version": settings.version,
            "device": device,
            "queue": tasks.queue_depth(),
            "config": settings.as_public_dict(),
        }

    @router.get("/models")
    def models() -> dict:
        return {
            "models": engine.model_states(),
            "default": DEFAULT_MODEL,
            "face_enhance": engine.face_enhance_state(),
            "device": engine.device_info(),
        }

    # ---------------------------------------------------------------- upload
    @router.post("/uploads")
    async def upload(file: UploadFile = File(...)) -> dict:
        if not file.filename:
            raise HTTPException(status_code=400, detail="没有选择文件。")

        suffix = Path(file.filename).suffix.lower()
        if suffix and suffix not in settings.allowed_exts:
            raise HTTPException(
                status_code=415,
                detail=f"不支持 {suffix} 格式，支持：{'、'.join(e.lstrip('.') for e in settings.allowed_exts)}。",
            )

        max_bytes = settings.max_upload_mb * 1024 * 1024
        buffer = bytearray()
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            buffer.extend(chunk)
            if len(buffer) > max_bytes:
                raise HTTPException(status_code=413, detail=f"图片超过 {settings.max_upload_mb} MB，请先压缩一下。")

        if not buffer:
            raise HTTPException(status_code=400, detail="文件是空的。")

        # 用 Pillow 真正解一次，顺便拿尺寸：伪造扩展名的文件在这里就会被拦下
        try:
            with Image.open(io.BytesIO(bytes(buffer))) as probe:
                fmt = (probe.format or "").upper()
                width, height = probe.size
        except (UnidentifiedImageError, OSError):
            raise HTTPException(status_code=415, detail="这个文件不是可识别的图片。") from None

        if fmt not in _FORMAT_EXT:
            raise HTTPException(status_code=415, detail=f"暂不支持 {fmt} 图片，请转成 JPG / PNG / WebP。")
        if width * height > settings.max_input_pixels:
            raise HTTPException(
                status_code=413,
                detail=f"图片有 {width}×{height}，超过 {settings.max_input_pixels // 1_000_000} 百万像素上限。",
            )

        file_id = uuid.uuid4().hex
        ext = _FORMAT_EXT[fmt]
        path = settings.upload_dir / f"{file_id}{ext}"
        path.write_bytes(bytes(buffer))

        logger.info("upload %s (%s, %sx%s, %.1f KB)", file_id, fmt, width, height, len(buffer) / 1024)
        return {
            "file_id": file_id,
            "filename": path.name,
            "original_name": Path(file.filename).name,
            "format": fmt,
            "size": len(buffer),
            "width": width,
            "height": height,
            "url": f"/api/uploads/{file_id}",
        }

    @router.get("/uploads/{file_id}")
    def get_upload(file_id: str, download: bool = False) -> FileResponse:
        for candidate in settings.upload_dir.glob(f"{file_id}.*"):
            if candidate.is_file():
                return FileResponse(
                    candidate,
                    media_type=None,
                    filename=f"source{candidate.suffix}" if download else None,
                )
        raise HTTPException(status_code=404, detail="找不到这个文件，可能已过期，请重新上传。")

    # ------------------------------------------------------------------ tasks
    @router.post("/tasks", response_model=EnhanceResponse, status_code=202)
    def create_task(payload: EnhanceRequest) -> EnhanceResponse:
        if payload.model not in MODELS:
            raise HTTPException(status_code=400, detail=f"未知模型：{payload.model}")
        if not any(settings.upload_dir.glob(f"{payload.file_id}.*")):
            raise HTTPException(status_code=404, detail="找不到上传的原图，请重新上传。")
        if tasks.queue_depth() >= settings.max_queue:
            raise HTTPException(status_code=429, detail="队列满了，等当前任务结束后再提交。")

        face_state = engine.face_enhance_state()
        if payload.face_enhance and not face_state.get("available"):
            raise HTTPException(status_code=400, detail=face_state.get("reason", "当前环境不支持人脸增强。"))

        try:
            task = tasks.submit(
                file_id=payload.file_id,
                original_name=Path(payload.original_name).name,
                model=payload.model,
                outscale=payload.outscale,
                face_enhance=payload.face_enhance,
            )
        except EngineUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        return EnhanceResponse(task_id=task.id, status=task.status, queue_position=tasks.queue_depth())

    @router.get("/tasks/{task_id}")
    def get_task(task_id: str) -> dict:
        task = tasks.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="任务不存在。")
        return task.public()

    @router.post("/tasks/{task_id}/cancel")
    def cancel_task(task_id: str) -> dict:
        result = tasks.cancel(task_id)
        if result is None:
            raise HTTPException(status_code=404, detail="任务不存在。")
        if result is False:
            raise HTTPException(status_code=409, detail="任务已经结束，无法取消。")
        return {"task_id": task_id, "status": "cancelling"}

    @router.delete("/tasks/{task_id}")
    def delete_task(task_id: str) -> dict:
        if not tasks.delete(task_id):
            raise HTTPException(status_code=404, detail="任务不存在。")
        return {"task_id": task_id, "deleted": True}

    @router.get("/tasks/{task_id}/file/{kind}")
    def get_task_file(
        task_id: str,
        kind: Literal["input", "result", "preview", "thumbnail"],
        download: bool = False,
    ) -> FileResponse:
        task = tasks.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="任务不存在。")
        path = tasks.file_path(task, kind)
        if path is None or not path.is_file():
            raise HTTPException(status_code=404, detail="文件还没生成，或者已被清理。")

        media_types = {
            "result": "image/png",
            "preview": "image/jpeg",
            "thumbnail": "image/webp",
        }
        media_type = media_types.get(kind) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"

        if download:
            stem = Path(task.original_name).stem if task.original_name else "image"
            if kind == "result":
                filename = f"{stem}_x{task.outscale:g}.png"
            elif kind == "input":
                filename = f"{stem}{path.suffix}"
            else:
                filename = f"{stem}_{kind}{path.suffix}"
        else:
            filename = None
        return FileResponse(path, media_type=media_type, filename=filename)

    return router
