"""打包前准备：缓存 WebView2 离线安装包（随应用分发，用户无需另行下载）。"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

VENDOR_DIR = Path(__file__).resolve().parent / "vendor"
INSTALLER_NAME = "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
# Microsoft 官方 x64 离线独立安装包（Evergreen Standalone）
INSTALLER_URL = "https://go.microsoft.com/fwlink/?linkid=2124701"


def main() -> int:
    VENDOR_DIR.mkdir(parents=True, exist_ok=True)
    dest = VENDOR_DIR / INSTALLER_NAME
    if dest.is_file() and dest.stat().st_size > 10_000_000:
        print(f"WebView2 installer ready ({dest.stat().st_size // 1_048_576} MB)")
        return 0

    print(f"Downloading WebView2 installer from {INSTALLER_URL}")
    try:
        urllib.request.urlretrieve(INSTALLER_URL, dest)
    except OSError as exc:
        print(f"下载失败: {exc}", file=sys.stderr)
        return 1

    if not dest.is_file() or dest.stat().st_size < 10_000_000:
        print("下载的文件异常（体积过小），请检查网络后重试。", file=sys.stderr)
        if dest.is_file():
            dest.unlink()
        return 1

    print(f"Saved installer ({dest.stat().st_size // 1_048_576} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
