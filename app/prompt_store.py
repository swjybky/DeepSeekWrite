"""工作台系统提示模板：磁盘默认 + 用户数据 `.data/prompt_overrides` 覆盖。"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

from app.models import LONG_STAGE_KEYS, is_long_stage_key
from app.runtime_paths import bundle_root, data_root, is_frozen

# --- 创作空间共享提示词管线，与工作台 TS 对齐 ---

SHORT_PREFIX = Path("short")
SCRIPT_PREFIX = Path("script")
LONG_PREFIX = Path("long")
SHARED_WORKSPACE_PROMPT_DIR = "shared"
LEGACY_QINGGAN_PROMPT_DIR = "qinggan"
SHARED_PROMPT_MIGRATION_MARKER = ".shared_prompt_migration_from_qinggan_v1"
PLOT_PROMPT_MERGE_MARKER = ".plot_prompt_merge_v1"
SCRIPT_PROMPT_SEED_MARKER = ".script_prompt_seed_from_short_v1"

SHORT_STAGES_ORDER: tuple[str, ...] = (
    "character_design",
    "plot_design",
    "intro_design",
    "plot_refine",
    "outline",
    "draft",
)

SCRIPT_STAGES_ORDER: tuple[str, ...] = tuple(
    stage_id for stage_id in SHORT_STAGES_ORDER if stage_id != "intro_design"
)

LONG_STAGES_ORDER: tuple[str, ...] = LONG_STAGE_KEYS
LONG_WORKSPACE_AGENT_IDS: tuple[str, ...] = (
    "worldbuilding",
    "character_design",
    "plot_design",
    "draft",
    "continuity_ledger",
)

EXPERT_DRAFT_COORDINATOR_AGENT_ID = "expert_draft_coordinator"
EXPERT_SECTION_WRITER_AGENT_ID = "expert_section_writer"
WORKSPACE_STAGE_AGENT_IDS: tuple[str, ...] = tuple(
    stage_id
    for stage_id in SHORT_STAGES_ORDER
    if stage_id not in {"draft", "intro_design", "plot_refine"}
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
    r"\{\{(BOOK_TITLE|BOOK_LINE|SKILL_TITLE|SKILL_LINE|SKILL_TYPE|STAGE_ID|STAGE_LABEL|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}"
)
_LEARNING_IMITATION_PLACEHOLDER_RE = re.compile(
    r"\{\{(STAGE_ID|STAGE_LABEL|DOCUMENT_COUNT|DOCUMENTS_SUMMARY|CURRENT_RESULT)\}\}"
)


def excerpt(text: str, _max_len: int = STAGE_BODY_EXCERPT_CAP) -> str:
    stripped = text.strip()
    return stripped if stripped else "（暂无）"


def workspace_agent_ids_for_type(workspace_type: str | None = None) -> tuple[str, ...]:
    return (
        LONG_WORKSPACE_AGENT_IDS
        if normalize_workspace_prompt_type(workspace_type) == "long"
        else WORKSPACE_AGENT_IDS
    )


def validate_workspace_agent_id(
    agent_id: str,
    workspace_type: str | None = None,
) -> None:
    if agent_id not in workspace_agent_ids_for_type(workspace_type):
        raise ValueError(f"未知的 workspace_agent_id: {agent_id!r}")


def validate_workspace_stage_id(
    stage_id: str,
    workspace_type: str | None = None,
) -> None:
    prompt_type = normalize_workspace_prompt_type(workspace_type)
    if prompt_type == "long":
        if stage_id not in LONG_WORKSPACE_AGENT_IDS and not is_long_stage_key(stage_id):
            raise ValueError(f"未知的 stage_id: {stage_id!r}")
        return
    order = SCRIPT_STAGES_ORDER if prompt_type == "script" else SHORT_STAGES_ORDER
    if stage_id not in order:
        raise ValueError(f"未知的 stage_id: {stage_id!r}")


def normalize_workspace_prompt_type(raw: str | None = None) -> str:
    value = str(raw or "").strip()
    if value == "long":
        return "long"
    return "script" if value == "script" else "short"


def _workspace_prefix(workspace_type: str | None = None) -> Path:
    prompt_type = normalize_workspace_prompt_type(workspace_type)
    if prompt_type == "long":
        return LONG_PREFIX
    return SCRIPT_PREFIX if prompt_type == "script" else SHORT_PREFIX


def _workspace_override_root(workspace_type: str | None = None) -> Path:
    return data_root() / "prompt_overrides" / _workspace_prefix(workspace_type)


def workspace_agent_override_absolute_path(
    agent_id: str,
    workspace_type: str | None = None,
) -> Path:
    validate_workspace_agent_id(agent_id, workspace_type)
    return (
        _workspace_override_root(workspace_type)
        / SHARED_WORKSPACE_PROMPT_DIR
        / f"{agent_id}.txt"
    ).resolve()


def workspace_agent_builtin_default_path(
    agent_id: str,
    workspace_type: str | None = None,
) -> Path:
    validate_workspace_agent_id(agent_id, workspace_type)
    return (
        bundle_root()
        / "app"
        / "prompt_defaults"
        / _workspace_prefix(workspace_type)
        / SHARED_WORKSPACE_PROMPT_DIR
        / f"{agent_id}.txt"
    )


def _write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=f".{path.stem}_",
        suffix=f"{path.suffix}.tmp",
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


def _ensure_shared_prompt_override_migrated() -> None:
    """首次使用共享提示词时，将现有追妻覆盖复制到共享目录。"""
    root = _workspace_override_root("short")
    marker = root / SHARED_PROMPT_MIGRATION_MARKER
    if marker.is_file():
        _ensure_plot_prompt_override_merged()
        return
    try:
        shared_root = root / SHARED_WORKSPACE_PROMPT_DIR
        legacy_root = root / LEGACY_QINGGAN_PROMPT_DIR
        shared_root.mkdir(parents=True, exist_ok=True)
        for agent_id in (*WORKSPACE_AGENT_IDS, "intro_design", "plot_refine"):
            source = legacy_root / f"{agent_id}.txt"
            target = shared_root / f"{agent_id}.txt"
            if source.is_file() and not target.exists():
                target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
        marker.write_text("migrated\n", encoding="utf-8")
    except OSError:
        # 只读环境仍应允许读取内置默认；后续可写时会再次尝试迁移。
        return
    _ensure_plot_prompt_override_merged()


def _ensure_plot_prompt_override_merged() -> None:
    """将旧剧情设计/导语设计/剧情细化提示词覆盖合并为剧情提示词。"""
    root = _workspace_override_root("short")
    marker = root / PLOT_PROMPT_MERGE_MARKER
    if marker.is_file():
        return
    try:
        shared_root = root / SHARED_WORKSPACE_PROMPT_DIR
        shared_root.mkdir(parents=True, exist_ok=True)
        sources = (
            ("plot_design", "剧情设计"),
            ("intro_design", "导语设计"),
            ("plot_refine", "剧情细化"),
        )
        sections: list[str] = []
        for agent_id, label in sources:
            path = shared_root / f"{agent_id}.txt"
            if not path.is_file():
                continue
            body = path.read_text(encoding="utf-8").strip()
            if body:
                sections.append(f"## {label}\n\n{body}")
        if sections:
            target = shared_root / "plot_design.txt"
            target.write_text("\n\n---\n\n".join(sections) + "\n", encoding="utf-8")
        marker.write_text("merged\n", encoding="utf-8")
    except OSError:
        return


def _ensure_script_prompt_overrides_seeded() -> None:
    """剧本提示词首次使用时，从短篇当前生效提示词复制一份独立覆盖。"""
    root = _workspace_override_root("script")
    marker = root / SCRIPT_PROMPT_SEED_MARKER
    if marker.is_file():
        return
    try:
        shared_root = root / SHARED_WORKSPACE_PROMPT_DIR
        shared_root.mkdir(parents=True, exist_ok=True)
        for agent_id in WORKSPACE_AGENT_IDS:
            target = shared_root / f"{agent_id}.txt"
            if target.exists():
                continue
            body = read_workspace_agent_prompt_template(agent_id, "short")
            target.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")
        marker.write_text("seeded\n", encoding="utf-8")
    except OSError:
        return


def _ensure_workspace_prompt_prepared(workspace_type: str | None = None) -> None:
    prompt_type = normalize_workspace_prompt_type(workspace_type)
    if prompt_type == "long":
        return
    if prompt_type == "script":
        _ensure_script_prompt_overrides_seeded()
        return
    _ensure_shared_prompt_override_migrated()
    _ensure_plot_prompt_override_merged()


def resolve_workspace_agent_read_path(
    agent_id: str,
    workspace_type: str | None = None,
) -> Path:
    """共享覆盖优先。"""
    _ensure_workspace_prompt_prepared(workspace_type)
    over = workspace_agent_override_absolute_path(agent_id, workspace_type)
    if over.is_file():
        return over
    return workspace_agent_builtin_default_path(agent_id, workspace_type)


def read_workspace_agent_prompt_template(
    agent_id: str,
    workspace_type: str | None = None,
) -> str:
    path = resolve_workspace_agent_read_path(agent_id, workspace_type)
    if not path.is_file():
        return (
            f"[缺少默认创作空间提示模板文件]\n路径: {path}\n\n"
            "请 reinstall 或补齐 app/prompt_defaults 下的同名 .txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    return text[:-1] if text.endswith("\n") else text


def save_workspace_agent_prompt_override(
    agent_id: str,
    body: str,
    workspace_type: str | None = None,
) -> None:
    _ensure_workspace_prompt_prepared(workspace_type)
    path = workspace_agent_override_absolute_path(agent_id, workspace_type)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def reset_workspace_agent_prompt_override(
    agent_id: str,
    workspace_type: str | None = None,
) -> bool:
    _ensure_workspace_prompt_prepared(workspace_type)
    path = workspace_agent_override_absolute_path(agent_id, workspace_type)
    if path.is_file():
        path.unlink()
        return True
    return False


def _long_workspace_agent_id_for_stage(stage_id: str) -> str:
    if stage_id in LONG_WORKSPACE_AGENT_IDS:
        return stage_id
    if stage_id.startswith("worldbuilding."):
        return "worldbuilding"
    if stage_id.startswith("character_design."):
        return "character_design"
    if stage_id.startswith("plot_design."):
        return "plot_design"
    if stage_id.startswith("continuity_ledger."):
        return "continuity_ledger"
    return "draft"


def render_workspace_system_prompt(
    stage_id: str,
    *,
    workspace_type: str | None = None,
    book_title: str,
    book_genre: str,
    stage_body: str,
    all_stages_for_peek: dict[str, str] | None = None,
) -> str:
    prompt_type = normalize_workspace_prompt_type(workspace_type)
    validate_workspace_stage_id(stage_id, prompt_type)
    if prompt_type == "long":
        template_id = _long_workspace_agent_id_for_stage(stage_id)
    else:
        template_id = (
            EXPERT_DRAFT_COORDINATOR_AGENT_ID if stage_id == "draft" else stage_id
        )
        if template_id in {"intro_design", "plot_refine"}:
            template_id = "plot_design"
    raw = read_workspace_agent_prompt_template(template_id, workspace_type)

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


def render_from_api_context(
    stage_id: str,
    context_raw: object,
    workspace_type: str | None = None,
) -> str:
    ctx = parse_context_payload(context_raw)
    title = str(ctx.get("book_title") or "")
    genre = str(ctx.get("book_genre") or "")
    prompt_type = workspace_type or str(ctx.get("workspace_type") or "")

    return render_workspace_system_prompt(
        stage_id,
        workspace_type=prompt_type,
        book_title=title,
        book_genre=genre,
        stage_body="",
        all_stages_for_peek=None,
    )


def read_raw_workspace_agent_prompt_for_editor(
    agent_id: str,
    workspace_type: str | None = None,
) -> str:
    """设置页读取当前生效来源（优先共享覆盖）的原始模板正文。"""
    path = resolve_workspace_agent_read_path(agent_id, workspace_type)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    return text[:-1] if text.endswith("\n") else text


def sync_workspace_prompt_defaults(
    workspace_type: str | None = None,
) -> dict[str, str]:
    """将当前生效的创作空间提示词同步为内置默认 .txt 文件。"""
    if is_frozen():
        raise RuntimeError("已打包环境下无法同步源码默认配置，请在源码运行模式下操作。")

    normalized = normalize_workspace_prompt_type(workspace_type)
    _ensure_workspace_prompt_prepared(normalized)

    synced: dict[str, str] = {}
    for agent_id in workspace_agent_ids_for_type(normalized):
        source_path = resolve_workspace_agent_read_path(agent_id, normalized)
        if not source_path.is_file():
            raise FileNotFoundError(f"缺少创作空间提示词模板: {source_path}")
        target_path = workspace_agent_builtin_default_path(agent_id, normalized)
        text = source_path.read_text(encoding="utf-8")
        _write_text_atomic(
            target_path,
            text if text.endswith("\n") else text + "\n",
        )
        synced[agent_id] = str(target_path)
    return synced


# ==================== 素材库提示词管线 ====================

MATERIAL_PREFIX = Path("material")
MATERIAL_MANAGER_AGENT_ID = "material_manager"
MATERIAL_MANAGER_PROMPT_KIND = "material_manager"
SHARED_MATERIAL_PROMPT_DIR = "shared"
LIBRARY_PROMPT_TYPES: frozenset[str] = frozenset({"short", "long", "script"})

# 素材阶段顺序（梗/人设/剧情设计/导语设计/剧情细化/优秀正文片段），对齐 app/models.py MATERIAL_STAGE_KEYS
MATERIAL_STAGES_ORDER: tuple[str, ...] = (
    "gimmick",
    "character",
    "pacing",
    "intro",
    "plot_refine",
    "draft_excerpt",
)

MATERIAL_STAGE_LABELS: dict[str, str] = {
    "gimmick": "梗",
    "character": "人设",
    "pacing": "剧情设计",
    "intro": "导语设计",
    "plot_refine": "剧情细化",
    "draft_excerpt": "优秀正文片段",
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


def normalize_library_prompt_type(raw: str | None = None) -> str:
    value = str(raw or "").strip()
    if value in LIBRARY_PROMPT_TYPES:
        return value
    if "剧本" in value:
        return "script"
    if "长篇" in value:
        return "long"
    return "short"


def library_prompt_type_label(raw: str | None = None) -> str:
    normalized = normalize_library_prompt_type(raw)
    if normalized == "script":
        return "剧本"
    if normalized == "long":
        return "长篇"
    return "短篇"


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


def material_agent_override_absolute_path(material_type: str | None = None) -> Path:
    root = data_root() / "prompt_overrides" / MATERIAL_PREFIX
    return (
        root
        / normalize_library_prompt_type(material_type)
        / SHARED_MATERIAL_PROMPT_DIR
        / f"{MATERIAL_MANAGER_AGENT_ID}.txt"
    ).resolve()


def material_agent_builtin_default_path(material_type: str | None = None) -> Path:
    return (
        (bundle_root() / "app" / "prompt_defaults" / MATERIAL_PREFIX)
        / normalize_library_prompt_type(material_type)
        / SHARED_MATERIAL_PROMPT_DIR
        / f"{MATERIAL_MANAGER_AGENT_ID}.txt"
    )


def material_agent_legacy_builtin_default_path() -> Path:
    return (
        (bundle_root() / "app" / "prompt_defaults" / MATERIAL_PREFIX)
        / SHARED_MATERIAL_PROMPT_DIR
        / f"{MATERIAL_MANAGER_AGENT_ID}.txt"
    )


def resolve_material_agent_read_path(material_type: str | None = None) -> Path:
    """覆盖优先。"""
    over = material_agent_override_absolute_path(material_type)
    if over.is_file():
        return over
    default = material_agent_builtin_default_path(material_type)
    if default.is_file():
        return default
    return material_agent_legacy_builtin_default_path()


def read_material_agent_prompt_template(material_type: str | None = None) -> str:
    path = resolve_material_agent_read_path(material_type)
    if not path.is_file():
        return (
            f"[缺少素材默认提示模板文件]\n路径: {path}\n\n"
            "请补齐 app/prompt_defaults/material/shared/material_manager.txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def save_material_agent_prompt_override(
    body: str,
    material_type: str | None = None,
) -> None:
    path = material_agent_override_absolute_path(material_type)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def reset_material_agent_prompt_override(material_type: str | None = None) -> bool:
    path = material_agent_override_absolute_path(material_type)
    if path.is_file():
        path.unlink()
        return True
    return False


def read_material_prompt_template(
    prompt_kind: str,
    stage_id: str,
    material_type: str | None = None,
) -> str:
    """兼容旧 API：素材库不再按 kind/stage 拆分模板。"""
    validate_material_slot(prompt_kind, stage_id)
    return read_material_agent_prompt_template(material_type)


def save_material_prompt_override(
    prompt_kind: str,
    stage_id: str,
    body: str,
    material_type: str | None = None,
) -> None:
    """兼容旧 API：写入唯一的素材库管理智能体模板。"""
    validate_material_slot(prompt_kind, stage_id)
    save_material_agent_prompt_override(body, material_type)


def reset_material_prompt_override(
    prompt_kind: str,
    stage_id: str,
    material_type: str | None = None,
) -> bool:
    """兼容旧 API：重置唯一的素材库管理智能体模板。"""
    validate_material_slot(prompt_kind, stage_id)
    return reset_material_agent_prompt_override(material_type)


def render_material_system_prompt(
    prompt_kind: str,
    stage_id: str,
    *,
    material_prompt_type: str | None = None,
    book_title: str,
    material_type: str = "",
    material_genre: str = "",
    stage_body: str,
    other_stages_excerpt: str | None = None,
    all_stages_for_peek: dict[str, str] | None = None,
) -> str:
    validate_material_slot(prompt_kind, stage_id)
    raw = read_material_agent_prompt_template(material_prompt_type)

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
    type_text = (material_type or "").strip() or (
        f"{library_prompt_type_label(material_prompt_type)}素材"
    )
    replacements = {
        "BOOK_TITLE": title,
        "BOOK_LINE": f"素材：《{title}》",
        "MATERIAL_TITLE": title,
        "MATERIAL_LINE": f"素材：《{title}》",
        "MATERIAL_TYPE": type_text,
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
    material_prompt_type = str(
        ctx.get("material_type_key")
        or ctx.get("material_prompt_type")
        or ctx.get("library_type")
        or ""
    )
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
            material_prompt_type=material_prompt_type or material_type,
            book_title=title,
            material_type=material_type,
            material_genre=material_genre,
            stage_body=body,
            other_stages_excerpt=str(other_override),
        )
    return render_material_system_prompt(
        prompt_kind,
        stage_id,
        material_prompt_type=material_prompt_type or material_type,
        book_title=title,
        material_type=material_type,
        material_genre=material_genre,
        stage_body=body,
        all_stages_for_peek=all_stages if all_stages is not None else {},
    )


def read_raw_material_agent_prompt_for_editor(material_type: str | None = None) -> str:
    """素材库智能体设置页读取当前生效来源（优先覆盖）的原始模板正文。"""
    path = resolve_material_agent_read_path(material_type)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def read_raw_material_prompt_for_editor(
    prompt_kind: str,
    stage_id: str,
    material_type: str | None = None,
) -> str:
    """兼容旧 API：读取唯一的素材库管理智能体模板。"""
    validate_material_slot(prompt_kind, stage_id)
    return read_raw_material_agent_prompt_for_editor(material_type)


# ==================== 技能库提示词管线 ====================

SKILL_PREFIX = Path("skill")
SKILL_MANAGER_AGENT_ID = "skill_manager"
SKILL_MANAGER_PROMPT_KIND = "skill_manager"
SHARED_SKILL_PROMPT_DIR = "shared"

SKILL_STAGES_ORDER: tuple[str, ...] = (
    "character_design",
    "plot_design",
    "outline",
    "draft",
    "expert_section_writer",
)

SKILL_STAGE_LABELS: dict[str, str] = {
    "character_design": "人物技能",
    "plot_design": "剧情技能",
    "outline": "大纲技能",
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


def skill_agent_override_absolute_path(skill_type: str | None = None) -> Path:
    root = data_root() / "prompt_overrides" / SKILL_PREFIX
    return (
        root
        / normalize_library_prompt_type(skill_type)
        / SHARED_SKILL_PROMPT_DIR
        / f"{SKILL_MANAGER_AGENT_ID}.txt"
    ).resolve()


def skill_agent_builtin_default_path(skill_type: str | None = None) -> Path:
    return (
        (bundle_root() / "app" / "prompt_defaults" / SKILL_PREFIX)
        / normalize_library_prompt_type(skill_type)
        / SHARED_SKILL_PROMPT_DIR
        / f"{SKILL_MANAGER_AGENT_ID}.txt"
    )


def skill_agent_legacy_builtin_default_path() -> Path:
    return (
        (bundle_root() / "app" / "prompt_defaults" / SKILL_PREFIX)
        / SHARED_SKILL_PROMPT_DIR
        / f"{SKILL_MANAGER_AGENT_ID}.txt"
    )


def resolve_skill_agent_read_path(skill_type: str | None = None) -> Path:
    """覆盖优先。"""
    over = skill_agent_override_absolute_path(skill_type)
    if over.is_file():
        return over
    default = skill_agent_builtin_default_path(skill_type)
    if default.is_file():
        return default
    return skill_agent_legacy_builtin_default_path()


def read_skill_agent_prompt_template(skill_type: str | None = None) -> str:
    path = resolve_skill_agent_read_path(skill_type)
    if not path.is_file():
        return (
            f"[缺少技能默认提示模板文件]\n路径: {path}\n\n"
            "请补齐 app/prompt_defaults/skill/shared/skill_manager.txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def save_skill_agent_prompt_override(body: str, skill_type: str | None = None) -> None:
    path = skill_agent_override_absolute_path(skill_type)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def reset_skill_agent_prompt_override(skill_type: str | None = None) -> bool:
    path = skill_agent_override_absolute_path(skill_type)
    if path.is_file():
        path.unlink()
        return True
    return False


def render_skill_system_prompt(
    stage_id: str,
    *,
    skill_type: str | None = None,
    skill_title: str,
    stage_body: str,
    all_stages_for_peek: dict[str, str] | None = None,
) -> str:
    if stage_id in {"intro_design", "plot_refine"}:
        stage_id = "plot_design"
    validate_skill_stage_id(stage_id)
    raw = read_skill_agent_prompt_template(skill_type)

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
        "SKILL_TYPE": f"{library_prompt_type_label(skill_type)}技能",
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
    skill_type = str(ctx.get("skill_type") or "")
    body = str(ctx.get("stage_body") or "")
    all_stages: dict[str, str] | None = None
    stages_val = ctx.get("all_stages")
    if isinstance(stages_val, dict):
        all_stages = {str(k): str(v if v is not None else "") for k, v in stages_val.items()}

    return render_skill_system_prompt(
        stage_id,
        skill_type=skill_type,
        skill_title=title,
        stage_body=body,
        all_stages_for_peek=all_stages if all_stages is not None else {},
    )


def read_raw_skill_agent_prompt_for_editor(skill_type: str | None = None) -> str:
    """技能库智能体设置页读取当前生效来源（优先覆盖）的原始模板正文。"""
    path = resolve_skill_agent_read_path(skill_type)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


# ==================== 学习仿写提示词管线 ====================

LEARNING_IMITATION_PREFIX = Path("learning_imitation")
LEARNING_IMITATION_SHARED_PROMPT_DIR = "shared"

LEARNING_IMITATION_STAGE_LABELS: dict[str, str] = {
    "material_split": "素材拆分",
    "plot_learning": "剧情设计学习",
    "style_learning": "文风学习",
}

LEARNING_IMITATION_STAGE_IDS: tuple[str, ...] = tuple(
    LEARNING_IMITATION_STAGE_LABELS.keys()
)


def validate_learning_imitation_stage_id(stage_id: str) -> None:
    if stage_id not in LEARNING_IMITATION_STAGE_IDS:
        raise ValueError(f"未知的 learning imitation stage_id: {stage_id!r}")


def learning_imitation_prompt_override_absolute_path(stage_id: str) -> Path:
    validate_learning_imitation_stage_id(stage_id)
    return (
        data_root()
        / "prompt_overrides"
        / LEARNING_IMITATION_PREFIX
        / LEARNING_IMITATION_SHARED_PROMPT_DIR
        / f"{stage_id}.txt"
    ).resolve()


def learning_imitation_prompt_builtin_default_path(stage_id: str) -> Path:
    validate_learning_imitation_stage_id(stage_id)
    return (
        bundle_root()
        / "app"
        / "prompt_defaults"
        / LEARNING_IMITATION_PREFIX
        / LEARNING_IMITATION_SHARED_PROMPT_DIR
        / f"{stage_id}.txt"
    )


def resolve_learning_imitation_prompt_read_path(stage_id: str) -> Path:
    over = learning_imitation_prompt_override_absolute_path(stage_id)
    if over.is_file():
        return over
    return learning_imitation_prompt_builtin_default_path(stage_id)


def read_learning_imitation_prompt_template(stage_id: str) -> str:
    path = resolve_learning_imitation_prompt_read_path(stage_id)
    if not path.is_file():
        return (
            f"[缺少学习仿写默认提示词模板文件]\n路径: {path}\n\n"
            "请补齐 app/prompt_defaults/learning_imitation/shared 下的同名 .txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def save_learning_imitation_prompt_override(stage_id: str, body: str) -> None:
    path = learning_imitation_prompt_override_absolute_path(stage_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def reset_learning_imitation_prompt_override(stage_id: str) -> bool:
    path = learning_imitation_prompt_override_absolute_path(stage_id)
    if path.is_file():
        path.unlink()
        return True
    return False


def render_learning_imitation_system_prompt(
    stage_id: str,
    *,
    document_count: int = 0,
    documents_summary: str = "",
    current_result: str = "",
) -> str:
    validate_learning_imitation_stage_id(stage_id)
    raw = read_learning_imitation_prompt_template(stage_id)
    replacements = {
        "STAGE_ID": stage_id,
        "STAGE_LABEL": LEARNING_IMITATION_STAGE_LABELS[stage_id],
        "DOCUMENT_COUNT": str(document_count),
        "DOCUMENTS_SUMMARY": documents_summary.strip() or "（尚未上传可分析文档）",
        "CURRENT_RESULT": current_result.strip() or "（当前阶段暂未生成结果）",
    }

    def repl(m: re.Match[str]) -> str:
        return replacements[m.group(1)]

    return _LEARNING_IMITATION_PLACEHOLDER_RE.sub(repl, raw)


def render_learning_imitation_from_api_context(
    stage_id: str,
    context_raw: object,
) -> str:
    ctx = parse_context_payload(context_raw)
    raw_count = ctx.get("document_count")
    try:
        document_count = int(raw_count) if raw_count is not None else 0
    except (TypeError, ValueError):
        document_count = 0
    return render_learning_imitation_system_prompt(
        stage_id,
        document_count=document_count,
        documents_summary=str(ctx.get("documents_summary") or ""),
        current_result=str(ctx.get("current_result") or ""),
    )


def read_raw_learning_imitation_prompt_for_editor(stage_id: str) -> str:
    path = resolve_learning_imitation_prompt_read_path(stage_id)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text
