#!/usr/bin/env python
"""端到端冒烟测试：上传 → 排队 → 真实推理 → 取结果。

用法：
    python scripts/smoke_test.py                     # 用内置生成的小图，scale=2
    python scripts/smoke_test.py --image path.jpg    # 用自己的图
    python scripts/smoke_test.py --scale 4 --base http://127.0.0.1:8000

只依赖标准库，随便哪台机器都能跑。
"""

from __future__ import annotations

import argparse
import io
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None


def _multipart(field: str, filename: str, payload: bytes) -> tuple[bytes, str]:
    boundary = f"----smoke{uuid.uuid4().hex}"
    ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'.encode(),
            f"Content-Type: {ctype}\r\n\r\n".encode(),
            payload,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    return body, f"multipart/form-data; boundary={boundary}"


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read())


def synthesize_image() -> tuple[str, bytes]:
    if Image is None:
        raise SystemExit("需要 Pillow 来生成测试图：pip install pillow")
    img = Image.new("RGB", (320, 200))
    px = img.load()
    for y in range(200):
        for x in range(320):
            px[x, y] = ((x * 3) % 256, (y * 5) % 256, ((x + y) * 2) % 256)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return "smoke.png", buf.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=os.environ.get("APP_BASE", "http://127.0.0.1:8000"))
    parser.add_argument("--image", help="待测试的图片路径")
    parser.add_argument("--scale", type=float, default=2.0)
    parser.add_argument("--model", default="RealESRGAN_x4plus")
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()

    base = args.base.rstrip("/")
    health = get_json(f"{base}/api/health")
    print(f"[health] {health['status']}  device={health['device'].get('name')}")

    if args.image:
        with open(args.image, "rb") as fh:
            payload = fh.read()
        filename = os.path.basename(args.image)
    else:
        filename, payload = synthesize_image()
    print(f"[upload] {filename}  {len(payload)/1024:.1f} KB")

    body, ctype = _multipart("file", filename, payload)
    req = urllib.request.Request(f"{base}/api/uploads", data=body, headers={"Content-Type": ctype}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        uploaded = json.loads(resp.read())
    print(f"[upload] file_id={uploaded['file_id']}  {uploaded['width']}x{uploaded['height']}")

    task = post_json(
        f"{base}/api/tasks",
        {
            "file_id": uploaded["file_id"],
            "original_name": uploaded["original_name"],
            "model": args.model,
            "outscale": args.scale,
            "face_enhance": False,
        },
    )
    task_id = task["task_id"]
    print(f"[task] {task_id} queued")

    started = time.time()
    slowest_poll = 0.0
    last_stage = None
    while True:
        if time.time() - started > args.timeout:
            raise SystemExit("[task] 超时")
        poll_started = time.time()
        status = get_json(f"{base}/api/tasks/{task_id}")
        slowest_poll = max(slowest_poll, time.time() - poll_started)

        stage_line = (
            f"  {status['progress']:3d}%  {status['stage_label']:<6} "
            f"tiles={status['tiles_done']}/{status['tiles_total']}  eta={status['eta_seconds']}"
        )
        if stage_line != last_stage:
            print(stage_line)
            last_stage = stage_line

        if status["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(1.0)

    print(f"[poll] 最慢一次轮询 {slowest_poll*1000:.0f} ms（应远小于 1 秒，说明事件循环没被推理堵住）")

    if status["status"] != "completed":
        print(f"[FAIL] {status['status']}: {status.get('error')}")
        return 1

    meta = status["meta"]
    expected_w = round(meta["source_width"] * args.scale)
    expected_h = round(meta["source_height"] * args.scale)
    ok_scale = meta["output_width"] == expected_w and meta["output_height"] == expected_h
    print(
        f"[result] {meta['source_width']}x{meta['source_height']} -> "
        f"{meta['output_width']}x{meta['output_height']}  {meta['inference_seconds']}s  tiles={status['tiles_total']}"
    )

    for kind in ("input", "result", "preview", "thumbnail"):
        url = f"{base}/api/tasks/{task_id}/file/{kind}"
        with urllib.request.urlopen(url, timeout=120) as resp:
            size = len(resp.read())
            print(f"[file] {kind:<9} {resp.status}  {size/1024:.1f} KB  {resp.headers.get('content-type')}")

    print("[check] outscale 生效" if ok_scale else f"[FAIL] outscale 未生效：期望 {expected_w}x{expected_h}")
    return 0 if ok_scale else 1


if __name__ == "__main__":
    sys.exit(main())
