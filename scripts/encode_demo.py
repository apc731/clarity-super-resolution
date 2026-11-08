#!/usr/bin/env python
"""把 record_demo.mjs 抓到的两段真实画面编成 6 秒 H.264 MP4。

    python scripts/encode_demo.py

需要 Pillow / numpy / imageio-ffmpeg（自带一个静态 ffmpeg，不用系统安装）。
输出：docs/demo-6s.mp4 + docs/screenshots/06-demo-poster.jpg
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
FRAMES = Path(tempfile.gettempdir()) / "clarity-demo-frames"
OUT = REPO / "docs" / "demo-6s.mp4"
POSTER = REPO / "docs" / "screenshots" / "06-demo-poster.jpg"
FPS = 24
SEGMENTS = (("segA", 2.0), ("segB", 4.0))


def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as error:
        raise SystemExit("缺少 imageio-ffmpeg：pip install imageio-ffmpeg") from error


def load_segment(name: str, seconds: float) -> tuple[list[np.ndarray], list[float]]:
    folder = FRAMES / name
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    times = meta["times"]
    images = []
    for index in range(meta["count"]):
        path = folder / f"{index + 1:04d}.jpg"
        with Image.open(path) as image:
            images.append(np.asarray(image.convert("RGB"))[:, :, ::-1].copy())  # RGB -> BGR
    if not images:
        raise SystemExit(f"{name} 一帧都没有，先跑 node scripts/record_demo.mjs")
    # 录屏时长以实测为准，但演示片按固定 2s / 4s 剪
    print(f"{name}: {len(images)} 帧, 采样到 {seconds:.1f}s", flush=True)
    return images, times


def main() -> int:
    sequence = FRAMES / "sequence"
    if sequence.exists():
        shutil.rmtree(sequence)
    sequence.mkdir(parents=True)

    size = None
    frame_no = 0
    for name, seconds in SEGMENTS:
        images, times = load_segment(name, seconds)
        if size is None:
            height, width = images[0].shape[:2]
            size = (width - width % 2, height - height % 2)
        for index in range(round(seconds * FPS)):
            t = index / FPS
            position = int(np.searchsorted(np.asarray(times), t, side="right")) - 1
            frame = images[max(0, min(position, len(images) - 1))]
            if frame.shape[1] != size[0] or frame.shape[0] != size[1]:
                frame = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)
            frame_no += 1
            cv2.imwrite(str(sequence / f"frame_{frame_no:04d}.jpg"), frame, [cv2.IMWRITE_JPEG_QUALITY, 94])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_exe(),
        "-y",
        "-loglevel",
        "error",
        "-framerate",
        str(FPS),
        "-i",
        str(sequence / "frame_%04d.jpg"),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(OUT),
    ]
    subprocess.run(command, check=True)

    capture = cv2.VideoCapture(str(OUT))
    frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = capture.get(cv2.CAP_PROP_FPS)
    capture.release()

    # 封面取结果页里滑块拖到中间的一帧
    POSTER.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(sequence / f"frame_{round((2.0 + 1.6) * FPS):04d}.jpg", POSTER)

    print(f"完成: {OUT.relative_to(REPO)}  {frames} 帧 / {fps:g} fps = {frames / fps:.2f}s  {OUT.stat().st_size / 1_000_000:.2f} MB")
    print(f"封面: {POSTER.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
