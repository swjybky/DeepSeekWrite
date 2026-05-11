"""源码运行与 PyInstaller 冻结运行下的根路径。

- bundle_root：只读资源（web/dist、app/assets、app/prompt_defaults），冻结时为 ``_MEIPASS``。
- writable_root：可写数据（``.data``、提示词覆盖、可选环境文件），冻结时为 ``sys.executable`` 所在目录。
"""

from __future__ import annotations

import sys
from pathlib import Path


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
