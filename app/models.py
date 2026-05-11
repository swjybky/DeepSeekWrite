from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal
from uuid import uuid4

BookType = Literal["short", "long"]
MaterialType = Literal["long", "short"]

# 素材分类定义
SHORT_MATERIAL_GENRES: dict[str, list[str]] = {
    "世情": ["家庭", "职场", "婚恋", "邻里", "亲子", "继承", "养老"],
    "情感": ["甜宠", "虐恋", "重生", "穿越", "暗恋", "破镜重圆", "先婚后爱"],
}

# 素材阶段键（人设、梗、节奏）
MATERIAL_STAGE_KEYS: tuple[str, ...] = (
    "character",  # 人设素材
    "gimmick",    # 梗素材
    "pacing",     # 节奏素材
)

# 统一的短篇工作台阶段键（世情和情感共用）
# 对应 web/src/workspaces/short/stages.ts 中的 SHORT_WORKSPACE_STAGES
SHORT_STAGE_KEYS: tuple[str, ...] = (
    "character_design",   # 人物设计（统一命名，世情原character_design，情感原qinggan_character）
    "intro_design",         # 导语设计
    "plot_design",          # 剧情设计（新增到情感）
    "plot_refine",          # 剧情细化
    "outline",              # 大纲纲要
    "draft",                # 正文编写
    "draft_review",         # 正文审阅（新增到世情）
    "format_conversion",    # 格式转换（新增到情感）
)

# 保留旧键用于数据迁移
LEGACY_QINGGAN_STAGE_KEYS: tuple[str, ...] = (
    "qinggan_character",
    "qinggan_intro",
    "qinggan_plot_refine",
    "qinggan_outline",
    "qinggan_draft",
    "qinggan_draft_review",
)

# 所有可能的阶段键（包括统一新键和遗留旧键）
ALL_STAGE_KEYS: tuple[str, ...] = SHORT_STAGE_KEYS + LEGACY_QINGGAN_STAGE_KEYS


def _legacy_key_mapping() -> dict[str, str]:
    """旧版情感阶段键到统一阶段键的映射"""
    return {
        "qinggan_character": "character_design",
        "qinggan_intro": "intro_design",
        "qinggan_plot_refine": "plot_refine",
        "qinggan_outline": "outline",
        "qinggan_draft": "draft",
        "qinggan_draft_review": "draft_review",
    }


def migrate_legacy_stages(stages: dict[str, str]) -> dict[str, str]:
    """
    将旧版阶段数据迁移到统一阶段键

    迁移规则：
    1. 如果键已经是新统一键，直接保留
    2. 如果是旧版情感键，映射到新键
    3. 如果新键已存在，不覆盖（保留新键的值）
    """
    mapping = _legacy_key_mapping()
    result: dict[str, str] = {}

    # 先复制所有非旧键的数据
    for key, value in stages.items():
        if key in mapping:
            # 旧版情感键，稍后处理
            continue
        result[key] = value

    # 处理旧键映射
    for old_key, new_key in mapping.items():
        if old_key in stages:
            # 只有新键不存在时才迁移，避免覆盖
            if new_key not in result:
                result[new_key] = stages[old_key]

    return result


def default_stages() -> dict[str, str]:
    """创建默认的空阶段字典（仅包含统一阶段键）"""
    return {k: "" for k in SHORT_STAGE_KEYS}


def normalize_stages_from_storage(raw: dict[str, Any] | None) -> dict[str, str]:
    """
    从 JSON 载入：补齐缺失键为 ''，并执行数据迁移
    """
    out = default_stages()
    if not raw:
        return out

    # 先迁移旧键
    migrated = migrate_legacy_stages({k: str(v or "") for k, v in raw.items()})

    # 填充到输出
    for k in SHORT_STAGE_KEYS:
        if k in migrated:
            out[k] = migrated[k]

    return out


def apply_stage_patch(base: dict[str, str], patch: dict[str, Any] | None) -> dict[str, str]:
    """
    合并前端传入的部分阶段字段，保留未出现在 patch 中的键。
    同时处理可能的旧键映射。
    """
    out = normalize_stages_from_storage(base)
    if patch:
        # 先对patch进行迁移
        migrated_patch = migrate_legacy_stages({k: str(v or "") for k, v in patch.items()})
        for k in SHORT_STAGE_KEYS:
            if k in migrated_patch:
                out[k] = migrated_patch[k]
    return out


def is_workspace_short_book(categories: list[str], book_type: str) -> bool:
    """判断是否为支持工作台的短篇书籍（世情或情感）"""
    if book_type != "short":
        return False
    cats = set(categories)
    return bool(cats & {"世情", "现实情感", "情感"})


def is_shiqing_short_book(categories: list[str], book_type: str) -> bool:
    """判断是否为世情短篇（用于提示词选择）"""
    if book_type != "short":
        return False
    return "世情" in categories


def is_qinggan_short_book(categories: list[str], book_type: str) -> bool:
    """
    判断是否为情感短篇（用于提示词选择）
    现实情感或「情感」分类；与世情并存时以世情为准
    """
    if book_type != "short":
        return False
    if "世情" in categories:
        return False
    return ("现实情感" in categories) or ("情感" in categories)


def primary_draft_stage_key(book: "Book") -> str:
    """
    save_book 时同步顶层 content 所取的正文阶段键。
    统一使用 "draft"
    """
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
    def from_dict(cls, data: dict[str, Any]) -> "Book":
        bt = data["book_type"] if data["book_type"] in ("short", "long") else "long"
        # 从存储加载时执行迁移
        raw_stages = data.get("stages")
        migrated_stages = normalize_stages_from_storage(raw_stages)

        return cls(
            id=str(data["id"]),
            title=str(data["title"]),
            book_type=bt,  # type: ignore[arg-type]
            categories=list(data.get("categories") or []),
            content=str(data.get("content") or ""),
            output_dir=str(data.get("output_dir") or ""),
            stages=migrated_stages,
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )


def new_book_id() -> str:
    return str(uuid4())


def new_material_id() -> str:
    return str(uuid4())


def default_material_stages() -> dict[str, str]:
    """创建默认的空素材阶段字典"""
    return {k: "" for k in MATERIAL_STAGE_KEYS}


def normalize_material_stages_from_storage(raw: dict[str, Any] | None) -> dict[str, str]:
    """从 JSON 载入素材阶段：补齐缺失键为 ''"""
    out = default_material_stages()
    if not raw:
        return out
    for k in MATERIAL_STAGE_KEYS:
        if k in raw:
            out[k] = str(raw[k] or "")
    return out


@dataclass
class Material:
    """素材数据模型，用于存储人设、梗、节奏等素材"""

    id: str
    title: str
    material_type: MaterialType
    parent_genre: str = ""  # 世情/情感（仅short时有效）
    sub_genre: str = ""     # 子分类（如家庭、甜宠等）
    stages: dict[str, str] = field(default_factory=default_material_stages)
    output_dir: str = ""
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Material":
        mt = data["material_type"] if data["material_type"] in ("long", "short") else "short"
        # 从存储加载时归一化阶段
        raw_stages = data.get("stages")
        normalized_stages = normalize_material_stages_from_storage(raw_stages)

        return cls(
            id=str(data["id"]),
            title=str(data["title"]),
            material_type=mt,  # type: ignore[arg-type]
            parent_genre=str(data.get("parent_genre") or ""),
            sub_genre=str(data.get("sub_genre") or ""),
            stages=normalized_stages,
            output_dir=str(data.get("output_dir") or ""),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )
