"""技能库管理智能体可加载的全局管理技能。"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.runtime_paths import bundle_root, data_root

SKILL_MANAGER_SKILLS_FILE_NAME = "manager_skills.json"
SKILL_MANAGER_SKILLS_OVERRIDE_FILE_NAME = "skill_manager_skills.json"


def skill_manager_skills_default_path() -> Path:
    return (
        bundle_root()
        / "app"
        / "prompt_defaults"
        / "skill"
        / SKILL_MANAGER_SKILLS_FILE_NAME
    )


def skill_manager_skills_override_path() -> Path:
    return data_root() / SKILL_MANAGER_SKILLS_OVERRIDE_FILE_NAME


def _source_list(raw: Any) -> list[Any]:
    source = raw.get("skills") if isinstance(raw, dict) else raw
    if not isinstance(source, list):
        raise ValueError("技能库管理技能配置必须是列表")
    return source


def normalize_skill_manager_skills(raw: Any) -> list[dict[str, str]]:
    """校验管理技能并修复缺失或重复 ID。"""

    normalized: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for index, item in enumerate(_source_list(raw), start=1):
        if not isinstance(item, dict):
            raise ValueError(f"第 {index} 个管理技能格式无效")
        name = str(item.get("name") or "").strip()
        description = str(item.get("description") or "").strip()
        body = str(item.get("body") or "").strip()
        if not name:
            raise ValueError(f"第 {index} 个管理技能缺少名称")
        if not description:
            raise ValueError(f"管理技能「{name}」缺少描述")
        if not body:
            raise ValueError(f"管理技能「{name}」缺少正文")
        if name in seen_names:
            raise ValueError(f"管理技能名称重复：{name}")
        seen_names.add(name)

        skill_id = str(item.get("id") or "").strip()
        if not skill_id or skill_id in seen_ids:
            skill_id = str(uuid4())
        seen_ids.add(skill_id)
        normalized.append(
            {
                "id": skill_id,
                "name": name,
                "description": description,
                "body": body,
            }
        )
    return normalized


def _read_skills_file(path: Path) -> list[dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return normalize_skill_manager_skills(payload)


def read_default_skill_manager_skills() -> list[dict[str, str]]:
    path = skill_manager_skills_default_path()
    if not path.is_file():
        return []
    try:
        return _read_skills_file(path)
    except (OSError, ValueError, json.JSONDecodeError):
        return []


def read_skill_manager_skills() -> list[dict[str, str]]:
    override = skill_manager_skills_override_path()
    if override.is_file():
        try:
            return _read_skills_file(override)
        except (OSError, ValueError, json.JSONDecodeError):
            pass
    return read_default_skill_manager_skills()


def save_skill_manager_skills(raw: Any) -> list[dict[str, str]]:
    skills = normalize_skill_manager_skills(raw)
    path = skill_manager_skills_override_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps({"skills": skills}, ensure_ascii=False, indent=2) + "\n"
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=".skill_manager_skills_",
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


def reset_skill_manager_skills() -> list[dict[str, str]]:
    path = skill_manager_skills_override_path()
    if path.is_file():
        path.unlink()
    return read_default_skill_manager_skills()
