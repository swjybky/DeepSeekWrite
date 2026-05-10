from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal
from uuid import uuid4

BookType = Literal["short", "long"]

# 世情短篇工作台（与 web workspaces/shiqing 一致）
SHIQING_STAGE_KEYS: tuple[str, ...] = (
    "intro_design",
    "character_design",
    "plot_design",
    "plot_refine",
    "outline",
    "draft",
    "review",
    "format_conversion",
)

# 情感短篇工作台（与 web workspaces/qinggan 一致；与世情不复用字段）
QINGGAN_STAGE_KEYS: tuple[str, ...] = (
    "qinggan_character",
    "qinggan_intro",
    "qinggan_plot_refine",
    "qinggan_outline",
    "qinggan_outline_review",
    "qinggan_draft",
    "qinggan_draft_review",
)

STAGE_KEYS: tuple[str, ...] = SHIQING_STAGE_KEYS + QINGGAN_STAGE_KEYS


def default_stages() -> dict[str, str]:
    return {k: "" for k in STAGE_KEYS}


def normalize_stages_from_storage(raw: dict[str, Any] | None) -> dict[str, str]:
    """从 JSON 载入：补齐缺失键为 ''。"""
    out = default_stages()
    if not raw:
        return out
    for k in STAGE_KEYS:
        if k in raw:
            out[k] = str(raw[k] or "")
    return out


def apply_stage_patch(base: dict[str, str], patch: dict[str, Any] | None) -> dict[str, str]:
    """合并前端传入的部分阶段字段，保留未出现在 patch 中的键。"""
    out = normalize_stages_from_storage(base)
    if patch:
        for k in STAGE_KEYS:
            if k in patch:
                out[k] = str(patch[k] or "")
    return out


def is_shiqing_short_book(categories: list[str], book_type: str) -> bool:
    return book_type == "short" and "世情" in categories


def is_qinggan_short_book(categories: list[str], book_type: str) -> bool:
    """现实情感或「情感」分类；与世情并存时以更靠前的世情工作台为准。"""
    if book_type != "short":
        return False
    if "世情" in categories:
        return False
    return ("现实情感" in categories) or ("情感" in categories)


def primary_draft_stage_key(book: Book) -> str:
    """save_book 时同步顶层 content 所取的正文阶段键。"""
    if is_qinggan_short_book(book.categories, book.book_type):
        return "qinggan_draft"
    return "draft"


@dataclass
class Book:
    id: str
    title: str
    book_type: BookType
    categories: list[str] = field(default_factory=list)
    content: str = ""
    output_dir: str = ""
    stages: dict[str, str] = field(default_factory=default_stages)
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Book:
        bt = data["book_type"] if data["book_type"] in ("short", "long") else "long"
        return cls(
            id=str(data["id"]),
            title=str(data["title"]),
            book_type=bt,  # type: ignore[arg-type]
            categories=list(data.get("categories") or []),
            content=str(data.get("content") or ""),
            output_dir=str(data.get("output_dir") or ""),
            stages=normalize_stages_from_storage(data.get("stages")),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )


def new_book_id() -> str:
    return str(uuid4())
