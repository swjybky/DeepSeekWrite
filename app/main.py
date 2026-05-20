from __future__ import annotations

import functools
import importlib.util
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


def _configure_macos_pywebview_env() -> None:
    """macOS：优先使用 pywebview 原生 Cocoa/WKWebView 后端。

    本项目依赖列表里曾全平台安装 PySide6；mac 开发机如果缺少 PyObjC，pywebview 会回退到 Qt，
    容易表现为窗口已打开但前端脚本或 JS bridge 异常（白屏）。默认固定 Cocoa，让缺失依赖尽早
    变成明确的安装错误。需要手动排查 Qt 后端时，仍可显式设置 ``PYWEBVIEW_GUI=qt`` 覆盖。
    """
    if sys.platform != "darwin":
        return
    os.environ.setdefault("PYWEBVIEW_GUI", "cocoa")


def _macos_pyobjc_runtime_hint() -> bool:
    """检查 Cocoa 后端所需的 PyObjC 模块是否可导入。"""
    if sys.platform != "darwin":
        return True
    return all(
        importlib.util.find_spec(name) is not None
        for name in ("AppKit", "Foundation", "WebKit", "objc", "PyObjCTools")
    )


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
_configure_macos_pywebview_env()

import webview

from app.ai_env import load_ai_model_defaults
from app.runtime_paths import bundle_root
from app.prompt_store import (
    read_raw_material_prompt_for_editor,
    read_raw_prompt_for_editor,
    render_from_api_context,
    render_material_from_api_context,
    reset_material_prompt_override as _reset_material_prompt_override,
    reset_prompt_override,
    save_material_prompt_override as _save_material_prompt_override,
    save_prompt_override,
)
from app.storage import BookStore, read_saved_workspace_root, write_saved_workspace_root


def _windows_webview2_runtime_hint() -> bool:
    """检测本机是否已登记 WebView2 Runtime（与 pywebview 选用 Edge/Chromium 引擎的前提一致）。

    若缺失，pywebview 在 Windows 上往往退回到 MSHTML（IE），无法执行 Vite 产出的 modern JS，
    表现为窗口空白。"""
    if not sys.platform.startswith("win"):
        return True
    try:
        import winreg  # noqa: PLC0415
    except ImportError:
        return True

    clsid = r"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    rel_parts = (
        rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{clsid}",
        rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{clsid}",
    )
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for subkey in rel_parts:
            try:
                with winreg.OpenKey(hive, subkey) as key:
                    pv, _ = winreg.QueryValueEx(key, "pv")
                    if pv and str(pv).strip() not in {"", "0"}:
                        return True
            except OSError:
                continue
    return False


def _dist_dir() -> Path:
    dist = bundle_root() / "web" / "dist"
    index = dist / "index.html"
    if not index.is_file():
        print(
            "前端未构建：请在 web 目录执行 npm install && npm run build",
            file=sys.stderr,
        )
        sys.exit(1)
    return dist


class DistHTTPRequestHandler(SimpleHTTPRequestHandler):
    """修补 Windows 等平台下 mimetypes / 注册表将 .js 标为 text/plain 的问题。

    Chromium 对 ``<script type=\"module\">`` 要求脚本为 JavaScript MIME，否则会拒绝执行（白屏）。
    """

    def guess_type(self, path: str) -> str:
        """Python 3.12+ 的 ``SimpleHTTPRequestHandler.guess_type`` 只返回类型字符串（非元组）。"""
        ext = Path(path).suffix.lower()
        if ext in ('.js', '.mjs'):
            return 'application/javascript'
        if ext == '.json':
            return 'application/json'
        if ext == '.css':
            return 'text/css'
        if ext in ('.html', '.htm'):
            return 'text/html'
        if ext == '.svg':
            return 'image/svg+xml'
        if ext == '.wasm':
            return 'application/wasm'
        return super().guess_type(path)


def _start_local_dist_server(dist_dir: Path) -> tuple[ThreadingHTTPServer, str]:
    """本机回环 HTTP 提供 dist，与 `npm run dev` 同为 http 源，避免 file:// 下 fetch 异常。"""
    handler = functools.partial(
        DistHTTPRequestHandler,
        directory=str(dist_dir.resolve()),
    )
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{port}/?pywebview=1"


def _app_icon_path() -> str | None:
    assets = bundle_root() / "app" / "assets"
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
        linked_material_id: str | None = None,
        expert_draft: dict | None = None,
    ) -> dict | None:
        return self._store.save_book(
            book_id,
            content=content,
            stages=stages,
            linked_material_id=linked_material_id,
            expert_draft=expert_draft,
        )

    def delete_book(self, book_id: str) -> bool:
        return self._store.delete_book(book_id)

    # ==================== 素材库 API ====================

    def list_materials(self) -> list[dict]:
        """列出所有素材"""
        return self._store.list_materials()

    def get_material(self, material_id: str) -> dict | None:
        """获取单个素材详情"""
        return self._store.get_material(material_id)

    def create_material(
        self,
        title: str,
        material_type: str,
        parent_genre: str | None = None,
        sub_genre: str | None = None,
        workspace_root: str | None = None,
    ) -> dict:
        """创建新素材

        Args:
            title: 素材标题
            material_type: 素材类型，'long' 或 'short'
            parent_genre: 父分类，短篇时为 '世情' 或 '情感'
            sub_genre: 子分类，如 '家庭'、'甜宠' 等
            workspace_root: 工作区根目录
        """
        return self._store.create_material(
            title, material_type, parent_genre, sub_genre, workspace_root
        )

    def save_material(
        self,
        material_id: str,
        stages: dict | None = None,
    ) -> dict | None:
        """保存素材阶段内容

        Args:
            material_id: 素材ID
            stages: 阶段内容字典，键为 'character'/'gimmick'/'pacing'
        """
        return self._store.save_material(material_id, stages)

    def delete_material(self, material_id: str) -> bool:
        """删除素材"""
        return self._store.delete_material(material_id)

    def get_material_genres(self) -> dict[str, list[str]]:
        """获取素材分类结构"""
        from app.models import SHORT_MATERIAL_GENRES
        return SHORT_MATERIAL_GENRES

    def get_workspace_root(self) -> str | None:
        return read_saved_workspace_root()

    def set_workspace_root(self, path: str | None) -> None:
        write_saved_workspace_root(path)

    def get_ai_defaults(self) -> dict[str, str] | None:
        """与 app/.env 同步的默认模型与 Key，供前端注入 Pi 存储并跳过首次选模型/填 Key。"""
        return load_ai_model_defaults()

    def get_workspace_system_prompt(
        self,
        workspace_kind: str,
        stage_id: str,
        context_json: str,
    ) -> str:
        return render_from_api_context(workspace_kind, stage_id, context_json)

    def read_workspace_prompt_template(
        self, workspace_kind: str, stage_id: str
    ) -> str:
        return read_raw_prompt_for_editor(workspace_kind, stage_id)

    def save_workspace_prompt_override(
        self, workspace_kind: str, stage_id: str, body: str
    ) -> None:
        save_prompt_override(workspace_kind, stage_id, body)

    def reset_workspace_prompt_override(
        self, workspace_kind: str, stage_id: str
    ) -> bool:
        return reset_prompt_override(workspace_kind, stage_id)

    # ==================== 素材库提示词 API ====================

    def get_material_system_prompt(
        self,
        material_kind: str,
        stage_id: str,
        context_json: str,
    ) -> str:
        return render_material_from_api_context(material_kind, stage_id, context_json)

    def read_material_prompt_template(
        self, material_kind: str, stage_id: str
    ) -> str:
        return read_raw_material_prompt_for_editor(material_kind, stage_id)

    def save_material_prompt_override(
        self, material_kind: str, stage_id: str, body: str
    ) -> None:
        _save_material_prompt_override(material_kind, stage_id, body)

    def reset_material_prompt_override(
        self, material_kind: str, stage_id: str
    ) -> bool:
        return _reset_material_prompt_override(material_kind, stage_id)


def main() -> None:
    store = BookStore()
    api = Api(store)
    _httpd, url = _start_local_dist_server(_dist_dir())
    webview.create_window(
        "涌泉写作",
        url,
        js_api=api,
        width=1500,
        height=1048,
        min_size=(640, 480),
    )
    if sys.platform.startswith("win") and not _windows_webview2_runtime_hint():
        print(
            "警告：未检测到 Microsoft Edge WebView2 Runtime 的常规安装登记。\n"
            "在未安装或未正确注册时，pywebview 可能退回到旧版 MSHTML，无法运行本应用前端（窗口常为白屏）。\n"
            "请安装 Evergreen WebView2 Runtime："
            "https://developer.microsoft.com/microsoft-edge/webview2/\n"
            "若安装后仍为白屏，可设置环境变量 WRITECLAW_DEBUG=1 后重新启动以打开开发者工具查看控制台错误。\n",
            file=sys.stderr,
        )
    if (
        sys.platform == "darwin"
        and os.environ.get("PYWEBVIEW_GUI", "").lower() == "cocoa"
        and not _macos_pyobjc_runtime_hint()
    ):
        print(
            "警告：macOS Cocoa 后端依赖 PyObjC，但当前 Python 环境未检测到完整的 "
            "AppKit/Foundation/WebKit/objc 模块。\n"
            "请在虚拟环境中执行 pip install -r requirements.txt，或单独执行 "
            "pip install pyobjc。若曾设置 PYWEBVIEW_GUI=qt，请先 unset PYWEBVIEW_GUI "
            "后再启动。\n",
            file=sys.stderr,
        )
    _debug = os.environ.get("WRITECLAW_DEBUG", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    webview.start(debug=_debug, icon=_app_icon_path())


if __name__ == "__main__":
    main()
