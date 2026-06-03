"""工作台系统提示模板：磁盘默认 + `.data/prompt_overrides` 覆盖，占位符服务端替换。"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.runtime_paths import bundle_root, writable_root

# --- 与工作台 TS 对齐 ---

SHORT_PREFIX = Path("short")

# 统一阶段顺序（世情和情感共用）
# 对应 web/src/workspaces/short/stages.ts 中的 SHORT_WORKSPACE_STAGES
SHORT_STAGES_ORDER: tuple[str, ...] = (
    "character_design",
    "intro_design",
    "plot_design",
    "plot_refine",
    "outline",
    "draft",
    "draft_review",
    "format_conversion",
)

# 统一阶段标签
SHORT_STAGE_LABELS: dict[str, str] = {
    "character_design": "人物设计",
    "intro_design": "导语设计",
    "plot_design": "剧情设计",
    "plot_refine": "剧情细化",
    "outline": "大纲纲要",
    "draft": "正文编写",
    "draft_review": "正文审阅",
    "format_conversion": "格式转换",
}

# 有效的提示词目录（用于区分短篇类型风格）
VALID_PROMPT_KINDS: frozenset[str] = frozenset(
    {"shiqing", "qinggan", "kehuan", "xuanyi"}
)

# 专家模式提示词槽位。当前只暴露后台小节编写智能体，文件名保持独立，
# 避免与普通「正文编写」阶段模板混用。
EXPERT_SECTION_WRITER_PROMPT_ID = "expert_section_writer"
DEAI_FLAVOR_REMOVAL_PROMPT_ID = "deai_flavor_removal"
VALID_EXPERT_PROMPT_IDS: frozenset[str] = frozenset(
    {EXPERT_SECTION_WRITER_PROMPT_ID, DEAI_FLAVOR_REMOVAL_PROMPT_ID}
)

# 阶段顺序映射（按提示词目录）
STAGED_ORDER: dict[str, tuple[str, ...]] = {
    "shiqing": SHORT_STAGES_ORDER,
    "qinggan": SHORT_STAGES_ORDER,
    "kehuan": SHORT_STAGES_ORDER,
    "xuanyi": SHORT_STAGES_ORDER,
}

# 阶段标签映射（按提示词目录）
STAGED_LABELS: dict[str, dict[str, str]] = {
    "shiqing": SHORT_STAGE_LABELS,
    "qinggan": SHORT_STAGE_LABELS,
    "kehuan": SHORT_STAGE_LABELS,
    "xuanyi": SHORT_STAGE_LABELS,
}

PEEK_EMPTY_MESSAGE = "（其它阶段暂无内容）"

OTHER_STAGES_PEER_MAX = 2000
STAGE_BODY_EXCERPT_CAP = 12000

_PLACEHOLDER_RE = re.compile(
    r"\{\{(BOOK_TITLE|STAGE_BODY|OTHER_STAGES_EXCERPT|BOOK_LINE)\}\}"
)


def excerpt(text: str, _max_len: int = STAGE_BODY_EXCERPT_CAP) -> str:
    stripped = text.strip()
    return stripped if stripped else "（暂无）"


def _peek_other_stages(
    prompt_kind: str,
    exclude_stage_id: str,
    all_stages: dict[str, str],
    *,
    peer_max: int | None,
) -> str:
    order = STAGED_ORDER.get(prompt_kind)
    labels = STAGED_LABELS.get(prompt_kind, {})
    if not order:
        return PEEK_EMPTY_MESSAGE
    cap = peer_max if peer_max is not None else OTHER_STAGES_PEER_MAX
    lines: list[str] = []
    for sid in order:
        if sid == exclude_stage_id:
            continue
        raw = str(all_stages.get(sid) or "").strip()
        if not raw:
            continue
        lbl = labels.get(sid, sid)
        excerpted = excerpt(raw, cap)
        lines.append(f"【{lbl}】\n{excerpted}")
    return "\n\n".join(lines) if lines else PEEK_EMPTY_MESSAGE


def peek_other_for_render(
    prompt_kind: str,
    exclude_stage_id: str,
    all_stages: dict[str, str],
) -> str:
    """与其它阶段摘录"""
    return _peek_other_stages(
        prompt_kind, exclude_stage_id, all_stages, peer_max=OTHER_STAGES_PEER_MAX
    )


def default_prompt_relative_path(prompt_kind: str, stage_id: str) -> Path:
    return SHORT_PREFIX / prompt_kind / f"{stage_id}.txt"


def override_prompt_absolute_path(prompt_kind: str, stage_id: str) -> Path:
    root = writable_root() / ".data" / "prompt_overrides" / SHORT_PREFIX
    return (root / prompt_kind / f"{stage_id}.txt").resolve()


def builtin_default_prompt_path(prompt_kind: str, stage_id: str) -> Path:
    return (
        (bundle_root() / "app" / "prompt_defaults" / SHORT_PREFIX)
        / prompt_kind
        / f"{stage_id}.txt"
    )


def override_expert_prompt_absolute_path(prompt_kind: str, prompt_id: str) -> Path:
    root = writable_root() / ".data" / "prompt_overrides" / SHORT_PREFIX
    return (root / prompt_kind / f"{prompt_id}.txt").resolve()


def builtin_default_expert_prompt_path(prompt_kind: str, prompt_id: str) -> Path:
    return (
        (bundle_root() / "app" / "prompt_defaults" / SHORT_PREFIX)
        / prompt_kind
        / f"{prompt_id}.txt"
    )


def validate_slot(prompt_kind: str, stage_id: str) -> None:
    if prompt_kind not in VALID_PROMPT_KINDS:
        raise ValueError(f"未知的 prompt_kind: {prompt_kind!r}")
    if stage_id not in SHORT_STAGES_ORDER:
        raise ValueError(f"未知的 stage_id: {stage_id!r}")


def validate_expert_prompt_slot(prompt_kind: str, prompt_id: str) -> None:
    if prompt_kind not in VALID_PROMPT_KINDS:
        raise ValueError(f"未知的 prompt_kind: {prompt_kind!r}")
    if prompt_id not in VALID_EXPERT_PROMPT_IDS:
        raise ValueError(f"未知的 expert_prompt_id: {prompt_id!r}")


def resolve_read_path(prompt_kind: str, stage_id: str) -> Path:
    """覆盖优先。"""
    validate_slot(prompt_kind, stage_id)
    over = override_prompt_absolute_path(prompt_kind, stage_id)
    if over.is_file():
        return over
    return builtin_default_prompt_path(prompt_kind, stage_id)


def resolve_expert_prompt_read_path(prompt_kind: str, prompt_id: str) -> Path:
    """专家模式提示词覆盖优先。"""
    validate_expert_prompt_slot(prompt_kind, prompt_id)
    over = override_expert_prompt_absolute_path(prompt_kind, prompt_id)
    if over.is_file():
        return over
    return builtin_default_expert_prompt_path(prompt_kind, prompt_id)


def read_prompt_template(prompt_kind: str, stage_id: str) -> str:
    path = resolve_read_path(prompt_kind, stage_id)
    if not path.is_file():
        return (
            f"[缺少默认提示模板文件]\n路径: {path}\n\n"
            "请 reinstall 或补齐 app/prompt_defaults 下的同名 .txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def read_expert_prompt_template(prompt_kind: str, prompt_id: str) -> str:
    path = resolve_expert_prompt_read_path(prompt_kind, prompt_id)
    if not path.is_file():
        return (
            f"[缺少默认专家模式提示模板文件]\n路径: {path}\n\n"
            "请 reinstall 或补齐 app/prompt_defaults 下的同名 .txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def save_prompt_override(prompt_kind: str, stage_id: str, body: str) -> None:
    validate_slot(prompt_kind, stage_id)
    path = override_prompt_absolute_path(prompt_kind, stage_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def save_expert_prompt_override(prompt_kind: str, prompt_id: str, body: str) -> None:
    validate_expert_prompt_slot(prompt_kind, prompt_id)
    path = override_expert_prompt_absolute_path(prompt_kind, prompt_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def reset_prompt_override(prompt_kind: str, stage_id: str) -> bool:
    validate_slot(prompt_kind, stage_id)
    path = override_prompt_absolute_path(prompt_kind, stage_id)
    if path.is_file():
        path.unlink()
        return True
    return False


def reset_expert_prompt_override(prompt_kind: str, prompt_id: str) -> bool:
    validate_expert_prompt_slot(prompt_kind, prompt_id)
    path = override_expert_prompt_absolute_path(prompt_kind, prompt_id)
    if path.is_file():
        path.unlink()
        return True
    return False


def render_workspace_system_prompt(
    prompt_kind: str,
    stage_id: str,
    *,
    book_title: str,
    stage_body: str,
    other_stages_excerpt: str | None = None,
    all_stages_for_peek: dict[str, str] | None = None,
) -> str:
    validate_slot(prompt_kind, stage_id)
    raw = read_prompt_template(prompt_kind, stage_id)

    staged_body = excerpt(stage_body, STAGE_BODY_EXCERPT_CAP)
    if other_stages_excerpt is None:
        if all_stages_for_peek is None:
            other = ""
        else:
            other = peek_other_for_render(
                prompt_kind, stage_id, all_stages_for_peek
            )
    else:
        other = other_stages_excerpt

    replacements = {
        "BOOK_TITLE": (book_title or "").strip(),
        "BOOK_LINE": f"书名：《{(book_title or '').strip()}》",
        "STAGE_BODY": staged_body,
        "OTHER_STAGES_EXCERPT": other,
    }

    def repl(m: re.Match[str]) -> str:
        key = m.group(1)
        return replacements[key]

    return _PLACEHOLDER_RE.sub(repl, raw)


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
        return render_workspace_system_prompt(
            prompt_kind,
            stage_id,
            book_title=title,
            stage_body=body,
            other_stages_excerpt=str(other_override),
        )
    return render_workspace_system_prompt(
        prompt_kind,
        stage_id,
        book_title=title,
        stage_body=body,
        all_stages_for_peek=all_stages if all_stages is not None else {},
    )


def read_raw_prompt_for_editor(prompt_kind: str, stage_id: str) -> str:
    """编辑框：读写当前生效来源（优先覆盖）原始模板正文。"""
    path = resolve_read_path(prompt_kind, stage_id)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def read_raw_expert_prompt_for_editor(prompt_kind: str, prompt_id: str) -> str:
    """专家模式编辑框：读写当前生效来源（优先覆盖）原始模板正文。"""
    path = resolve_expert_prompt_read_path(prompt_kind, prompt_id)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


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

    return _PLACEHOLDER_RE.sub(repl, raw)


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
