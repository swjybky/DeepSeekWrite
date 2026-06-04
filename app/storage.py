from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.runtime_paths import writable_root

from app.models import (
    Book,
    normalize_book_status,
    Material,
    Skill,
    SHORT_STAGE_KEYS,
    MATERIAL_STAGE_KEYS,
    SKILL_STAGE_KEYS,
    apply_stage_patch,
    default_stages,
    default_material_stages,
    normalize_expert_draft_from_storage,
    new_book_id,
    new_material_id,
    new_skill_id,
    primary_draft_stage_key,
    normalize_material_stages_from_storage,
    normalize_skill_stage_id,
)

ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"

_WIN_INVALID = '<>:"/\\|?*\n\r\t'
AI_MODEL_CONFIG_PREF_KEY = "ai_model_config"


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
    使用所有短篇分类共享的统一阶段键
    """
    od = (book.output_dir or "").strip()
    if not od:
        return
    root = Path(od)
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return

    # 统一使用 SHORT_STAGE_KEYS 写入所有阶段
    for key in SHORT_STAGE_KEYS:
        text = str(book.stages.get(key, "") or "")
        try:
            (root / f"{key}.txt").write_text(text, encoding="utf-8")
        except OSError:
            pass


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime(ISO_FMT)


def default_data_path() -> Path:
    data_dir = writable_root() / ".data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "books.json"


def default_materials_path() -> Path:
    """素材数据文件路径"""
    data_dir = writable_root() / ".data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "materials.json"


def default_skills_path() -> Path:
    """技能数据文件路径"""
    data_dir = writable_root() / ".data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "skills.json"


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


def load_preferences() -> dict[str, Any]:
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


def save_preferences_atomic(prefs: dict[str, Any]) -> None:
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


def read_saved_workspace_root() -> str | None:
    w = load_preferences().get("workspace_root")
    if isinstance(w, str) and w.strip():
        return w.strip()
    return None


def write_saved_workspace_root(path: str | None) -> None:
    prefs = load_preferences()
    if path and str(path).strip():
        prefs["workspace_root"] = str(path).strip()
    else:
        prefs.pop("workspace_root", None)
    save_preferences_atomic(prefs)


def read_workspace_agent_read_access() -> dict[str, Any]:
    """全局创作空间智能体读取配置，首次读取时兼容旧阶段配置。"""
    prefs = load_preferences()
    raw = prefs.get("workspace_agent_read_access")
    if isinstance(raw, dict):
        return raw

    legacy = prefs.get("stage_read_access")
    if not isinstance(legacy, dict):
        return {}

    prefs["workspace_agent_read_access"] = legacy
    save_preferences_atomic(prefs)
    return legacy


def write_workspace_agent_read_access(config: dict[str, Any]) -> None:
    prefs = load_preferences()
    if config:
        prefs["workspace_agent_read_access"] = config
    else:
        prefs.pop("workspace_agent_read_access", None)
    save_preferences_atomic(prefs)


def _normalize_config_id(raw: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in raw.strip().lower()).strip("_")


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
    if not config_id or not provider or not model_id or not api_key:
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


def read_ai_model_config() -> dict[str, Any]:
    prefs = load_preferences()
    raw = prefs.get(AI_MODEL_CONFIG_PREF_KEY)
    if isinstance(raw, dict):
        return normalize_ai_model_config(raw)

    from app.ai_env import load_ai_model_settings_from_env

    imported = normalize_ai_model_config(load_ai_model_settings_from_env())
    if _ai_model_config_has_values(imported):
        prefs[AI_MODEL_CONFIG_PREF_KEY] = imported
        save_preferences_atomic(prefs)
    return imported


def write_ai_model_config(config: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_ai_model_config(config)
    prefs = load_preferences()
    prefs[AI_MODEL_CONFIG_PREF_KEY] = normalized
    save_preferences_atomic(prefs)
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


def _write_skill_stages_to_disk(skill: Skill) -> None:
    """将单阶段技能内容写入输出目录。"""
    od = (skill.output_dir or "").strip()
    if not od:
        return
    root = Path(od)
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return

    stage_id = normalize_skill_stage_id(skill.stage_id)
    try:
        (root / f"{stage_id}.txt").write_text(str(skill.body or ""), encoding="utf-8")
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


class BookStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or default_data_path()
        self._books = load_books(self._path)
        # 素材数据存储
        self._materials_path = default_materials_path()
        self._materials = load_materials(self._materials_path)
        # 技能数据存储
        self._skills_path = default_skills_path()
        self._skills = load_skills(self._skills_path)

    @property
    def path(self) -> Path:
        return self._path

    def list_books(self) -> list[dict[str, Any]]:
        return [
            {
                "id": b.id,
                "title": b.title,
                "book_type": b.book_type,
                "categories": b.categories,
                "output_dir": b.output_dir,
                "linked_material_id": b.linked_material_id,
                "skill_library_enabled": b.skill_library_enabled,
                "status": b.status,
            }
            for b in sorted(
                self._books.values(),
                key=lambda x: (x.updated_at or "", x.title),
                reverse=True,
            )
        ]

    def get_book(self, book_id: str) -> dict[str, Any] | None:
        b = self._books.get(book_id)
        if b is None:
            return None
        return b.to_dict()

    def create_book(
        self,
        title: str,
        book_type: str,
        categories: list[str] | None,
        workspace_root: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        bt: str = book_type if book_type in ("short", "long") else "long"
        cats = list(categories or []) if bt == "short" else []
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
            linked_material_id="",
            skill_library_enabled=bt == "short",
            stages=default_stages(),
            expert_draft=normalize_expert_draft_from_storage(None),
            created_at=now,
            updated_at=now,
        )
        self._books[bid] = b
        save_books_atomic(self._path, self._books)
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
    ) -> dict[str, Any] | None:
        b = self._books.get(book_id)
        if b is None:
            return None
        if title is not None:
            b.title = title.strip()
        if linked_material_id is not None:
            mid = linked_material_id.strip()
            b.linked_material_id = mid if mid in self._materials else ""
        if stages is not None:
            b.stages = apply_stage_patch(b.stages, stages)
            dk = primary_draft_stage_key(b)
            b.content = str(b.stages.get(dk, "") or "")
        elif content is not None:
            b.content = content
        if expert_draft is not None:
            b.expert_draft = normalize_expert_draft_from_storage(expert_draft)
        if status is not None:
            b.status = normalize_book_status(status)
        b.updated_at = _utc_now_iso()
        save_books_atomic(self._path, self._books)
        _write_stages_to_disk(b)
        return b.to_dict()

    def delete_book(self, book_id: str) -> bool:
        """从书架移除该书（不写磁盘目录）。若 id 不存在则返回 False。"""
        bid = (book_id or "").strip()
        if not bid or bid not in self._books:
            return False
        del self._books[bid]
        save_books_atomic(self._path, self._books)
        return True

    # ==================== 素材管理方法 ====================

    def list_materials(self) -> list[dict[str, Any]]:
        """列出所有素材，按更新时间倒序"""
        return [
            {
                "id": m.id,
                "title": m.title,
                "material_type": m.material_type,
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
    ) -> dict[str, Any]:
        """创建新素材"""
        now = _utc_now_iso()
        mt: str = material_type if material_type in ("long", "short") else "short"
        wr = (workspace_root or "").strip()
        od = ""
        if wr:
            try:
                parent = Path(wr).expanduser()
                parent.mkdir(parents=True, exist_ok=True)
                parent = parent.resolve()
                folder_name = _sanitize_material_folder_name(title.strip() or "未命名素材")
                # 使用 materials 子目录存放素材
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
            parent_genre=str(parent_genre or ""),
            sub_genre=str(sub_genre or ""),
            stages=default_material_stages(),
            output_dir=od,
            created_at=now,
            updated_at=now,
        )
        self._materials[mid] = m
        save_materials_atomic(self._materials_path, self._materials)
        _write_material_stages_to_disk(m)
        return m.to_dict()

    def save_material(
        self,
        material_id: str,
        stages: dict[str, str] | None = None,
        title: str | None = None,
    ) -> dict[str, Any] | None:
        """保存素材阶段内容"""
        m = self._materials.get(material_id)
        if m is None:
            return None
        if stages is not None:
            # 归一化阶段数据
            m.stages = normalize_material_stages_from_storage(stages)
        if title is not None:
            m.title = title.strip()
        m.updated_at = _utc_now_iso()
        save_materials_atomic(self._materials_path, self._materials)
        _write_material_stages_to_disk(m)
        return m.to_dict()

    def delete_material(self, material_id: str) -> bool:
        """删除素材"""
        mid = (material_id or "").strip()
        if not mid or mid not in self._materials:
            return False
        del self._materials[mid]
        save_materials_atomic(self._materials_path, self._materials)
        return True

    # ==================== 技能管理方法 ====================

    def list_skills(self, stage_id: str | None = None) -> list[dict[str, Any]]:
        """列出所有技能，按更新时间倒序"""
        sid = (stage_id or "").strip()
        skills = self._skills.values()
        if sid in SKILL_STAGE_KEYS:
            skills = [s for s in skills if s.stage_id == sid]
        return [
            {
                "id": s.id,
                "title": s.title,
                "genre": s.genre,
                "stage_id": s.stage_id,
                "output_dir": s.output_dir,
            }
            for s in sorted(
                skills,
                key=lambda x: (x.updated_at or "", x.title),
                reverse=True,
            )
        ]

    def get_skill(self, skill_id: str) -> dict[str, Any] | None:
        """获取单个技能详情"""
        s = self._skills.get(skill_id)
        if s is None:
            return None
        return s.to_dict()

    def create_skill(
        self,
        title: str,
        genre: str,
        stage_id: str,
        workspace_root: str | None = None,
    ) -> dict[str, Any]:
        """创建新技能"""
        now = _utc_now_iso()
        g = genre.strip() if genre.strip() else "世情"
        if g not in ("世情", "追妻", "科幻", "悬疑"):
            g = "世情"
        normalized_stage_id = normalize_skill_stage_id(stage_id)
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
        s = Skill(
            id=sid,
            title=title.strip() or "未命名技能",
            genre=g,
            stage_id=normalized_stage_id,
            body="",
            output_dir=od,
            created_at=now,
            updated_at=now,
        )
        self._skills[sid] = s
        save_skills_atomic(self._skills_path, self._skills)
        _write_skill_stages_to_disk(s)
        return s.to_dict()

    def save_skill(
        self,
        skill_id: str,
        title: str | None = None,
        genre: str | None = None,
        stage_id: str | None = None,
        body: str | None = None,
    ) -> dict[str, Any] | None:
        """保存技能阶段内容"""
        s = self._skills.get(skill_id)
        if s is None:
            return None
        if title is not None:
            s.title = title.strip()
        if genre is not None:
            g = genre.strip()
            s.genre = g if g in ("世情", "追妻", "科幻", "悬疑") else "世情"
        if stage_id is not None:
            s.stage_id = normalize_skill_stage_id(stage_id)
        if body is not None:
            s.body = str(body)
        s.updated_at = _utc_now_iso()
        save_skills_atomic(self._skills_path, self._skills)
        _write_skill_stages_to_disk(s)
        return s.to_dict()

    def delete_skill(self, skill_id: str) -> bool:
        """删除技能"""
        sid = (skill_id or "").strip()
        if not sid or sid not in self._skills:
            return False
        del self._skills[sid]
        save_skills_atomic(self._skills_path, self._skills)
        return True
