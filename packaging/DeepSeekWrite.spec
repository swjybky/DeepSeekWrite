# -*- mode: python ; coding: utf-8 -*-
"""DeepSeekWrite Windows 便携目录包（PyInstaller onedir）。在项目根目录执行:
    pip install pyinstaller
    cd web && npm ci && npm run build
    pyinstaller packaging/DeepSeekWrite.spec
产出: dist/DeepSeekWrite/（含 DeepSeekWrite.exe，双击即可运行）。
用户本机需已安装 Microsoft Edge WebView2 Runtime。
"""
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules


def _conda_runtime_dlls() -> list[tuple[str, str]]:
    """Miniconda/Anaconda 的 OpenSSL 等 DLL 不会自动被 PyInstaller 收集。"""
    lib_bin = Path(sys.prefix) / "Library" / "bin"
    names = (
        "libssl-3-x64.dll",
        "libcrypto-3-x64.dll",
        "liblzma.dll",
        "libbz2.dll",
        "ffi.dll",
    )
    return [
        (str(lib_bin / name), ".")
        for name in names
        if (lib_bin / name).is_file()
    ]


spec_dir = Path(SPECPATH).resolve()
project_root = spec_dir.parent
entry_script = project_root / "packaging" / "pyi_entry.py"
dist_web = project_root / "web" / "dist"
assets_dir = project_root / "app" / "assets"
prompt_defaults = project_root / "app" / "prompt_defaults"
version_config = project_root / "app" / "version.json"
ico_path = assets_dir / "app-icon.ico"
webview2_runtime = project_root / "packaging" / "webview2_runtime"

if not dist_web.is_dir() or not (dist_web / "index.html").is_file():
    raise SystemExit(
        f"缺少前端构建产物: {dist_web}\n请先执行: cd web && npm install && npm run build"
    )

datas = [
    (str(dist_web), "web/dist"),
    (str(prompt_defaults), "app/prompt_defaults"),
    (str(version_config), "app"),
]
if assets_dir.is_dir():
    datas.append((str(assets_dir), "app/assets"))
if webview2_runtime.is_dir() and (webview2_runtime / "msedgewebview2.exe").is_file():
    datas.append((str(webview2_runtime), "webview2_runtime"))

_platformdirs_datas, _platformdirs_binaries, _platformdirs_hidden = collect_all(
    "platformdirs"
)

hiddenimports = list(
    dict.fromkeys(
        collect_submodules("webview")
        + collect_submodules("platformdirs")
        + _platformdirs_hidden
        + [
            "http.server",
            "socketserver",
            "threading",
            "platformdirs",
            "pkg_resources.extern.platformdirs",
        ]
    )
)

datas += _platformdirs_datas
binaries = list(_platformdirs_binaries) + _conda_runtime_dlls()

_rthook_preload = str(project_root / "packaging" / "pyi_rth_preload_platformdirs.py")
_rthooks_exclude = {"pyi_rth_pkgres"}

a = Analysis(
    [str(entry_script)],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[_rthook_preload],
    excludes=[],
    noarchive=False,
)
a.scripts = [entry for entry in a.scripts if entry[0] not in _rthooks_exclude]
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
    name="DeepSeekWrite",
)
