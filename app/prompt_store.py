"""工作台系统提示模板：磁盘默认 + 用户数据 `.data/prompt_overrides` 覆盖。"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.runtime_paths import bundle_root, data_root

# --- 创作空间共享提示词管线，与工作台 TS 对齐 ---

SHORT_PREFIX = Path("short")
SHARED_WORKSPACE_PROMPT_DIR = "shared"
LEGACY_QINGGAN_PROMPT_DIR = "qinggan"
SHARED_PROMPT_MIGRATION_MARKER = ".shared_prompt_migration_from_qinggan_v1"

SHORT_STAGES_ORDER: tuple[str, ...] = (
    "character_design",
    "plot_design",
    "intro_design",
    "plot_refine",
    "outline",
    "draft",
)

EXPERT_DRAFT_COORDINATOR_AGENT_ID = "expert_draft_coordinator"
EXPERT_SECTION_WRITER_AGENT_ID = "expert_section_writer"
WORKSPACE_STAGE_AGENT_IDS: tuple[str, ...] = tuple(
    stage_id for stage_id in SHORT_STAGES_ORDER if stage_id != "draft"
)
WORKSPACE_AGENT_IDS: tuple[str, ...] = WORKSPACE_STAGE_AGENT_IDS + (
    EXPERT_DRAFT_COORDINATOR_AGENT_ID,
    EXPERT_SECTION_WRITER_AGENT_ID,
)

PEEK_EMPTY_MESSAGE = "（其它阶段暂无内容）"
OTHER_STAGES_PEER_MAX = 2000
STAGE_BODY_EXCERPT_CAP = 12000

_WORKSPACE_PLACEHOLDER_RE = re.compile(
    r"\{\{(BOOK_TITLE|BOOK_GENRE)\}\}"
)
_MATERIAL_PLACEHOLDER_RE = re.compile(
    r"\{\{(BOOK_TITLE|BOOK_LINE|MATERIAL_TITLE|MATERIAL_LINE|MATERIAL_TYPE|MATERIAL_GENRE|STAGE_ID|STAGE_LABEL|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}"
)
_SKILL_PLACEHOLDER_RE = re.compile(
    r"\{\{(BOOK_TITLE|BOOK_LINE|SKILL_TITLE|SKILL_LINE|STAGE_ID|STAGE_LABEL|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}"
)


def excerpt(text: str, _max_len: int = STAGE_BODY_EXCERPT_CAP) -> str:
    stripped = text.strip()
    return stripped if stripped else "（暂无）"


def validate_workspace_agent_id(agent_id: str) -> None:
    if agent_id not in WORKSPACE_AGENT_IDS:
        raise ValueError(f"未知的 workspace_agent_id: {agent_id!r}")


def validate_workspace_stage_id(stage_id: str) -> None:
    if stage_id not in SHORT_STAGES_ORDER:
        raise ValueError(f"未知的 stage_id: {stage_id!r}")


def _workspace_override_root() -> Path:
    return data_root() / "prompt_overrides" / SHORT_PREFIX


def workspace_agent_override_absolute_path(agent_id: str) -> Path:
    validate_workspace_agent_id(agent_id)
    return (
        _workspace_override_root()
        / SHARED_WORKSPACE_PROMPT_DIR
        / f"{agent_id}.txt"
    ).resolve()


def workspace_agent_builtin_default_path(agent_id: str) -> Path:
    validate_workspace_agent_id(agent_id)
    return (
        bundle_root()
        / "app"
        / "prompt_defaults"
        / SHORT_PREFIX
        / SHARED_WORKSPACE_PROMPT_DIR
        / f"{agent_id}.txt"
    )


def _ensure_shared_prompt_override_migrated() -> None:
    """首次使用共享提示词时，将现有追妻覆盖复制到共享目录。"""
    root = _workspace_override_root()
    marker = root / SHARED_PROMPT_MIGRATION_MARKER
    if marker.is_file():
        return
    try:
        shared_root = root / SHARED_WORKSPACE_PROMPT_DIR
        legacy_root = root / LEGACY_QINGGAN_PROMPT_DIR
        shared_root.mkdir(parents=True, exist_ok=True)
        for agent_id in WORKSPACE_AGENT_IDS:
            source = legacy_root / f"{agent_id}.txt"
            target = shared_root / f"{agent_id}.txt"
            if source.is_file() and not target.exists():
                target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        marker.write_text("migrated\n", encoding="utf-8")
    except OSError:
        # 只读环境仍应允许读取内置默认；后续可写时会再次尝试迁移。
        return


def resolve_workspace_agent_read_path(agent_id: str) -> Path:
    """共享覆盖优先。"""
    _ensure_shared_prompt_override_migrated()
    over = workspace_agent_override_absolute_path(agent_id)
    if over.is_file():
        return over
    return workspace_agent_builtin_default_path(agent_id)


def read_workspace_agent_prompt_template(agent_id: str) -> str:
    path = resolve_workspace_agent_read_path(agent_id)
    if not path.is_file():
        return (
            f"[缺少默认创作空间提示模板文件]\n路径: {path}\n\n"
            "请 reinstall 或补齐 app/prompt_defaults 下的同名 .txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    return text[:-1] if text.endswith("\n") else text


def save_workspace_agent_prompt_override(agent_id: str, body: str) -> None:
    _ensure_shared_prompt_override_migrated()
    path = workspace_agent_override_absolute_path(agent_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def reset_workspace_agent_prompt_override(agent_id: str) -> bool:
    _ensure_shared_prompt_override_migrated()
    path = workspace_agent_override_absolute_path(agent_id)
    if path.is_file():
        path.unlink()
        return True
    return False


def render_workspace_system_prompt(
    stage_id: str,
    *,
    book_title: str,
    book_genre: str,
    stage_body: str,
    all_stages_for_peek: dict[str, str] | None = None,
) -> str:
    validate_workspace_stage_id(stage_id)
    template_id = (
        EXPERT_DRAFT_COORDINATOR_AGENT_ID if stage_id == "draft" else stage_id
    )
    raw = read_workspace_agent_prompt_template(template_id)

    title = (book_title or "").strip()
    genre = (book_genre or "").strip() or "未分类"
    replacements = {
        "BOOK_TITLE": title,
        "BOOK_GENRE": genre,
    }

    def repl(m: re.Match[str]) -> str:
        return replacements[m.group(1)]

    return _WORKSPACE_PLACEHOLDER_RE.sub(repl, raw)


def parse_context_payload(context_raw: object) -> dict[str, object]:
    if isinstance(context_raw, dict):
        return context_raw  # pywebview sometimes passes dict
    if isinstance(context_raw, str):
        if not context_raw.strip():
            return {}
        try:
            return dict(json.loads(context_raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"context_json 无效 JSON：{exc}") from exc
    raise TypeError("context 须为 dict 或 JSON 字符串")


def render_from_api_context(stage_id: str, context_raw: object) -> str:
    ctx = parse_context_payload(context_raw)
    title = str(ctx.get("book_title") or "")
    genre = str(ctx.get("book_genre") or "")

    return render_workspace_system_prompt(
        stage_id,
        book_title=title,
        book_genre=genre,
        stage_body="",
        all_stages_for_peek=None,
    )


def read_raw_workspace_agent_prompt_for_editor(agent_id: str) -> str:
    """设置页读取当前生效来源（优先共享覆盖）的原始模板正文。"""
    path = resolve_workspace_agent_read_path(agent_id)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    return text[:-1] if text.endswith("\n") else text


# ==================== 素材库提示词管线 ====================

MATERIAL_PREFIX = Path("material")
MATERIAL_MANAGER_AGENT_ID = "material_manager"
MATERIAL_MANAGER_PROMPT_KIND = "material_manager"
SHARED_MATERIAL_PROMPT_DIR = "shared"

# 素材阶段顺序（人设/导语/梗/剧情细化/剧情设计/正文片段），对齐 app/models.py MATERIAL_STAGE_KEYS
MATERIAL_STAGES_ORDER: tuple[str, ...] = (
    "character",
    "intro",
    "gimmick",
    "plot_refine",
    "pacing",
    "draft_excerpt",
)

MATERIAL_STAGE_LABELS: dict[str, str] = {
    "character": "人设素材",
    "intro": "导语素材",
    "gimmick": "梗素材",
    "plot_refine": "剧情细化素材",
    "pacing": "剧情设计素材",
    "draft_excerpt": "正文片段",
}

# 新版素材库只保留一个「素材库管理智能体」；旧 kind 仅作为桥接兼容入口。
VALID_MATERIAL_PROMPT_KINDS: frozenset[str] = frozenset(
    {
        MATERIAL_MANAGER_PROMPT_KIND,
        "material_long",
        "material_short_shiqing",
        "material_short_qinggan",
        "material_short_kehuan",
        "material_short_xuanyi",
    }
)


def _peek_material_other_stages(
    exclude_stage_id: str,
    all_stages: dict[str, str],
    *,
    peer_max: int | None,
) -> str:
    cap = peer_max if peer_max is not None else OTHER_STAGES_PEER_MAX
    lines: list[str] = []
    for sid in MATERIAL_STAGES_ORDER:
        if sid == exclude_stage_id:
            continue
        raw = str(all_stages.get(sid) or "").strip()
        if not raw:
            continue
        lbl = MATERIAL_STAGE_LABELS.get(sid, sid)
        excerpted = excerpt(raw, cap)
        lines.append(f"【{lbl}】\n{excerpted}")
    return "\n\n".join(lines) if lines else PEEK_EMPTY_MESSAGE


def peek_material_other_for_render(
    exclude_stage_id: str,
    all_stages: dict[str, str],
) -> str:
    return _peek_material_other_stages(
        exclude_stage_id, all_stages, peer_max=OTHER_STAGES_PEER_MAX
    )


def validate_material_slot(prompt_kind: str, stage_id: str) -> None:
    if prompt_kind not in VALID_MATERIAL_PROMPT_KINDS:
        raise ValueError(f"未知的 material prompt_kind: {prompt_kind!r}")
    if stage_id not in MATERIAL_STAGES_ORDER:
        raise ValueError(f"未知的 material stage_id: {stage_id!r}")


def material_agent_override_absolute_path() -> Path:
    root = data_root() / "prompt_overrides" / MATERIAL_PREFIX
    return (
        root
        / SHARED_MATERIAL_PROMPT_DIR
        / f"{MATERIAL_MANAGER_AGENT_ID}.txt"
    ).resolve()


def material_agent_builtin_default_path() -> Path:
    return (
        (bundle_root() / "app" / "prompt_defaults" / MATERIAL_PREFIX)
        / SHARED_MATERIAL_PROMPT_DIR
        / f"{MATERIAL_MANAGER_AGENT_ID}.txt"
    )


def resolve_material_agent_read_path() -> Path:
    """覆盖优先。"""
    over = material_agent_override_absolute_path()
    if over.is_file():
        return over
    return material_agent_builtin_default_path()


def read_material_agent_prompt_template() -> str:
    path = resolve_material_agent_read_path()
    if not path.is_file():
        return (
            f"[缺少素材默认提示模板文件]\n路径: {path}\n\n"
            "请补齐 app/prompt_defaults/material/shared/material_manager.txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def save_material_agent_prompt_override(body: str) -> None:
    path = material_agent_override_absolute_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def reset_material_agent_prompt_override() -> bool:
    path = material_agent_override_absolute_path()
    if path.is_file():
        path.unlink()
        return True
    return False


def read_material_prompt_template(prompt_kind: str, stage_id: str) -> str:
    """兼容旧 API：素材库不再按 kind/stage 拆分模板。"""
    validate_material_slot(prompt_kind, stage_id)
    return read_material_agent_prompt_template()


def save_material_prompt_override(prompt_kind: str, stage_id: str, body: str) -> None:
    """兼容旧 API：写入唯一的素材库管理智能体模板。"""
    validate_material_slot(prompt_kind, stage_id)
    save_material_agent_prompt_override(body)


def reset_material_prompt_override(prompt_kind: str, stage_id: str) -> bool:
    """兼容旧 API：重置唯一的素材库管理智能体模板。"""
    validate_material_slot(prompt_kind, stage_id)
    return reset_material_agent_prompt_override()


def render_material_system_prompt(
    prompt_kind: str,
    stage_id: str,
    *,
    book_title: str,
    material_type: str = "",
    material_genre: str = "",
    stage_body: str,
    other_stages_excerpt: str | None = None,
    all_stages_for_peek: dict[str, str] | None = None,
) -> str:
    validate_material_slot(prompt_kind, stage_id)
    raw = read_material_agent_prompt_template()

    staged_body = excerpt(stage_body, STAGE_BODY_EXCERPT_CAP)
    if other_stages_excerpt is None:
        if all_stages_for_peek is None:
            other = ""
        else:
            other = peek_material_other_for_render(stage_id, all_stages_for_peek)
    else:
        other = other_stages_excerpt

    title = (book_title or "").strip()
    stage_label = MATERIAL_STAGE_LABELS.get(stage_id, stage_id)
    replacements = {
        "BOOK_TITLE": title,
        "BOOK_LINE": f"素材：《{title}》",
        "MATERIAL_TITLE": title,
        "MATERIAL_LINE": f"素材：《{title}》",
        "MATERIAL_TYPE": (material_type or "").strip() or "未分类素材",
        "MATERIAL_GENRE": (material_genre or "").strip() or "未分类",
        "STAGE_ID": stage_id,
        "STAGE_LABEL": stage_label,
        "STAGE_BODY": staged_body,
        "OTHER_STAGES_EXCERPT": other,
    }

    def repl(m: re.Match[str]) -> str:
        key = m.group(1)
        return replacements[key]

    return _MATERIAL_PLACEHOLDER_RE.sub(repl, raw)


def render_material_from_api_context(
    prompt_kind: str, stage_id: str, context_raw: object
) -> str:
    ctx = parse_context_payload(context_raw)
    title = str(ctx.get("material_title") or ctx.get("book_title") or "")
    material_type = str(ctx.get("material_type") or "")
    material_genre = str(ctx.get("material_genre") or "")
    if not material_genre:
        parts = [
            str(ctx.get("parent_genre") or "").strip(),
            str(ctx.get("sub_genre") or "").strip(),
        ]
        material_genre = " · ".join([part for part in parts if part])
    body = str(ctx.get("stage_body") or "")
    all_stages: dict[str, str] | None = None
    stages_val = ctx.get("all_stages")
    if isinstance(stages_val, dict):
        all_stages = {str(k): str(v if v is not None else "") for k, v in stages_val.items()}

    other_override = ctx.get("other_stages_excerpt_override")
    if other_override is not None:
        return render_material_system_prompt(
            prompt_kind,
            stage_id,
            book_title=title,
            material_type=material_type,
            material_genre=material_genre,
            stage_body=body,
            other_stages_excerpt=str(other_override),
        )
    return render_material_system_prompt(
        prompt_kind,
        stage_id,
        book_title=title,
        material_type=material_type,
        material_genre=material_genre,
        stage_body=body,
        all_stages_for_peek=all_stages if all_stages is not None else {},
    )


def read_raw_material_agent_prompt_for_editor() -> str:
    """素材库智能体设置页读取当前生效来源（优先覆盖）的原始模板正文。"""
    path = resolve_material_agent_read_path()
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def read_raw_material_prompt_for_editor(prompt_kind: str, stage_id: str) -> str:
    """兼容旧 API：读取唯一的素材库管理智能体模板。"""
    validate_material_slot(prompt_kind, stage_id)
    return read_raw_material_agent_prompt_for_editor()


# ==================== 技能库提示词管线 ====================

SKILL_PREFIX = Path("skill")
SKILL_MANAGER_AGENT_ID = "skill_manager"
SKILL_MANAGER_PROMPT_KIND = "skill_manager"
SHARED_SKILL_PROMPT_DIR = "shared"

SKILL_STAGES_ORDER: tuple[str, ...] = (
    "character_design",
    "plot_design",
    "intro_design",
    "plot_refine",
    "outline",
    "draft",
    "expert_section_writer",
)

SKILL_STAGE_LABELS: dict[str, str] = {
    "character_design": "人物设计技能",
    "plot_design": "剧情设计技能",
    "intro_design": "导语设计技能",
    "plot_refine": "剧情细化技能",
    "outline": "大纲纲要技能",
    "draft": "正文专家编写技能",
    "expert_section_writer": "分节写手技能",
}


def _peek_skill_other_stages(
    exclude_stage_id: str,
    all_stages: dict[str, str],
    *,
    peer_max: int | None,
) -> str:
    cap = peer_max if peer_max is not None else OTHER_STAGES_PEER_MAX
    lines: list[str] = []
    for sid in SKILL_STAGES_ORDER:
        if sid == exclude_stage_id:
            continue
        raw = str(all_stages.get(sid) or "").strip()
        if not raw:
            continue
        lbl = SKILL_STAGE_LABELS.get(sid, sid)
        excerpted = excerpt(raw, cap)
        lines.append(f"【{lbl}】\n{excerpted}")
    return "\n\n".join(lines) if lines else PEEK_EMPTY_MESSAGE


def validate_skill_stage_id(stage_id: str) -> None:
    if stage_id not in SKILL_STAGES_ORDER:
        raise ValueError(f"未知的 skill stage_id: {stage_id!r}")


def skill_agent_override_absolute_path() -> Path:
    root = data_root() / "prompt_overrides" / SKILL_PREFIX
    return (
        root
        / SHARED_SKILL_PROMPT_DIR
        / f"{SKILL_MANAGER_AGENT_ID}.txt"
    ).resolve()


def skill_agent_builtin_default_path() -> Path:
    return (
        (bundle_root() / "app" / "prompt_defaults" / SKILL_PREFIX)
        / SHARED_SKILL_PROMPT_DIR
        / f"{SKILL_MANAGER_AGENT_ID}.txt"
    )


def resolve_skill_agent_read_path() -> Path:
    """覆盖优先。"""
    over = skill_agent_override_absolute_path()
    if over.is_file():
        return over
    return skill_agent_builtin_default_path()


def read_skill_agent_prompt_template() -> str:
    path = resolve_skill_agent_read_path()
    if not path.is_file():
        return (
            f"[缺少技能默认提示模板文件]\n路径: {path}\n\n"
            "请补齐 app/prompt_defaults/skill/shared/skill_manager.txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def save_skill_agent_prompt_override(body: str) -> None:
    path = skill_agent_override_absolute_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def reset_skill_agent_prompt_override() -> bool:
    path = skill_agent_override_absolute_path()
    if path.is_file():
        path.unlink()
        return True
    return False


def render_skill_system_prompt(
    stage_id: str,
    *,
    skill_title: str,
    stage_body: str,
    all_stages_for_peek: dict[str, str] | None = None,
) -> str:
    validate_skill_stage_id(stage_id)
    raw = read_skill_agent_prompt_template()

    staged_body = excerpt(stage_body, STAGE_BODY_EXCERPT_CAP)
    other = (
        ""
        if all_stages_for_peek is None
        else _peek_skill_other_stages(
            stage_id,
            all_stages_for_peek,
            peer_max=OTHER_STAGES_PEER_MAX,
        )
    )

    title = (skill_title or "").strip()
    stage_label = SKILL_STAGE_LABELS.get(stage_id, stage_id)
    replacements = {
        "BOOK_TITLE": title,
        "BOOK_LINE": f"技能：《{title}》",
        "SKILL_TITLE": title,
        "SKILL_LINE": f"技能：《{title}》",
        "STAGE_ID": stage_id,
        "STAGE_LABEL": stage_label,
        "STAGE_BODY": staged_body,
        "OTHER_STAGES_EXCERPT": other,
    }

    def repl(m: re.Match[str]) -> str:
        return replacements[m.group(1)]

    return _SKILL_PLACEHOLDER_RE.sub(repl, raw)


def render_skill_from_api_context(stage_id: str, context_raw: object) -> str:
    ctx = parse_context_payload(context_raw)
    title = str(ctx.get("skill_title") or ctx.get("book_title") or "")
    body = str(ctx.get("stage_body") or "")
    all_stages: dict[str, str] | None = None
    stages_val = ctx.get("all_stages")
    if isinstance(stages_val, dict):
        all_stages = {str(k): str(v if v is not None else "") for k, v in stages_val.items()}

    return render_skill_system_prompt(
        stage_id,
        skill_title=title,
        stage_body=body,
        all_stages_for_peek=all_stages if all_stages is not None else {},
    )


def read_raw_skill_agent_prompt_for_editor() -> str:
    """技能库智能体设置页读取当前生效来源（优先覆盖）的原始模板正文。"""
    path = resolve_skill_agent_read_path()
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text
