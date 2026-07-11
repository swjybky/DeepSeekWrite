from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Literal
from uuid import uuid4

BookType = Literal["short", "long", "script"]
BookStatus = Literal["editing", "completed"]
MaterialType = Literal["long", "short", "script"]
MaterialKind = Literal["character", "gimmick", "plot", "draft", "other"]
SkillType = Literal["long", "short", "script"]
SkillKind = Literal["general", "plot", "style", "other"]

OFFICIAL_GENERAL_SKILL_LIBRARY_ID = "official-general-skill-library"

WORKSPACE_BOOK_TYPES: tuple[str, ...] = ("short", "long", "script")
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

# 素材阶段键（梗、人设、剧情设计、导语设计、剧情细化、优秀正文片段、其他素材）
MATERIAL_STAGE_KEYS: tuple[str, ...] = (
    "gimmick",       # 梗
    "character",     # 人设
    "pacing",        # 剧情设计
    "intro",         # 导语设计
    "plot_refine",   # 剧情细化
    "draft_excerpt", # 优秀正文片段
    "other",         # 其他素材
)

MATERIAL_KIND_KEYS: tuple[str, ...] = (
    "character",
    "gimmick",
    "plot",
    "draft",
    "other",
)

MATERIAL_KIND_WITH_MIXED_KEYS: tuple[str, ...] = (*MATERIAL_KIND_KEYS, "mixed")

MATERIAL_KIND_STAGE_KEYS: dict[str, tuple[str, ...]] = {
    "character": ("character",),
    "gimmick": ("gimmick",),
    "plot": ("pacing", "intro", "plot_refine"),
    "draft": ("draft_excerpt",),
    "other": ("other",),
    "mixed": MATERIAL_STAGE_KEYS,
}

MATERIAL_STAGE_TO_KIND: dict[str, str] = {
    stage_id: kind
    for kind, stage_ids in MATERIAL_KIND_STAGE_KEYS.items()
    if kind != "mixed"
    for stage_id in stage_ids
}

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

SKILL_KIND_KEYS: tuple[str, ...] = (
    "general",
    "plot",
    "style",
    "other",
)

SKILL_KIND_STAGE_KEYS: dict[str, tuple[str, ...]] = {
    "general": SKILL_STAGE_KEYS,
    "plot": ("character_design", "plot_design", "outline"),
    "style": ("draft", "expert_section_writer"),
    "other": SKILL_STAGE_KEYS,
}

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

# 长篇工作台阶段键：独立于短篇/剧本，保存实际可编辑叶子节点。
LONG_STAGE_KEYS: tuple[str, ...] = (
    "worldbuilding.rules",
    "worldbuilding.factions",
    "worldbuilding.geography",
    "worldbuilding.history",
    "worldbuilding.terminology",
    "worldbuilding.items",
    "character_design.protagonists",
    "character_design.major_supporting",
    "character_design.minor_supporting",
    "character_design.passersby",
    "plot_design.book_line",
    "plot_design.volumes",
    "plot_design.story_arcs",
    "plot_design.chapter_cards",
    "plot_design.foreshadowing",
    "draft.volume-1.arc-1.chapter-1",
    "draft.volume-2.arc-1.chapter-1",
    "continuity_ledger.timeline",
    "continuity_ledger.character_states",
    "continuity_ledger.open_foreshadowing",
    "continuity_ledger.continuity_notes",
)

_LONG_DRAFT_STAGE_RE = re.compile(
    r"^draft\.volume-[1-9]\d*\.arc-[1-9]\d*\.chapter-[1-9]\d*$"
)

LONG_WORKSPACE_SCHEMA_VERSION = 2

LONG_WORLDBUILDING_CATEGORY_DEFAULTS: tuple[tuple[str, str], ...] = (
    ("rules", "规则"),
    ("factions", "势力"),
    ("geography", "地理"),
    ("history", "历史"),
    ("terminology", "术语"),
    ("realms", "境界"),
    ("items", "物品"),
)

LONG_CHARACTER_GROUPS: tuple[tuple[str, str], ...] = (
    ("protagonists", "主角"),
    ("major_supporting", "主要配角"),
    ("minor_supporting", "次要配角"),
    ("passersby", "路人"),
)


def _record_dict(raw: Any) -> dict[str, Any]:
    return dict(raw) if isinstance(raw, dict) else {}


def _record_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return list(raw)
    if isinstance(raw, dict):
        return list(raw.values())
    return []


def _record_id(raw: Any, prefix: str, seen: set[str]) -> str:
    candidate = str(raw or "").strip()
    if not candidate or candidate in seen:
        candidate = f"{prefix}-{uuid4()}"
    seen.add(candidate)
    return candidate


def _record_order(raw: Any, fallback: int) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = fallback
    return max(0, value)


def _record_string_list(raw: Any) -> list[str]:
    source = raw if isinstance(raw, list) else ([raw] if raw else [])
    out: list[str] = []
    seen: set[str] = set()
    for item in source:
        value = str(item or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _default_long_worldbuilding_categories() -> list[dict[str, Any]]:
    return [
        {
            "id": category_id,
            "name": name,
            "format": "list",
            "overview": "",
            "items": [],
            "text": "",
        }
        for category_id, name in LONG_WORLDBUILDING_CATEGORY_DEFAULTS
    ]


def _default_long_plot() -> dict[str, Any]:
    return {
        "book_line": "",
        "volumes": [
            {
                "id": "volume-1",
                "name": "第一卷",
                "outline": "",
                "order": 1,
            }
        ],
        "arcs": [
            {
                "id": "arc-1-1",
                "volume_id": "volume-1",
                "name": "第一剧情弧",
                "timeline": "",
                "order": 1,
            }
        ],
        "chapter_cards": [
            {
                "id": "chapter-card-1-1-1",
                "volume_id": "volume-1",
                "arc_id": "arc-1-1",
                "stage_id": "draft.volume-1.arc-1.chapter-1",
                "title": "第一章",
                "outline": "",
                "world_constraints": "",
                "characters": [],
                "order": 1,
            }
        ],
        "foreshadowing": [],
    }


def default_long_workspace() -> dict[str, Any]:
    """长篇独立工作台 v2 的默认结构。"""
    return {
        "schema_version": LONG_WORKSPACE_SCHEMA_VERSION,
        "revision": 0,
        "worldbuilding": {
            "categories": _default_long_worldbuilding_categories(),
        },
        "characters": {
            group_id: {"entries": []}
            for group_id, _label in LONG_CHARACTER_GROUPS
        },
        "plot": _default_long_plot(),
        "chapters": {
            "draft.volume-1.arc-1.chapter-1": {
                "title": "第一章",
                "body": "",
                "character_state": "",
                "handoff": "",
                "committed": False,
                "committed_at": "",
                "commit_id": "",
            }
        },
        "ledger": {
            "committed_through": "",
            "timeline": [],
            "faction_states": [],
            "realm_states": [],
            "foreshadowing_states": [],
            "continuity_notes": [],
        },
    }


def _long_draft_parts(stage_id: str) -> tuple[int, int, int] | None:
    match = _LONG_DRAFT_STAGE_RE.match(str(stage_id or "").strip())
    if not match:
        return None
    parts = tuple(int(value) for value in match.groups())
    return parts[0], parts[1], parts[2]


def _long_ledger_entry(raw: Any, prefix: str, index: int) -> dict[str, str] | None:
    if isinstance(raw, str):
        content = raw.strip()
        source: dict[str, Any] = {}
    elif isinstance(raw, dict):
        source = raw
        content = str(
            source.get("content")
            or source.get("description")
            or source.get("detail")
            or source.get("state")
            or source.get("note")
            or ""
        ).strip()
    else:
        return None
    if not content:
        return None
    return {
        "id": str(source.get("id") or f"{prefix}-{index + 1}"),
        "chapter_stage_id": str(source.get("chapter_stage_id") or ""),
        "chapter_title": str(source.get("chapter_title") or ""),
        "content": content,
        "created_at": str(source.get("created_at") or ""),
        **(
            {"commit_id": str(source.get("commit_id") or "")}
            if source.get("commit_id")
            else {}
        ),
    }


def _normalize_long_ledger_entries(raw: Any, prefix: str) -> list[dict[str, str]]:
    source = raw if isinstance(raw, list) else ([raw] if raw else [])
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, item in enumerate(source):
        entry = _long_ledger_entry(item, prefix, index)
        if not entry:
            continue
        entry_id = entry["id"]
        if entry_id in seen:
            entry["id"] = f"{prefix}-{uuid4()}"
        seen.add(entry["id"])
        out.append(entry)
    return out


def normalize_long_workspace_from_storage(
    raw: Any | None,
    legacy_stages: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """读取长篇 v2 结构；没有结构化数据时无损迁移旧 stages。"""
    if not isinstance(raw, dict):
        return migrate_long_workspace_from_stages(legacy_stages)

    base = default_long_workspace()
    result: dict[str, Any] = {
        "schema_version": LONG_WORKSPACE_SCHEMA_VERSION,
        "revision": _record_order(raw.get("revision"), 0),
    }

    world_raw = _record_dict(raw.get("worldbuilding"))
    category_source = (
        _record_list(world_raw.get("categories"))
        if "categories" in world_raw
        else base["worldbuilding"]["categories"]
    )
    categories: list[dict[str, Any]] = []
    seen_category_ids: set[str] = set()
    for index, item in enumerate(category_source):
        source = _record_dict(item)
        category_id = _record_id(source.get("id"), "world-category", seen_category_ids)
        item_rows: list[dict[str, str]] = []
        seen_item_ids: set[str] = set()
        for item_index, raw_item in enumerate(_record_list(source.get("items"))):
            item_source = _record_dict(raw_item)
            item_id = _record_id(
                item_source.get("id"),
                f"{category_id}-item",
                seen_item_ids,
            )
            item_rows.append(
                {
                    "id": item_id,
                    "name": str(item_source.get("name") or f"未命名条目{item_index + 1}"),
                    "description": str(item_source.get("description") or ""),
                    "detail": str(
                        item_source.get("detail")
                        or item_source.get("introduction")
                        or ""
                    ),
                }
            )
        categories.append(
            {
                "id": category_id,
                "name": str(source.get("name") or f"未命名分类{index + 1}"),
                "format": "text" if source.get("format") == "text" else "list",
                "overview": str(source.get("overview") or ""),
                "items": item_rows,
                "text": str(source.get("text") or ""),
            }
        )
    result["worldbuilding"] = {"categories": categories}

    characters_raw = _record_dict(raw.get("characters"))
    characters: dict[str, Any] = {}
    seen_character_ids: set[str] = set()
    for group_id, _label in LONG_CHARACTER_GROUPS:
        group_raw = characters_raw.get(group_id)
        group_obj = _record_dict(group_raw)
        entries_raw = (
            group_obj.get("entries")
            if isinstance(group_raw, dict)
            else group_raw
        )
        entries: list[dict[str, str]] = []
        for index, item in enumerate(_record_list(entries_raw)):
            source = _record_dict(item)
            character_id = _record_id(
                source.get("id"),
                f"character-{group_id}",
                seen_character_ids,
            )
            entries.append(
                {
                    "id": character_id,
                    "name": str(source.get("name") or f"未命名人物{index + 1}"),
                    "core_profile": str(source.get("core_profile") or ""),
                    "relationships": str(source.get("relationships") or ""),
                    "current_state": str(source.get("current_state") or ""),
                    "history": str(source.get("history") or ""),
                }
            )
        characters[group_id] = {"entries": entries}
    result["characters"] = characters

    plot_raw = _record_dict(raw.get("plot"))
    default_plot = base["plot"]
    volume_source = (
        _record_list(plot_raw.get("volumes"))
        if "volumes" in plot_raw
        else default_plot["volumes"]
    )
    volumes: list[dict[str, Any]] = []
    seen_volume_ids: set[str] = set()
    for index, item in enumerate(volume_source):
        source = _record_dict(item)
        volumes.append(
            {
                "id": _record_id(source.get("id"), "volume", seen_volume_ids),
                "name": str(source.get("name") or f"第{index + 1}卷"),
                "outline": str(source.get("outline") or ""),
                "order": _record_order(source.get("order"), index + 1),
            }
        )
    volumes.sort(key=lambda item: (item["order"], item["id"]))

    arc_source = (
        _record_list(plot_raw.get("arcs"))
        if "arcs" in plot_raw
        else default_plot["arcs"]
    )
    arcs: list[dict[str, Any]] = []
    seen_arc_ids: set[str] = set()
    volume_ids = {str(item["id"]) for item in volumes}
    for index, item in enumerate(arc_source):
        source = _record_dict(item)
        volume_id = str(source.get("volume_id") or "").strip()
        if volume_id not in volume_ids:
            if not volumes:
                recovered = {
                    "id": volume_id or "volume-recovered",
                    "name": "恢复的分卷",
                    "outline": "",
                    "order": 1,
                }
                recovered["id"] = _record_id(
                    recovered["id"], "volume", seen_volume_ids
                )
                volumes.append(recovered)
                volume_ids.add(str(recovered["id"]))
            volume_id = str(volumes[0]["id"])
        arcs.append(
            {
                "id": _record_id(source.get("id"), "arc", seen_arc_ids),
                "volume_id": volume_id,
                "name": str(source.get("name") or f"剧情弧{index + 1}"),
                "timeline": str(source.get("timeline") or ""),
                "order": _record_order(source.get("order"), index + 1),
            }
        )
    arcs.sort(key=lambda item: (item["order"], item["id"]))

    card_source = (
        _record_list(plot_raw.get("chapter_cards"))
        if "chapter_cards" in plot_raw
        else default_plot["chapter_cards"]
    )
    raw_chapters = _record_dict(raw.get("chapters"))
    known_card_stages = {
        str(_record_dict(item).get("stage_id") or "")
        for item in card_source
    }
    for stage_id in raw_chapters:
        parts = _long_draft_parts(str(stage_id))
        if not parts or stage_id in known_card_stages:
            continue
        volume_number, arc_number, chapter_number = parts
        volume_id = f"volume-{volume_number}"
        arc_id = f"arc-{volume_number}-{arc_number}"
        if volume_id not in {str(item["id"]) for item in volumes}:
            volumes.append(
                {
                    "id": volume_id,
                    "name": f"第{volume_number}卷",
                    "outline": "",
                    "order": volume_number,
                }
            )
        if arc_id not in {str(item["id"]) for item in arcs}:
            arcs.append(
                {
                    "id": arc_id,
                    "volume_id": volume_id,
                    "name": f"剧情弧{arc_number}",
                    "timeline": "",
                    "order": arc_number,
                }
            )
        card_source.append(
            {
                "id": f"chapter-card-{volume_number}-{arc_number}-{chapter_number}",
                "volume_id": volume_id,
                "arc_id": arc_id,
                "stage_id": stage_id,
                "title": f"第{chapter_number}章",
                "outline": "",
                "world_constraints": "",
                "characters": [],
                "order": chapter_number,
            }
        )
        known_card_stages.add(stage_id)
    volumes.sort(key=lambda item: (item["order"], item["id"]))
    arcs.sort(key=lambda item: (item["order"], item["id"]))
    volume_ids = {str(item["id"]) for item in volumes}
    arc_by_id = {str(item["id"]): item for item in arcs}

    cards: list[dict[str, Any]] = []
    seen_card_ids: set[str] = set()
    seen_stage_ids: set[str] = set()
    for index, item in enumerate(card_source):
        source = _record_dict(item)
        arc_id = str(source.get("arc_id") or "").strip()
        arc = arc_by_id.get(arc_id)
        if arc is None:
            if not arcs:
                volume_id = str(volumes[0]["id"]) if volumes else "volume-recovered"
                if volume_id not in volume_ids:
                    volumes.append(
                        {
                            "id": volume_id,
                            "name": "恢复的分卷",
                            "outline": "",
                            "order": 1,
                        }
                    )
                    volume_ids.add(volume_id)
                arc = {
                    "id": "arc-recovered",
                    "volume_id": volume_id,
                    "name": "恢复的剧情弧",
                    "timeline": "",
                    "order": 1,
                }
                arcs.append(arc)
                arc_by_id[str(arc["id"])] = arc
            else:
                arc = arcs[0]
            arc_id = str(arc["id"])
        volume_id = str(arc["volume_id"])
        stage_id = str(source.get("stage_id") or "").strip()
        if not _long_draft_parts(stage_id) or stage_id in seen_stage_ids:
            volume_index = next(
                (i + 1 for i, row in enumerate(volumes) if row["id"] == volume_id),
                1,
            )
            matching_arcs = [row for row in arcs if row["volume_id"] == volume_id]
            arc_index = next(
                (i + 1 for i, row in enumerate(matching_arcs) if row["id"] == arc_id),
                1,
            )
            chapter_number = 1 + sum(
                1
                for row in cards
                if row["volume_id"] == volume_id and row["arc_id"] == arc_id
            )
            stage_id = (
                f"draft.volume-{volume_index}.arc-{arc_index}.chapter-{chapter_number}"
            )
            while stage_id in seen_stage_ids:
                chapter_number += 1
                stage_id = (
                    f"draft.volume-{volume_index}.arc-{arc_index}.chapter-{chapter_number}"
                )
        seen_stage_ids.add(stage_id)
        cards.append(
            {
                "id": _record_id(source.get("id"), "chapter-card", seen_card_ids),
                "volume_id": volume_id,
                "arc_id": arc_id,
                "stage_id": stage_id,
                "title": str(source.get("title") or f"第{index + 1}章"),
                "outline": str(source.get("outline") or ""),
                "world_constraints": str(source.get("world_constraints") or ""),
                "characters": _record_string_list(source.get("characters")),
                "order": _record_order(source.get("order"), index + 1),
            }
        )
    cards.sort(key=lambda item: (item["order"], item["id"]))

    foreshadowing: list[dict[str, str]] = []
    seen_foreshadow_ids: set[str] = set()
    for index, item in enumerate(_record_list(plot_raw.get("foreshadowing"))):
        source = _record_dict(item)
        foreshadowing.append(
            {
                "id": _record_id(source.get("id"), "foreshadowing", seen_foreshadow_ids),
                "name": str(source.get("name") or f"未命名伏笔{index + 1}"),
                "description": str(source.get("description") or ""),
                "content": str(source.get("content") or ""),
                "status": str(source.get("status") or "open"),
            }
        )

    result["plot"] = {
        "book_line": str(plot_raw.get("book_line") or ""),
        "volumes": volumes,
        "arcs": arcs,
        "chapter_cards": cards,
        "foreshadowing": foreshadowing,
    }

    chapters: dict[str, dict[str, Any]] = {}
    for card in cards:
        stage_id = str(card["stage_id"])
        source = _record_dict(raw_chapters.get(stage_id))
        chapters[stage_id] = {
            "title": str(source.get("title") or card["title"]),
            "body": str(source.get("body") or ""),
            "character_state": str(source.get("character_state") or ""),
            "handoff": str(source.get("handoff") or source.get("handoff_notes") or ""),
            "committed": bool(source.get("committed")),
            "committed_at": str(source.get("committed_at") or ""),
            "commit_id": str(source.get("commit_id") or ""),
        }
    result["chapters"] = chapters

    ledger_raw = _record_dict(raw.get("ledger"))
    committed_through = str(ledger_raw.get("committed_through") or "")
    if committed_through not in chapters:
        committed_through = ""
    result["ledger"] = {
        "committed_through": committed_through,
        "timeline": _normalize_long_ledger_entries(
            ledger_raw.get("timeline"), "timeline"
        ),
        "faction_states": _normalize_long_ledger_entries(
            ledger_raw.get("faction_states"), "faction-state"
        ),
        "realm_states": _normalize_long_ledger_entries(
            ledger_raw.get("realm_states"), "realm-state"
        ),
        "foreshadowing_states": _normalize_long_ledger_entries(
            ledger_raw.get("foreshadowing_states"), "foreshadowing-state"
        ),
        "continuity_notes": _normalize_long_ledger_entries(
            ledger_raw.get("continuity_notes"), "continuity-note"
        ),
    }
    return result


def migrate_long_workspace_from_stages(
    stages: dict[str, Any] | None,
) -> dict[str, Any]:
    """将第一版长篇平面 stages 无损装入 v2 结构。"""
    source = {str(key): str(value or "") for key, value in (stages or {}).items()}
    raw = default_long_workspace()

    category_stage_map = {
        "rules": "worldbuilding.rules",
        "factions": "worldbuilding.factions",
        "geography": "worldbuilding.geography",
        "history": "worldbuilding.history",
        "terminology": "worldbuilding.terminology",
        "items": "worldbuilding.items",
    }
    for category in raw["worldbuilding"]["categories"]:
        body = source.get(category_stage_map.get(category["id"], ""), "")
        if body:
            category["format"] = "text"
            category["text"] = body

    character_stage_map = {
        "protagonists": "character_design.protagonists",
        "major_supporting": "character_design.major_supporting",
        "minor_supporting": "character_design.minor_supporting",
        "passersby": "character_design.passersby",
    }
    for group_id, stage_id in character_stage_map.items():
        body = source.get(stage_id, "")
        if not body:
            continue
        raw["characters"][group_id]["entries"] = [
            {
                "id": f"legacy-{group_id}",
                "name": "旧版人物资料",
                "core_profile": body,
                "relationships": "",
                "current_state": "",
                "history": "",
            }
        ]

    raw["plot"]["book_line"] = source.get("plot_design.book_line", "")
    raw["plot"]["volumes"][0]["outline"] = source.get("plot_design.volumes", "")
    raw["plot"]["arcs"][0]["timeline"] = source.get("plot_design.story_arcs", "")
    raw["plot"]["chapter_cards"][0]["outline"] = source.get(
        "plot_design.chapter_cards", ""
    )
    foreshadowing_body = source.get("plot_design.foreshadowing", "")
    if foreshadowing_body:
        raw["plot"]["foreshadowing"] = [
            {
                "id": "legacy-foreshadowing",
                "name": "旧版伏笔资料",
                "description": "",
                "content": foreshadowing_body,
                "status": "open",
            }
        ]

    raw_chapters: dict[str, Any] = raw["chapters"]
    for stage_id, body in source.items():
        if not _long_draft_parts(stage_id):
            continue
        # 第一版默认自带两个空章节；迁移时只保留真正写过的节点，另保留 v2 默认第一章。
        if not body and stage_id in LONG_STAGE_KEYS and stage_id != "draft.volume-1.arc-1.chapter-1":
            continue
        raw_chapters[stage_id] = {
            "title": "",
            "body": body,
            "character_state": "",
            "handoff": "",
            "committed": False,
            "committed_at": "",
            "commit_id": "",
        }

    def add_legacy_ledger(target: str, stage_id: str, prefix: str) -> None:
        body = source.get(stage_id, "").strip()
        if not body:
            return
        raw["ledger"][target].append(
            {
                "id": f"legacy-{prefix}",
                "chapter_stage_id": "",
                "chapter_title": "旧版状态账本",
                "content": body,
                "created_at": "",
            }
        )

    add_legacy_ledger("timeline", "continuity_ledger.timeline", "timeline")
    add_legacy_ledger(
        "foreshadowing_states",
        "continuity_ledger.open_foreshadowing",
        "foreshadowing",
    )
    add_legacy_ledger(
        "continuity_notes",
        "continuity_ledger.character_states",
        "character-states",
    )
    add_legacy_ledger(
        "continuity_notes",
        "continuity_ledger.continuity_notes",
        "continuity-notes",
    )
    return normalize_long_workspace_from_storage(raw)


def sync_long_workspace_from_stage_patch(
    workspace: Any,
    patch: dict[str, Any] | None,
) -> dict[str, Any]:
    """兼容第一版前端：显式 stages patch 同步到 v2 对应内容。"""
    out = normalize_long_workspace_from_storage(workspace)
    if not patch:
        return out

    category_stage_map = {
        "worldbuilding.rules": "rules",
        "worldbuilding.factions": "factions",
        "worldbuilding.geography": "geography",
        "worldbuilding.history": "history",
        "worldbuilding.terminology": "terminology",
        "worldbuilding.items": "items",
    }
    categories = out["worldbuilding"]["categories"]
    for stage_id, category_id in category_stage_map.items():
        if stage_id not in patch:
            continue
        category = next((row for row in categories if row["id"] == category_id), None)
        if category is not None:
            category["format"] = "text"
            category["text"] = str(patch.get(stage_id) or "")

    character_stage_map = {
        "character_design.protagonists": "protagonists",
        "character_design.major_supporting": "major_supporting",
        "character_design.minor_supporting": "minor_supporting",
        "character_design.passersby": "passersby",
    }
    for stage_id, group_id in character_stage_map.items():
        if stage_id not in patch:
            continue
        entries = out["characters"][group_id]["entries"]
        legacy = next(
            (row for row in entries if row["id"] == f"legacy-{group_id}"),
            None,
        )
        if legacy is None:
            legacy = {
                "id": f"legacy-{group_id}",
                "name": "旧版人物资料",
                "core_profile": "",
                "relationships": "",
                "current_state": "",
                "history": "",
            }
            entries.append(legacy)
        legacy["core_profile"] = str(patch.get(stage_id) or "")

    if "plot_design.book_line" in patch:
        out["plot"]["book_line"] = str(patch.get("plot_design.book_line") or "")
    if "plot_design.volumes" in patch and out["plot"]["volumes"]:
        out["plot"]["volumes"][0]["outline"] = str(
            patch.get("plot_design.volumes") or ""
        )
    if "plot_design.story_arcs" in patch and out["plot"]["arcs"]:
        out["plot"]["arcs"][0]["timeline"] = str(
            patch.get("plot_design.story_arcs") or ""
        )
    if "plot_design.chapter_cards" in patch and out["plot"]["chapter_cards"]:
        out["plot"]["chapter_cards"][0]["outline"] = str(
            patch.get("plot_design.chapter_cards") or ""
        )

    chapters = out["chapters"]
    for stage_id, value in patch.items():
        if not _long_draft_parts(str(stage_id)):
            continue
        if stage_id not in chapters:
            chapters[stage_id] = {
                "title": "",
                "body": "",
                "character_state": "",
                "handoff": "",
                "committed": False,
                "committed_at": "",
                "commit_id": "",
            }
        chapters[stage_id]["body"] = str(value or "")
    return normalize_long_workspace_from_storage(out)


def ordered_long_chapter_cards(workspace: Any) -> list[dict[str, Any]]:
    """按卷、剧情弧、章卡 order 返回权威章节顺序。"""
    normalized = normalize_long_workspace_from_storage(workspace)
    plot = normalized["plot"]
    volume_rank = {
        str(item["id"]): index
        for index, item in enumerate(
            sorted(plot["volumes"], key=lambda row: (row["order"], row["id"]))
        )
    }
    arcs_by_volume: dict[str, list[dict[str, Any]]] = {}
    for arc in plot["arcs"]:
        arcs_by_volume.setdefault(str(arc["volume_id"]), []).append(arc)
    arc_rank: dict[str, int] = {}
    for rows in arcs_by_volume.values():
        for index, arc in enumerate(sorted(rows, key=lambda row: (row["order"], row["id"]))):
            arc_rank[str(arc["id"])] = index
    return sorted(
        plot["chapter_cards"],
        key=lambda row: (
            volume_rank.get(str(row["volume_id"]), 10**9),
            arc_rank.get(str(row["arc_id"]), 10**9),
            row["order"],
            row["id"],
        ),
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
ALL_STAGE_KEYS: tuple[str, ...] = (
    SHORT_STAGE_KEYS + LONG_STAGE_KEYS + LEGACY_QINGGAN_STAGE_KEYS
)


def _stage_keys_for_book_type(book_type: str | None = None) -> tuple[str, ...]:
    """根据书籍类型返回适用的阶段键列表。"""
    normalized = str(book_type or "").strip()
    if normalized == "long":
        return LONG_STAGE_KEYS
    return SCRIPT_STAGE_KEYS if normalized == "script" else SHORT_STAGE_KEYS


def is_long_stage_key(stage_id: str) -> bool:
    """长篇允许固定叶子节点和动态正文卷/剧情弧线/章节节点。"""
    key = str(stage_id or "").strip()
    if key in LONG_STAGE_KEYS:
        return True
    if _LONG_DRAFT_STAGE_RE.match(key):
        return True
    return False


def long_stage_keys_from_stages(stages: dict[str, Any] | None) -> tuple[str, ...]:
    """导出/落盘时使用：默认键在前，动态长篇键随后稳定排序。"""
    keys = list(LONG_STAGE_KEYS)
    for key in sorted(str(k) for k in (stages or {}).keys()):
        if key not in keys and is_long_stage_key(key):
            keys.append(key)
    return tuple(keys)


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

    if str(book_type or "").strip() == "long":
        for key, value in raw.items():
            stage_id = str(key)
            if is_long_stage_key(stage_id):
                out[stage_id] = str(value or "")
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
    if str(book_type or "").strip() == "long":
        if patch:
            for key, value in patch.items():
                stage_id = str(key)
                if is_long_stage_key(stage_id):
                    out[stage_id] = str(value or "")
        return out
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
    if str(book_type or "").strip() == "long":
        return {
            "sections": [],
            "character_states": [],
            "running": False,
            "active_section_id": "",
        }
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
    if str(book_type or "").strip() == "long":
        return default_expert_draft("long")
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


def normalize_skill_kind(raw: Any | None, default: str = "general") -> str:
    kind = str(raw or "").strip()
    if kind in SKILL_KIND_KEYS:
        return kind
    return default if default in SKILL_KIND_KEYS else "general"


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


def normalize_material_kind(raw: Any | None, default: str = "mixed") -> str:
    kind = str(raw or "").strip()
    if kind in MATERIAL_KIND_WITH_MIXED_KEYS:
        return kind
    return default if default in MATERIAL_KIND_WITH_MIXED_KEYS else "mixed"


def normalize_linked_material_ids_by_kind(
    raw: Any,
    legacy_material_id: Any | None = None,
) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {kind: [] for kind in MATERIAL_KIND_KEYS}
    if isinstance(raw, dict):
        for kind in MATERIAL_KIND_KEYS:
            value = raw.get(kind)
            values = value if isinstance(value, list) else [value] if value else []
            seen: set[str] = set()
            for item in values:
                mid = str(item or "").strip()
                if not mid or mid in seen:
                    continue
                seen.add(mid)
                out[kind].append(mid)
        return out

    legacy_id = str(legacy_material_id or "").strip()
    if legacy_id:
        for kind in MATERIAL_KIND_KEYS:
            out[kind] = [legacy_id]
    return out


def first_linked_material_id(
    linked_material_ids_by_kind: dict[str, list[str]] | None,
) -> str:
    if not linked_material_ids_by_kind:
        return ""
    for kind in MATERIAL_KIND_KEYS:
        ids = linked_material_ids_by_kind.get(kind) or []
        if ids:
            return ids[0]
    return ""


def normalize_linked_skill_ids_by_kind(
    raw: Any,
    legacy_skill_id: Any | None = None,
) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {kind: [] for kind in SKILL_KIND_KEYS}
    if isinstance(raw, dict):
        for kind in SKILL_KIND_KEYS:
            value = raw.get(kind)
            values = value if isinstance(value, list) else [value] if value else []
            seen: set[str] = set()
            for item in values:
                sid = str(item or "").strip()
                if not sid or sid in seen:
                    continue
                seen.add(sid)
                out[kind].append(sid)
        return out

    legacy_id = str(legacy_skill_id or "").strip()
    if legacy_id:
        out["general"] = [legacy_id]
    return out


def first_linked_skill_id(
    linked_skill_ids_by_kind: dict[str, list[str]] | None,
) -> str:
    if not linked_skill_ids_by_kind:
        return ""
    for kind in SKILL_KIND_KEYS:
        ids = linked_skill_ids_by_kind.get(kind) or []
        if ids:
            return ids[0]
    return ""


@dataclass
class Book:
    id: str
    title: str
    book_type: BookType
    categories: list[str] = field(default_factory=list)
    content: str = ""
    output_dir: str = ""
    linked_material_id: str = ""
    linked_material_ids_by_kind: dict[str, list[str]] = field(
        default_factory=lambda: {kind: [] for kind in MATERIAL_KIND_KEYS},
    )
    linked_skill_id: str = ""
    linked_skill_ids_by_kind: dict[str, list[str]] = field(
        default_factory=lambda: {kind: [] for kind in SKILL_KIND_KEYS},
    )
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
        linked_material_id = str(data.get("linked_material_id") or "")
        linked_material_ids_by_kind = normalize_linked_material_ids_by_kind(
            data.get("linked_material_ids_by_kind"),
            linked_material_id,
        )
        if "linked_material_ids_by_kind" in data:
            linked_material_id = first_linked_material_id(linked_material_ids_by_kind)
        linked_skill_id = str(data.get("linked_skill_id") or "")
        linked_skill_ids_by_kind = normalize_linked_skill_ids_by_kind(
            data.get("linked_skill_ids_by_kind"),
            linked_skill_id,
        )
        if "linked_skill_ids_by_kind" in data:
            linked_skill_id = first_linked_skill_id(linked_skill_ids_by_kind)

        return cls(
            id=str(data["id"]),
            title=str(data["title"]),
            book_type=bt,  # type: ignore[arg-type]
            categories=list(data.get("categories") or []),
            content=str(data.get("content") or ""),
            output_dir=str(data.get("output_dir") or ""),
            linked_material_id=linked_material_id,
            linked_material_ids_by_kind=linked_material_ids_by_kind,
            linked_skill_id=linked_skill_id,
            linked_skill_ids_by_kind=linked_skill_ids_by_kind,
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


def new_material_stage_item_id() -> str:
    return str(uuid4())


def new_skill_id() -> str:
    return str(uuid4())


def new_skill_stage_item_id() -> str:
    return str(uuid4())


def new_library_group_id() -> str:
    return str(uuid4())


def material_matches_kind(material_kind: str | None, kind: str) -> bool:
    """素材库是否可用于指定用途部门（mixed 可匹配任意部门）。"""
    normalized = normalize_material_kind(material_kind)
    return normalized == "mixed" or normalized == kind


def normalize_material_library_group_members(
    raw: Any | None,
) -> dict[str, str]:
    """规范化素材分组成员：每个部门最多一个 material id。"""
    out: dict[str, str] = {}
    if not isinstance(raw, dict):
        return out
    seen_ids: set[str] = set()
    for kind in MATERIAL_KIND_KEYS:
        value = raw.get(kind)
        if not isinstance(value, str):
            continue
        mid = value.strip()
        if not mid or mid in seen_ids:
            continue
        seen_ids.add(mid)
        out[kind] = mid
    return out


def normalize_skill_library_group_members(
    raw: Any | None,
) -> dict[str, str]:
    """规范化技能分组成员：每个分类最多一个 skill id。"""
    out: dict[str, str] = {}
    if not isinstance(raw, dict):
        return out
    seen_ids: set[str] = set()
    for kind in SKILL_KIND_KEYS:
        value = raw.get(kind)
        if not isinstance(value, str):
            continue
        sid = value.strip()
        if not sid or sid in seen_ids:
            continue
        seen_ids.add(sid)
        out[kind] = sid
    return out


def normalize_material_library_group(raw: Any | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    gid = str(raw.get("id") or "").strip()
    title = str(raw.get("title") or "").strip()
    if not gid or not title:
        return None
    members = normalize_material_library_group_members(raw.get("members"))
    return {
        "id": gid,
        "title": title,
        "members": members,
        "created_at": str(raw.get("created_at") or ""),
        "updated_at": str(raw.get("updated_at") or ""),
    }


def normalize_skill_library_group(raw: Any | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    gid = str(raw.get("id") or "").strip()
    title = str(raw.get("title") or "").strip()
    if not gid or not title:
        return None
    members = normalize_skill_library_group_members(raw.get("members"))
    return {
        "id": gid,
        "title": title,
        "members": members,
        "created_at": str(raw.get("created_at") or ""),
        "updated_at": str(raw.get("updated_at") or ""),
    }


def normalize_material_library_groups(raw: Any | None) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        group = normalize_material_library_group(item)
        if group is None or group["id"] in seen:
            continue
        seen.add(group["id"])
        out.append(group)
    return out


def normalize_skill_library_groups(raw: Any | None) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        group = normalize_skill_library_group(item)
        if group is None or group["id"] in seen:
            continue
        seen.add(group["id"])
        out.append(group)
    return out


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


MATERIAL_STAGE_ITEM_LABELS: dict[str, str] = {
    "gimmick": "梗",
    "character": "人设",
    "pacing": "剧情",
    "intro": "导语",
    "plot_refine": "剧情细化",
    "draft_excerpt": "正文",
    "other": "其他素材",
}


def default_material_stage_items() -> dict[str, list[dict[str, str]]]:
    """创建默认的空素材条目列表。"""
    return {k: [] for k in MATERIAL_STAGE_KEYS}


def _title_from_material_body(stage_id: str, body: str, index: int) -> str:
    fallback = MATERIAL_STAGE_ITEM_LABELS.get(stage_id, "素材")
    for raw_line in body.splitlines():
        line = raw_line.strip().lstrip("#").strip()
        if line:
            return line[:40]
    suffix = "" if index <= 1 else f" {index}"
    return f"未命名{fallback}{suffix}"


def _material_stage_item(
    *,
    stage_id: str,
    title: str,
    body: str,
    index: int = 1,
    item_id: Any | None = None,
    created_at: Any | None = None,
    updated_at: Any | None = None,
) -> dict[str, str]:
    fallback_title = _title_from_material_body(stage_id, body, index)
    return {
        "id": str(item_id or new_material_stage_item_id()),
        "title": str(title or fallback_title).strip() or fallback_title,
        "body": str(body or ""),
        "created_at": str(created_at or ""),
        "updated_at": str(updated_at or ""),
    }


def normalize_material_stage_entries(
    stage_id: str,
    raw: Any,
    fallback_body: str = "",
) -> list[dict[str, str]]:
    """从 JSON 载入单个素材阶段的条目列表，兼容旧版单文本阶段。"""
    out: list[dict[str, str]] = []
    if isinstance(raw, list):
        for index, item in enumerate(raw, start=1):
            if isinstance(item, dict):
                body = str(item.get("body") or "")
                title = str(item.get("title") or "").strip()
                if not body.strip() and not title and not item.get("id"):
                    continue
                out.append(
                    _material_stage_item(
                        stage_id=stage_id,
                        title=title,
                        body=body,
                        index=index,
                        item_id=item.get("id"),
                        created_at=item.get("created_at"),
                        updated_at=item.get("updated_at"),
                    ),
                )
            elif isinstance(item, str) and item.strip():
                out.append(
                    _material_stage_item(
                        stage_id=stage_id,
                        title="",
                        body=item,
                        index=index,
                    ),
                )
    elif isinstance(raw, dict):
        body = str(raw.get("body") or "")
        title = str(raw.get("title") or "").strip()
        if body.strip() or title or raw.get("id"):
            out.append(
                _material_stage_item(
                    stage_id=stage_id,
                    title=title,
                    body=body,
                    item_id=raw.get("id"),
                    created_at=raw.get("created_at"),
                    updated_at=raw.get("updated_at"),
                ),
            )
    elif isinstance(raw, str) and raw.strip():
        out.append(_material_stage_item(stage_id=stage_id, title="", body=raw))

    if not out and fallback_body.strip():
        out.append(
            _material_stage_item(
                stage_id=stage_id,
                title="",
                body=fallback_body,
            ),
        )
    return out


def normalize_material_stage_items_from_storage(
    raw: dict[str, Any] | None,
    fallback_stages: dict[str, str] | None = None,
) -> dict[str, list[dict[str, str]]]:
    out = default_material_stage_items()
    fallback = fallback_stages or {}
    for stage_id in MATERIAL_STAGE_KEYS:
        if raw is not None:
            out[stage_id] = normalize_material_stage_entries(
                stage_id,
                raw.get(stage_id),
                "",
            )
        else:
            out[stage_id] = normalize_material_stage_entries(
                stage_id,
                None,
                str(fallback.get(stage_id, "") or ""),
            )
    return out


def material_stage_items_to_stages(
    stage_items: dict[str, list[dict[str, Any]]] | None,
) -> dict[str, str]:
    stages = default_material_stages()
    if not stage_items:
        return stages
    for stage_id in MATERIAL_STAGE_KEYS:
        blocks: list[str] = []
        for item in stage_items.get(stage_id, []):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            body = str(item.get("body") or "")
            if not title and not body.strip():
                continue
            if title:
                blocks.append(f"# {title}\n\n{body}".strip())
            else:
                blocks.append(body.strip())
        stages[stage_id] = "\n\n---\n\n".join(blocks)
    return stages


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
    source_skill_id: Any | None = None,
    source_skill_entry_id: Any | None = None,
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
    source_library_id = str(source_skill_id or "").strip()
    if source_library_id:
        item["source_skill_id"] = source_library_id
    source_entry_id = str(source_skill_entry_id or "").strip()
    if source_entry_id:
        item["source_skill_entry_id"] = source_entry_id
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
                        source_skill_id=item.get("source_skill_id"),
                        source_skill_entry_id=item.get("source_skill_entry_id"),
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
                    source_skill_id=raw.get("source_skill_id"),
                    source_skill_entry_id=raw.get("source_skill_entry_id"),
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
    material_kind: str = "mixed"
    parent_genre: str = ""  # 世情/情感（仅short时有效）
    sub_genre: str = ""     # legacy: 旧版子分类；新建素材不再填写
    overview: str = ""
    stages: dict[str, str] = field(default_factory=default_material_stages)
    stage_items: dict[str, list[dict[str, str]]] = field(
        default_factory=default_material_stage_items
    )
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
        raw_stage_items = data.get("stage_items")
        normalized_stage_items = normalize_material_stage_items_from_storage(
            raw_stage_items if isinstance(raw_stage_items, dict) else None,
            normalized_stages,
        )
        if raw_stage_items is not None:
            normalized_stages = material_stage_items_to_stages(normalized_stage_items)

        return cls(
            id=str(data["id"]),
            title=str(data["title"]),
            material_type=mt,  # type: ignore[arg-type]
            material_kind=normalize_material_kind(data.get("material_kind")),
            parent_genre=str(data.get("parent_genre") or ""),
            sub_genre=str(data.get("sub_genre") or ""),
            overview=str(data.get("overview") or ""),
            stages=normalized_stages,
            stage_items=normalized_stage_items,
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
    skill_kind: str = "general"
    overview: str = ""
    is_builtin: bool = False
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
            skill_kind=normalize_skill_kind(data.get("skill_kind")),
            overview=str(data.get("overview") or ""),
            is_builtin=normalize_bool(data.get("is_builtin")),
            stages=stages,
            output_dir=str(data.get("output_dir") or ""),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )
