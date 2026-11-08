"""集中配置：所有路径与可调参数都可以用环境变量覆盖。

设计原则：代码里不出现任何绝对路径。默认值全部指向仓库内部（``.data/``），
换一台机器克隆下来、装好依赖就能跑；想改位置只需改 ``.env``。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

__version__ = "2.0.0"


def _load_dotenv() -> None:
    """极简 .env 读取，避免额外依赖。已存在的环境变量优先。"""
    for candidate in (REPO_ROOT / ".env", BACKEND_DIR / ".env"):
        if not candidate.is_file():
            continue
        try:
            raw_lines = candidate.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for raw in raw_lines:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key.startswith("export "):
                key = key[len("export ") :].strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


_load_dotenv()


def _str(name: str, default: str) -> str:
    value = os.environ.get(name, "")
    value = value.strip()
    return value or default


def _int(name: str, default: int) -> int:
    try:
        return int(_str(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(_str(name, str(default)))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    value = _str(name, "1" if default else "0").lower()
    return value in ("1", "true", "yes", "on")


def _path(name: str, default: Path) -> Path:
    raw = _str(name, "")
    path = Path(raw).expanduser() if raw else default
    if not path.is_absolute():
        path = (REPO_ROOT / path).resolve()
    return path


def _detect_realesrgan_root() -> Optional[Path]:
    """找到 Real-ESRGAN 源码目录（提供 basicsr / realesrgan 包）。

    优先显式配置，其次常见位置。找不到时返回 None，服务仍可启动，
    但推理接口会返回一条明确的"缺什么、怎么装"的提示，而不是 500 崩溃。
    """
    explicit = os.environ.get("REALESRGAN_ROOT", "").strip()
    candidates: List[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    candidates += [
        REPO_ROOT / "Real-ESRGAN",
        Path("E:/Real-ESRGAN"),
        Path("D:/Real-ESRGAN"),
        Path.home() / "Real-ESRGAN",
        Path("/opt/Real-ESRGAN"),
    ]
    for candidate in candidates:
        if (candidate / "realesrgan" / "utils.py").is_file():
            return candidate.resolve()
    return None


@dataclass(frozen=True)
class Settings:
    # 目录
    repo_root: Path
    backend_dir: Path
    data_dir: Path
    upload_dir: Path
    result_dir: Path
    frontend_dist: Path
    weights_dir: Path
    realesrgan_root: Optional[Path]

    # 推理
    tile: int
    tile_pad: int
    half: bool
    pre_pad: int
    device: str
    face_enhance_upscale_cap: int

    # 上传限制
    max_upload_mb: int
    max_input_pixels: int
    allowed_exts: Tuple[str, ...]

    # 输出
    preview_max_side: int
    preview_quality: int
    thumbnail_width: int

    # 运行
    host: str
    port: int
    max_queue: int
    task_keep_hours: float
    cors_origins: Tuple[str, ...]

    @property
    def version(self) -> str:
        return __version__

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.upload_dir, self.result_dir):
            path.mkdir(parents=True, exist_ok=True)

    def as_public_dict(self) -> dict:
        """暴露给前端的配置（不含任何敏感信息）。"""
        return {
            "version": self.version,
            "tile": self.tile,
            "half": self.half,
            "max_upload_mb": self.max_upload_mb,
            "max_input_pixels": self.max_input_pixels,
            "allowed_exts": list(self.allowed_exts),
            "task_keep_hours": self.task_keep_hours,
        }


def load_settings() -> Settings:
    data_dir = _path("DATA_DIR", REPO_ROOT / ".data")
    realesrgan_root = _detect_realesrgan_root()
    default_weights = (realesrgan_root / "weights") if realesrgan_root else (data_dir / "weights")

    origins_raw = _str("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000")
    origins = tuple(part.strip() for part in origins_raw.split(",") if part.strip())

    exts_raw = _str("ALLOWED_EXTS", "jpg,jpeg,png,webp,bmp,tif,tiff")
    exts = tuple("." + part.strip().lower().lstrip(".") for part in exts_raw.split(",") if part.strip())

    return Settings(
        repo_root=REPO_ROOT,
        backend_dir=BACKEND_DIR,
        data_dir=data_dir,
        upload_dir=_path("UPLOAD_DIR", data_dir / "uploads"),
        result_dir=_path("RESULT_DIR", data_dir / "results"),
        frontend_dist=_path("FRONTEND_DIST", REPO_ROOT / "frontend" / "dist"),
        weights_dir=_path("WEIGHTS_DIR", default_weights),
        realesrgan_root=realesrgan_root,
        tile=_int("TILE_SIZE", 512),
        tile_pad=_int("TILE_PAD", 10),
        half=_bool("HALF_PRECISION", True),
        pre_pad=_int("PRE_PAD", 0),
        device=_str("DEVICE", "auto"),
        face_enhance_upscale_cap=_int("FACE_ENHANCE_MAX_UPSCALE", 2),
        max_upload_mb=_int("MAX_UPLOAD_MB", 20),
        max_input_pixels=_int("MAX_INPUT_PIXELS", 24_000_000),
        allowed_exts=exts,
        preview_max_side=_int("PREVIEW_MAX_SIDE", 2048),
        preview_quality=_int("PREVIEW_QUALITY", 88),
        thumbnail_width=_int("THUMBNAIL_WIDTH", 480),
        host=_str("HOST", "127.0.0.1"),
        port=_int("PORT", 8000),
        max_queue=_int("MAX_QUEUE", 4),
        task_keep_hours=_float("TASK_KEEP_HOURS", 24),
        cors_origins=origins,
    )


settings = load_settings()
