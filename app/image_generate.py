from __future__ import annotations

import base64
import http.client
import json
import uuid
from pathlib import Path

from app.ai_env import load_image_model_defaults


def generate_image(prompt: str, output_dir: str | Path = ".data/image") -> Path | None:
    """调用图像生成 API，将返回的 base64 图片保存为 PNG。"""
    image_defaults = load_image_model_defaults()
    if not image_defaults:
        print("未配置图片生成模型，请在 .env 中设置 image_model 和 image_model_key")
        return None

    conn = http.client.HTTPSConnection("sucloud.vip")
    payload = json.dumps({
        "size": "1024x1536",
        "prompt": prompt,
        "model": image_defaults["model"],
        "n": 1,
    })
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {image_defaults['api_key']}",
        "Content-Type": "application/json",
    }
    conn.request("POST", "/v1/images/generations", payload, headers)
    res = conn.getresponse()
    data = res.read()
    body = json.loads(data)

    b64_str = body.get("data", [{}])[0].get("b64_json")
    if not b64_str:
        print("API 未返回图片数据")
        return None

    image_bytes = base64.b64decode(b64_str)

    dest = Path(output_dir)
    dest.mkdir(parents=True, exist_ok=True)

    # 使用 UUID 确保文件名不重复
    filename = f"{uuid.uuid4().hex}.png"
    filepath = dest / filename
    filepath.write_bytes(image_bytes)

    print(f"图片已保存: {filepath}")
    return filepath


def truncate_values(obj: object, max_len: int = 80) -> object:
    if isinstance(obj, dict):
        return {k: truncate_values(v, max_len) for k, v in obj.items()}
    if isinstance(obj, list):
        return [truncate_values(v, max_len) for v in obj]
    if isinstance(obj, str) and len(obj) > max_len:
        return obj[:max_len] + f"...[{len(obj)}]"
    return obj
