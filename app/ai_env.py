from __future__ import annotations

from pathlib import Path


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    text = path.read_text(encoding="utf-8")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            key, rest = line.split(":", 1)
        elif "=" in line:
            key, rest = line.split("=", 1)
        else:
            continue
        k = key.strip().lower()
        v = rest.strip()
        if k:
            out[k] = v
    return out


def load_ai_model_defaults() -> dict[str, str] | None:
    """
    读取 app/.env：model_name、model_api_key、model_source（兼容 mdoel_source 拼写）。
    三者齐全时返回 provider / model_id / api_key；否则返回 None，前端使用内置默认模型。
    """
    env_path = Path(__file__).resolve().parent / ".env"
    data = _parse_env_file(env_path)
    model_name = (data.get("model_name") or "").strip()
    api_key = (data.get("model_api_key") or "").strip()
    source = (data.get("model_source") or data.get("mdoel_source") or "").strip().lower()
    if not model_name or not api_key or not source:
        return None
    # 小米模型 ID 常见笔误 mino-* → pi-ai 注册名为 mimo-*
    if source == "xiaomi" and model_name.startswith("mino"):
        model_name = "mimo" + model_name[4:]
    return {
        "provider": source,
        "model_id": model_name,
        "api_key": api_key,
    }
