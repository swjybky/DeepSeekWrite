from __future__ import annotations

import json
import os
import sys
import tempfile
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.runtime_paths import data_root

ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"
HISTORY_FILE_NAME = "ai_chat_history.json"
HISTORY_VERSION = 1
MAX_SESSIONS_PER_SCOPE = 20
VALID_OWNER_TYPES = {"book", "material", "skill"}


@contextmanager
def _data_file_lock():
    data_dir = data_root()
    data_dir.mkdir(parents=True, exist_ok=True)
    lock_path = data_dir / ".write_claw.lock"
    with lock_path.open("a+b") as f:
        if sys.platform.startswith("win"):
            import msvcrt  # noqa: PLC0415

            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl  # noqa: PLC0415

            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime(ISO_FMT)


def _history_path() -> Path:
    root = data_root()
    root.mkdir(parents=True, exist_ok=True)
    return root / HISTORY_FILE_NAME


def _empty_payload() -> dict[str, Any]:
    return {"version": HISTORY_VERSION, "sessions": []}


def _load_payload_unlocked() -> dict[str, Any]:
    path = _history_path()
    if not path.exists():
        return _empty_payload()
    try:
        raw = path.read_text(encoding="utf-8")
        if not raw.strip():
            return _empty_payload()
        data = json.loads(raw)
    except (json.JSONDecodeError, OSError):
        return _empty_payload()
    if not isinstance(data, dict):
        return _empty_payload()
    sessions = data.get("sessions")
    if not isinstance(sessions, list):
        sessions = []
    return {
        "version": HISTORY_VERSION,
        "sessions": [item for item in sessions if isinstance(item, dict)],
    }


def _save_payload_unlocked(payload: dict[str, Any]) -> None:
    path = _history_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(
        {
            "version": HISTORY_VERSION,
            "sessions": payload.get("sessions", []),
        },
        ensure_ascii=False,
        indent=2,
    )
    fd, tmp = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=".ai_chat_history_",
        suffix=".json.tmp",
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


def _normalize_scope(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise ValueError("scope must be an object")
    owner_type = str(raw.get("owner_type") or raw.get("ownerType") or "").strip()
    owner_id = str(raw.get("owner_id") or raw.get("ownerId") or "").strip()
    category_id = str(
        raw.get("category_id") or raw.get("categoryId") or ""
    ).strip()
    if owner_type not in VALID_OWNER_TYPES:
        raise ValueError("invalid owner_type")
    if not owner_id:
        raise ValueError("owner_id is required")
    if not category_id:
        raise ValueError("category_id is required")
    return {
        "owner_type": owner_type,
        "owner_id": owner_id,
        "category_id": category_id,
    }


def _same_scope(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return (
        str(a.get("owner_type", "")) == b["owner_type"]
        and str(a.get("owner_id", "")) == b["owner_id"]
        and str(a.get("category_id", "")) == b["category_id"]
    )


def _message_text(message: Any) -> str:
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            parts.append(str(block.get("text") or ""))
    return " ".join(part.strip() for part in parts if part.strip()).strip()


def _title_from_messages(messages: list[Any]) -> str:
    for message in messages:
        if isinstance(message, dict) and message.get("role") == "user":
            title = _message_text(message)
            if title:
                return title
    return "未命名对话"


def _normalize_session(raw: Any, existing: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        raise ValueError("session must be an object")
    scope = _normalize_scope(raw.get("scope"))
    messages = raw.get("messages")
    if not isinstance(messages, list) or not any(
        isinstance(message, dict) and message.get("role") == "user"
        for message in messages
    ):
        return None

    now = _utc_now_iso()
    existing_id = existing.get("id") if existing else ""
    session_id = str(raw.get("id") or existing_id or "").strip()
    if not session_id:
        session_id = uuid.uuid4().hex

    title = str(raw.get("title") or "").strip() or _title_from_messages(messages)
    created_at = str(
        raw.get("created_at")
        or raw.get("createdAt")
        or (existing or {}).get("created_at")
        or now
    )
    updated_at = now
    model = raw.get("model")
    if model is None and existing is not None:
        model = existing.get("model")
    thinking_level = str(
        raw.get("thinking_level")
        or raw.get("thinkingLevel")
        or (existing or {}).get("thinking_level")
        or "off"
    )
    return {
        "id": session_id,
        "scope": scope,
        "title": title,
        "messages": messages,
        "model": model,
        "thinking_level": thinking_level,
        "created_at": created_at,
        "updated_at": updated_at,
        "message_count": len(messages),
    }


def _session_metadata(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(session.get("id") or ""),
        "scope": session.get("scope") or {},
        "title": str(session.get("title") or "未命名对话"),
        "created_at": str(session.get("created_at") or ""),
        "updated_at": str(session.get("updated_at") or ""),
        "message_count": int(session.get("message_count") or 0),
    }


def _sorted_sessions(sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexed = list(enumerate(sessions))
    indexed.sort(
        key=lambda item: (
            str(item[1].get("updated_at") or item[1].get("created_at") or ""),
            item[0],
        ),
        reverse=True,
    )
    return [item for _, item in indexed]


def list_ai_chat_sessions(scope: dict[str, Any]) -> list[dict[str, Any]]:
    normalized_scope = _normalize_scope(scope)
    with _data_file_lock():
        payload = _load_payload_unlocked()
        scoped = [
            session
            for session in payload["sessions"]
            if isinstance(session.get("scope"), dict)
            and _same_scope(session["scope"], normalized_scope)
        ]
        return [
            _session_metadata(session)
            for session in _sorted_sessions(scoped)[:MAX_SESSIONS_PER_SCOPE]
        ]


def get_ai_chat_session(session_id: str) -> dict[str, Any] | None:
    sid = str(session_id or "").strip()
    if not sid:
        return None
    with _data_file_lock():
        payload = _load_payload_unlocked()
        for session in payload["sessions"]:
            if str(session.get("id") or "") == sid:
                return session
    return None


def save_ai_chat_session(session: dict[str, Any]) -> dict[str, Any] | None:
    with _data_file_lock():
        payload = _load_payload_unlocked()
        sessions = payload["sessions"]
        incoming_id = str(session.get("id") or "").strip() if isinstance(session, dict) else ""
        existing = next(
            (
                item
                for item in sessions
                if incoming_id and str(item.get("id") or "") == incoming_id
            ),
            None,
        )
        normalized = _normalize_session(session, existing)
        if normalized is None:
            return None

        next_sessions = [
            item
            for item in sessions
            if str(item.get("id") or "") != normalized["id"]
        ]
        next_sessions.append(normalized)

        scoped = [
            item
            for item in next_sessions
            if isinstance(item.get("scope"), dict)
            and _same_scope(item["scope"], normalized["scope"])
        ]
        keep_ids = {
            str(item.get("id") or "")
            for item in _sorted_sessions(scoped)[:MAX_SESSIONS_PER_SCOPE]
        }
        next_sessions = [
            item
            for item in next_sessions
            if not (
                isinstance(item.get("scope"), dict)
                and _same_scope(item["scope"], normalized["scope"])
                and str(item.get("id") or "") not in keep_ids
            )
        ]
        payload["sessions"] = next_sessions
        _save_payload_unlocked(payload)
        return normalized


def delete_ai_chat_session(session_id: str) -> bool:
    sid = str(session_id or "").strip()
    if not sid:
        return False
    with _data_file_lock():
        payload = _load_payload_unlocked()
        before = len(payload["sessions"])
        payload["sessions"] = [
            item for item in payload["sessions"] if str(item.get("id") or "") != sid
        ]
        if len(payload["sessions"]) == before:
            return False
        _save_payload_unlocked(payload)
        return True


def delete_ai_chat_sessions_for_owner(owner_type: str, owner_id: str) -> int:
    ot = str(owner_type or "").strip()
    oid = str(owner_id or "").strip()
    if ot not in VALID_OWNER_TYPES or not oid:
        return 0
    with _data_file_lock():
        payload = _load_payload_unlocked()
        before = len(payload["sessions"])
        payload["sessions"] = [
            item
            for item in payload["sessions"]
            if not (
                isinstance(item.get("scope"), dict)
                and str(item["scope"].get("owner_type") or "") == ot
                and str(item["scope"].get("owner_id") or "") == oid
            )
        ]
        removed = before - len(payload["sessions"])
        if removed:
            _save_payload_unlocked(payload)
        return removed
