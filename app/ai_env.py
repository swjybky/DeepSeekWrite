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


def _normalize_xiaomi_model_id(source: str, model_id: str) -> str:
    """小米模型 ID 常见笔误 mino-* → pi-ai 注册名为 mimo-*"""
    if source == "xiaomi" and model_id.startswith("mino"):
        return "mimo" + model_id[4:]
    return model_id


def load_ai_model_defaults() -> dict[str, str] | None:
    """
    读取 app/.env：model_api_key、model_source（兼容 mdoel_source 拼写）。
    主模型：model_name_main 或兼容旧键 model_name。
    可选快速模型：model_name_flash（旁路抽取/写入正文）；与主模型同 provider，共用同一 model_api_key。
    主模型名、密钥与源三者齐全时返回 provider / model_id / api_key；否则返回 None。
    """
    env_path = Path(__file__).resolve().parent / ".deepseek.env"
    data = _parse_env_file(env_path)
    main_raw = (data.get("model_name_main") or data.get("model_name") or "").strip()
    flash_raw = (data.get("model_name_flash") or "").strip()
    api_key = (data.get("model_api_key") or "").strip()
    source = (data.get("model_source") or data.get("mdoel_source") or "").strip().lower()
    if not main_raw or not api_key or not source:
        return None
    model_name = _normalize_xiaomi_model_id(source, main_raw)
    out: dict[str, str] = {
        "provider": source,
        "model_id": model_name,
        "api_key": api_key,
    }
    if flash_raw:
        out["model_id_flash"] = _normalize_xiaomi_model_id(source, flash_raw)
    return out
