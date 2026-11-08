#!/usr/bin/env python
"""接口约定检查：主要跑"坏输入"，确认错误是 4xx + 人能看懂的话，而不是 500。

    python scripts/api_check.py --base http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SAMPLE = REPO / "frontend" / "public" / "cases" / "anime-sunset-before.jpg"


def multipart(name: str, data: bytes, ctype: str = "image/png") -> tuple[bytes, str]:
    boundary = f"----check{uuid.uuid4().hex}"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'.encode(),
            f"Content-Type: {ctype}\r\n\r\n".encode(),
            data,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    return body, f"multipart/form-data; boundary={boundary}"


def call(request: urllib.request.Request) -> tuple[int, dict]:
    def parse(raw: bytes) -> dict:
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}  # 根路径返回的是 HTML，这里只关心状态码

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, parse(response.read())
    except urllib.error.HTTPError as error:
        return error.code, parse(error.read())


def upload(base: str, name: str, data: bytes, ctype: str = "image/png") -> tuple[int, dict]:
    body, content_type = multipart(name, data, ctype)
    request = urllib.request.Request(
        f"{base}/api/uploads", data=body, headers={"Content-Type": content_type}, method="POST"
    )
    return call(request)


def post_json(base: str, path: str, payload: dict) -> tuple[int, dict]:
    request = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return call(request)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    failures = 0

    def expect(label: str, actual: int, expected: int, detail: str = "") -> None:
        nonlocal failures
        ok = actual == expected
        failures += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FAIL'}  {label:<28} {actual} (期望 {expected}) {detail}")

    expect("健康检查", call(urllib.request.Request(f"{base}/api/health"))[0], 200)

    status, _ = upload(base, "fake.png", b"this is definitely not an image")
    expect("伪造的图片", status, 415)

    status, _ = upload(base, "vector.gif", b"GIF89a", "image/gif")
    expect("不支持的格式", status, 415)

    status, body = upload(base, "empty.png", b"")
    expect("空文件", status, 400)

    sample = SAMPLE.read_bytes() if SAMPLE.is_file() else b""
    status, uploaded = upload(base, "sample.jpg", sample, "image/jpeg")
    expect("正常上传", status, 200, f"{uploaded.get('width')}x{uploaded.get('height')}")

    file_id = uploaded.get("file_id", "")
    status, _ = post_json(base, "/api/tasks", {"file_id": file_id, "model": "不存在", "outscale": 4})
    expect("未知模型", status, 400)

    status, _ = post_json(base, "/api/tasks", {"file_id": file_id, "outscale": 99})
    expect("outscale 越界", status, 422)

    status, _ = post_json(base, "/api/tasks", {"file_id": "nope", "outscale": 4})
    expect("不存在的 file_id", status, 404)

    expect("不存在的任务", call(urllib.request.Request(f"{base}/api/tasks/nope"))[0], 404)
    expect("不存在的文件", call(urllib.request.Request(f"{base}/api/tasks/nope/file/result"))[0], 404)
    expect("页面根路径", call(urllib.request.Request(f"{base}/"))[0], 200)

    print(f"\n{'全部通过' if failures == 0 else f'{failures} 项未通过'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
