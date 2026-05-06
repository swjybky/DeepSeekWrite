from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal
from uuid import uuid4

BookType = Literal["short", "long"]

# 与前端 WORKSPACE_STAGES id 一致
STAGE_KEYS: tuple[str, ...] = (
    "plot_design",
    "plot_refine",
    "outline",
    "draft",
    "review",
)


def default_stages() -> dict[str, str]:
    return {k: "" for k in STAGE_KEYS}


def merge_stages(raw: dict[str, Any] | None) -> dict[str, str]:
    out = default_stages()
    if not raw:
        return out
    for k in STAGE_KEYS:
        if k in raw:
            out[k] = str(raw[k] or "")
    return out


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
            stages=merge_stages(data.get("stages")),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )


def new_book_id() -> str:
    return str(uuid4())
