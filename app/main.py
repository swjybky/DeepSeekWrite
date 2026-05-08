from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path


def _configure_linux_pywebview_env() -> None:
    """仅 Linux：配置 pywebview 后端与环境变量；Windows/macOS 不会调用此处逻辑。

    若未设置 PYWEBVIEW_GUI：能 import gi（PyGObject）则默认 GTK/WebKit（便于系统输入法），否则回退 Qt。
    可显式指定：`PYWEBVIEW_GUI=gtk` 或 `qt`。想用 GTK 时请安装系统库（README）并在当前 Python 环境中执行
    `pip install PyGObject`。

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
        if importlib.util.find_spec("gi") is not None:
            os.environ["PYWEBVIEW_GUI"] = "gtk"
        else:
            os.environ["PYWEBVIEW_GUI"] = "qt"
    system_bus = Path("/var/run/dbus/system_bus_socket")
    if system_bus.exists():
        os.environ.setdefault(
            "DBUS_SYSTEM_BUS_ADDRESS",
            f"unix:path={system_bus}",
        )


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
