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
    QINGGAN_STAGE_KEYS,
    SHIQING_STAGE_KEYS,
    apply_stage_patch,
    default_stages,
    new_book_id,
    primary_draft_stage_key,
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
    od = (book.output_dir or "").strip()
    if not od:
        return
    root = Path(od)
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    # 世情：沿用书籍根目录下的 key.txt；情感：单独子目录，与世情文件不混放
    for key in SHIQING_STAGE_KEYS:
        text = str(book.stages.get(key, "") or "")
        try:
            (root / f"{key}.txt").write_text(text, encoding="utf-8")
        except OSError:
            pass
    qg_root = root / "qinggan_workspace"
    try:
        qg_root.mkdir(parents=True, exist_ok=True)
    except OSError:
        qg_root = root
    for key in QINGGAN_STAGE_KEYS:
        text = str(book.stages.get(key, "") or "")
        try:
            (qg_root / f"{key}.txt").write_text(text, encoding="utf-8")
        except OSError:
            pass


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime(ISO_FMT)


def default_data_path() -> Path:
    data_dir = writable_root() / ".data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "books.json"


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


class BookStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or default_data_path()
        self._books = load_books(self._path)

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
            stages=default_stages(),
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
    ) -> dict[str, Any] | None:
        b = self._books.get(book_id)
        if b is None:
            return None
        if stages is not None:
            b.stages = apply_stage_patch(b.stages, stages)
            dk = primary_draft_stage_key(b)
            b.content = str(b.stages.get(dk, "") or "")
        elif content is not None:
            b.content = content
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
