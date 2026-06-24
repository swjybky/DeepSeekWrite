# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for DeepSeekWrite macOS Intel x86_64 builds.

This file is invoked by build_macintel_dmg.sh with:
  WRITECLAW_PROJECT_ROOT=/path/to/write-claw
  WRITECLAW_MAC_ICON=/path/to/generated/app-icon.icns
"""

from __future__ import annotations

import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules


project_root_env = os.environ.get("WRITECLAW_PROJECT_ROOT")
if not project_root_env:
    raise SystemExit("WRITECLAW_PROJECT_ROOT is required")

project_root = Path(project_root_env).resolve()
entry_script = project_root / "packaging" / "pyi_entry.py"
dist_web = project_root / "web" / "dist"
assets_dir = project_root / "app" / "assets"
prompt_defaults = project_root / "app" / "prompt_defaults"
icon_env = os.environ.get("WRITECLAW_MAC_ICON")
icns_path = Path(icon_env).resolve() if icon_env else assets_dir / "app-icon.icns"

if not entry_script.is_file():
    raise SystemExit(f"Missing PyInstaller entry script: {entry_script}")
if not dist_web.is_dir() or not (dist_web / "index.html").is_file():
    raise SystemExit(
        f"Missing frontend build output: {dist_web}\n"
        "Run: cd web && npm ci && npm run build"
    )

datas = [
    (str(dist_web), "web/dist"),
    (str(prompt_defaults), "app/prompt_defaults"),
]
if assets_dir.is_dir():
    datas.append((str(assets_dir), "app/assets"))

platformdirs_datas, platformdirs_binaries, platformdirs_hidden = collect_all(
    "platformdirs"
)

hiddenimports = list(
    dict.fromkeys(
        collect_submodules("webview")
        + collect_submodules("platformdirs")
        + platformdirs_hidden
        + [
            "AppKit",
            "Foundation",
            "WebKit",
            "objc",
            "PyObjCTools",
            "http.server",
            "socketserver",
            "threading",
            "platformdirs",
            "pkg_resources.extern.platformdirs",
        ]
    )
)

datas += platformdirs_datas
binaries = list(platformdirs_binaries)

a = Analysis(
    [str(entry_script)],
    pathex=[str(project_root)],
    binaries=binaries,
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
    name="DeepSeekWrite",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch="x86_64",
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="DeepSeekWrite",
)

app = BUNDLE(
    coll,
    name="DeepSeekWrite.app",
    icon=str(icns_path) if icns_path.is_file() else None,
    bundle_identifier="com.openwrite.deepseekwrite",
    info_plist={
        "CFBundleName": "DeepSeekWrite",
        "CFBundleDisplayName": "DeepSeekWrite",
        "CFBundleShortVersionString": "1.0.0",
        "CFBundleVersion": "1.0.0",
        "LSMinimumSystemVersion": "10.13",
        "NSHighResolutionCapable": True,
        "NSAppTransportSecurity": {
            "NSAllowsLocalNetworking": True,
        },
    },
)
