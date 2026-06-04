from __future__ import annotations

import base64
import functools
import http.client
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen


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

from app.runtime_paths import bundle_root
from app.prompt_store import (
    read_raw_material_prompt_for_editor,
    read_raw_material_agent_prompt_for_editor,
    read_raw_skill_agent_prompt_for_editor,
    read_raw_workspace_agent_prompt_for_editor,
    render_from_api_context,
    render_material_from_api_context,
    render_skill_from_api_context,
    reset_material_agent_prompt_override as _reset_material_agent_prompt_override,
    reset_material_prompt_override as _reset_material_prompt_override,
    reset_skill_agent_prompt_override as _reset_skill_agent_prompt_override,
    reset_workspace_agent_prompt_override as _reset_workspace_agent_prompt_override,
    save_material_agent_prompt_override as _save_material_agent_prompt_override,
    save_material_prompt_override as _save_material_prompt_override,
    save_skill_agent_prompt_override as _save_skill_agent_prompt_override,
    save_workspace_agent_prompt_override as _save_workspace_agent_prompt_override,
)
from app.storage import (
    BookStore,
    read_ai_model_config,
    read_ai_model_defaults,
    read_image_model_config,
    read_saved_workspace_root,
    read_workspace_agent_read_access,
    write_ai_model_config,
    write_saved_workspace_root,
    write_workspace_agent_read_access,
)


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

    def end_headers(self) -> None:
        # Vite 每次 build 会换 chunk 哈希；WebView2 若缓存旧 index.js，会 404 动态 import 的子模块。
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


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
        title: str | None = None,
        status: str | None = None,
    ) -> dict | None:
        return self._store.save_book(
            book_id,
            content=content,
            stages=stages,
            linked_material_id=linked_material_id,
            expert_draft=expert_draft,
            title=title,
            status=status,
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
            parent_genre: 父分类，短篇时为 '世情' 或 '追妻'
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
        title: str | None = None,
    ) -> dict | None:
        """保存素材阶段内容

        Args:
            material_id: 素材ID
            stages: 阶段内容字典，键为 'character'/'intro'/'gimmick'/'plot_refine'/'pacing'/'draft_excerpt'
            title: 素材标题
        """
        return self._store.save_material(material_id, stages, title)

    def delete_material(self, material_id: str) -> bool:
        """删除素材"""
        return self._store.delete_material(material_id)

    def get_material_genres(self) -> dict[str, list[str]]:
        """获取素材分类结构"""
        from app.models import SHORT_MATERIAL_GENRES
        return SHORT_MATERIAL_GENRES

    # ==================== 技能库 API ====================

    def list_skills(self, stage_id: str | None = None) -> list[dict]:
        """列出所有技能"""
        return self._store.list_skills(stage_id)

    def get_skill(self, skill_id: str) -> dict | None:
        """获取单个技能详情"""
        return self._store.get_skill(skill_id)

    def create_skill(
        self,
        title: str,
        genre: str,
        stage_id: str,
        workspace_root: str | None = None,
    ) -> dict:
        """创建新技能"""
        return self._store.create_skill(title, genre, stage_id, workspace_root)

    def save_skill(
        self,
        skill_id: str,
        payload: dict | None = None,
    ) -> dict | None:
        """保存单阶段技能内容。"""
        data = payload if isinstance(payload, dict) else {}
        return self._store.save_skill(
            skill_id,
            title=data.get("title") if "title" in data else None,
            genre=data.get("genre") if "genre" in data else None,
            stage_id=data.get("stage_id") if "stage_id" in data else None,
            body=data.get("body") if "body" in data else None,
        )

    def delete_skill(self, skill_id: str) -> bool:
        """删除技能"""
        return self._store.delete_skill(skill_id)

    def get_workspace_root(self) -> str | None:
        return read_saved_workspace_root()

    def set_workspace_root(self, path: str | None) -> None:
        write_saved_workspace_root(path)

    def get_workspace_agent_read_access(self) -> dict[str, object]:
        """全局创作空间智能体可读的 workspace/material 阶段列表。"""
        return read_workspace_agent_read_access()

    def set_workspace_agent_read_access(self, config: dict[str, object]) -> None:
        if not isinstance(config, dict):
            raise ValueError("workspace_agent_read_access 须为对象")
        write_workspace_agent_read_access(config)

    def get_ai_model_config(self) -> dict[str, object]:
        """读取本地模型配置，首次为空时从旧 `.env` 导入。"""
        return read_ai_model_config()

    def save_ai_model_config(self, config: dict[str, object]) -> dict[str, object]:
        """保存模型配置到 `.data/preferences.json`。"""
        if not isinstance(config, dict):
            raise ValueError("ai_model_config 须为对象")
        return write_ai_model_config(config)

    def get_ai_defaults(self) -> dict[str, object] | None:
        """从界面模型配置派生默认文字模型，供前端注入 Pi 存储。"""
        return read_ai_model_defaults()

    def get_workspace_system_prompt(
        self,
        stage_id: str,
        context_json: str,
    ) -> str:
        return render_from_api_context(stage_id, context_json)

    def read_workspace_agent_prompt_template(self, agent_id: str) -> str:
        return read_raw_workspace_agent_prompt_for_editor(agent_id)

    def save_workspace_agent_prompt_override(self, agent_id: str, body: str) -> None:
        _save_workspace_agent_prompt_override(agent_id, body)

    def reset_workspace_agent_prompt_override(self, agent_id: str) -> bool:
        return _reset_workspace_agent_prompt_override(agent_id)

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

    def read_material_agent_prompt_template(self) -> str:
        return read_raw_material_agent_prompt_for_editor()

    def save_material_agent_prompt_override(self, body: str) -> None:
        _save_material_agent_prompt_override(body)

    def reset_material_agent_prompt_override(self) -> bool:
        return _reset_material_agent_prompt_override()

    # ==================== 技能库提示词 API ====================

    def get_skill_system_prompt(
        self,
        stage_id: str,
        context_json: str,
    ) -> str:
        return render_skill_from_api_context(stage_id, context_json)

    def read_skill_agent_prompt_template(self) -> str:
        return read_raw_skill_agent_prompt_for_editor()

    def save_skill_agent_prompt_override(self, body: str) -> None:
        _save_skill_agent_prompt_override(body)

    def reset_skill_agent_prompt_override(self) -> bool:
        return _reset_skill_agent_prompt_override()

    def get_book_cover(self, book_id: str) -> dict:
        """获取书籍封面图片（base64）。

        Returns:
            {"cover_data": str | None}  base64 编码的 PNG 图片，不含 data URI 前缀
        """
        book = self._store.get_book(book_id)
        if not book:
            return {"cover_data": None}
        output_dir = book.get("output_dir", "")
        if not output_dir:
            return {"cover_data": None}
        cover = Path(output_dir) / "cover.png"
        if cover.is_file():
            try:
                data = cover.read_bytes()
                return {"cover_data": base64.b64encode(data).decode("utf-8")}
            except Exception:
                return {"cover_data": None}
        return {"cover_data": None}

    def generate_book_cover(self, book_id: str, prompt: str) -> dict:
        """调用图像生成 API 为书籍生成封面，保存到 output_dir/cover.png。

        Args:
            book_id: 书籍 ID
            prompt: 图像生成提示词

        Returns:
            {"cover_path": str | None, "success": bool, "error": str | None}
        """
        book = self._store.get_book(book_id)
        if not book:
            return {"cover_path": None, "success": False, "error": "书籍不存在"}
        output_dir = book.get("output_dir", "")
        if not output_dir:
            return {"cover_path": None, "success": False, "error": "书籍未设置工作目录"}
        if not read_image_model_config():
            return {"cover_path": None, "success": False, "error": "未配置图像模型，请先在首页配置模型"}
        cover_path = generate_image(prompt, output_dir)
        if not cover_path:
            return {"cover_path": None, "success": False, "error": "图片生成失败"}
        return {"cover_path": str(cover_path), "success": True, "error": None}

    def export_docx(
        self,
        book_id: str,
        stage_id: str,
        folder_path: str,
        content: str,
        cover_data: str | None = None,
    ) -> dict:
        """将指定阶段内容导出为 docx，文件名使用小说名，第一页插入封面（如有）。

        Args:
            book_id: 书籍 ID
            stage_id: 阶段 ID
            folder_path: 用户选择的保存文件夹
            content: 阶段文本内容
            cover_data: 封面图片 base64（不含 data URI 前缀），可选

        Returns:
            {"success": bool, "error": str | None, "path": str | None}
        """
        try:
            book = self._store.get_book(book_id)
            if not book:
                return {"success": False, "error": "书籍不存在", "path": None}

            from docx import Document
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            from docx.shared import Inches

            title = book.get("title", "未命名").strip() or "未命名"
            safe_title = "".join(c for c in title if c not in r'\/:*?"<>|').strip() or "未命名"
            filename = f"{safe_title}.docx"
            output_path = Path(folder_path) / filename

            doc = Document()

            if cover_data:
                try:
                    image_bytes = base64.b64decode(cover_data)
                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                        tmp.write(image_bytes)
                        tmp_path = tmp.name
                    paragraph = doc.add_paragraph()
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    run = paragraph.add_run()
                    run.add_picture(tmp_path, width=Inches(4.5))
                    os.unlink(tmp_path)
                    doc.add_page_break()
                except Exception as e:
                    print(f"插入封面失败: {e}")

            if content:
                for line in content.split("\n"):
                    if line.strip():
                        doc.add_paragraph(line)
            else:
                doc.add_paragraph("")

            doc.save(str(output_path))
            return {"success": True, "error": None, "path": str(output_path)}
        except Exception as e:
            return {"success": False, "error": str(e), "path": None}


def _truncate_image_response(value: object, max_len: int = 1200) -> str:
    text = json.dumps(value, ensure_ascii=False)
    if len(text) <= max_len:
        return text
    return text[:max_len] + f"...[{len(text)}]"


def _is_supported_image(data: bytes) -> bool:
    return (
        data.startswith(b"\x89PNG\r\n\x1a\n")
        or data.startswith(b"\xff\xd8\xff")
        or data.startswith(b"RIFF") and data[8:12] == b"WEBP"
        or data.startswith(b"GIF87a")
        or data.startswith(b"GIF89a")
    )


def _decode_image_base64(raw: str) -> bytes | None:
    value = raw.strip()
    if not value:
        return None
    if value.startswith("data:"):
        _header, sep, rest = value.partition(",")
        if not sep:
            return None
        value = rest
    try:
        data = base64.b64decode(value, validate=False)
    except Exception:
        return None
    if not _is_supported_image(data):
        return None
    return data


def _download_image(url: str) -> bytes | None:
    try:
        req = Request(url, headers={"Accept": "image/*"})
        with urlopen(req, timeout=60) as res:
            data = res.read()
    except Exception as e:
        print(f"下载图片 URL 失败: {e}")
        return None
    if not _is_supported_image(data):
        print("图片 URL 返回的不是受支持的图片格式")
        return None
    return data


def _extract_image_bytes(body: object) -> bytes | None:
    if isinstance(body, str):
        return _decode_image_base64(body)
    if isinstance(body, list):
        for item in body:
            found = _extract_image_bytes(item)
            if found:
                return found
        return None
    if not isinstance(body, dict):
        return None

    for key in ("b64_json", "base64", "image_base64", "image", "result"):
        value = body.get(key)
        if isinstance(value, str):
            found = _decode_image_base64(value)
            if found:
                return found

    for key in ("inline_data", "inlineData"):
        inline = body.get(key)
        if isinstance(inline, dict) and isinstance(inline.get("data"), str):
            found = _decode_image_base64(inline["data"])
            if found:
                return found

    url = body.get("url")
    if isinstance(url, str) and url.strip():
        found = _download_image(url.strip())
        if found:
            return found

    for value in body.values():
        found = _extract_image_bytes(value)
        if found:
            return found
    return None


def _image_api_request_target(base_url: str) -> tuple[str, str, bool]:
    parsed = urlparse(base_url.rstrip("/"))
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"图片 API 地址无效: {base_url}")
    prefix = parsed.path.rstrip("/")
    if not prefix:
        prefix = "/v1"
    path = f"{prefix}/images/generations"
    return parsed.netloc, path, parsed.scheme == "https"


def generate_image(prompt: str, output_dir: str | Path = ".data/image") -> Path | None:
    """调用图像生成 API，将返回的图片保存为 PNG。"""
    try:
        image_defaults = read_image_model_config()
        if not image_defaults:
            print("未配置图片生成模型，请先在首页配置图像模型")
            return None
        host, path, use_https = _image_api_request_target(
            image_defaults.get("base_url", "https://sucloud.vip"),
        )
        conn_cls = http.client.HTTPSConnection if use_https else http.client.HTTPConnection
        conn = conn_cls(host, timeout=120)
        payload = json.dumps({
            "size": "1024x1536",
            "prompt": prompt,
            "model": image_defaults["model"],
            "n": 1,
        })
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {image_defaults['api_key']}",
            "Content-Type": "application/json",
        }
        conn.request("POST", path, payload, headers)
        res = conn.getresponse()
        data = res.read()
        body = json.loads(data)

        if res.status >= 400:
            print(
                f"图片 API 请求失败: HTTP {res.status} {res.reason} "
                f"{_truncate_image_response(body)}"
            )
            return None

        image_bytes = _extract_image_bytes(body)
        if not image_bytes:
            print(f"API 未返回图片数据: {_truncate_image_response(body)}")
            return None

        dest = Path(output_dir)
        dest.mkdir(parents=True, exist_ok=True)

        filename = "cover.png"
        filepath = dest / filename
        filepath.write_bytes(image_bytes)

        print(f"图片已保存: {filepath}")
        return filepath
    except Exception as e:
        print(f"生成图片失败: {e}")
        return None


def main() -> None:
    store = BookStore()
    api = Api(store)
    _httpd, url = _start_local_dist_server(_dist_dir())
    webview.create_window(
        "DeepseekWrite",
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
