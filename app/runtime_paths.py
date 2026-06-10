"""源码运行与 PyInstaller 冻结运行下的根路径。

- bundle_root：只读资源（web/dist、app/assets、app/prompt_defaults），冻结时为 ``_MEIPASS``。
- writable_root：可执行文件旁的可写位置，冻结时为 ``sys.executable`` 所在目录。
- data_root：用户数据目录下的 ``.data``，用于书籍、素材、偏好与提示词覆盖。
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

APP_DATA_DIR_NAME = "WriteClaw"
DATA_DIR_NAME = ".data"
_LEGACY_LOCK_FILE = ".write_claw.lock"
_LEGACY_MIGRATION_MARKER = ".legacy_data_migration_v1"
_DATA_ROOT_READY = False


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def bundle_root() -> Path:
    if is_frozen():
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass).resolve()
    return Path(__file__).resolve().parent.parent


def writable_root() -> Path:
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def app_data_root() -> Path:
    """返回当前用户的应用数据目录。"""
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA")
        root = Path(base).expanduser() if base else Path.home() / "AppData" / "Roaming"
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        base = os.environ.get("XDG_DATA_HOME")
        root = Path(base).expanduser() if base else Path.home() / ".local" / "share"
    return (root / APP_DATA_DIR_NAME).resolve()


def legacy_data_root() -> Path:
    """旧版本的 `.data` 位置：源码/可执行文件所在目录。"""
    return writable_root() / DATA_DIR_NAME


def _should_skip_legacy_data_item(path: Path) -> bool:
    name = path.name
    return name in {_LEGACY_LOCK_FILE, _LEGACY_MIGRATION_MARKER} or name.endswith(
        ".tmp"
    )


def _copy_missing_legacy_data(source: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        if _should_skip_legacy_data_item(child):
            continue
        dest = target / child.name
        try:
            if child.is_dir():
                _copy_missing_legacy_data(child, dest)
            elif child.is_file() and not dest.exists():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(child, dest)
        except OSError:
            continue


def _migrate_legacy_data_root(target: Path) -> None:
    """首次使用用户数据目录时，从旧 `.data` 复制缺失文件。"""
    marker = target / _LEGACY_MIGRATION_MARKER
    if marker.is_file():
        return

    source = legacy_data_root()
    if source.is_dir():
        try:
            if source.resolve() != target.resolve():
                _copy_missing_legacy_data(source, target)
        except OSError:
            _copy_missing_legacy_data(source, target)

    try:
        marker.write_text("migrated\n", encoding="utf-8")
    except OSError:
        pass


def data_root() -> Path:
    """返回 `.data` 目录，并兼容迁移旧位置中的数据。"""
    global _DATA_ROOT_READY

    root = app_data_root() / DATA_DIR_NAME
    if not _DATA_ROOT_READY:
        root.mkdir(parents=True, exist_ok=True)
        _migrate_legacy_data_root(root)
        _DATA_ROOT_READY = True
    return root
