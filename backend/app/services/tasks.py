"""任务队列与结果落盘。

关键点：推理是同步、耗 CPU/GPU 的重活，所以放在单线程 worker 里跑，
HTTP 事件循环永远不被阻塞——轮询能拿到真实进度，页面也不会"卡住然后突然完成"。
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from app.config import Settings
from app.services.engine import (
    DEFAULT_MODEL,
    JobCancelled,
    ProgressReporter,
    UpscaleEngine,
)

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat().replace("+00:00", "Z") if value else None


STAGE_LABELS = {
    "queued": "排队中",
    "model": "载入模型",
    "read": "读取图像",
    "upscale": "超分推理",
    "face": "人脸增强",
    "save": "写入结果",
    "done": "完成",
    "failed": "失败",
    "cancelled": "已取消",
}

STAGE_WEIGHT = {  # 每个阶段在总进度里的起点
    "queued": 0,
    "model": 4,
    "read": 8,
    "upscale": 10,
    "face": 88,
    "save": 92,
    "done": 100,
}


@dataclass
class Task:
    id: str
    file_id: str
    original_name: str
    model: str
    outscale: float
    face_enhance: bool
    status: str = "queued"
    stage: str = "queued"
    progress: int = 0
    tiles_done: int = 0
    tiles_total: int = 0
    eta_seconds: Optional[float] = None
    created_at: datetime = field(default_factory=_utcnow)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error: Optional[str] = None
    meta: dict = field(default_factory=dict)
    outputs: Dict[str, Path] = field(default_factory=dict)
    cancel_requested: bool = False
    _tile_started: float = 0.0

    def public(self) -> dict:
        return {
            "task_id": self.id,
            "file_id": self.file_id,
            "original_name": self.original_name,
            "status": self.status,
            "stage": self.stage,
            "stage_label": STAGE_LABELS.get(self.stage, self.stage),
            "progress": self.progress,
            "tiles_done": self.tiles_done,
            "tiles_total": self.tiles_total,
            "eta_seconds": self.eta_seconds,
            "params": {
                "model": self.model,
                "outscale": self.outscale,
                "face_enhance": self.face_enhance,
            },
            "error": self.error,
            "created_at": _iso(self.created_at),
            "started_at": _iso(self.started_at),
            "finished_at": _iso(self.finished_at),
            "elapsed_seconds": round(
                ((self.finished_at or _utcnow()) - (self.started_at or self.created_at)).total_seconds(), 1
            ),
            "meta": self.meta,
            "files": {
                "input": f"/api/tasks/{self.id}/file/input" if "input" in self.outputs else None,
                "result": f"/api/tasks/{self.id}/file/result" if "result" in self.outputs else None,
                "preview": f"/api/tasks/{self.id}/file/preview" if "preview" in self.outputs else None,
                "thumbnail": f"/api/tasks/{self.id}/file/thumbnail" if "thumbnail" in self.outputs else None,
            },
            "bytes": {kind: (path.stat().st_size if path.is_file() else None) for kind, path in self.outputs.items()},
        }


class TaskManager:
    def __init__(self, settings: Settings, engine: UpscaleEngine) -> None:
        self._settings = settings
        self._engine = engine
        self._tasks: Dict[str, Task] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="upscale-worker")

    # ------------------------------------------------------------------ queue
    def queue_depth(self) -> int:
        with self._lock:
            return sum(1 for t in self._tasks.values() if t.status == "queued")

    def submit(self, *, file_id: str, original_name: str, model: str, outscale: float, face_enhance: bool) -> Task:
        known = {state["name"] for state in self._engine.model_states()}
        if model not in known:
            raise ValueError(f"未知模型：{model}")

        task = Task(
            id=str(uuid.uuid4()),
            file_id=file_id,
            original_name=original_name,
            model=model or DEFAULT_MODEL,
            outscale=float(outscale),
            face_enhance=bool(face_enhance),
        )
        with self._lock:
            self._tasks[task.id] = task
        self._executor.submit(self._run, task)
        return task

    def get(self, task_id: str) -> Optional[Task]:
        with self._lock:
            return self._tasks.get(task_id)

    def cancel(self, task_id: str) -> Optional[bool]:
        task = self.get(task_id)
        if task is None:
            return None
        if task.status in ("completed", "failed", "cancelled"):
            return False
        task.cancel_requested = True
        if task.status == "queued":
            self._finish_cancelled(task)
        return True

    def delete(self, task_id: str) -> bool:
        task = self.get(task_id)
        if task is None:
            return False
        for path in list(task.outputs.values()):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        meta_path = self._settings.result_dir / f"{task.id}_meta.json"
        meta_path.unlink(missing_ok=True)
        with self._lock:
            self._tasks.pop(task_id, None)
        return True

    # ----------------------------------------------------------------- worker
    def _run(self, task: Task) -> None:
        if task.cancel_requested:
            self._finish_cancelled(task)
            return

        task.status = "running"
        task.started_at = _utcnow()
        upload_path = self._find_upload(task.file_id)
        if upload_path is None:
            self._fail(task, "找不到上传的原图，请重新上传。")
            return

        reporter = ProgressReporter(
            on_stage=lambda stage, label: self._set_stage(task, stage),
            on_tiles=lambda done, total, elapsed: self._set_tiles(task, done, total, elapsed),
            check_cancel=lambda: self._raise_if_cancelled(task),
        )

        try:
            output, meta = self._engine.run(
                image_path=upload_path,
                model_name=task.model,
                outscale=task.outscale,
                face_enhance=task.face_enhance,
                progress=reporter,
            )
            self._raise_if_cancelled(task)
            self._set_stage(task, "save", progress=92)
            files = self._save_outputs(task, output, upload_path)
            task.meta = meta
            task.outputs = files
            task.progress = 100
            task.stage = "done"
            task.status = "completed"
            task.finished_at = _utcnow()
            self._write_meta(task)
            logger.info(
                "task %s done: %sx%s -> %sx%s in %ss",
                task.id,
                meta["source_width"],
                meta["source_height"],
                meta["output_width"],
                meta["output_height"],
                meta["inference_seconds"],
            )
        except JobCancelled:
            self._finish_cancelled(task)
        except Exception as exc:  # noqa: BLE001 - 统一转成用户可读的失败状态
            logger.exception("task %s failed", task.id)
            self._fail(task, self._humanize(exc))

    # --------------------------------------------------------------- progress
    def _set_stage(self, task: Task, stage: str, progress: Optional[int] = None) -> None:
        task.stage = stage
        if progress is not None:
            task.progress = progress
        else:
            task.progress = max(task.progress, STAGE_WEIGHT.get(stage, task.progress))

    def _set_tiles(self, task: Task, done: int, total: int, elapsed: float) -> None:
        task.tiles_done = done
        task.tiles_total = total
        base = STAGE_WEIGHT["upscale"]
        span = STAGE_WEIGHT["face"] - base
        ratio = (done / total) if total else 0
        task.progress = int(base + span * ratio)
        if done > 0 and total > done and elapsed > 0:
            per_tile = elapsed / done
            task.eta_seconds = round(per_tile * (total - done), 1)
        elif total and done >= total:
            task.eta_seconds = 2.0

    def _raise_if_cancelled(self, task: Task) -> None:
        if task.cancel_requested:
            raise JobCancelled()

    def _finish_cancelled(self, task: Task) -> None:
        task.status = "cancelled"
        task.stage = "cancelled"
        task.finished_at = _utcnow()
        task.progress = 0
        task.eta_seconds = None

    def _fail(self, task: Task, message: str) -> None:
        task.status = "failed"
        task.stage = "failed"
        task.error = message
        task.finished_at = _utcnow()
        task.eta_seconds = None

    @staticmethod
    def _humanize(exc: Exception) -> str:
        text = str(exc).strip() or type(exc).__name__
        if "out of memory" in text.lower():
            return "显存不够了。可以调小 TILE_SIZE（例如 256）或换 2× 模型再试。"
        return text

    # ------------------------------------------------------------------ files
    def _find_upload(self, file_id: str) -> Optional[Path]:
        for candidate in self._settings.upload_dir.glob(f"{file_id}.*"):
            if candidate.is_file():
                return candidate
        return None

    def _save_outputs(self, task: Task, output: np.ndarray, upload_path: Path) -> Dict[str, Path]:
        import cv2
        from PIL import Image

        result_dir = self._settings.result_dir
        result_dir.mkdir(parents=True, exist_ok=True)
        files: Dict[str, Path] = {}

        # 原图副本：结果目录自成一体，删了 uploads 也能对比
        input_copy = result_dir / f"{task.id}_input{upload_path.suffix.lower()}"
        shutil.copyfile(upload_path, input_copy)
        files["input"] = input_copy

        result_path = result_dir / f"{task.id}_result.png"
        if not cv2.imwrite(str(result_path), output):
            raise RuntimeError("写入结果 PNG 失败（磁盘空间不足？）")
        files["result"] = result_path

        pil = Image.fromarray(cv2.cvtColor(output, cv2.COLOR_BGR2RGB))
        preview = pil.copy()
        preview.thumbnail((self._settings.preview_max_side, self._settings.preview_max_side), Image.LANCZOS)
        preview_path = result_dir / f"{task.id}_preview.jpg"
        preview.save(preview_path, "JPEG", quality=self._settings.preview_quality, optimize=True, progressive=True)
        files["preview"] = preview_path

        thumb = pil.copy()
        width = min(self._settings.thumbnail_width, pil.width)
        thumb.thumbnail((width, width * 10), Image.LANCZOS)
        thumb_path = result_dir / f"{task.id}_thumb.webp"
        thumb.save(thumb_path, "WEBP", quality=78, method=4)
        files["thumbnail"] = thumb_path
        return files

    def _write_meta(self, task: Task) -> None:
        payload = task.public()
        payload["sizes"] = {
            "result_bytes": task.outputs["result"].stat().st_size if "result" in task.outputs else None,
            "preview_bytes": task.outputs["preview"].stat().st_size if "preview" in task.outputs else None,
        }
        payload["settings"] = {"tile": self._settings.tile, "half": self._settings.half}
        try:
            (self._settings.result_dir / f"{task.id}_meta.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError:
            logger.warning("could not write meta for task %s", task.id)

    def file_path(self, task: Task, kind: str) -> Optional[Path]:
        return task.outputs.get(kind)

    # --------------------------------------------------------------- cleanup
    def purge_expired(self) -> int:
        cutoff = time.time() - self._settings.task_keep_hours * 3600
        removed = 0
        with self._lock:
            stale = [
                t
                for t in self._tasks.values()
                if t.status in ("completed", "failed", "cancelled")
                and (t.finished_at or t.created_at).timestamp() < cutoff
            ]
        for task in stale:
            self.delete(task.id)
            removed += 1

        # 清掉无人引用的上传文件（正常流程里结果目录已存了副本）
        try:
            for upload in self._settings.upload_dir.glob("*"):
                if upload.is_file() and upload.stat().st_mtime < cutoff:
                    upload.unlink(missing_ok=True)
            for result in self._settings.result_dir.glob("*"):
                if result.is_file() and result.stat().st_mtime < cutoff:
                    if not any(result.name.startswith(t.id) for t in self._tasks.values()):
                        result.unlink(missing_ok=True)
        except OSError:
            pass
        return removed
