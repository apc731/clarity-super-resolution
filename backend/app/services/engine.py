"""Real-ESRGAN 推理封装。

三件事在原来的版本里是坏的，这里逐条修掉：

1. 参数被 FastAPI 当 query 解析 → 参数真实生效（见 api/routes.py 的 Body 模型）。
2. 推理写在 async 函数里堵死事件循环 → 现在跑在独立工作线程中（见 services/tasks.py），
   事件循环始终空闲，轮询接口可以随时返回真实进度。
3. 进度条是假的 → 这里按分块（tile）真实上报已完成块数，并用实测速度估算剩余时间。
"""

from __future__ import annotations

import math
import os
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

from app.config import Settings


class EngineUnavailable(RuntimeError):
    """依赖没装好 / Real-ESRGAN 源码找不到。"""


class JobCancelled(RuntimeError):
    """用户主动取消。"""


@dataclass(frozen=True)
class ModelSpec:
    name: str
    label: str
    description: str
    scale: int
    arch: str  # "rrdb" | "srvgg"
    num_block: int
    weight_file: str
    url: str
    recommended: bool = False


MODELS: Dict[str, ModelSpec] = {
    "RealESRGAN_x4plus": ModelSpec(
        name="RealESRGAN_x4plus",
        label="通用 · 4×",
        description="通用照片、插画都稳，23 层 RRDB，画质优先。",
        scale=4,
        arch="rrdb",
        num_block=23,
        weight_file="RealESRGAN_x4plus.pth",
        url="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
        recommended=True,
    ),
    "RealESRGAN_x4plus_anime_6B": ModelSpec(
        name="RealESRGAN_x4plus_anime_6B",
        label="动漫 · 4×",
        description="线条干净、色块平整的二次元图，几乎不糊边。",
        scale=4,
        arch="rrdb",
        num_block=6,
        weight_file="RealESRGAN_x4plus_anime_6B.pth",
        url="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
    ),
    "RealESRGAN_x2plus": ModelSpec(
        name="RealESRGAN_x2plus",
        label="通用 · 2×",
        description="只要放大一倍时更自然，细节不过度生成。",
        scale=2,
        arch="rrdb",
        num_block=23,
        weight_file="RealESRGAN_x2plus.pth",
        url="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1.0/RealESRGAN_x2plus.pth",
    ),
    "realesr-general-x4v3": ModelSpec(
        name="realesr-general-x4v3",
        label="轻量 · 4×",
        description="小模型，速度快，适合噪点较多的老照片。",
        scale=4,
        arch="srvgg",
        num_block=0,
        weight_file="realesr-general-x4v3.pth",
        url="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
    ),
}

DEFAULT_MODEL = "RealESRGAN_x4plus"

GFPGAN_WEIGHT = "GFPGANv1.3.pth"
GFPGAN_URL = "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.3.pth"


def _mb(path: Path) -> float:
    try:
        return round(path.stat().st_size / (1024 * 1024), 1)
    except OSError:
        return 0.0


class ProgressReporter:
    """由任务层传入的回调集合。"""

    def __init__(
        self,
        on_stage: Callable[[str, str], None],
        on_tiles: Callable[[int, int, float], None],
        check_cancel: Callable[[], None],
    ) -> None:
        self.on_stage = on_stage
        self.on_tiles = on_tiles
        self.check_cancel = check_cancel


class UpscaleEngine:
    """模型加载、设备管理、推理。整个进程共用一个实例。"""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._lock = threading.Lock()
        self._upsamplers: Dict[str, object] = {}
        self._upsampler_cls = None
        self._face_enhancer = None
        self._runtime: Optional[dict] = None

    # ---------------------------------------------------------------- runtime
    def _ensure_runtime(self) -> dict:
        """导入 torch 与 Real-ESRGAN（源码目录或已安装的包都能用）。"""
        if self._runtime is not None:
            return self._runtime
        with self._lock:
            if self._runtime is not None:
                return self._runtime

            root = self._settings.realesrgan_root
            if root is not None and str(root) not in sys.path:
                sys.path.insert(0, str(root))

            try:
                import torch
                from basicsr.archs.rrdbnet_arch import RRDBNet
                from basicsr.archs.srvgg_arch import SRVGGNetCompact
                from realesrgan import RealESRGANer
            except Exception as exc:  # pragma: no cover - 依赖缺失时的兜底
                raise EngineUnavailable(
                    "无法导入 Real-ESRGAN 依赖。请先安装后端依赖，并设置 REALESRGAN_ROOT "
                    "指向 Real-ESRGAN 源码目录（或 pip install realesrgan basicsr）。"
                    f"原始错误：{type(exc).__name__}: {exc}"
                ) from exc

            cuda = bool(torch.cuda.is_available())
            if self._settings.device == "cpu":
                cuda = False
            device_name = "CPU"
            if cuda:
                try:
                    device_name = torch.cuda.get_device_name(0)
                except Exception:
                    device_name = "CUDA GPU"

            self._runtime = {
                "torch": torch,
                "RRDBNet": RRDBNet,
                "SRVGGNetCompact": SRVGGNetCompact,
                "RealESRGANer": RealESRGANer,
                "cuda": cuda,
                "device_name": device_name,
                "device": torch.device("cuda" if cuda else "cpu"),
            }
            return self._runtime

    def device_info(self) -> dict:
        try:
            rt = self._ensure_runtime()
        except EngineUnavailable as exc:
            return {
                "ready": False,
                "cuda": False,
                "name": "未就绪",
                "reason": str(exc),
                "torch": None,
                "realesrgan_root": str(self._settings.realesrgan_root) if self._settings.realesrgan_root else None,
            }
        info = {
            "ready": True,
            "cuda": rt["cuda"],
            "name": rt["device_name"],
            "torch": rt["torch"].__version__,
            "precision": "fp16" if (self._settings.half and rt["cuda"]) else "fp32",
            "realesrgan_root": str(self._settings.realesrgan_root) if self._settings.realesrgan_root else "已安装的 pip 包",
        }
        if rt["cuda"]:
            try:
                info["vram_gb"] = round(rt["torch"].cuda.get_device_properties(0).total_memory / 1024**3, 1)
            except Exception:
                pass
        return info

    # ----------------------------------------------------------------- models
    def model_states(self) -> List[dict]:
        out: List[dict] = []
        for spec in MODELS.values():
            local = self._settings.weights_dir / spec.weight_file
            out.append(
                {
                    "name": spec.name,
                    "label": spec.label,
                    "description": spec.description,
                    "scale": spec.scale,
                    "recommended": spec.recommended,
                    "downloaded": local.is_file(),
                    "download_size_mb": _mb(local) if local.is_file() else 64.0,
                }
            )
        return out

    def _gfpgan_weight_path(self) -> Optional[Path]:
        root = self._settings.realesrgan_root
        if root is not None:
            return root / "gfpgan" / "weights" / GFPGAN_WEIGHT
        try:
            import importlib.util

            spec = importlib.util.find_spec("gfpgan")
            if spec and spec.origin:
                return Path(spec.origin).parent / "weights" / GFPGAN_WEIGHT
        except Exception:
            pass
        return None

    def face_enhance_state(self) -> dict:
        try:
            import importlib.util

            has_gfpgan = importlib.util.find_spec("gfpgan") is not None
            has_facexlib = importlib.util.find_spec("facexlib") is not None
        except Exception:
            has_gfpgan = has_facexlib = False

        if not has_gfpgan:
            return {"available": False, "reason": "缺少 gfpgan 依赖：pip install gfpgan 后重启服务。"}
        if not has_facexlib:
            return {"available": False, "reason": "缺少 facexlib 依赖：pip install facexlib 后重启服务。"}

        weight = self._gfpgan_weight_path()
        downloaded = bool(weight and weight.is_file())
        return {
            "available": True,
            "downloaded": downloaded,
            "download_size_mb": _mb(weight) if (downloaded and weight) else 348.0,
            "max_upscale": self._settings.face_enhance_upscale_cap,
        }

    # ------------------------------------------------------------- upsampling
    def _build_upsampler_class(self, RealESRGANer, torch):
        """在官方 RealESRGANer 上加两个钩子：分块进度 + 可中断。

        分块切分/拼接逻辑与上游完全一致，只多了一行进度上报，
        所以画质和 tile=0 的一次性推理等价。
        """

        class ProgressRealESRGANer(RealESRGANer):
            progress: Optional[ProgressReporter] = None

            def _report(self, done: int, total: int, elapsed: float) -> None:
                if self.progress is not None:
                    self.progress.on_tiles(done, total, elapsed)

            def _check_cancel(self) -> None:
                if self.progress is not None:
                    self.progress.check_cancel()

            def process(self):  # type: ignore[override]
                started = time.time()
                super().process()
                self._report(1, 1, time.time() - started)

            def tile_process(self):  # type: ignore[override]
                started = time.time()
                batch, channel, height, width = self.img.shape
                output_shape = (batch, channel, height * self.scale, width * self.scale)
                self.output = self.img.new_zeros(output_shape)

                tiles_x = math.ceil(width / self.tile_size)
                tiles_y = math.ceil(height / self.tile_size)
                total = tiles_x * tiles_y
                done = 0
                self._report(done, total, 0.0)

                for y in range(tiles_y):
                    for x in range(tiles_x):
                        self._check_cancel()

                        ofs_x, ofs_y = x * self.tile_size, y * self.tile_size
                        input_start_x = ofs_x
                        input_end_x = min(ofs_x + self.tile_size, width)
                        input_start_y = ofs_y
                        input_end_y = min(ofs_y + self.tile_size, height)

                        input_start_x_pad = max(input_start_x - self.tile_pad, 0)
                        input_end_x_pad = min(input_end_x + self.tile_pad, width)
                        input_start_y_pad = max(input_start_y - self.tile_pad, 0)
                        input_end_y_pad = min(input_end_y + self.tile_pad, height)

                        input_tile_width = input_end_x - input_start_x
                        input_tile_height = input_end_y - input_start_y
                        input_tile = self.img[
                            :, :, input_start_y_pad:input_end_y_pad, input_start_x_pad:input_end_x_pad
                        ]

                        with torch.no_grad():
                            output_tile = self.model(input_tile)

                        output_start_x = input_start_x * self.scale
                        output_end_x = input_end_x * self.scale
                        output_start_y = input_start_y * self.scale
                        output_end_y = input_end_y * self.scale

                        output_start_x_tile = (input_start_x - input_start_x_pad) * self.scale
                        output_end_x_tile = output_start_x_tile + input_tile_width * self.scale
                        output_start_y_tile = (input_start_y - input_start_y_pad) * self.scale
                        output_end_y_tile = output_start_y_tile + input_tile_height * self.scale

                        self.output[:, :, output_start_y:output_end_y, output_start_x:output_end_x] = output_tile[
                            :, :, output_start_y_tile:output_end_y_tile, output_start_x_tile:output_end_x_tile
                        ]

                        done += 1
                        self._report(done, total, time.time() - started)

        return ProgressRealESRGANer

    def _get_upsampler(self, model_name: str):
        spec = MODELS.get(model_name)
        if spec is None:
            raise ValueError(f"未知模型：{model_name}")

        cached = self._upsamplers.get(model_name)
        if cached is not None:
            return cached

        rt = self._ensure_runtime()
        if self._upsampler_cls is None:
            self._upsampler_cls = self._build_upsampler_class(rt["RealESRGANer"], rt["torch"])

        weight_path = self._settings.weights_dir / spec.weight_file
        if not weight_path.is_file():
            self._settings.weights_dir.mkdir(parents=True, exist_ok=True)
            from basicsr.utils.download_util import load_file_from_url

            weight_path = Path(
                load_file_from_url(url=spec.url, model_dir=str(self._settings.weights_dir), progress=True)
            )

        if spec.arch == "rrdb":
            model = rt["RRDBNet"](
                num_in_ch=3, num_out_ch=3, num_feat=64, num_block=spec.num_block, num_grow_ch=32, scale=spec.scale
            )
        else:
            model = rt["SRVGGNetCompact"](
                num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type="prelu"
            )

        upsampler = self._upsampler_cls(
            scale=spec.scale,
            model_path=str(weight_path),
            model=model,
            tile=self._settings.tile,
            tile_pad=self._settings.tile_pad,
            pre_pad=self._settings.pre_pad,
            half=bool(self._settings.half and rt["cuda"]),
            device=rt["device"],
        )
        self._upsamplers[model_name] = upsampler
        return upsampler

    def _get_face_enhancer(self, upsampler, outscale: int):
        rt = self._ensure_runtime()
        if self._face_enhancer is not None:
            return self._face_enhancer
        if self._settings.realesrgan_root is not None:
            root_str = str(self._settings.realesrgan_root)
            if root_str not in sys.path:
                sys.path.insert(0, root_str)
        from gfpgan import GFPGANer

        weight = self._gfpgan_weight_path()
        model_path = str(weight) if (weight and weight.is_file()) else GFPGAN_URL
        self._face_enhancer = GFPGANer(
            model_path=model_path,
            upscale=outscale,
            arch="clean",
            channel_multiplier=2,
            bg_upsampler=upsampler,
            device=rt["device"],
        )
        return self._face_enhancer

    # -------------------------------------------------------------------- run
    def run(
        self,
        *,
        image_path: Path,
        model_name: str,
        outscale: float,
        face_enhance: bool,
        progress: ProgressReporter,
    ) -> Tuple[np.ndarray, dict]:
        import cv2

        rt = self._ensure_runtime()
        progress.check_cancel()

        progress.on_stage("model", "载入模型")
        upsampler = self._get_upsampler(model_name)
        progress.check_cancel()

        progress.on_stage("read", "读取图像")
        img = cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError("无法解码这张图片，请换一张 JPG / PNG / WebP。")
        if img.ndim == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
        elif img.ndim == 3 and img.shape[2] == 1:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)

        source_h, source_w = int(img.shape[0]), int(img.shape[1])
        progress.on_stage("upscale", "超分推理" if not face_enhance else "超分推理（含人脸增强）")

        upsampler.progress = progress
        started = time.time()
        try:
            if face_enhance:
                outscale_int = max(1, int(round(outscale)))
                enhancer = self._get_face_enhancer(upsampler, outscale_int)
                _, _, output = enhancer.enhance(img, has_aligned=False, only_center_face=False, paste_back=True)
                # GFPGAN 按 upscale 输出，若用户要的比例不同再补齐
                target_w = int(round(source_w * outscale))
                if output.shape[1] != target_w:
                    output = cv2.resize(output, (target_w, int(round(source_h * outscale))), interpolation=cv2.INTER_LANCZOS4)
            else:
                output, _ = upsampler.enhance(img, outscale=outscale)
        finally:
            upsampler.progress = None
            try:
                if rt["cuda"]:
                    rt["torch"].cuda.empty_cache()
            except Exception:
                pass

        elapsed = time.time() - started
        meta = {
            "model": model_name,
            "outscale": float(outscale),
            "face_enhance": bool(face_enhance),
            "source_width": source_w,
            "source_height": source_h,
            "output_width": int(output.shape[1]),
            "output_height": int(output.shape[0]),
            "inference_seconds": round(elapsed, 1),
            "device": rt["device_name"],
            "tile": self._settings.tile,
        }
        return output, meta
