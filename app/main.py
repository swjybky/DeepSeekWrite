from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path


def _configure_linux_pywebview_env() -> None:
    """仅 Linux：配置 pywebview 后端与环境变量；Windows/macOS 不会调用此处逻辑。

    若未设置 PYWEBVIEW_GUI：默认优先 Qt WebEngine。原因：内嵌 Pi Web UI（Lit 自定义元素）
    在 GTK/WebKitGTK 下易出现右侧 AI 面板高度塌缩、输入区空白；而 Qt 端正常。
    依赖见 requirements.txt（PySide6）。仍可显式指定：`PYWEBVIEW_GUI=gtk` 或 `PYWEBVIEW_GUI=qt`。
    需用 GTK（如更习惯系统输入法）时自设 `PYWEBVIEW_GUI=gtk` 并安装系统 WebKit 与 PyGObject（README）。

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
        _has_qt = (
            importlib.util.find_spec("PySide6") is not None
            or importlib.util.find_spec("PyQt6") is not None
            or importlib.util.find_spec("PyQt5") is not None
        )
        if _has_qt:
            os.environ["PYWEBVIEW_GUI"] = "qt"
        elif importlib.util.find_spec("gi") is not None:
            os.environ["PYWEBVIEW_GUI"] = "gtk"
        else:
            os.environ["PYWEBVIEW_GUI"] = "qt"
    system_bus = Path("/var/run/dbus/system_bus_socket")
    if system_bus.exists():
        os.environ.setdefault(
            "DBUS_SYSTEM_BUS_ADDRESS",
            f"unix:path={system_bus}",
        )

    _ensure_linux_qt_input_method()


def _ensure_linux_qt_input_method() -> None:
    """Qt WebEngine 走中文输入法需加载 Qt 平台输入法插件，依赖环境变量 QT_IM_MODULE。

    从图形界面登录时桌面会话通常会注入；从终端直接 `python -m app.main` 时经常缺失，
    表现为网页内输入框无法调出搜狗 / 微软拼音类输入法。此处在与 GTK_IM_MODULE / XMODIFIERS
    一致时镜像到 Qt；若仍无则默认 ibus（Ubuntu 常见）。已手动设置 QT_IM_MODULE 时不覆盖。

    Fcitx5 用户请安装发行版提供的 Qt6 前端（如 Debian/Ubuntu: ``fcitx5-frontend-qt6``）。
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
        os.environ.setdefault("QT_IM_MODULE", "ibus")


_configure_linux_pywebview_env()

import webview

from app.ai_env import load_ai_model_defaults
from app.storage import BookStore, read_saved_workspace_root, write_saved_workspace_root


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _dist_index_url() -> str:
    index = _project_root() / "web" / "dist" / "index.html"
    if not index.exists():
        print(
            "前端未构建：请在 web 目录执行 npm install && npm run build",
            file=sys.stderr,
        )
        sys.exit(1)
    return index.resolve().as_uri()


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
    url = _dist_index_url()
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
