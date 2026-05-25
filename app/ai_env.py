from __future__ import annotations

from pathlib import Path
from typing import Any

from app.runtime_paths import bundle_root, writable_root


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    text = path.read_text(encoding="utf-8")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, rest = line.split("=", 1)
        elif ":" in line:
            key, rest = line.split(":", 1)
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


def _normalize_config_id(raw: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in raw.strip().lower()).strip("_")


def _parse_bool(value: str) -> bool | None:
    normalized = value.strip().lower()
    if normalized in ("1", "true", "yes", "y", "on", "支持", "开启"):
        return True
    if normalized in ("0", "false", "no", "n", "off", "不支持", "关闭"):
        return False
    return None


def _ai_env_file_candidates() -> list[Path]:
    """冻结版优先读取可执行文件旁的配置，便于不把密钥打进包内。"""
    app_dir = bundle_root() / "app"
    wr = writable_root()
    module_dir = Path(__file__).resolve().parent
    return [
        wr / ".env",
        wr / ".deepseek.env",
        wr / ".kimi.env",
        module_dir / ".env",
        module_dir / ".deepseek.env",
        module_dir / ".kimi.env",
        app_dir / ".env",
        app_dir / ".deepseek.env",
        app_dir / ".kimi.env",
    ]


def _load_ai_env_data() -> dict[str, str]:
    data: dict[str, str] = {}
    for env_path in _ai_env_file_candidates():
        for key, value in _parse_env_file(env_path).items():
            data.setdefault(key, value)
    return data


def _first_config_value(
    data: dict[str, str],
    config_id: str,
    suffixes: tuple[str, ...],
) -> str:
    normalized = _normalize_config_id(config_id)
    candidate_prefixes = tuple(
        dict.fromkeys(
            (
                config_id.strip().lower(),
                normalized,
            )
        )
    )
    keys: list[str] = []
    for prefix in candidate_prefixes:
        for suffix in suffixes:
            keys.append(f"{prefix}_{suffix}")
            keys.append(f"{suffix}_{prefix}")
    for key in keys:
        value = (data.get(key) or "").strip()
        if value:
            return value
    return ""


def _load_configured_models(data: dict[str, str]) -> list[dict[str, str]]:
    list_raw = (
        data.get("model_list")
        or data.get("models")
        or data.get("ai_models")
        or data.get("model_configs")
        or ""
    )
    config_ids = [
        item.strip()
        for item in list_raw.replace("，", ",").split(",")
        if item.strip()
    ]
    models: list[dict[str, str]] = []
    for config_id in config_ids:
        model_name = _first_config_value(
            data,
            config_id,
            ("model_name", "name", "model", "model_id"),
        )
        api_key = _first_config_value(
            data,
            config_id,
            ("model_key", "model_api_key", "api_key", "key"),
        )
        source = _first_config_value(
            data,
            config_id,
            ("model_source", "source", "provider"),
        ).lower()
        label = _first_config_value(
            data,
            config_id,
            ("label", "display_name", "title"),
        )
        base_url = _first_config_value(
            data,
            config_id,
            ("model_url", "url", "endpoint", "base_url"),
        )
        model_like = _first_config_value(
            data,
            config_id,
            ("model_like", "like", "api_type", "api", "format"),
        ).lower()
        reasoning_raw = _first_config_value(
            data,
            config_id,
            ("model_reasoning", "reasoning", "thinking", "supports_reasoning"),
        )
        if not model_name or not api_key or not source:
            continue
        api = ""
        if model_like in ("openai", "openai-completions"):
            api = "openai-completions"
        elif model_like in ("openai-response", "openai-responses"):
            api = "openai-responses"
        elif model_like in ("claude", "anthropic", "anthropic-messages"):
            api = "anthropic-messages"
        entry: dict[str, str] = {
            "id": _normalize_config_id(config_id) or config_id,
            "label": label or config_id,
            "provider": source,
            "model_id": _normalize_xiaomi_model_id(source, model_name),
            "api_key": api_key,
        }
        if base_url:
            entry["base_url"] = base_url
        if api:
            entry["api"] = api
        reasoning = _parse_bool(reasoning_raw)
        if reasoning is not None:
            entry["reasoning"] = "true" if reasoning else "false"
        models.append(entry)
    return models


def load_ai_model_defaults() -> dict[str, Any] | None:
    """
    models_type=owner 时读取环境配置并返回前端可用的固定模型列表。
    models_type=pi 或未配置时返回 None，前端使用 Pi 原生模型选择与密钥存储。

    新格式示例：
    ``models_type=owner``
    ``model_list=deepseekflash,kimi``
    ``deepseekflash_model_name=deepseek-v4-flash``
    ``deepseekflash_model_key=...``
    ``deepseekflash_model_source=deepseek``

    owner 模式下旧格式仍兼容：model_name_main / model_name、model_api_key、model_source。
    """
    data = _load_ai_env_data()
    models_type = (data.get("models_type") or "pi").strip().lower()
    if models_type != "owner":
        return None

    configured_models = _load_configured_models(data)
    default_model_id = (
        data.get("default_model")
        or data.get("model_default")
        or data.get("default_ai_model")
        or ""
    ).strip()
    if configured_models:
        default_id = _normalize_config_id(default_model_id)
        if default_id and not any(m["id"] == default_id for m in configured_models):
            default_id = ""
        first = configured_models[0]
        out: dict[str, Any] = {
            "provider": first["provider"],
            "model_id": first["model_id"],
            "api_key": first["api_key"],
            "models": configured_models,
        }
        if default_id:
            out["default_model_id"] = default_id
        return out

    main_raw = (data.get("model_name_main") or data.get("model_name") or "").strip()
    api_key = (data.get("model_api_key") or "").strip()
    source = (
        data.get("model_source") or data.get("mdoel_source") or ""
    ).strip().lower()
    if not main_raw or not api_key or not source:
        return None
    model_name = _normalize_xiaomi_model_id(source, main_raw)
    out: dict[str, str] = {
        "provider": source,
        "model_id": model_name,
        "api_key": api_key,
    }
    return out


def load_image_model_defaults() -> dict[str, str] | None:
    """读取图片生成模型配置。"""
    data = _load_ai_env_data()
    model = (data.get("image_model") or "").strip()
    api_key = (data.get("image_model_key") or "").strip()
    if not model or not api_key:
        return None
    return {
        "model": model,
        "api_key": api_key,
    }
