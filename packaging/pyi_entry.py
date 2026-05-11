"""PyInstaller 入口：保证以项目根为包路径解析 ``app``。"""

from __future__ import annotations

from app.main import main

if __name__ == "__main__":
    main()
