"""工作台系统提示模板：磁盘默认 + `.data/prompt_overrides` 覆盖，占位符服务端替换。"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.runtime_paths import bundle_root, writable_root

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
    "draft_review",
    "format_conversion",
)

SHORT_STAGE_LABELS: dict[str, str] = {
    "character_design": "人物设计",
    "plot_design": "剧情设计",
    "intro_design": "导语设计",
    "plot_refine": "剧情细化",
    "outline": "大纲纲要",
    "draft": "正文编写",
    "draft_review": "正文审阅",
    "format_conversion": "格式转换",
}

EXPERT_DRAFT_COORDINATOR_AGENT_ID = "expert_draft_coordinator"
EXPERT_SECTION_WRITER_AGENT_ID = "expert_section_writer"
WORKSPACE_AGENT_IDS: tuple[str, ...] = SHORT_STAGES_ORDER + (
    EXPERT_DRAFT_COORDINATOR_AGENT_ID,
    EXPERT_SECTION_WRITER_AGENT_ID,
)

PEEK_EMPTY_MESSAGE = "（其它阶段暂无内容）"
OTHER_STAGES_PEER_MAX = 2000
STAGE_BODY_EXCERPT_CAP = 12000

_WORKSPACE_PLACEHOLDER_RE = re.compile(
    r"\{\{(BOOK_TITLE|BOOK_LINE|BOOK_GENRE|STYLE|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}"
)
_MATERIAL_PLACEHOLDER_RE = re.compile(
    r"\{\{(BOOK_TITLE|BOOK_LINE|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}"
)


def excerpt(text: str, _max_len: int = STAGE_BODY_EXCERPT_CAP) -> str:
    stripped = text.strip()
    return stripped if stripped else "（暂无）"


def _peek_other_stages(
    exclude_stage_id: str,
    all_stages: dict[str, str],
    *,
    peer_max: int | None,
) -> str:
    cap = peer_max if peer_max is not None else OTHER_STAGES_PEER_MAX
    lines: list[str] = []
    for sid in SHORT_STAGES_ORDER:
        if sid == exclude_stage_id:
            continue
        raw = str(all_stages.get(sid) or "").strip()
        if not raw:
            continue
        excerpted = excerpt(raw, cap)
        lines.append(f"【{SHORT_STAGE_LABELS.get(sid, sid)}】\n{excerpted}")
    return "\n\n".join(lines) if lines else PEEK_EMPTY_MESSAGE


def peek_other_for_render(
    exclude_stage_id: str,
    all_stages: dict[str, str],
) -> str:
    """渲染当前阶段允许读取的其它创作阶段摘录。"""
    return _peek_other_stages(
        exclude_stage_id,
        all_stages,
        peer_max=OTHER_STAGES_PEER_MAX,
    )


def validate_workspace_agent_id(agent_id: str) -> None:
    if agent_id not in WORKSPACE_AGENT_IDS:
        raise ValueError(f"未知的 workspace_agent_id: {agent_id!r}")


def validate_workspace_stage_id(stage_id: str) -> None:
    if stage_id not in SHORT_STAGES_ORDER:
        raise ValueError(f"未知的 stage_id: {stage_id!r}")


def _workspace_override_root() -> Path:
    return writable_root() / ".data" / "prompt_overrides" / SHORT_PREFIX


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
    raw = read_workspace_agent_prompt_template(stage_id)

    staged_body = excerpt(stage_body, STAGE_BODY_EXCERPT_CAP)
    other = (
        ""
        if all_stages_for_peek is None
        else peek_other_for_render(stage_id, all_stages_for_peek)
    )

    title = (book_title or "").strip()
    genre = (book_genre or "").strip() or "未分类"
    replacements = {
        "BOOK_TITLE": title,
        "BOOK_LINE": f"书名：《{title}》",
        "BOOK_GENRE": genre,
        "STYLE": genre,
        "STAGE_BODY": staged_body,
        "OTHER_STAGES_EXCERPT": other,
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
    body = str(ctx.get("stage_body") or "")
    all_stages: dict[str, str] | None = None
    stages_val = ctx.get("all_stages")
    if isinstance(stages_val, dict):
        all_stages = {str(k): str(v if v is not None else "") for k, v in stages_val.items()}
    allowed_val = ctx.get("allowed_workspace_stages")
    if all_stages is not None:
        allowed = {str(v) for v in allowed_val} if isinstance(allowed_val, list) else set()
        all_stages = {k: v for k, v in all_stages.items() if k in allowed}

    return render_workspace_system_prompt(
        stage_id,
        book_title=title,
        book_genre=genre,
        stage_body=body,
        all_stages_for_peek=all_stages if all_stages is not None else {},
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

# 素材阶段顺序（人设/导语/梗/剧情细化/节奏/正文片段），对齐 app/models.py MATERIAL_STAGE_KEYS
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
    "pacing": "节奏素材",
    "draft_excerpt": "正文片段",
}

# 素材提示词目录：long(长篇) / short_*(短篇分类)
VALID_MATERIAL_PROMPT_KINDS: frozenset[str] = frozenset(
    {
        "material_long",
        "material_short_shiqing",
        "material_short_qinggan",
        "material_short_kehuan",
        "material_short_xuanyi",
    }
)


def _material_kind_to_subdir(prompt_kind: str) -> str:
    """material_long → long、material_short_shiqing → short_shiqing。"""
    if not prompt_kind.startswith("material_"):
        return prompt_kind
    return prompt_kind[len("material_"):]


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


def material_override_absolute_path(prompt_kind: str, stage_id: str) -> Path:
    subdir = _material_kind_to_subdir(prompt_kind)
    root = writable_root() / ".data" / "prompt_overrides" / MATERIAL_PREFIX
    return (root / subdir / f"{stage_id}.txt").resolve()


def material_builtin_default_path(prompt_kind: str, stage_id: str) -> Path:
    subdir = _material_kind_to_subdir(prompt_kind)
    return (
        (bundle_root() / "app" / "prompt_defaults" / MATERIAL_PREFIX)
        / subdir
        / f"{stage_id}.txt"
    )


def resolve_material_read_path(prompt_kind: str, stage_id: str) -> Path:
    """覆盖优先。"""
    validate_material_slot(prompt_kind, stage_id)
    over = material_override_absolute_path(prompt_kind, stage_id)
    if over.is_file():
        return over
    return material_builtin_default_path(prompt_kind, stage_id)


def read_material_prompt_template(prompt_kind: str, stage_id: str) -> str:
    path = resolve_material_read_path(prompt_kind, stage_id)
    if not path.is_file():
        return (
            f"[缺少素材默认提示模板文件]\n路径: {path}\n\n"
            "请补齐 app/prompt_defaults/material 下的同名 .txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def save_material_prompt_override(prompt_kind: str, stage_id: str, body: str) -> None:
    validate_material_slot(prompt_kind, stage_id)
    path = material_override_absolute_path(prompt_kind, stage_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def reset_material_prompt_override(prompt_kind: str, stage_id: str) -> bool:
    validate_material_slot(prompt_kind, stage_id)
    path = material_override_absolute_path(prompt_kind, stage_id)
    if path.is_file():
        path.unlink()
        return True
    return False


def render_material_system_prompt(
    prompt_kind: str,
    stage_id: str,
    *,
    book_title: str,
    stage_body: str,
    other_stages_excerpt: str | None = None,
    all_stages_for_peek: dict[str, str] | None = None,
) -> str:
    validate_material_slot(prompt_kind, stage_id)
    raw = read_material_prompt_template(prompt_kind, stage_id)

    staged_body = excerpt(stage_body, STAGE_BODY_EXCERPT_CAP)
    if other_stages_excerpt is None:
        if all_stages_for_peek is None:
            other = ""
        else:
            other = peek_material_other_for_render(stage_id, all_stages_for_peek)
    else:
        other = other_stages_excerpt

    replacements = {
        "BOOK_TITLE": (book_title or "").strip(),
        "BOOK_LINE": f"素材：《{(book_title or '').strip()}》",
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
    title = str(ctx.get("book_title") or "")
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
            stage_body=body,
            other_stages_excerpt=str(other_override),
        )
    return render_material_system_prompt(
        prompt_kind,
        stage_id,
        book_title=title,
        stage_body=body,
        all_stages_for_peek=all_stages if all_stages is not None else {},
    )


def read_raw_material_prompt_for_editor(prompt_kind: str, stage_id: str) -> str:
    """素材编辑框：读写当前生效来源（优先覆盖）原始模板正文。"""
    path = resolve_material_read_path(prompt_kind, stage_id)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text
