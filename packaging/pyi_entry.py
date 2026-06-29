"""PyInstaller 入口：保证以项目根为包路径解析 ``app``。"""

from __future__ import annotations

import os
import sys
from pathlib import Path


class _NullTextStream:
    encoding = "utf-8"
    errors = "replace"
    newlines = None
    closed = False

    def write(self, text: object) -> int:
        return len(str(text))

    def flush(self) -> None:
        return None

    def isatty(self) -> bool:
        return False

    def writable(self) -> bool:
        return True

    def close(self) -> None:
        return None

    def fileno(self) -> int:
        raise OSError("null stream has no file descriptor")


def _open_devnull_or_fallback() -> object:
    try:
        return open(os.devnull, "w", encoding="utf-8")
    except OSError:
        return _NullTextStream()


def _ensure_windowed_stdio() -> None:
    if sys.stdout is None:
        sys.stdout = _open_devnull_or_fallback()  # type: ignore[assignment]
    if sys.stderr is None:
        sys.stderr = _open_devnull_or_fallback()  # type: ignore[assignment]


_ensure_windowed_stdio()


def _delete_zone_identifier(path: Path) -> None:
    if not sys.platform.startswith("win"):
        return
    try:
        os.remove(f"{path}:Zone.Identifier")
    except OSError:
        return


def _unblock_packaged_dotnet_assemblies() -> None:
    """Remove Mark-of-the-Web from bundled .NET DLLs before pythonnet loads CLR."""
    if not sys.platform.startswith("win") or not getattr(sys, "frozen", False):
        return

    bundle_root = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    candidates = [
        bundle_root / "pythonnet" / "runtime" / "Python.Runtime.dll",
        bundle_root / "webview" / "lib" / "Microsoft.Web.WebView2.Core.dll",
        bundle_root / "webview" / "lib" / "Microsoft.Web.WebView2.WinForms.dll",
    ]
    candidates.extend((bundle_root / "clr_loader" / "ffi" / "dlls").glob("**/*.dll"))
    candidates.extend((bundle_root / "webview" / "lib" / "runtimes").glob("**/*.dll"))

    for candidate in candidates:
        if candidate.is_file():
            _delete_zone_identifier(candidate)


_unblock_packaged_dotnet_assemblies()

from app.main import main

if __name__ == "__main__":
    main()
