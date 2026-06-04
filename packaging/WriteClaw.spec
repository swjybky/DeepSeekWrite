# -*- mode: python ; coding: utf-8 -*-
"""DeepseekWrite Windows 便携目录包（PyInstaller onedir）。在项目根目录执行:
    pip install pyinstaller
    cd web && npm ci && npm run build
    cd .. && pyinstaller packaging/WriteClaw.spec
产出: dist/WriteClaw/（将整个文件夹打包 zip 分发）。
"""
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


spec_dir = Path(SPECPATH).resolve()
project_root = spec_dir.parent
entry_script = project_root / "packaging" / "pyi_entry.py"
dist_web = project_root / "web" / "dist"
assets_dir = project_root / "app" / "assets"
prompt_defaults = project_root / "app" / "prompt_defaults"
ico_path = assets_dir / "app-icon.ico"

if not dist_web.is_dir() or not (dist_web / "index.html").is_file():
    raise SystemExit(
        f"缺少前端构建产物: {dist_web}\n请先执行: cd web && npm install && npm run build"
    )

datas = [
    (str(dist_web), "web/dist"),
    (str(prompt_defaults), "app/prompt_defaults"),
]
if assets_dir.is_dir():
    datas.append((str(assets_dir), "app/assets"))

hiddenimports = list(
    dict.fromkeys(
        collect_submodules("webview")
        + [
            "http.server",
            "socketserver",
            "threading",
        ]
    )
)

a = Analysis(
    [str(entry_script)],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="WriteClaw",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ico_path) if ico_path.is_file() else None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="WriteClaw",
)
