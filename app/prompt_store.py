"""工作台系统提示模板：磁盘默认 + `.data/prompt_overrides` 覆盖，占位符服务端替换。"""

from __future__ import annotations

import json
import re
from pathlib import Path

# --- 与工作台 TS 对齐 ---

SHORT_PREFIX = Path("short")

SHIQING_STAGES_ORDER: tuple[str, ...] = (
    "intro_design",
    "character_design",
    "plot_design",
    "plot_refine",
    "outline",
    "draft",
    "review",
    "format_conversion",
)

QINGGAN_STAGES_ORDER: tuple[str, ...] = (
    "qinggan_character",
    "qinggan_intro",
    "qinggan_plot_refine",
    "qinggan_outline",
    "qinggan_outline_review",
    "qinggan_draft",
    "qinggan_draft_review",
)

SHIQING_LABELS: dict[str, str] = {
    "intro_design": "导语设计",
    "character_design": "人设设计",
    "plot_design": "剧情设计",
    "plot_refine": "剧情细化",
    "outline": "大纲纲要",
    "draft": "正文编写",
    "review": "编辑审阅",
    "format_conversion": "格式转换",
}

QINGGAN_LABELS: dict[str, str] = {
    "qinggan_character": "人物设计",
    "qinggan_intro": "导语设计",
    "qinggan_plot_refine": "剧情细化",
    "qinggan_outline": "大纲纲要",
    "qinggan_outline_review": "大纲审阅",
    "qinggan_draft": "正文编写",
    "qinggan_draft_review": "正文审阅",
}

VALID_WORKSPACE: frozenset[str] = frozenset({"shiqing", "qinggan"})

STAGED_ORDER: dict[str, tuple[str, ...]] = {
    "shiqing": SHIQING_STAGES_ORDER,
    "qinggan": QINGGAN_STAGES_ORDER,
}

STAGED_LABELS: dict[str, dict[str, str]] = {
    "shiqing": SHIQING_LABELS,
    "qinggan": QINGGAN_LABELS,
}

PEEK_EMPTY_MESSAGE = "（其它阶段暂无内容）"

OTHER_STAGES_PEER_MAX_DEFAULT = 2000
OTHER_STAGES_PEER_MAX_QINGGAN = 2000
STAGE_BODY_EXCERPT_CAP = 12000

_PLACEHOLDER_RE = re.compile(
    r"\{\{(BOOK_TITLE|STAGE_BODY|OTHER_STAGES_EXCERPT|BOOK_LINE)\}\}"
)


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def excerpt(text: str, max_len: int = STAGE_BODY_EXCERPT_CAP) -> str:
    stripped = text.strip()
    if len(stripped) <= max_len:
        return stripped if stripped else "（暂无）"
    suffix = "\n\n…（内容过长已截断）"
    return stripped[:max_len].rstrip() + suffix


def _peek_other_stages(
    workspace_kind: str,
    exclude_stage_id: str,
    all_stages: dict[str, str],
    *,
    peer_max: int | None,
) -> str:
    order = STAGED_ORDER.get(workspace_kind)
    labels = STAGED_LABELS.get(workspace_kind, {})
    if not order:
        return PEEK_EMPTY_MESSAGE
    cap = peer_max if peer_max is not None else OTHER_STAGES_PEER_MAX_DEFAULT
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
    workspace_kind: str,
    exclude_stage_id: str,
    all_stages: dict[str, str],
) -> str:
    """与其它阶段摘录：情感工作台沿用每条 2000 字截取（与前端一致）。"""
    peer = OTHER_STAGES_PEER_MAX_QINGGAN if workspace_kind == "qinggan" else 2000
    return _peek_other_stages(
        workspace_kind, exclude_stage_id, all_stages, peer_max=peer
    )


def default_prompt_relative_path(workspace_kind: str, stage_id: str) -> Path:
    return SHORT_PREFIX / workspace_kind / f"{stage_id}.txt"


def override_prompt_absolute_path(workspace_kind: str, stage_id: str) -> Path:
    root = _project_root() / ".data" / "prompt_overrides" / SHORT_PREFIX
    return (root / workspace_kind / f"{stage_id}.txt").resolve()


def builtin_default_prompt_path(workspace_kind: str, stage_id: str) -> Path:
    return (
        (_project_root() / "app" / "prompt_defaults" / SHORT_PREFIX)
        / workspace_kind
        / f"{stage_id}.txt"
    )


def validate_slot(workspace_kind: str, stage_id: str) -> None:
    if workspace_kind not in VALID_WORKSPACE:
        raise ValueError(f"未知的 workspace_kind: {workspace_kind!r}")
    if stage_id not in STAGED_ORDER[workspace_kind]:
        raise ValueError(f"工作台 {workspace_kind} 无阶段键: {stage_id!r}")


def resolve_read_path(workspace_kind: str, stage_id: str) -> Path:
    """覆盖优先。"""
    validate_slot(workspace_kind, stage_id)
    over = override_prompt_absolute_path(workspace_kind, stage_id)
    if over.is_file():
        return over
    return builtin_default_prompt_path(workspace_kind, stage_id)


def read_prompt_template(workspace_kind: str, stage_id: str) -> str:
    path = resolve_read_path(workspace_kind, stage_id)
    if not path.is_file():
        return (
            f"[缺少默认提示模板文件]\n路径: {path}\n\n"
            "请 reinstall 或补齐 app/prompt_defaults 下的同名 .txt。\n"
        )
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text


def save_prompt_override(workspace_kind: str, stage_id: str, body: str) -> None:
    validate_slot(workspace_kind, stage_id)
    path = override_prompt_absolute_path(workspace_kind, stage_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")


def reset_prompt_override(workspace_kind: str, stage_id: str) -> bool:
    validate_slot(workspace_kind, stage_id)
    path = override_prompt_absolute_path(workspace_kind, stage_id)
    if path.is_file():
        path.unlink()
        return True
    return False


def render_workspace_system_prompt(
    workspace_kind: str,
    stage_id: str,
    *,
    book_title: str,
    stage_body: str,
    other_stages_excerpt: str | None = None,
    all_stages_for_peek: dict[str, str] | None = None,
) -> str:
    validate_slot(workspace_kind, stage_id)
    raw = read_prompt_template(workspace_kind, stage_id)

    staged_body = excerpt(stage_body, STAGE_BODY_EXCERPT_CAP)
    if other_stages_excerpt is None:
        if all_stages_for_peek is None:
            other = ""
        else:
            other = peek_other_for_render(
                workspace_kind, stage_id, all_stages_for_peek
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
    workspace_kind: str, stage_id: str, context_raw: object
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
            workspace_kind,
            stage_id,
            book_title=title,
            stage_body=body,
            other_stages_excerpt=str(other_override),
        )
    return render_workspace_system_prompt(
        workspace_kind,
        stage_id,
        book_title=title,
        stage_body=body,
        all_stages_for_peek=all_stages if all_stages is not None else {},
    )


def read_raw_prompt_for_editor(workspace_kind: str, stage_id: str) -> str:
    """编辑框：读写当前生效来源（优先覆盖）原始模板正文。"""
    path = resolve_read_path(workspace_kind, stage_id)
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8")
    if text.endswith("\n"):
        return text[:-1]
    return text
