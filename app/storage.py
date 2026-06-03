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
    Material,
    SHORT_STAGE_KEYS,
    MATERIAL_STAGE_KEYS,
    apply_stage_patch,
    default_stages,
    default_material_stages,
    normalize_expert_draft_from_storage,
    new_book_id,
    new_material_id,
    primary_draft_stage_key,
    normalize_material_stages_from_storage,
)

ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"

_WIN_INVALID = '<>:"/\\|?*\n\r\t'


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
    使用统一阶段键，不再区分世情和情感
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


def read_stage_read_access() -> dict[str, Any]:
    """全局创作空间阶段可读配置（各阶段 workspace/material 列表）。"""
    raw = load_preferences().get("stage_read_access")
    return raw if isinstance(raw, dict) else {}


def write_stage_read_access(config: dict[str, Any]) -> None:
    prefs = load_preferences()
    if config:
        prefs["stage_read_access"] = config
    else:
        prefs.pop("stage_read_access", None)
    save_preferences_atomic(prefs)


def _sanitize_material_folder_name(title: str) -> str:
    """清理素材文件夹名称"""
    t = (title or "").strip() or "未命名素材"
    for ch in _WIN_INVALID:
        t = t.replace(ch, "_")
    t = t.strip(" .")
    return t or "未命名素材"


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


class BookStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or default_data_path()
        self._books = load_books(self._path)
        # 素材数据存储
        self._materials_path = default_materials_path()
        self._materials = load_materials(self._materials_path)

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
