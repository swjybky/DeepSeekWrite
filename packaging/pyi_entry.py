"""PyInstaller 入口：保证以项目根为包路径解析 ``app``。"""

from __future__ import annotations

import os
import sys


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

from app.main import main

if __name__ == "__main__":
    main()
