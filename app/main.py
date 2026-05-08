from __future__ import annotations

import functools
import os
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def _configure_linux_pywebview_env() -> None:
    """仅 Linux：配置 pywebview 后端与环境变量；Windows/macOS 不会调用此处逻辑。

    若未设置 PYWEBVIEW_GUI：一律默认 ``qt``（PySide6 见 requirements.txt）。GTK/WebKitGTK 不再作为默认回退。
    需要 GTK 时须自行指定 ``PYWEBVIEW_GUI=gtk`` 并安装 WebKit 与 PyGObject（README）。

    Conda 等前缀安装的 PyGObject 默认不会搜索 Debian/Ubuntu multiarch 下的 typelib（如
    /usr/lib/x86_64-linux-gnu/girepository-1.0），会导致 gi.require_version('Gtk','3.0') 报
    Namespace Gtk not available；因此在导入 webview 前合并 GI_TYPELIB_PATH。

    指向系统 D-Bus，减轻选用 Qt 时 WebEngine 误连 conda 等环境下路径的告警。
    """
    if not sys.platform.startswith("linux"):
        return
    typelib_dirs = [
        "/usr/lib/x86_64-linux-gnu/girepository-1.0",
        "/usr/lib/aarch64-linux-gnu/girepository-1.0",
        "/usr/lib/girepository-1.0",
    ]
    existing = [
        p for p in os.environ.get("GI_TYPELIB_PATH", "").split(os.pathsep) if p
    ]
    merged: list[str] = []
    seen: set[str] = set()
    for p in [d for d in typelib_dirs if Path(d).is_dir()] + existing:
        if p not in seen:
            seen.add(p)
            merged.append(p)
    if merged:
        os.environ["GI_TYPELIB_PATH"] = os.pathsep.join(merged)
    if "PYWEBVIEW_GUI" not in os.environ:
        os.environ["PYWEBVIEW_GUI"] = "qt"
    system_bus = Path("/var/run/dbus/system_bus_socket")
    if system_bus.exists():
        os.environ.setdefault(
            "DBUS_SYSTEM_BUS_ADDRESS",
            f"unix:path={system_bus}",
        )

    _ensure_linux_qt_input_method()


def _guess_linux_im_module_from_running_processes() -> str | None:
    """终端启动时常无会话里的 GTK_IM_MODULE，根据常见输入法守护进程推断 QT_IM_MODULE。"""
    for exe, qt_module in (
        ("fcitx5", "fcitx"),
        ("fcitx", "fcitx"),
        ("ibus-daemon", "ibus"),
    ):
        try:
            r = subprocess.run(
                ["pgrep", "-x", exe],
                capture_output=True,
                timeout=0.5,
            )
            if r.returncode == 0:
                return qt_module
        except (OSError, subprocess.TimeoutExpired):
            continue
    return None


def _ensure_linux_qt_input_method() -> None:
    """Qt WebEngine 走中文输入法需加载 Qt 平台输入法插件，依赖环境变量 QT_IM_MODULE。

    从图形界面登录时桌面会话通常会注入；从终端直接 `python -m app.main` 时经常缺失，
    表现为网页内输入框无法调出搜狗 / 微软拼音类输入法。此处在与 GTK_IM_MODULE / XMODIFIERS
    一致时镜像到 Qt；若无会话变量则用 pgrep 推断正在运行的 ibus / fcitx5；最后默认 ibus。
    已手动设置 QT_IM_MODULE 时不覆盖。

    Fcitx5 用户请安装发行版提供的 Qt6 前端（如 Debian/Ubuntu: ``fcitx5-frontend-qt6``）。
    Wayland 下若仍无法输入，可尝试启动前 ``QT_QPA_PLATFORM=xcb``（强制 XWayland）或改用系统输入法框架文档中的 Qt 插件路径。
    """
    if not sys.platform.startswith("linux"):
        return
    if os.environ.get("PYWEBVIEW_GUI") != "qt":
        return
    if os.environ.get("QT_IM_MODULE"):
        return
    gtk_im = os.environ.get("GTK_IM_MODULE", "").lower()
    xmod = os.environ.get("XMODIFIERS", "").lower()
    if "fcitx" in gtk_im or "fcitx" in xmod:
        os.environ["QT_IM_MODULE"] = "fcitx"
    elif "ibus" in gtk_im or "ibus" in xmod:
        os.environ["QT_IM_MODULE"] = "ibus"
    else:
        guessed = _guess_linux_im_module_from_running_processes()
        if guessed:
            os.environ["QT_IM_MODULE"] = guessed
        else:
            os.environ.setdefault("QT_IM_MODULE", "ibus")


_configure_linux_pywebview_env()

import webview

from app.ai_env import load_ai_model_defaults
from app.storage import BookStore, read_saved_workspace_root, write_saved_workspace_root


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _dist_dir() -> Path:
    dist = _project_root() / "web" / "dist"
    index = dist / "index.html"
    if not index.is_file():
        print(
            "前端未构建：请在 web 目录执行 npm install && npm run build",
            file=sys.stderr,
        )
        sys.exit(1)
    return dist


def _start_local_dist_server(dist_dir: Path) -> tuple[ThreadingHTTPServer, str]:
    """本机回环 HTTP 提供 dist，与 `npm run dev` 同为 http 源，避免 file:// 下 fetch 异常。"""
    handler = functools.partial(
        SimpleHTTPRequestHandler,
        directory=str(dist_dir.resolve()),
    )
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}/?pywebview=1"


def _app_icon_path() -> str | None:
    assets = _project_root() / "app" / "assets"
    # Linux GTK：GdkPixbuf 无法载入「PNG 压缩帧」的 .ico，窗口图标需使用 PNG。
    if sys.platform.startswith("linux"):
        png = assets / "app-icon.png"
        return str(png.resolve()) if png.is_file() else None
    ico = assets / "app-icon.ico"
    return str(ico.resolve()) if ico.is_file() else None


class Api:
    def __init__(self, store: BookStore) -> None:
        self._store = store

    def list_books(self) -> list[dict]:
        return self._store.list_books()

    def pick_folder(self) -> str | None:
        try:
            if not webview.windows:
                return None
            win = webview.windows[0]
            result = win.create_file_dialog(webview.FileDialog.FOLDER)
            if not result:
                return None
            if isinstance(result, (list, tuple)) and len(result) > 0:
                return str(result[0])
            return str(result) if result else None
        except Exception:
            return None

    def create_book(
        self,
        title: str,
        book_type: str,
        categories: list[str],
        workspace_root: str | None = None,
    ) -> dict:
        return self._store.create_book(title, book_type, categories, workspace_root)

    def get_book(self, book_id: str) -> dict | None:
        return self._store.get_book(book_id)

    def save_book(
        self,
        book_id: str,
        content: str | None = None,
        stages: dict | None = None,
    ) -> dict | None:
        return self._store.save_book(book_id, content=content, stages=stages)

    def delete_book(self, book_id: str) -> bool:
        return self._store.delete_book(book_id)

    def get_workspace_root(self) -> str | None:
        return read_saved_workspace_root()

    def set_workspace_root(self, path: str | None) -> None:
        write_saved_workspace_root(path)

    def get_ai_defaults(self) -> dict[str, str] | None:
        """与 app/.env 同步的默认模型与 Key，供前端注入 Pi 存储并跳过首次选模型/填 Key。"""
        return load_ai_model_defaults()


def main() -> None:
    store = BookStore()
    api = Api(store)
    _httpd, url = _start_local_dist_server(_dist_dir())
    webview.create_window(
        "涌泉写作",
        url,
        js_api=api,
        width=2000,
        height=1048,
        min_size=(640, 480),
    )
    webview.start(debug=False, icon=_app_icon_path())


if __name__ == "__main__":
    main()
