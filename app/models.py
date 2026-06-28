from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal
from uuid import uuid4

BookType = Literal["short", "long", "script"]
BookStatus = Literal["editing", "completed"]
MaterialType = Literal["long", "short", "script"]
SkillType = Literal["long", "short", "script"]

WORKSPACE_BOOK_TYPES: tuple[str, ...] = ("short", "script")
LIBRARY_TYPES: tuple[str, ...] = ("short", "long", "script")
MEMORY_TAGS: tuple[str, ...] = (
    "general",
    "character",
    "plot",
    "outline",
    "draft",
    "style",
)

# 素材分类定义
SHORT_MATERIAL_GENRES: dict[str, list[str]] = {
    "世情": ["家庭", "职场", "婚恋", "邻里", "亲子", "继承", "养老"],
    "追妻": ["甜宠", "虐恋", "重生", "穿越", "暗恋", "破镜重圆", "先婚后爱"],
    "科幻": ["未来都市", "星际", "人工智能", "赛博朋克", "末日", "时间旅行", "异星文明"],
    "悬疑": ["刑侦", "推理", "惊悚", "密室", "民俗", "心理", "反转"],
    "其他": [],
}

# 剧本素材暂时沿用短篇一级分类，但保持独立常量，后续可单独演进。
SCRIPT_MATERIAL_GENRES: dict[str, list[str]] = {
    key: list(values) for key, values in SHORT_MATERIAL_GENRES.items()
}

# 素材阶段键（梗、人设、剧情设计、导语设计、剧情细化、优秀正文片段）
MATERIAL_STAGE_KEYS: tuple[str, ...] = (
    "gimmick",       # 梗
    "character",     # 人设
    "pacing",        # 剧情设计
    "intro",         # 导语设计
    "plot_refine",   # 剧情细化
    "draft_excerpt", # 优秀正文片段
)

# 技能库阶段键：可见短篇技能栏目 + 分节写手技能。
# 旧导语设计、剧情细化技能会在读取时合并进 plot_design；
# 旧正文审阅、格式转换、专家总控技能会在读取时合并进 draft。
SKILL_STAGE_KEYS: tuple[str, ...] = (
    "character_design",          # 人物技能
    "plot_design",               # 剧情技能
    "outline",                   # 大纲技能
    "draft",                     # 正文专家编写技能
    "expert_section_writer",     # 分节写手技能
)

LEGACY_SKILL_STAGES_TO_PLOT: tuple[str, ...] = (
    "intro_design",
    "plot_refine",
)

LEGACY_SKILL_STAGES_TO_DRAFT: tuple[str, ...] = (
    "draft_review",
    "format_conversion",
    "expert_draft_coordinator",
)

SKILL_STAGE_LABELS: dict[str, str] = {
    "character_design": "人物技能",
    "plot_design": "剧情技能",
    "outline": "大纲技能",
    "draft": "正文专家编写技能",
    "expert_section_writer": "分节写手技能",
}

# 统一的短篇工作台阶段键（所有短篇分类共用）
# 对应 web/src/workspaces/short/stages.ts 中的 SHORT_WORKSPACE_STAGES
SHORT_STAGE_KEYS: tuple[str, ...] = (
    "character_design",   # 人物（统一命名，世情原character_design，情感原qinggan_character）
    "plot_design",          # 剧情设计（新增到情感）
    "intro_design",         # 导语设计
    "plot_refine",          # 剧情细化
    "outline",              # 大纲
    "draft",                # 正文编写
    "draft_review",         # 正文审阅（新增到世情）
    "format_conversion",    # 格式转换（新增到情感）
)

# 剧本工作台阶段键：与短篇一致，但移除独立的导语设计阶段
# 对应 web/src/workspaces/script/stages.ts 中的 SCRIPT_WORKSPACE_CONTENT_STAGES
SCRIPT_STAGE_KEYS: tuple[str, ...] = tuple(
    key for key in SHORT_STAGE_KEYS if key != "intro_design"
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


def _stage_keys_for_book_type(book_type: str | None = None) -> tuple[str, ...]:
    """根据书籍类型返回适用的阶段键列表。"""
    return SCRIPT_STAGE_KEYS if str(book_type or "").strip() == "script" else SHORT_STAGE_KEYS


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


def default_stages(book_type: str | None = None) -> dict[str, str]:
    """创建默认的空阶段字典（仅包含当前书籍类型适用的统一阶段键）"""
    return {k: "" for k in _stage_keys_for_book_type(book_type)}


def normalize_stages_from_storage(
    raw: dict[str, Any] | None,
    book_type: str | None = None,
) -> dict[str, str]:
    """
    从 JSON 载入：补齐缺失键为 ''，并执行数据迁移
    """
    keys = _stage_keys_for_book_type(book_type)
    out = {k: "" for k in keys}
    if not raw:
        return out

    # 先迁移旧键
    migrated = migrate_legacy_stages({k: str(v or "") for k, v in raw.items()})

    # 填充到输出
    for k in keys:
        if k in migrated:
            out[k] = migrated[k]

    return out


def apply_stage_patch(
    base: dict[str, str],
    patch: dict[str, Any] | None,
    book_type: str | None = None,
) -> dict[str, str]:
    """
    合并前端传入的部分阶段字段，保留未出现在 patch 中的键。
    同时处理可能的旧键映射。
    """
    out = normalize_stages_from_storage(base, book_type)
    keys = _stage_keys_for_book_type(book_type)
    if patch:
        # 先对patch进行迁移
        migrated_patch = migrate_legacy_stages({k: str(v or "") for k, v in patch.items()})
        for k in keys:
            if k in migrated_patch:
                out[k] = migrated_patch[k]
    return out


def default_expert_draft(book_type: str | None = None) -> dict[str, Any]:
    """创建专家模式正文编写的默认空结构。剧本从第一节开始，短篇保留导语。"""
    if str(book_type or "").strip() == "script":
        return {
            "sections": [
                {
                    "id": "section-1",
                    "title": "第一节",
                    "word_count_requirement": "",
                    "body": "",
                },
            ],
            "character_states": [
                {"section_id": "section-1", "title": "第一节人物状态", "body": ""},
            ],
            "running": False,
            "active_section_id": "",
        }
    return {
        "sections": [
            {"id": "intro", "title": "导语", "word_count_requirement": "", "body": ""},
            {
                "id": "section-1",
                "title": "第一节",
                "word_count_requirement": "",
                "body": "",
            },
        ],
        "character_states": [
            {"section_id": "intro", "title": "导语人物状态", "body": ""},
            {"section_id": "section-1", "title": "第一节人物状态", "body": ""},
        ],
        "running": False,
        "active_section_id": "",
    }


def _default_character_state_title(section_title: str) -> str:
    title = section_title.strip() or "小节"
    return f"{title}人物状态"


def _section_number_for_index(index: int, book_type: str | None) -> int:
    """计算小节序号：剧本从 1 开始，短篇 index 0 为导语，index 1 为第一节。"""
    return index + 1 if str(book_type or "").strip() == "script" else index


def normalize_expert_draft_from_storage(
    raw: Any | None,
    book_type: str | None = None,
) -> dict[str, Any]:
    """从 JSON 载入专家模式正文结构，补齐对应书籍类型的默认小节和人物状态。"""
    base = default_expert_draft(book_type)
    if not isinstance(raw, dict):
        return base

    is_script = str(book_type or "").strip() == "script"
    sections: list[dict[str, str]] = []
    seen_section_ids: set[str] = set()
    raw_sections = raw.get("sections")
    has_section_list = isinstance(raw_sections, list)
    if has_section_list:
        for idx, item in enumerate(raw_sections):
            if not isinstance(item, dict):
                continue
            sid = str(item.get("id") or "").strip()
            if not sid:
                if is_script:
                    sid = f"section-{idx + 1}"
                else:
                    sid = "intro" if idx == 0 else f"section-{idx}"
            if sid in seen_section_ids:
                continue
            seen_section_ids.add(sid)
            title = str(item.get("title") or "").strip()
            if not title:
                if sid == "intro":
                    title = "导语"
                else:
                    title = f"第{_section_number_for_index(len(sections), book_type)}节"
            sections.append(
                {
                    "id": sid,
                    "title": title,
                    "word_count_requirement": str(
                        item.get("word_count_requirement") or ""
                    ).strip(),
                    "body": str(item.get("body") or ""),
                }
            )
    if not has_section_list:
        sections = list(base["sections"])
        seen_section_ids = {str(s["id"]) for s in sections}

    title_by_id = {str(s["id"]): str(s["title"]) for s in sections}
    states: list[dict[str, str]] = []
    seen_state_ids: set[str] = set()
    raw_states = raw.get("character_states")
    if isinstance(raw_states, list):
        for item in raw_states:
            if not isinstance(item, dict):
                continue
            sid = str(item.get("section_id") or item.get("id") or "").strip()
            if not sid or sid in seen_state_ids:
                continue
            if sid not in title_by_id:
                continue
            seen_state_ids.add(sid)
            title = str(item.get("title") or "").strip()
            states.append(
                {
                    "section_id": sid,
                    "title": title or _default_character_state_title(title_by_id[sid]),
                    "body": str(item.get("body") or ""),
                }
            )

    for section in sections:
        sid = str(section["id"])
        if sid in seen_state_ids:
            continue
        states.append(
            {
                "section_id": sid,
                "title": _default_character_state_title(str(section["title"])),
                "body": "",
            }
        )

    section_ids = {str(s["id"]) for s in sections}
    active = str(raw.get("active_section_id") or "").strip()
    if active not in section_ids:
        active = ""

    return {
        "sections": sections,
        "character_states": states,
        "running": bool(raw.get("running")),
        "active_section_id": active,
    }


def primary_draft_stage_key(book: "Book") -> str:
    """
    save_book 时同步顶层 content 所取的正文阶段键。
    统一使用 "draft"
    """
    return "draft"


def normalize_book_status(raw: Any | None) -> BookStatus:
    """书籍状态兼容旧数据：缺失或未知值均视为编辑中。"""
    return "completed" if raw == "completed" else "editing"


def normalize_book_type(raw: Any | None) -> BookType:
    bt = str(raw or "").strip()
    return bt if bt in ("short", "long", "script") else "short"  # type: ignore[return-value]


def normalize_bool(raw: Any | None, default: bool = False) -> bool:
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return raw != 0
    if isinstance(raw, str):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    return default


def normalize_material_type(raw: Any | None) -> MaterialType:
    mt = str(raw or "").strip()
    return mt if mt in LIBRARY_TYPES else "short"  # type: ignore[return-value]


def normalize_skill_type(raw: Any | None) -> SkillType:
    st = str(raw or "").strip()
    return st if st in LIBRARY_TYPES else "short"  # type: ignore[return-value]


def new_memory_id() -> str:
    return str(uuid4())


def normalize_memory_tag(raw: Any | None) -> str:
    tag = str(raw or "").strip()
    return tag if tag in MEMORY_TAGS else "general"


def normalize_memory_entry(raw: Any | None) -> dict[str, str] | None:
    if isinstance(raw, str):
        content = raw.strip()
        if not content:
            return None
        return {
            "id": new_memory_id(),
            "tag": "general",
            "content": content,
            "created_at": "",
            "updated_at": "",
        }
    if not isinstance(raw, dict):
        return None
    content = str(raw.get("content") or "").strip()
    if not content:
        return None
    memory_id = str(raw.get("id") or "").strip() or new_memory_id()
    return {
        "id": memory_id,
        "tag": normalize_memory_tag(raw.get("tag")),
        "content": content,
        "created_at": str(raw.get("created_at") or ""),
        "updated_at": str(raw.get("updated_at") or ""),
    }


def normalize_memories_from_storage(raw: Any | None) -> list[dict[str, str]]:
    if raw is None:
        return []
    source = raw if isinstance(raw, list) else [raw]
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in source:
        entry = normalize_memory_entry(item)
        if not entry:
            continue
        if entry["id"] in seen:
            entry["id"] = new_memory_id()
        seen.add(entry["id"])
        out.append(entry)
    return out


@dataclass
class Book:
    id: str
    title: str
    book_type: BookType
    categories: list[str] = field(default_factory=list)
    content: str = ""
    output_dir: str = ""
    linked_material_id: str = ""
    linked_skill_id: str = ""
    status: BookStatus = "editing"
    stages: dict[str, str] = field(default_factory=default_stages)
    expert_draft: dict[str, Any] = field(default_factory=default_expert_draft)
    memories: list[dict[str, str]] = field(default_factory=list)
    memory_auto_capture_enabled: bool = True
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Book":
        bt = normalize_book_type(data.get("book_type"))
        # 从存储加载时执行迁移
        raw_stages = data.get("stages")
        migrated_stages = normalize_stages_from_storage(raw_stages, bt)

        return cls(
            id=str(data["id"]),
            title=str(data["title"]),
            book_type=bt,  # type: ignore[arg-type]
            categories=list(data.get("categories") or []),
            content=str(data.get("content") or ""),
            output_dir=str(data.get("output_dir") or ""),
            linked_material_id=str(data.get("linked_material_id") or ""),
            linked_skill_id=str(data.get("linked_skill_id") or ""),
            status=normalize_book_status(data.get("status")),
            stages=migrated_stages,
            expert_draft=normalize_expert_draft_from_storage(
                data.get("expert_draft"), bt
            ),
            memories=normalize_memories_from_storage(data.get("memories")),
            memory_auto_capture_enabled=normalize_bool(
                data.get("memory_auto_capture_enabled"), True
            ),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )


def new_book_id() -> str:
    return str(uuid4())


def new_material_id() -> str:
    return str(uuid4())


def new_skill_id() -> str:
    return str(uuid4())


def new_skill_stage_item_id() -> str:
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


def default_skill_stages() -> dict[str, list[dict[str, str]]]:
    """创建默认的空技能阶段字典：每个阶段是一组技能条目。"""
    return {k: [] for k in SKILL_STAGE_KEYS}


def _skill_stage_item(
    *,
    title: str,
    body: str,
    item_id: Any | None = None,
    created_at: Any | None = None,
    updated_at: Any | None = None,
    source_common_skill_id: Any | None = None,
) -> dict[str, str]:
    item = {
        "id": str(item_id or new_skill_stage_item_id()),
        "title": str(title or "未命名技能").strip() or "未命名技能",
        "body": str(body or ""),
        "created_at": str(created_at or ""),
        "updated_at": str(updated_at or ""),
    }
    source_id = str(source_common_skill_id or "").strip()
    if source_id:
        item["source_common_skill_id"] = source_id
    return item


def normalize_skill_stage_items(stage_id: str, raw: Any) -> list[dict[str, str]]:
    """从 JSON 载入单个阶段的技能条目列表，兼容旧版阶段字符串。"""
    label = SKILL_STAGE_LABELS.get(stage_id, "阶段技能")
    if raw is None:
        return []
    if isinstance(raw, str):
        return [_skill_stage_item(title=label, body=raw)] if raw.strip() else []
    if isinstance(raw, list):
        out: list[dict[str, str]] = []
        for index, item in enumerate(raw, start=1):
            if isinstance(item, dict):
                body = str(item.get("body") or "")
                title = str(item.get("title") or "").strip() or f"{label} {index}"
                out.append(
                    _skill_stage_item(
                        title=title,
                        body=body,
                        item_id=item.get("id"),
                        created_at=item.get("created_at"),
                        updated_at=item.get("updated_at"),
                        source_common_skill_id=item.get("source_common_skill_id"),
                    ),
                )
            elif isinstance(item, str) and item.strip():
                out.append(_skill_stage_item(title=f"{label} {index}", body=item))
        return out
    if isinstance(raw, dict):
        body = str(raw.get("body") or "")
        if body.strip() or raw.get("title"):
            return [
                _skill_stage_item(
                    title=str(raw.get("title") or label),
                    body=body,
                    item_id=raw.get("id"),
                    created_at=raw.get("created_at"),
                    updated_at=raw.get("updated_at"),
                    source_common_skill_id=raw.get("source_common_skill_id"),
                ),
            ]
    return []


def normalize_skill_stages_from_storage(raw: dict[str, Any] | None) -> dict[str, list[dict[str, str]]]:
    """从 JSON 载入技能阶段：补齐缺失键为 []，并兼容旧版阶段字符串。"""
    out = default_skill_stages()
    if not raw:
        return out
    for k in SKILL_STAGE_KEYS:
        if k in raw:
            out[k] = normalize_skill_stage_items(k, raw[k])
    for legacy_key in LEGACY_SKILL_STAGES_TO_PLOT:
        if legacy_key in raw:
            out["plot_design"].extend(normalize_skill_stage_items("plot_design", raw[legacy_key]))
    for legacy_key in LEGACY_SKILL_STAGES_TO_DRAFT:
        if legacy_key in raw:
            out["draft"].extend(normalize_skill_stage_items("draft", raw[legacy_key]))
    return out


def normalize_skill_stage_id(raw: Any | None) -> str:
    sid = str(raw or "").strip()
    if sid in SKILL_STAGE_KEYS:
        return sid
    if sid in LEGACY_SKILL_STAGES_TO_PLOT:
        return "plot_design"
    if sid in LEGACY_SKILL_STAGES_TO_DRAFT:
        return "draft"
    return "character_design"


@dataclass
class Material:
    """素材数据模型，用于存储人设、导语、梗、剧情设计等素材"""

    id: str
    title: str
    material_type: MaterialType
    parent_genre: str = ""  # 世情/情感（仅short时有效）
    sub_genre: str = ""     # legacy: 旧版子分类；新建素材不再填写
    stages: dict[str, str] = field(default_factory=default_material_stages)
    output_dir: str = ""
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Material":
        mt = normalize_material_type(data.get("material_type"))
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


@dataclass
class Skill:
    """技能库数据模型：保留阶段工作台；每个阶段可管理多条技能。"""

    id: str
    title: str
    skill_type: SkillType = "short"
    stages: dict[str, list[dict[str, str]]] = field(default_factory=default_skill_stages)
    output_dir: str = ""
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Skill":
        stages = normalize_skill_stages_from_storage(data.get("stages"))

        # 兼容误拆成单阶段技能的数据：把 stage_id/body 还原为该阶段下的一条技能。
        raw_stage_id = normalize_skill_stage_id(data.get("stage_id"))
        if data.get("stage_id") is not None and not stages[raw_stage_id]:
            stages[raw_stage_id] = [
                _skill_stage_item(
                    title=str(data.get("title") or SKILL_STAGE_LABELS[raw_stage_id]),
                    body=str(data.get("body") or ""),
                    created_at=data.get("created_at"),
                    updated_at=data.get("updated_at"),
                ),
            ]
        return cls(
            id=str(data["id"]),
            title=str(data["title"]),
            skill_type=normalize_skill_type(data.get("skill_type")),
            stages=stages,
            output_dir=str(data.get("output_dir") or ""),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )
