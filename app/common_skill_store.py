"""随应用发布的通用技能模板。

该配置保存在 ``app/prompt_defaults/skill``，属于应用资源而非用户数据。
源码运行时会直接修改仓库文件；打包时由 PyInstaller 随资源目录带走。
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.models import SKILL_STAGE_KEYS
from app.runtime_paths import bundle_root

COMMON_SKILLS_FILE_NAME = "common_skills.json"


def common_skills_path() -> Path:
    return (
        bundle_root()
        / "app"
        / "prompt_defaults"
        / "skill"
        / COMMON_SKILLS_FILE_NAME
    )


def _normalize_common_skill(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    title = str(raw.get("title") or "").strip()
    body = str(raw.get("body") or "")
    raw_stages = raw.get("effective_stages")
    effective_stages: list[str] = []
    if isinstance(raw_stages, list):
        effective_stages = [
            stage_id
            for stage_id in SKILL_STAGE_KEYS
            if stage_id in {str(item) for item in raw_stages}
        ]
    return {
        "id": str(raw.get("id") or uuid4()),
        "title": title or "未命名通用技能",
        "body": body,
        "effective_stages": effective_stages,
    }


def normalize_common_skills(raw: Any) -> list[dict[str, Any]]:
    source = raw.get("skills") if isinstance(raw, dict) else raw
    if not isinstance(source, list):
        return []
    skills: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in source:
        normalized = _normalize_common_skill(item)
        if normalized is None:
            continue
        if normalized["id"] in seen_ids:
            normalized["id"] = str(uuid4())
        seen_ids.add(normalized["id"])
        skills.append(normalized)
    return skills


def read_common_skills() -> list[dict[str, Any]]:
    path = common_skills_path()
    if not path.is_file():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return normalize_common_skills(payload)


def save_common_skills(raw: Any) -> list[dict[str, Any]]:
    skills = normalize_common_skills(raw)
    path = common_skills_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps({"skills": skills}, ensure_ascii=False, indent=2) + "\n"
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=".common_skills_",
        suffix=".json.tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            file.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return skills
