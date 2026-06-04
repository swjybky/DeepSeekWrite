from __future__ import annotations

import base64
import http.client
import json
import uuid
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from app.storage import read_image_model_config


def _truncate_response(value: object, max_len: int = 1200) -> str:
    text = json.dumps(value, ensure_ascii=False)
    if len(text) <= max_len:
        return text
    return text[:max_len] + f"...[{len(text)}]"


def _is_supported_image(data: bytes) -> bool:
    return (
        data.startswith(b"\x89PNG\r\n\x1a\n")
        or data.startswith(b"\xff\xd8\xff")
        or data.startswith(b"RIFF") and data[8:12] == b"WEBP"
        or data.startswith(b"GIF87a")
        or data.startswith(b"GIF89a")
    )


def _decode_image_base64(raw: str) -> bytes | None:
    value = raw.strip()
    if not value:
        return None
    if value.startswith("data:"):
        _header, sep, rest = value.partition(",")
        if not sep:
            return None
        value = rest
    try:
        data = base64.b64decode(value, validate=False)
    except Exception:
        return None
    if not _is_supported_image(data):
        return None
    return data


def _download_image(url: str) -> bytes | None:
    try:
        req = Request(url, headers={"Accept": "image/*"})
        with urlopen(req, timeout=60) as res:
            data = res.read()
    except Exception as e:
        print(f"下载图片 URL 失败: {e}")
        return None
    if not _is_supported_image(data):
        print("图片 URL 返回的不是受支持的图片格式")
        return None
    return data


def _extract_image_bytes(body: object) -> bytes | None:
    if isinstance(body, str):
        return _decode_image_base64(body)
    if isinstance(body, list):
        for item in body:
            found = _extract_image_bytes(item)
            if found:
                return found
        return None
    if not isinstance(body, dict):
        return None

    for key in ("b64_json", "base64", "image_base64", "image", "result"):
        value = body.get(key)
        if isinstance(value, str):
            found = _decode_image_base64(value)
            if found:
                return found

    for key in ("inline_data", "inlineData"):
        inline = body.get(key)
        if isinstance(inline, dict) and isinstance(inline.get("data"), str):
            found = _decode_image_base64(inline["data"])
            if found:
                return found

    url = body.get("url")
    if isinstance(url, str) and url.strip():
        found = _download_image(url.strip())
        if found:
            return found

    for value in body.values():
        found = _extract_image_bytes(value)
        if found:
            return found
    return None


def _image_api_request_target(base_url: str) -> tuple[str, str, bool]:
    parsed = urlparse(base_url.rstrip("/"))
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"图片 API 地址无效: {base_url}")
    prefix = parsed.path.rstrip("/")
    if not prefix:
        prefix = "/v1"
    return parsed.netloc, f"{prefix}/images/generations", parsed.scheme == "https"


def generate_image(prompt: str, output_dir: str | Path = ".data/image") -> Path | None:
    """调用图像生成 API，将返回的图片保存为 PNG。"""
    image_defaults = read_image_model_config()
    if not image_defaults:
        print("未配置图片生成模型，请先在首页配置图像模型")
        return None

    host, path, use_https = _image_api_request_target(
        image_defaults.get("base_url", "https://sucloud.vip"),
    )
    conn_cls = http.client.HTTPSConnection if use_https else http.client.HTTPConnection
    conn = conn_cls(host, timeout=120)
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
    conn.request("POST", path, payload, headers)
    res = conn.getresponse()
    data = res.read()
    body = json.loads(data)

    if res.status >= 400:
        print(
            f"图片 API 请求失败: HTTP {res.status} {res.reason} "
            f"{_truncate_response(body)}"
        )
        return None

    image_bytes = _extract_image_bytes(body)
    if not image_bytes:
        print(f"API 未返回图片数据: {_truncate_response(body)}")
        return None

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
