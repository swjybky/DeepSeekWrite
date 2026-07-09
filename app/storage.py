from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.runtime_paths import bundle_root, data_root, is_frozen
from app.common_skill_store import read_common_skills

from app.models import (
    Book,
    LONG_STAGE_KEYS,
    MATERIAL_KIND_KEYS,
    MATERIAL_STAGE_KEYS,
    SCRIPT_STAGE_KEYS,
    SHORT_STAGE_KEYS,
    SKILL_KIND_KEYS,
    SKILL_KIND_STAGE_KEYS,
    SKILL_STAGE_KEYS,
    normalize_book_status,
    normalize_book_type,
    normalize_material_type,
    normalize_material_kind,
    normalize_skill_kind,
    normalize_skill_type,
    WORKSPACE_BOOK_TYPES,
    Material,
    MEMORY_TAGS,
    Skill,
    MATERIAL_STAGE_TO_KIND,
    apply_stage_patch,
    default_material_stages,
    material_stage_items_to_stages,
    default_stages,
    new_memory_id,
    normalize_expert_draft_from_storage,
    new_book_id,
    new_material_id,
    new_skill_id,
    new_skill_stage_item_id,
    primary_draft_stage_key,
    normalize_memories_from_storage,
    normalize_memory_entry,
    normalize_material_stages_from_storage,
    normalize_material_stage_items_from_storage,
    normalize_linked_material_ids_by_kind,
    first_linked_material_id,
    normalize_linked_skill_ids_by_kind,
    first_linked_skill_id,
    normalize_skill_stages_from_storage,
    long_stage_keys_from_stages,
)

ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"

_WIN_INVALID = '<>:"/\\|?*\n\r\t'
AI_MODEL_CONFIG_PREF_KEY = "ai_model_config"
APPEARANCE_STYLE_PREF_KEY = "appearance_style"
APPEARANCE_STYLES = {"classic", "modern", "night"}
TEXT_DISPLAY_MODE_PREF_KEY = "text_display_mode"
TEXT_DISPLAY_MODES = {"text", "markdown"}


@contextmanager
def _data_file_lock():
    """跨进程串行化用户数据目录 `.data` 下 JSON 的读改写。

    JSON 写入本身已经是 os.replace 原子替换；这里额外锁住读改写窗口，避免两个
    桌面进程各自基于旧内存快照保存，后写的一方覆盖先写的一方。
    """
    data_dir = data_root()
    data_dir.mkdir(parents=True, exist_ok=True)
    lock_path = data_dir / ".deepseekwrite.lock"
    with lock_path.open("a+b") as f:
        if sys.platform.startswith("win"):
            import msvcrt  # noqa: PLC0415

            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl  # noqa: PLC0415

            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def _sanitize_book_folder_name(title: str) -> str:
    t = (title or "").strip() or "未命名"
    for ch in _WIN_INVALID:
        t = t.replace(ch, "_")
    t = t.strip(" .")
    return t or "未命名"


def _unique_child_dir(parent: Path, base_name: str) -> Path:
    candidate = parent / base_name
    if not candidate.exists():
        return candidate
    n = 2
    while True:
        alt = parent / f"{base_name}_{n}"
        if not alt.exists():
            return alt
        n += 1


def _write_stages_to_disk(book: Book) -> None:
    """
    将各阶段内容写入书籍输出目录
    根据书籍类型选择适用的阶段键
    """
    od = (book.output_dir or "").strip()
    if not od:
        return
    root = Path(od)
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return

    if book.book_type == "long":
        keys = long_stage_keys_from_stages(book.stages)
    else:
        keys = SCRIPT_STAGE_KEYS if book.book_type == "script" else SHORT_STAGE_KEYS
    for key in keys:
        text = str(book.stages.get(key, "") or "")
        try:
            (root / f"{key}.txt").write_text(text, encoding="utf-8")
        except OSError:
            pass


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime(ISO_FMT)


def default_data_path() -> Path:
    data_dir = data_root()
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "books.json"


def default_materials_path() -> Path:
    """素材数据文件路径"""
    data_dir = data_root()
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "materials.json"


def default_skills_path() -> Path:
    """技能数据文件路径"""
    data_dir = data_root()
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "skills.json"


_FILE_SIGNATURE_UNSET = object()


def _file_signature(path: Path) -> tuple[int, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return (stat.st_mtime_ns, stat.st_size)


def load_books(path: Path) -> dict[str, Book]:
    if not path.exists():
        return {}
    raw = path.read_text(encoding="utf-8")
    if not raw.strip():
        return {}
    payload = json.loads(raw)
    books: dict[str, Book] = {}
    for item in payload.get("books", []):
        b = Book.from_dict(item)
        books[b.id] = b
    return books


def save_books_atomic(path: Path, books: dict[str, Book]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "books": [b.to_dict() for b in books.values()],
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=".books_",
        suffix=".json.tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def preferences_path() -> Path:
    return default_data_path().parent / "preferences.json"


def _load_preferences_unlocked() -> dict[str, Any]:
    path = preferences_path()
    if not path.exists():
        return {}
    try:
        raw = path.read_text(encoding="utf-8")
        if not raw.strip():
            return {}
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def load_preferences() -> dict[str, Any]:
    with _data_file_lock():
        return _load_preferences_unlocked()


def _save_preferences_atomic_unlocked(prefs: dict[str, Any]) -> None:
    path = preferences_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(prefs, ensure_ascii=False, indent=2)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=".prefs_",
        suffix=".json.tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def save_preferences_atomic(prefs: dict[str, Any]) -> None:
    with _data_file_lock():
        _save_preferences_atomic_unlocked(prefs)


def user_memories_path() -> Path:
    data_dir = data_root()
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "user_memories.json"


def _normalize_memory_workspace_type(workspace_type: str | None) -> str:
    normalized = normalize_book_type(workspace_type)
    if normalized == "long":
        return "long"
    return "script" if normalized == "script" else "short"


def _empty_user_memory_payload() -> dict[str, list[dict[str, str]]]:
    return {"short": [], "long": [], "script": []}


def _load_user_memories_unlocked() -> dict[str, list[dict[str, str]]]:
    path = user_memories_path()
    if not path.exists():
        return _empty_user_memory_payload()
    try:
        raw = path.read_text(encoding="utf-8")
        if not raw.strip():
            return _empty_user_memory_payload()
        data = json.loads(raw)
    except (json.JSONDecodeError, OSError):
        return _empty_user_memory_payload()
    if not isinstance(data, dict):
        return _empty_user_memory_payload()
    return {
        "short": normalize_memories_from_storage(data.get("short")),
        "long": normalize_memories_from_storage(data.get("long")),
        "script": normalize_memories_from_storage(data.get("script")),
    }


def _save_user_memories_atomic_unlocked(
    payload: dict[str, list[dict[str, str]]],
) -> None:
    path = user_memories_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=".user_memories_",
        suffix=".json.tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _stamp_memory_entries(
    raw_entries: Any,
    previous_entries: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    previous_by_id = {
        str(item.get("id") or ""): item
        for item in (previous_entries or [])
        if str(item.get("id") or "").strip()
    }
    now = _utc_now_iso()
    out: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    seen_content_keys: set[tuple[str, str]] = set()
    source = raw_entries if isinstance(raw_entries, list) else []
    for item in source:
        entry = normalize_memory_entry(item)
        if not entry:
            continue
        if entry["id"] in seen_ids:
            entry["id"] = new_memory_id()
        content_key = (entry["tag"], entry["content"].strip())
        if content_key in seen_content_keys:
            continue
        previous = previous_by_id.get(entry["id"])
        created_at = entry.get("created_at")
        if not created_at and previous:
            created_at = previous.get("created_at")
        if not created_at:
            created_at = now
        changed = (
            not previous
            or previous.get("tag") != entry["tag"]
            or previous.get("content") != entry["content"]
        )
        updated_at = now if changed else (entry.get("updated_at") or previous.get("updated_at") or now)
        entry["created_at"] = str(created_at)
        entry["updated_at"] = str(updated_at)
        seen_ids.add(entry["id"])
        seen_content_keys.add(content_key)
        out.append(entry)
    return out


def read_user_memories(workspace_type: str | None = None) -> list[dict[str, str]]:
    key = _normalize_memory_workspace_type(workspace_type)
    with _data_file_lock():
        return list(_load_user_memories_unlocked().get(key, []))


def write_user_memories(
    workspace_type: str | None,
    memories: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    key = _normalize_memory_workspace_type(workspace_type)
    with _data_file_lock():
        payload = _load_user_memories_unlocked()
        next_entries = _stamp_memory_entries(memories or [], payload.get(key, []))
        payload[key] = next_entries
        _save_user_memories_atomic_unlocked(payload)
        return next_entries


def read_saved_workspace_root() -> str | None:
    with _data_file_lock():
        w = _load_preferences_unlocked().get("workspace_root")
    if isinstance(w, str) and w.strip():
        return w.strip()
    return None


def write_saved_workspace_root(path: str | None) -> None:
    with _data_file_lock():
        prefs = _load_preferences_unlocked()
        if path and str(path).strip():
            prefs["workspace_root"] = str(path).strip()
        else:
            prefs.pop("workspace_root", None)
        _save_preferences_atomic_unlocked(prefs)


def normalize_appearance_style(raw: Any) -> str:
    if isinstance(raw, str) and raw.strip() in APPEARANCE_STYLES:
        return raw.strip()
    return "classic"


def read_appearance_style() -> str:
    with _data_file_lock():
        return normalize_appearance_style(
            _load_preferences_unlocked().get(APPEARANCE_STYLE_PREF_KEY)
        )


def write_appearance_style(style: str) -> str:
    normalized = normalize_appearance_style(style)
    with _data_file_lock():
        prefs = _load_preferences_unlocked()
        prefs[APPEARANCE_STYLE_PREF_KEY] = normalized
        _save_preferences_atomic_unlocked(prefs)
    return normalized


def normalize_text_display_mode(raw: Any) -> str:
    if isinstance(raw, str) and raw.strip() in TEXT_DISPLAY_MODES:
        return raw.strip()
    return "text"


def read_text_display_mode() -> str:
    with _data_file_lock():
        return normalize_text_display_mode(
            _load_preferences_unlocked().get(TEXT_DISPLAY_MODE_PREF_KEY)
        )


def write_text_display_mode(mode: str) -> str:
    normalized = normalize_text_display_mode(mode)
    with _data_file_lock():
        prefs = _load_preferences_unlocked()
        prefs[TEXT_DISPLAY_MODE_PREF_KEY] = normalized
        _save_preferences_atomic_unlocked(prefs)
    return normalized


def read_workspace_agent_read_access() -> dict[str, Any]:
    return read_workspace_agent_read_access_for_type("short")


def write_workspace_agent_read_access(config: dict[str, Any]) -> None:
    write_workspace_agent_read_access_for_type("short", config)


def _workspace_agent_read_access_pref_key(workspace_type: str) -> str:
    normalized = normalize_book_type(workspace_type)
    if normalized == "long":
        return "long_workspace_agent_read_access"
    if normalized == "script":
        return "script_workspace_agent_read_access"
    return "workspace_agent_read_access"


def read_workspace_agent_read_access_for_type(workspace_type: str) -> dict[str, Any]:
    """按创作空间类型读取智能体读取配置；剧本首次从短篇配置复制。"""
    key = _workspace_agent_read_access_pref_key(workspace_type)
    with _data_file_lock():
        prefs = _load_preferences_unlocked()
        raw = prefs.get(key)
        if isinstance(raw, dict):
            return raw

        if normalize_book_type(workspace_type) == "script":
            short_raw = prefs.get("workspace_agent_read_access")
            if isinstance(short_raw, dict):
                prefs[key] = short_raw
                _save_preferences_atomic_unlocked(prefs)
                return short_raw

        legacy = prefs.get("stage_read_access")
        if not isinstance(legacy, dict):
            return {}

        prefs[key] = legacy
        _save_preferences_atomic_unlocked(prefs)
        return legacy


def write_workspace_agent_read_access_for_type(workspace_type: str, config: dict[str, Any]) -> None:
    key = _workspace_agent_read_access_pref_key(workspace_type)
    with _data_file_lock():
        prefs = _load_preferences_unlocked()
        if config:
            prefs[key] = config
        else:
            prefs.pop(key, None)
        _save_preferences_atomic_unlocked(prefs)


_READ_ACCESS_DEFAULT_AGENT_IDS: dict[str, tuple[str, ...]] = {
    "short": (
        "character_design",
        "plot_design",
        "outline",
        "expert_draft_coordinator",
        "expert_section_writer",
    ),
    "script": (
        "character_design",
        "plot_design",
        "outline",
        "expert_draft_coordinator",
        "expert_section_writer",
    ),
    "long": (
        "worldbuilding",
        "character_design",
        "plot_design",
        "draft",
        "continuity_ledger",
    ),
}

_READ_ACCESS_REQUIRED_WORKSPACE_STAGES: dict[str, dict[str, tuple[str, ...]]] = {
    "short": {
        "character_design": ("character_design",),
        "plot_design": ("plot_design", "intro_design", "plot_refine"),
        "outline": ("outline",),
        "expert_draft_coordinator": ("draft",),
        "expert_section_writer": ("draft",),
    },
    "script": {
        "character_design": ("character_design",),
        "plot_design": ("plot_design", "plot_refine"),
        "outline": ("outline",),
        "expert_draft_coordinator": ("draft",),
        "expert_section_writer": ("draft",),
    },
    "long": {
        "worldbuilding": ("worldbuilding.rules",),
        "character_design": ("character_design.protagonists",),
        "plot_design": ("plot_design.book_line",),
        "draft": ("draft.volume-1.arc-1.chapter-1",),
        "continuity_ledger": ("continuity_ledger.timeline",),
    },
}


def _required_workspace_stages_for_read_access(
    workspace_type: str,
    agent_id: str,
) -> tuple[str, ...]:
    normalized = normalize_book_type(workspace_type)
    return _READ_ACCESS_REQUIRED_WORKSPACE_STAGES.get(normalized, {}).get(agent_id, ())


def _builtin_read_access_default_path(workspace_type: str) -> Path:
    normalized = normalize_book_type(workspace_type)
    if normalized == "long":
        prefix = "long"
    else:
        prefix = "script" if normalized == "script" else "short"
    return (
        bundle_root() / "app" / "prompt_defaults" / prefix / "shared" / "read_access.json"
    )


def _validate_read_access_entry(
    agent_id: str,
    entry: dict[str, Any],
    valid_workspace_stages: set[str],
    valid_material_stages: set[str],
    required_workspace_stages: tuple[str, ...] = (),
) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None
    workspace_raw = entry.get("workspace")
    material_raw = entry.get("material")
    out: dict[str, Any] = {}
    workspace: list[str] = []
    if isinstance(workspace_raw, list):
        workspace = [
            str(x) for x in workspace_raw if str(x) in valid_workspace_stages
        ]
    for stage_id in required_workspace_stages:
        if stage_id in valid_workspace_stages and stage_id not in workspace:
            workspace.append(stage_id)
    if workspace:
        out["workspace"] = workspace
    if isinstance(material_raw, list):
        material: list[str] = []
        for raw_id in material_raw:
            material_id = str(raw_id)
            if material_id in valid_material_stages:
                kind = material_id
            else:
                kind = MATERIAL_STAGE_TO_KIND.get(material_id, "")
            if kind and kind in valid_material_stages and kind not in material:
                material.append(kind)
        out["material"] = material
    return out if out else None


def sync_workspace_agent_read_access_defaults(
    workspace_type: str | None = None,
) -> dict[str, Any]:
    """将用户 AppData preferences.json 中的读取范围配置同步为内置默认 JSON 文件。"""
    if is_frozen():
        raise RuntimeError("已打包环境下无法同步源码默认配置，请在源码运行模式下操作。")

    normalized = normalize_book_type(workspace_type or "short")
    if normalized == "long":
        valid_workspace = set(LONG_STAGE_KEYS)
    else:
        is_script = normalized == "script"
        valid_workspace = set(SCRIPT_STAGE_KEYS if is_script else SHORT_STAGE_KEYS)
    valid_material = set(MATERIAL_KIND_KEYS)

    user_config = read_workspace_agent_read_access_for_type(normalized)

    output: dict[str, Any] = {}
    for agent_id in _READ_ACCESS_DEFAULT_AGENT_IDS.get(normalized, ()):
        raw_entry = user_config.get(agent_id)
        if not isinstance(raw_entry, dict):
            continue
        validated = _validate_read_access_entry(
            agent_id,
            raw_entry,
            valid_workspace,
            valid_material,
            _required_workspace_stages_for_read_access(normalized, agent_id),
        )
        if validated:
            output[agent_id] = validated

    target_path = _builtin_read_access_default_path(normalized)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(output, ensure_ascii=False, indent=2)
    fd, tmp = tempfile.mkstemp(
        dir=str(target_path.parent),
        prefix=".read_access_",
        suffix=".json.tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, target_path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

    return output


def read_workspace_agent_read_access_defaults(
    workspace_type: str | None = None,
) -> dict[str, Any]:
    """从内置默认 JSON 文件读取读取范围默认配置；文件不存在时返回空对象。"""
    normalized = normalize_book_type(workspace_type or "short")
    if normalized == "long":
        valid_workspace = set(LONG_STAGE_KEYS)
    else:
        is_script = normalized == "script"
        valid_workspace = set(SCRIPT_STAGE_KEYS if is_script else SHORT_STAGE_KEYS)
    valid_material = set(MATERIAL_KIND_KEYS)

    target_path = _builtin_read_access_default_path(normalized)
    if not target_path.is_file():
        return {}

    try:
        raw = json.loads(target_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}

    if not isinstance(raw, dict):
        return {}

    output: dict[str, Any] = {}
    for agent_id in _READ_ACCESS_DEFAULT_AGENT_IDS.get(normalized, ()):
        entry = raw.get(agent_id)
        if not isinstance(entry, dict):
            continue
        validated = _validate_read_access_entry(
            agent_id,
            entry,
            valid_workspace,
            valid_material,
            _required_workspace_stages_for_read_access(normalized, agent_id),
        )
        if validated:
            output[agent_id] = validated
    return output


def _normalize_config_id(raw: str) -> str:
    return "".join(
        ch if ch.isalnum() or ch == "-" else "_"
        for ch in raw.strip().lower()
    ).strip("_-")


def _read_string(raw: Any) -> str:
    return raw.strip() if isinstance(raw, str) else ""


def _read_bool(raw: Any) -> bool | None:
    if isinstance(raw, bool):
        return raw
    if not isinstance(raw, str):
        return None
    normalized = raw.strip().lower()
    if normalized in ("1", "true", "yes", "y", "on", "支持", "开启"):
        return True
    if normalized in ("0", "false", "no", "n", "off", "不支持", "关闭"):
        return False
    return None


def _normalize_ai_model_entry(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    provider = _read_string(raw.get("provider") or raw.get("model_source"))
    model_id = _read_string(
        raw.get("model_id") or raw.get("modelId") or raw.get("model_name")
    )
    api_key = _read_string(raw.get("api_key") or raw.get("apiKey") or raw.get("model_key"))
    raw_id = _read_string(raw.get("id")) or model_id or provider
    config_id = _normalize_config_id(raw_id)
    if not config_id or not provider or not model_id:
        return None

    label = (
        _read_string(raw.get("label") or raw.get("display_name") or raw.get("title"))
        or raw_id
        or model_id
    )
    out: dict[str, Any] = {
        "id": config_id,
        "label": label,
        "provider": provider.lower(),
        "model_id": model_id,
        "api_key": api_key,
    }
    base_url = _read_string(raw.get("base_url") or raw.get("baseUrl") or raw.get("model_url"))
    api = _read_string(raw.get("api") or raw.get("model_like") or raw.get("modelLike"))
    if base_url:
        out["base_url"] = base_url
    if api:
        out["api"] = api
    reasoning_raw = raw["reasoning"] if "reasoning" in raw else raw.get("model_reasoning")
    stream_raw = raw["stream"] if "stream" in raw else raw.get("model_stream")
    reasoning = _read_bool(reasoning_raw)
    stream = _read_bool(stream_raw)
    if reasoning is not None:
        out["reasoning"] = reasoning
    if stream is not None:
        out["stream"] = stream
    return out


def _normalize_image_model_config(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    model = _read_string(raw.get("model") or raw.get("image_model"))
    api_key = _read_string(raw.get("api_key") or raw.get("apiKey") or raw.get("image_model_key"))
    if not model or not api_key:
        return None
    out = {
        "model": model,
        "api_key": api_key,
    }
    base_url = _read_string(
        raw.get("base_url")
        or raw.get("baseUrl")
        or raw.get("image_model_url")
        or raw.get("image_url")
        or raw.get("image_base_url")
    )
    if base_url:
        out["base_url"] = base_url
    return out


def normalize_ai_model_config(raw: Any) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    text = source.get("text") if isinstance(source.get("text"), dict) else source
    text_obj = text if isinstance(text, dict) else {}
    models_raw = text_obj.get("models")
    if not isinstance(models_raw, list):
        models_raw = []

    models: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in models_raw:
        normalized = _normalize_ai_model_entry(item)
        if not normalized:
            continue
        base_id = normalized["id"]
        config_id = base_id
        suffix = 2
        while config_id in seen_ids:
            config_id = f"{base_id}_{suffix}"
            suffix += 1
        normalized["id"] = config_id
        seen_ids.add(config_id)
        models.append(normalized)

    default_model_id = _normalize_config_id(
        _read_string(
            text_obj.get("default_model_id")
            or text_obj.get("defaultModelId")
            or source.get("default_model_id")
            or source.get("default_model")
        )
    )
    if default_model_id and default_model_id not in seen_ids:
        default_model_id = ""
    if not default_model_id and models:
        default_model_id = models[0]["id"]

    return {
        "text": {
            "models": models,
            "default_model_id": default_model_id,
        },
        "image": _normalize_image_model_config(source.get("image")),
    }


def _ai_model_config_has_values(config: dict[str, Any]) -> bool:
    text = config.get("text")
    models = text.get("models") if isinstance(text, dict) else []
    return bool(models) or config.get("image") is not None


def _apply_builtin_text_default(config: dict[str, Any]) -> dict[str, Any]:
    text = config.get("text")
    from app.ai_env import load_text_model_defaults

    text_defaults = load_text_model_defaults()
    builtin_models = [
        normalized
        for item in text_defaults["models"]
        if (normalized := _normalize_ai_model_entry(item))
    ]
    if not builtin_models:
        return config

    models = list(text.get("models", [])) if isinstance(text, dict) else []
    default_model_id = _read_string(text.get("default_model_id")) if isinstance(text, dict) else ""

    for builtin in reversed(builtin_models):
        index = next(
            (i for i, model in enumerate(models) if model.get("id") == builtin["id"]),
            -1,
        )
        if index >= 0:
            models[index] = {**models[index], **builtin}
        else:
            models.insert(0, dict(builtin))

    model_ids = {model.get("id") for model in models}
    selected = next(
        (model for model in models if model.get("id") == default_model_id),
        None,
    )
    builtin_default_id = _normalize_config_id(text_defaults["default_model_id"])
    if (
        not default_model_id
        or default_model_id not in model_ids
        or not _read_string(selected.get("api_key") if isinstance(selected, dict) else "")
    ):
        default_model_id = (
            builtin_default_id
            if builtin_default_id in model_ids
            else _read_string(models[0].get("id")) if models else ""
        )

    return {
        **config,
        "text": {
            "models": models,
            "default_model_id": default_model_id,
        },
    }


def _apply_builtin_image_default(config: dict[str, Any]) -> dict[str, Any]:
    if config.get("image") is not None:
        return config
    from app.ai_env import load_image_model_defaults

    image = load_image_model_defaults()
    if not image:
        return config
    return {**config, "image": image}


def _apply_builtin_defaults(config: dict[str, Any]) -> dict[str, Any]:
    return _apply_builtin_image_default(_apply_builtin_text_default(config))


def read_ai_model_config() -> dict[str, Any]:
    with _data_file_lock():
        prefs = _load_preferences_unlocked()
        raw = prefs.get(AI_MODEL_CONFIG_PREF_KEY)
        if isinstance(raw, dict):
            return _apply_builtin_defaults(normalize_ai_model_config(raw))

        from app.ai_env import load_ai_model_settings_from_env

        imported = _apply_builtin_defaults(
            normalize_ai_model_config(load_ai_model_settings_from_env())
        )
        if _ai_model_config_has_values(imported):
            prefs[AI_MODEL_CONFIG_PREF_KEY] = imported
            _save_preferences_atomic_unlocked(prefs)
        return imported


def write_ai_model_config(config: dict[str, Any]) -> dict[str, Any]:
    normalized = _apply_builtin_defaults(normalize_ai_model_config(config))
    with _data_file_lock():
        prefs = _load_preferences_unlocked()
        prefs[AI_MODEL_CONFIG_PREF_KEY] = normalized
        _save_preferences_atomic_unlocked(prefs)
    return normalized


def read_ai_model_defaults() -> dict[str, Any] | None:
    settings = read_ai_model_config()
    text = settings.get("text")
    if not isinstance(text, dict):
        return None
    models = text.get("models")
    if not isinstance(models, list) or not models:
        return None
    default_model_id = _read_string(text.get("default_model_id"))
    first = models[0]
    out: dict[str, Any] = {
        "provider": first["provider"],
        "model_id": first["model_id"],
        "api_key": first["api_key"],
        "models": models,
    }
    if default_model_id:
        out["default_model_id"] = default_model_id
    return out


def read_image_model_config() -> dict[str, str] | None:
    image = read_ai_model_config().get("image")
    return image if isinstance(image, dict) else None


def _sanitize_material_folder_name(title: str) -> str:
    """清理素材文件夹名称"""
    t = (title or "").strip() or "未命名素材"
    for ch in _WIN_INVALID:
        t = t.replace(ch, "_")
    t = t.strip(" .")
    return t or "未命名素材"


def _sanitize_skill_folder_name(title: str) -> str:
    """清理技能文件夹名称"""
    t = (title or "").strip() or "未命名技能"
    for ch in _WIN_INVALID:
        t = t.replace(ch, "_")
    t = t.strip(" .")
    return t or "未命名技能"


def _write_material_stages_to_disk(material: Material) -> None:
    """将素材各阶段内容写入输出目录"""
    od = (material.output_dir or "").strip()
    if not od:
        return
    root = Path(od)
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return

    for key in MATERIAL_STAGE_KEYS:
        text = str(material.stages.get(key, "") or "")
        try:
            (root / f"{key}.txt").write_text(text, encoding="utf-8")
        except OSError:
            pass

    try:
        (root / "overview.txt").write_text(str(material.overview or ""), encoding="utf-8")
    except OSError:
        pass


def _remove_output_dir(output_dir: str) -> None:
    """删除输出目录及其内容（忽略删除失败）。"""
    od = (output_dir or "").strip()
    if not od:
        return
    root = Path(od)
    if not root.is_dir():
        return
    try:
        shutil.rmtree(root)
    except OSError:
        pass


def _write_skill_stages_to_disk(skill: Skill) -> None:
    """将技能内容写入输出目录。"""
    od = (skill.output_dir or "").strip()
    if not od:
        return
    root = Path(od)
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return

    for stage_id in SKILL_STAGE_KEYS:
        entries = skill.stages.get(stage_id, [])
        blocks: list[str] = []
        for entry in entries:
            title = str(entry.get("title") or "未命名技能").strip() or "未命名技能"
            body = str(entry.get("body") or "")
            blocks.append(f"# {title}\n\n{body}".strip())
        try:
            (root / f"{stage_id}.txt").write_text(
                "\n\n---\n\n".join(blocks),
                encoding="utf-8",
            )
        except OSError:
            pass
    try:
        (root / "overview.txt").write_text(str(skill.overview or ""), encoding="utf-8")
    except OSError:
        pass
    for legacy_stage_id in ("intro_design", "plot_refine"):
        try:
            legacy_path = root / f"{legacy_stage_id}.txt"
            if legacy_path.is_file():
                legacy_path.unlink()
        except OSError:
            pass


def load_materials(path: Path) -> dict[str, Material]:
    """从JSON文件加载素材数据"""
    if not path.exists():
        return {}
    raw = path.read_text(encoding="utf-8")
    if not raw.strip():
        return {}
    payload = json.loads(raw)
    materials: dict[str, Material] = {}
    for item in payload.get("materials", []):
        m = Material.from_dict(item)
        materials[m.id] = m
    return materials


def load_skills(path: Path) -> dict[str, Skill]:
    """从 JSON 文件加载技能数据"""
    if not path.exists():
        return {}
    raw = path.read_text(encoding="utf-8")
    if not raw.strip():
        return {}
    payload = json.loads(raw)
    skills: dict[str, Skill] = {}
    for item in payload.get("skills", []):
        s = Skill.from_dict(item)
        skills[s.id] = s
    return skills


def _load_default_skill_template() -> dict[str, Any] | None:
    """从 bundle_root 读取默认技能模板 JSON。"""
    template_path = (
        bundle_root() / "app" / "prompt_defaults" / "skill" / "default_skill_template.json"
    )
    if not template_path.exists():
        return None
    try:
        raw = template_path.read_text(encoding="utf-8")
        return json.loads(raw) if raw.strip() else None
    except (json.JSONDecodeError, OSError):
        return None


def _seed_default_skill(skills_path: Path) -> dict[str, Skill]:
    """首次启动无技能时，从内置模板创建默认参考技能。"""
    template = _load_default_skill_template()
    if not template:
        return {}
    now = datetime.now(timezone.utc).strftime(ISO_FMT)
    sid = new_skill_id()
    title = str(template.get("title") or "参考技能")
    raw_stages = template.get("stages") or {}
    merged_stages = normalize_skill_stages_from_storage(
        raw_stages if isinstance(raw_stages, dict) else {}
    )
    stages: dict[str, list[dict[str, str]]] = {}
    for stage_key in SKILL_STAGE_KEYS:
        entries = merged_stages.get(stage_key, [])
        normalized: list[dict[str, str]] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            body = str(entry.get("body") or "")
            entry_title = str(entry.get("title") or "未命名技能").strip() or "未命名技能"
            normalized.append({
                "id": new_skill_stage_item_id(),
                "title": entry_title,
                "body": body,
                "created_at": now,
                "updated_at": now,
            })
        stages[stage_key] = normalized
    skill = Skill(
        id=sid,
        title=title,
        skill_type="short",
        skill_kind="general",
        overview=str(template.get("overview") or ""),
        stages=stages,
        output_dir="",
        created_at=now,
        updated_at=now,
    )
    skills = {sid: skill}
    save_skills_atomic(skills_path, skills)
    return skills


def save_materials_atomic(path: Path, materials: dict[str, Material]) -> None:
    """原子化保存素材数据到JSON文件"""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "materials": [m.to_dict() for m in materials.values()],
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=".materials_",
        suffix=".json.tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def save_skills_atomic(path: Path, skills: dict[str, Skill]) -> None:
    """原子化保存技能数据到 JSON 文件"""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "skills": [s.to_dict() for s in skills.values()],
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=".skills_",
        suffix=".json.tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _same_loaded_common_skill(entry: dict[str, Any], common_skill: dict[str, Any]) -> bool:
    source_id = str(common_skill.get("id") or "").strip()
    entry_source_id = str(entry.get("source_common_skill_id") or "").strip()
    if source_id and entry_source_id == source_id:
        return True
    return (
        str(entry.get("title") or "").strip() == str(common_skill.get("title") or "").strip()
        and str(entry.get("body") or "").strip() == str(common_skill.get("body") or "").strip()
    )


def _append_missing_common_skills(
    stages: dict[str, list[dict[str, Any]]],
    now: str,
    allowed_stage_ids: tuple[str, ...] | list[str] | None = None,
) -> tuple[int, int]:
    added_count = 0
    available_count = 0
    allowed = set(allowed_stage_ids or SKILL_STAGE_KEYS)
    for common_skill in read_common_skills():
        source_id = str(common_skill.get("id") or "").strip()
        title = str(common_skill.get("title") or "").strip() or "未命名通用技能"
        body = str(common_skill.get("body") or "")
        for stage_id in common_skill.get("effective_stages") or []:
            if stage_id not in SKILL_STAGE_KEYS or stage_id not in allowed:
                continue
            available_count += 1
            entries = stages.setdefault(stage_id, [])
            if any(_same_loaded_common_skill(entry, common_skill) for entry in entries):
                continue
            entry = {
                "id": new_skill_stage_item_id(),
                "title": title,
                "body": body,
                "created_at": now,
                "updated_at": now,
            }
            if source_id:
                entry["source_common_skill_id"] = source_id
            entries.append(entry)
            added_count += 1
    return added_count, available_count


class BookStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or default_data_path()
        # 素材数据存储
        self._materials_path = default_materials_path()
        # 技能数据存储
        self._skills_path = default_skills_path()
        self._books_signature: object | tuple[int, int] | None = _FILE_SIGNATURE_UNSET
        self._materials_signature: object | tuple[int, int] | None = _FILE_SIGNATURE_UNSET
        self._skills_signature: object | tuple[int, int] | None = _FILE_SIGNATURE_UNSET
        with _data_file_lock():
            self._reload_all_unlocked()

    def _reload_all_unlocked(self) -> None:
        self._reload_books_unlocked()
        self._reload_materials_unlocked()
        self._reload_skills_unlocked()
        self._normalize_all_book_material_links_unlocked()
        self._normalize_all_book_skill_links_unlocked()
        if not self._skills and not self._skills_path.exists():
            self._skills = _seed_default_skill(self._skills_path)
            self._skills_signature = _file_signature(self._skills_path)

    def _reload_books_unlocked(self) -> None:
        signature = _file_signature(self._path)
        if self._books_signature == signature:
            return
        self._books = load_books(self._path)
        self._books_signature = signature

    def _reload_materials_unlocked(self) -> None:
        signature = _file_signature(self._materials_path)
        if self._materials_signature == signature:
            return
        self._materials = load_materials(self._materials_path)
        self._materials_signature = signature

    def _reload_skills_unlocked(self) -> None:
        signature = _file_signature(self._skills_path)
        if self._skills_signature == signature:
            return
        self._skills = load_skills(self._skills_path)
        self._skills_signature = signature

    def _mark_books_saved_unlocked(self) -> None:
        self._books_signature = _file_signature(self._path)

    def _mark_materials_saved_unlocked(self) -> None:
        self._materials_signature = _file_signature(self._materials_path)

    def _mark_skills_saved_unlocked(self) -> None:
        self._skills_signature = _file_signature(self._skills_path)

    def _material_can_link_to_book_kind(
        self,
        material_id: str,
        book_type: str,
        material_kind: str,
    ) -> bool:
        material = self._materials.get(material_id)
        if material is None:
            return False
        if material.material_type != book_type:
            return False
        return material.material_kind == "mixed" or material.material_kind == material_kind

    def _legacy_material_links_by_kind(
        self,
        material_id: str,
        book_type: str,
    ) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {kind: [] for kind in MATERIAL_KIND_KEYS}
        mid = (material_id or "").strip()
        material = self._materials.get(mid)
        if not mid or material is None or material.material_type != book_type:
            return out
        if material.material_kind == "mixed":
            for kind in MATERIAL_KIND_KEYS:
                out[kind] = [mid]
            return out
        if material.material_kind in out:
            out[material.material_kind] = [mid]
        return out

    def _normalize_book_material_links_unlocked(self, book: Book) -> bool:
        previous_legacy_id = book.linked_material_id
        previous_by_kind = {
            kind: list(book.linked_material_ids_by_kind.get(kind) or [])
            for kind in MATERIAL_KIND_KEYS
        }
        if book.book_type not in WORKSPACE_BOOK_TYPES:
            book.linked_material_ids_by_kind = {kind: [] for kind in MATERIAL_KIND_KEYS}
            book.linked_material_id = ""
            return previous_legacy_id != "" or any(previous_by_kind.values())

        normalized: dict[str, list[str]] = {kind: [] for kind in MATERIAL_KIND_KEYS}
        for kind in MATERIAL_KIND_KEYS:
            seen: set[str] = set()
            for raw_id in book.linked_material_ids_by_kind.get(kind) or []:
                mid = str(raw_id or "").strip()
                if not mid or mid in seen:
                    continue
                if not self._material_can_link_to_book_kind(mid, book.book_type, kind):
                    continue
                seen.add(mid)
                normalized[kind].append(mid)

        if not any(normalized.values()) and book.linked_material_id:
            normalized = self._legacy_material_links_by_kind(
                book.linked_material_id,
                book.book_type,
            )

        book.linked_material_ids_by_kind = normalized
        book.linked_material_id = first_linked_material_id(normalized)
        return (
            previous_legacy_id != book.linked_material_id
            or previous_by_kind != normalized
        )

    def _skill_can_link_to_book_kind(
        self,
        skill_id: str,
        book_type: str,
        skill_kind: str,
    ) -> bool:
        skill = self._skills.get(skill_id)
        if skill is None:
            return False
        if skill.skill_type != book_type:
            return False
        return skill.skill_kind == skill_kind

    def _legacy_skill_links_by_kind(
        self,
        skill_id: str,
        book_type: str,
    ) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {kind: [] for kind in SKILL_KIND_KEYS}
        sid = (skill_id or "").strip()
        skill = self._skills.get(sid)
        if not sid or skill is None or skill.skill_type != book_type:
            return out
        if skill.skill_kind in out:
            out[skill.skill_kind] = [sid]
        else:
            out["general"] = [sid]
        return out

    def _normalize_book_skill_links_unlocked(self, book: Book) -> bool:
        previous_legacy_id = book.linked_skill_id
        previous_by_kind = {
            kind: list(book.linked_skill_ids_by_kind.get(kind) or [])
            for kind in SKILL_KIND_KEYS
        }
        if book.book_type not in WORKSPACE_BOOK_TYPES:
            book.linked_skill_ids_by_kind = {kind: [] for kind in SKILL_KIND_KEYS}
            book.linked_skill_id = ""
            return previous_legacy_id != "" or any(previous_by_kind.values())

        normalized: dict[str, list[str]] = {kind: [] for kind in SKILL_KIND_KEYS}
        for kind in SKILL_KIND_KEYS:
            seen: set[str] = set()
            for raw_id in book.linked_skill_ids_by_kind.get(kind) or []:
                sid = str(raw_id or "").strip()
                if not sid or sid in seen:
                    continue
                if not self._skill_can_link_to_book_kind(sid, book.book_type, kind):
                    continue
                seen.add(sid)
                normalized[kind].append(sid)

        if not any(normalized.values()) and book.linked_skill_id:
            normalized = self._legacy_skill_links_by_kind(
                book.linked_skill_id,
                book.book_type,
            )

        book.linked_skill_ids_by_kind = normalized
        book.linked_skill_id = first_linked_skill_id(normalized)
        return (
            previous_legacy_id != book.linked_skill_id
            or previous_by_kind != normalized
        )

    def _normalize_all_book_material_links_unlocked(self) -> bool:
        changed = False
        for book in self._books.values():
            changed = self._normalize_book_material_links_unlocked(book) or changed
        return changed

    def _normalize_all_book_skill_links_unlocked(self) -> bool:
        changed = False
        for book in self._books.values():
            changed = self._normalize_book_skill_links_unlocked(book) or changed
        return changed

    @property
    def path(self) -> Path:
        return self._path

    def list_books(self) -> list[dict[str, Any]]:
        with _data_file_lock():
            self._reload_all_unlocked()
            return [
                {
                    "id": b.id,
                    "title": b.title,
                    "book_type": b.book_type,
                    "categories": b.categories,
                    "output_dir": b.output_dir,
                    "linked_material_id": b.linked_material_id,
                    "linked_material_ids_by_kind": b.linked_material_ids_by_kind,
                    "linked_skill_id": b.linked_skill_id,
                    "linked_skill_ids_by_kind": b.linked_skill_ids_by_kind,
                    "status": b.status,
                }
                for b in sorted(
                    self._books.values(),
                    key=lambda x: (x.updated_at or "", x.title),
                    reverse=True,
                )
            ]

    def get_book(self, book_id: str) -> dict[str, Any] | None:
        with _data_file_lock():
            self._reload_all_unlocked()
            b = self._books.get(book_id)
            if b is None:
                return None
            return b.to_dict()

    def get_book_output_dir(self, book_id: str) -> str:
        with _data_file_lock():
            self._reload_books_unlocked()
            b = self._books.get((book_id or "").strip())
            return b.output_dir if b is not None else ""

    def get_book_output_dirs(self, book_ids: list[str]) -> dict[str, str]:
        cleaned_ids = [str(book_id or "").strip() for book_id in book_ids]
        with _data_file_lock():
            self._reload_books_unlocked()
            return {
                book_id: self._books[book_id].output_dir
                for book_id in cleaned_ids
                if book_id in self._books
            }

    def create_book(
        self,
        title: str,
        book_type: str,
        categories: list[str] | None,
        workspace_root: str | None = None,
        linked_skill_id: str | None = None,
        linked_material_id: str | None = None,
        linked_material_ids_by_kind: dict[str, Any] | None = None,
        linked_skill_ids_by_kind: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with _data_file_lock():
            self._reload_all_unlocked()
            now = _utc_now_iso()
            bt = normalize_book_type(book_type)
            cats = list(categories or []) if bt in WORKSPACE_BOOK_TYPES else []
            sid = (linked_skill_id or "").strip()
            linked_sid = sid if bt in WORKSPACE_BOOK_TYPES and sid in self._skills else ""
            linked_skill_by_kind = normalize_linked_skill_ids_by_kind(
                linked_skill_ids_by_kind,
                linked_sid,
            )
            linked_by_kind = normalize_linked_material_ids_by_kind(
                linked_material_ids_by_kind,
                linked_material_id,
            )
            wr = (workspace_root or "").strip()
            od = ""
            if wr:
                try:
                    parent = Path(wr).expanduser()
                    parent.mkdir(parents=True, exist_ok=True)
                    parent = parent.resolve()
                    folder_name = _sanitize_book_folder_name(title.strip() or "未命名")
                    book_dir = _unique_child_dir(parent, folder_name)
                    book_dir.mkdir(parents=True, exist_ok=False)
                    od = str(book_dir)
                except (OSError, ValueError):
                    od = ""
                if not od:
                    raise RuntimeError(
                        "无法在选定工作文件夹下创建书本目录，请检查路径是否有效、磁盘空间与写入权限。",
                    )
            bid = new_book_id()
            b = Book(
                id=bid,
                title=title.strip() or "未命名",
                book_type=bt,  # type: ignore[arg-type]
                categories=cats,
                content="",
                output_dir=od,
                linked_material_id=(linked_material_id or "").strip(),
                linked_material_ids_by_kind=linked_by_kind,
                linked_skill_id=linked_sid,
                linked_skill_ids_by_kind=linked_skill_by_kind,
                stages=default_stages(bt),
                expert_draft=normalize_expert_draft_from_storage(None, bt),
                created_at=now,
                updated_at=now,
            )
            self._normalize_book_material_links_unlocked(b)
            self._normalize_book_skill_links_unlocked(b)
            self._books[bid] = b
            save_books_atomic(self._path, self._books)
            self._mark_books_saved_unlocked()
            _write_stages_to_disk(b)
            return b.to_dict()

    def save_book(
        self,
        book_id: str,
        content: str | None = None,
        stages: dict[str, str] | None = None,
        linked_material_id: str | None = None,
        expert_draft: dict[str, Any] | None = None,
        title: str | None = None,
        status: str | None = None,
        linked_skill_id: str | None = None,
        linked_skill_ids_by_kind: dict[str, Any] | None = None,
        memory_auto_capture_enabled: bool | None = None,
        linked_material_ids_by_kind: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        with _data_file_lock():
            self._reload_all_unlocked()
            b = self._books.get(book_id)
            if b is None:
                return None
            if title is not None:
                b.title = title.strip()
            if linked_material_id is not None:
                mid = linked_material_id.strip()
                b.linked_material_id = mid if mid in self._materials else ""
                b.linked_material_ids_by_kind = self._legacy_material_links_by_kind(
                    b.linked_material_id,
                    b.book_type,
                )
            if linked_material_ids_by_kind is not None:
                b.linked_material_ids_by_kind = normalize_linked_material_ids_by_kind(
                    linked_material_ids_by_kind,
                    None,
                )
                b.linked_material_id = first_linked_material_id(
                    b.linked_material_ids_by_kind,
                )
            self._normalize_book_material_links_unlocked(b)
            if linked_skill_id is not None:
                sid = linked_skill_id.strip()
                b.linked_skill_id = sid if b.book_type in WORKSPACE_BOOK_TYPES and sid in self._skills else ""
                b.linked_skill_ids_by_kind = self._legacy_skill_links_by_kind(
                    b.linked_skill_id,
                    b.book_type,
                )
            if linked_skill_ids_by_kind is not None:
                b.linked_skill_ids_by_kind = normalize_linked_skill_ids_by_kind(
                    linked_skill_ids_by_kind,
                    None,
                )
                b.linked_skill_id = first_linked_skill_id(
                    b.linked_skill_ids_by_kind,
                )
            self._normalize_book_skill_links_unlocked(b)
            if stages is not None:
                b.stages = apply_stage_patch(b.stages, stages, b.book_type)
                dk = primary_draft_stage_key(b)
                b.content = str(b.stages.get(dk, "") or "")
            elif content is not None:
                b.content = content
            if expert_draft is not None:
                b.expert_draft = normalize_expert_draft_from_storage(
                    expert_draft, b.book_type
                )
            if status is not None:
                b.status = normalize_book_status(status)
            if memory_auto_capture_enabled is not None:
                b.memory_auto_capture_enabled = bool(memory_auto_capture_enabled)
            b.updated_at = _utc_now_iso()
            save_books_atomic(self._path, self._books)
            self._mark_books_saved_unlocked()
            _write_stages_to_disk(b)
            return b.to_dict()

    def get_book_memories(self, book_id: str) -> list[dict[str, str]]:
        with _data_file_lock():
            self._reload_books_unlocked()
            b = self._books.get((book_id or "").strip())
            if b is None:
                return []
            return list(b.memories)

    def set_book_memories(
        self,
        book_id: str,
        memories: list[dict[str, Any]] | None,
    ) -> list[dict[str, str]]:
        with _data_file_lock():
            self._reload_books_unlocked()
            b = self._books.get((book_id or "").strip())
            if b is None:
                return []
            b.memories = _stamp_memory_entries(memories or [], b.memories)
            b.updated_at = _utc_now_iso()
            save_books_atomic(self._path, self._books)
            self._mark_books_saved_unlocked()
            return list(b.memories)

    def delete_book(self, book_id: str) -> bool:
        """从书架移除该书（不写磁盘目录）。若 id 不存在则返回 False。"""
        with _data_file_lock():
            self._reload_books_unlocked()
            bid = (book_id or "").strip()
            if not bid or bid not in self._books:
                return False
            del self._books[bid]
            save_books_atomic(self._path, self._books)
            self._mark_books_saved_unlocked()
            return True

    # ==================== 素材管理方法 ====================

    def list_materials(self) -> list[dict[str, Any]]:
        """列出所有素材，按更新时间倒序"""
        with _data_file_lock():
            self._reload_materials_unlocked()
            return [
                {
                    "id": m.id,
                    "title": m.title,
                    "material_type": m.material_type,
                    "material_kind": m.material_kind,
                    "parent_genre": m.parent_genre,
                    "sub_genre": m.sub_genre,
                    "output_dir": m.output_dir,
                }
                for m in sorted(
                    self._materials.values(),
                    key=lambda x: (x.updated_at or "", x.title),
                    reverse=True,
                )
            ]

    def get_material(self, material_id: str) -> dict[str, Any] | None:
        """获取单个素材详情"""
        with _data_file_lock():
            self._reload_materials_unlocked()
            m = self._materials.get(material_id)
            if m is None:
                return None
            return m.to_dict()

    def create_material(
        self,
        title: str,
        material_type: str,
        parent_genre: str | None = None,
        sub_genre: str | None = None,
        workspace_root: str | None = None,
        material_kind: str | None = None,
    ) -> dict[str, Any]:
        """创建新素材"""
        with _data_file_lock():
            self._reload_materials_unlocked()
            now = _utc_now_iso()
            mt = normalize_material_type(material_type)
            mk = normalize_material_kind(material_kind, "mixed")
            wr = (workspace_root or "").strip()
            od = ""
            if wr:
                try:
                    parent = Path(wr).expanduser()
                    parent.mkdir(parents=True, exist_ok=True)
                    parent = parent.resolve()
                    folder_name = _sanitize_material_folder_name(title.strip() or "未命名素材")
                    materials_parent = _unique_child_dir(parent, "素材库")
                    materials_parent.mkdir(parents=True, exist_ok=True)
                    material_dir = _unique_child_dir(materials_parent, folder_name)
                    material_dir.mkdir(parents=True, exist_ok=False)
                    od = str(material_dir)
                except (OSError, ValueError):
                    od = ""
                if not od:
                    raise RuntimeError(
                        "无法在选定工作文件夹下创建素材目录，请检查路径是否有效、磁盘空间与写入权限。",
                    )
            mid = new_material_id()
            m = Material(
                id=mid,
                title=title.strip() or "未命名素材",
                material_type=mt,  # type: ignore[arg-type]
                material_kind=mk,
                parent_genre=str(parent_genre or "") if mt in ("short", "script") else "",
                sub_genre="",
                overview="",
                stages=default_material_stages(),
                stage_items=normalize_material_stage_items_from_storage({}),
                output_dir=od,
                created_at=now,
                updated_at=now,
            )
            self._materials[mid] = m
            save_materials_atomic(self._materials_path, self._materials)
            self._mark_materials_saved_unlocked()
            _write_material_stages_to_disk(m)
            return m.to_dict()

    def save_material(
        self,
        material_id: str,
        stages: dict[str, str] | None = None,
        title: str | None = None,
        stage_items: dict[str, Any] | None = None,
        overview: str | None = None,
    ) -> dict[str, Any] | None:
        """保存素材阶段内容"""
        with _data_file_lock():
            self._reload_materials_unlocked()
            m = self._materials.get(material_id)
            if m is None:
                return None
            if stage_items is not None:
                m.stage_items = normalize_material_stage_items_from_storage(stage_items)
                m.stages = material_stage_items_to_stages(m.stage_items)
            elif stages is not None:
                m.stages = normalize_material_stages_from_storage(stages)
                m.stage_items = normalize_material_stage_items_from_storage(None, m.stages)
            if title is not None:
                m.title = title.strip()
            if overview is not None:
                m.overview = str(overview)
            m.updated_at = _utc_now_iso()
            save_materials_atomic(self._materials_path, self._materials)
            self._mark_materials_saved_unlocked()
            _write_material_stages_to_disk(m)
            return m.to_dict()

    def delete_material(self, material_id: str) -> bool:
        """删除素材及其本地输出目录"""
        with _data_file_lock():
            self._reload_all_unlocked()
            mid = (material_id or "").strip()
            if not mid or mid not in self._materials:
                return False
            m = self._materials[mid]
            output_dir = m.output_dir
            del self._materials[mid]
            save_materials_atomic(self._materials_path, self._materials)
            self._mark_materials_saved_unlocked()
            changed_books = False
            for book in self._books.values():
                previous_legacy = book.linked_material_id
                previous = {
                    kind: list(book.linked_material_ids_by_kind.get(kind) or [])
                    for kind in MATERIAL_KIND_KEYS
                }
                book.linked_material_ids_by_kind = {
                    kind: [
                        linked_id
                        for linked_id in book.linked_material_ids_by_kind.get(kind, [])
                        if linked_id != mid
                    ]
                    for kind in MATERIAL_KIND_KEYS
                }
                if book.linked_material_id == mid:
                    book.linked_material_id = ""
                self._normalize_book_material_links_unlocked(book)
                if (
                    previous != book.linked_material_ids_by_kind
                    or previous_legacy != book.linked_material_id
                ):
                    book.updated_at = _utc_now_iso()
                    changed_books = True
            if changed_books:
                save_books_atomic(self._path, self._books)
                self._mark_books_saved_unlocked()
            _remove_output_dir(output_dir)
            return True

    # ==================== 技能管理方法 ====================

    def list_skills(self) -> list[dict[str, Any]]:
        """列出所有技能集合，按更新时间倒序"""
        with _data_file_lock():
            self._reload_skills_unlocked()
            return [
                {
                    "id": s.id,
                    "title": s.title,
                    "skill_type": s.skill_type,
                    "skill_kind": s.skill_kind,
                    "stage_counts": {
                        stage_id: len(s.stages.get(stage_id, []))
                        for stage_id in SKILL_STAGE_KEYS
                    },
                    "stage_skill_count": sum(
                        len(s.stages.get(stage_id, [])) for stage_id in SKILL_STAGE_KEYS
                    ),
                    "output_dir": s.output_dir,
                }
                for s in sorted(
                    self._skills.values(),
                    key=lambda x: (x.updated_at or "", x.title),
                    reverse=True,
                )
            ]

    def get_skill(self, skill_id: str) -> dict[str, Any] | None:
        """获取单个技能详情"""
        with _data_file_lock():
            self._reload_skills_unlocked()
            s = self._skills.get(skill_id)
            if s is None:
                return None
            return s.to_dict()

    def create_skill(
        self,
        title: str,
        skill_type: str = "short",
        workspace_root: str | None = None,
        load_common_skills: bool = False,
        skill_kind: str | None = None,
    ) -> dict[str, Any]:
        """创建新技能集合"""
        if workspace_root is None and str(skill_type or "").strip() not in LIBRARY_TYPES:
            workspace_root = skill_type
            skill_type = "short"
        with _data_file_lock():
            self._reload_skills_unlocked()
            now = _utc_now_iso()
            st = normalize_skill_type(skill_type)
            sk = normalize_skill_kind(skill_kind)
            wr = (workspace_root or "").strip()
            od = ""
            if wr:
                try:
                    parent = Path(wr).expanduser()
                    parent.mkdir(parents=True, exist_ok=True)
                    parent = parent.resolve()
                    skills_parent = parent / "技能库"
                    skills_parent.mkdir(parents=True, exist_ok=True)
                    folder_name = _sanitize_skill_folder_name(title.strip() or "未命名技能")
                    skill_dir = _unique_child_dir(skills_parent, folder_name)
                    skill_dir.mkdir(parents=True, exist_ok=False)
                    od = str(skill_dir)
                except (OSError, ValueError):
                    od = ""
                if not od:
                    raise RuntimeError(
                        "无法在选定工作文件夹下创建技能目录，请检查路径是否有效、磁盘空间与写入权限。",
                    )
            sid = new_skill_id()
            stages = normalize_skill_stages_from_storage(None)
            if load_common_skills:
                _append_missing_common_skills(
                    stages,
                    now,
                    SKILL_KIND_STAGE_KEYS.get(sk, SKILL_STAGE_KEYS),
                )
            s = Skill(
                id=sid,
                title=title.strip() or "未命名技能",
                skill_type=st,
                skill_kind=sk,
                overview="",
                stages=stages,
                output_dir=od,
                created_at=now,
                updated_at=now,
            )
            self._skills[sid] = s
            save_skills_atomic(self._skills_path, self._skills)
            self._mark_skills_saved_unlocked()
            _write_skill_stages_to_disk(s)
            return s.to_dict()

    def load_common_skills_to_skill(self, skill_id: str) -> dict[str, Any] | None:
        """将内置通用技能合并到已有技能库，已存在的通用技能不会重复加载。"""
        with _data_file_lock():
            self._reload_skills_unlocked()
            sid = (skill_id or "").strip()
            s = self._skills.get(sid)
            if s is None:
                return None
            now = _utc_now_iso()
            added_count, available_count = _append_missing_common_skills(
                s.stages,
                now,
                SKILL_KIND_STAGE_KEYS.get(s.skill_kind, SKILL_STAGE_KEYS),
            )
            if added_count > 0:
                s.updated_at = now
                save_skills_atomic(self._skills_path, self._skills)
                self._mark_skills_saved_unlocked()
                _write_skill_stages_to_disk(s)
            return {
                "skill": s.to_dict(),
                "added_count": added_count,
                "available_count": available_count,
                "already_loaded": available_count > 0 and added_count == 0,
            }

    def save_skill(
        self,
        skill_id: str,
        title: str | None = None,
        skill_type: str | None = None,
        skill_kind: str | None = None,
        overview: str | None = None,
        stages: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """保存技能集合及各阶段技能条目"""
        with _data_file_lock():
            self._reload_skills_unlocked()
            s = self._skills.get(skill_id)
            if s is None:
                return None
            if title is not None:
                s.title = title.strip()
            if skill_type is not None:
                s.skill_type = normalize_skill_type(skill_type)
            if skill_kind is not None:
                s.skill_kind = normalize_skill_kind(skill_kind)
            if overview is not None:
                s.overview = str(overview)
            if stages is not None:
                s.stages = normalize_skill_stages_from_storage(stages)
            s.updated_at = _utc_now_iso()
            save_skills_atomic(self._skills_path, self._skills)
            self._mark_skills_saved_unlocked()
            _write_skill_stages_to_disk(s)
            return s.to_dict()

    def delete_skill(self, skill_id: str) -> bool:
        """删除技能及其本地输出目录"""
        with _data_file_lock():
            self._reload_all_unlocked()
            sid = (skill_id or "").strip()
            if not sid or sid not in self._skills:
                return False
            s = self._skills[sid]
            output_dir = s.output_dir
            del self._skills[sid]
            save_skills_atomic(self._skills_path, self._skills)
            self._mark_skills_saved_unlocked()
            changed_books = False
            for book in self._books.values():
                previous_legacy = book.linked_skill_id
                previous = {
                    kind: list(book.linked_skill_ids_by_kind.get(kind) or [])
                    for kind in SKILL_KIND_KEYS
                }
                book.linked_skill_ids_by_kind = {
                    kind: [
                        linked_id
                        for linked_id in book.linked_skill_ids_by_kind.get(kind, [])
                        if linked_id != sid
                    ]
                    for kind in SKILL_KIND_KEYS
                }
                if book.linked_skill_id == sid:
                    book.linked_skill_id = ""
                self._normalize_book_skill_links_unlocked(book)
                if (
                    previous != book.linked_skill_ids_by_kind
                    or previous_legacy != book.linked_skill_id
                ):
                    book.updated_at = _utc_now_iso()
                    changed_books = True
            if changed_books:
                save_books_atomic(self._path, self._books)
                self._mark_books_saved_unlocked()
            _remove_output_dir(output_dir)
            return True
