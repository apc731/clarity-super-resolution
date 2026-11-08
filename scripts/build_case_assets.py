#!/usr/bin/env python
"""用本地跑出来的真实结果，生成案例页（静态展示页）需要的素材与数据。

它不是"假素材生成器"：每一张 after 图都是这个仓库的代码在这台机器上真跑出来的，
连尺寸、耗时、输出体积都取自同一次任务。所以案例页上写的每个数字都能对得上。

用法（需要后端已经在跑）：
    python scripts/build_case_assets.py --base http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import io
import json
import mimetypes
import sys
import time
import urllib.request
import uuid
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
PUBLIC_DIR = REPO / "frontend" / "public" / "cases"
DATA_FILE = REPO / "frontend" / "src" / "data" / "cases.json"

# 每组案例：slug / 源图 / 标题 / 说明 / 模型 / 倍数
CASES = [
    {
        "slug": "anime-sunset",
        "source": REPO / "samples" / "sunset-1728x1080.jpg",
        "title": "插画 · 黄昏的海",
        "note": "线条和色带最考验模型：糊掉的海平面被重新长出细节，云层没有出现油画感。",
        "focus": {"x": 47, "y": 68},
        "model": "RealESRGAN_x4plus",
        "scale": 4,
    },
    {
        "slug": "winter-branches",
        "source": REPO / "samples" / "branches-512x256.png",
        "title": "实拍 · 冬天里的树枝",
        "note": "512×256 的素材本身就缺信息，细枝之间的缝隙会被补上，但主体结构没有变形。",
        "focus": {"x": 30, "y": 32},
        "model": "RealESRGAN_x4plus",
        "scale": 4,
    },
    {
        "slug": "cosplay-group",
        "source": REPO / "samples" / "portrait-850x1327.jpg",
        "title": "人像 · 群像合影",
        "note": "人脸是硬指标：皮肤纹理和发丝被重建，五个人的轮廓都保持原样。",
        "focus": {"x": 62, "y": 20},
        "model": "RealESRGAN_x4plus",
        "scale": 4,
    },
]


def post_file(base: str, path: Path) -> dict:
    boundary = f"----assets{uuid.uuid4().hex}"
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode(),
            f"Content-Type: {ctype}\r\n\r\n".encode(),
            path.read_bytes(),
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    request = urllib.request.Request(
        f"{base}/api/uploads", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read())


def post_json(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def get_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=300) as response:
        return response.read()


def wait_task(base: str, task_id: str, timeout: int = 1800) -> dict:
    started = time.time()
    while time.time() - started < timeout:
        status = json.loads(get_bytes(f"{base}/api/tasks/{task_id}"))
        if status["status"] in ("completed", "failed", "cancelled"):
            return status
        print(f"    {status['progress']:3d}%  {status['stage_label']}  {status['tiles_done']}/{status['tiles_total']}")
        time.sleep(2)
    raise TimeoutError(task_id)


def save_web_image(raw: bytes, target: Path, max_side: int, quality: int, fmt: str) -> tuple[int, int]:
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    image.thumbnail((max_side, max_side), Image.LANCZOS)
    if fmt == "WEBP":
        image.save(target, "WEBP", quality=quality, method=5)
    else:
        image.save(target, "JPEG", quality=quality, optimize=True, progressive=True)
    return image.size


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

    entries = []
    for case in CASES:
        source = Path(case["source"])
        if not source.is_file():
            print(f"[skip] 找不到源图 {source}")
            continue
        print(f"[case] {case['slug']}  {source.name}")
        uploaded = post_file(base, source)
        task = post_json(
            f"{base}/api/tasks",
            {
                "file_id": uploaded["file_id"],
                "original_name": uploaded["original_name"],
                "model": case["model"],
                "outscale": case["scale"],
                "face_enhance": False,
            },
        )
        status = wait_task(base, task["task_id"])
        if status["status"] != "completed":
            print(f"[fail] {case['slug']}: {status.get('error')}")
            return 1

        meta = status["meta"]
        before_raw = source.read_bytes()
        after_raw = get_bytes(f"{base}/api/tasks/{task['task_id']}/file/result")

        before_name = f"{case['slug']}-before.jpg"
        after_name = f"{case['slug']}-after.webp"
        save_web_image(before_raw, PUBLIC_DIR / before_name, 1728, 86, "JPEG")
        save_web_image(after_raw, PUBLIC_DIR / after_name, 2560, 90, "WEBP")

        entries.append(
            {
                "slug": case["slug"],
                "title": case["title"],
                "note": case["note"],
                "before": f"/cases/{before_name}",
                "after": f"/cases/{after_name}",
                "model": meta["model"],
                "outscale": meta["outscale"],
                "sourceWidth": meta["source_width"],
                "sourceHeight": meta["source_height"],
                "outputWidth": meta["output_width"],
                "outputHeight": meta["output_height"],
                "inferenceSeconds": meta["inference_seconds"],
                "tiles": status["tiles_total"],
                "tileSize": meta["tile"],
                "device": meta["device"],
                "focus": case.get("focus"),
                "resultBytes": status.get("bytes", {}).get("result"),
            }
        )
        print(
            f"    ok {meta['source_width']}x{meta['source_height']} -> "
            f"{meta['output_width']}x{meta['output_height']}  {meta['inference_seconds']}s"
        )

    DATA_FILE.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[done] {len(entries)} 组案例 -> {PUBLIC_DIR} / {DATA_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
