from __future__ import annotations

import base64
from datetime import datetime, timezone
import functools
import html
import http.client
import importlib.util
import inspect
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import socket
import ssl
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote_to_bytes, urlparse
from urllib.request import Request, urlopen

# 桌面壳内浏览器/WebView 无法直连部分 LLM API（无 CORS）；经本地 HTTP 转发。
_LLM_PROXY_UPSTREAM: dict[str, str] = {
    "kimi-coding": "https://api.kimi.com/coding",
    "moonshotai-cn": "https://api.moonshot.cn/v1",
    "moonshotai": "https://api.moonshot.ai/v1",
}
_LLM_PROXY_SKIP_REQUEST_HEADERS = frozenset(
    {
        "host",
        "connection",
        "content-length",
        "accept-encoding",
        "transfer-encoding",
    }
)
_LLM_PROXY_SKIP_RESPONSE_HEADERS = frozenset(
    {
        "transfer-encoding",
        "connection",
        "content-encoding",
        "content-length",
    }
)
_LLM_PROXY_STREAM_CHUNK_SIZE = 512


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


def _configure_windows_webview2_proxy_env() -> None:
    if not sys.platform.startswith("win"):
        return
    disable_proxy = os.environ.get("DEEPSEEKWRITE_WEBVIEW2_DISABLE_PROXY", "")
    if disable_proxy.strip().lower() not in ("1", "true", "yes", "on"):
        return
    key = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
    current = os.environ.get(key, "").strip()
    current_lower = current.lower()
    if "--proxy-server" in current_lower or "--no-proxy-server" in current_lower:
        return
    os.environ[key] = f"{current} --no-proxy-server".strip()


_configure_windows_webview2_proxy_env()

import webview

from app.runtime_paths import app_data_root, bundle_root, data_root, writable_root
from app.prompt_store import (
    read_raw_learning_imitation_prompt_for_editor,
    read_raw_material_prompt_for_editor,
    read_raw_material_agent_prompt_for_editor,
    read_raw_skill_agent_prompt_for_editor,
    read_raw_workspace_agent_prompt_for_editor,
    render_from_api_context,
    render_learning_imitation_from_api_context,
    render_material_from_api_context,
    render_skill_from_api_context,
    reset_learning_imitation_prompt_override as _reset_learning_imitation_prompt_override,
    reset_material_agent_prompt_override as _reset_material_agent_prompt_override,
    reset_material_prompt_override as _reset_material_prompt_override,
    reset_skill_agent_prompt_override as _reset_skill_agent_prompt_override,
    reset_workspace_agent_prompt_override as _reset_workspace_agent_prompt_override,
    save_learning_imitation_prompt_override as _save_learning_imitation_prompt_override,
    save_material_agent_prompt_override as _save_material_agent_prompt_override,
    save_material_prompt_override as _save_material_prompt_override,
    save_skill_agent_prompt_override as _save_skill_agent_prompt_override,
    save_workspace_agent_prompt_override as _save_workspace_agent_prompt_override,
    sync_workspace_prompt_defaults as _sync_workspace_prompt_defaults,
)
from app.models import SCRIPT_STAGE_KEYS, SHORT_STAGE_KEYS, long_stage_keys_from_stages
from app.storage import (
    BookStore,
    read_appearance_style,
    read_ai_model_config,
    read_ai_model_defaults,
    read_image_model_config,
    read_saved_workspace_root,
    read_text_display_mode,
    read_user_memories,
    read_workspace_agent_read_access,
    read_workspace_agent_read_access_defaults,
    read_workspace_agent_read_access_for_type,
    sync_workspace_agent_read_access_defaults,
    write_appearance_style,
    write_ai_model_config,
    write_saved_workspace_root,
    write_text_display_mode,
    write_user_memories,
    write_workspace_agent_read_access,
    write_workspace_agent_read_access_for_type,
)
from app.ai_chat_history import (
    delete_ai_chat_session,
    delete_ai_chat_sessions_for_owner,
    get_ai_chat_session,
    list_ai_chat_sessions,
    save_ai_chat_session,
)
from app.update_service import (
    check_for_update as _check_for_update,
    download_latest_update as _download_latest_update,
)


_WEBVIEW2_INSTALLER_NAME = "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
_WEBVIEW2_DOWNLOAD_URL = "https://developer.microsoft.com/microsoft-edge/webview2/"
_WEBVIEW2_REQUIRED_PAGE = "webview2-required.html"


def _find_msedgewebview2_dir(root: Path) -> Path | None:
    """返回包含 msedgewebview2.exe 的目录（用于捆绑的 Fixed Version 运行时）。"""
    if not root.is_dir():
        return None
    if (root / "msedgewebview2.exe").is_file():
        return root
    for candidate in root.rglob("msedgewebview2.exe"):
        return candidate.parent
    return None


def _bundled_webview2_installer() -> Path | None:
    if not sys.platform.startswith("win"):
        return None
    for base in (writable_root(), bundle_root()):
        candidate = base / _WEBVIEW2_INSTALLER_NAME
        if candidate.is_file():
            return candidate
    return None


def _ensure_windows_webview2() -> None:
    """优先使用捆绑运行时；否则在缺少系统 WebView2 时用离线安装包静默安装。"""
    if not sys.platform.startswith("win"):
        return

    bundled_runtime = _find_msedgewebview2_dir(bundle_root() / "webview2_runtime")
    if bundled_runtime is not None:
        webview.settings["WEBVIEW2_RUNTIME_PATH"] = str(bundled_runtime)
        return

    if _windows_webview2_runtime_hint():
        return

    installer = _bundled_webview2_installer()
    if installer is None:
        return

    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.run(
        [str(installer), "/silent", "/install"],
        check=False,
        creationflags=flags,
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


def _resolve_llm_proxy_target(path: str, query: str) -> str | None:
    """将 ``/llm-proxy/{alias}/...`` 映射到上游 LLM API URL。"""
    if not path.startswith("/llm-proxy/"):
        return None
    remainder = path[len("/llm-proxy/") :]
    slash = remainder.find("/")
    if slash <= 0:
        return None
    alias = remainder[:slash]
    upstream_base = _LLM_PROXY_UPSTREAM.get(alias)
    if not upstream_base:
        return None
    subpath = remainder[slash + 1 :]
    target = f"{upstream_base.rstrip('/')}/{subpath}"
    if query:
        target = f"{target}?{query}"
    return target


def _open_upstream_http_connection(
    parsed_target: urlparse,
) -> http.client.HTTPConnection | http.client.HTTPSConnection:
    host = parsed_target.hostname
    if not host:
        raise URLError("missing upstream hostname")
    port = parsed_target.port or (443 if parsed_target.scheme == "https" else 80)
    if parsed_target.scheme == "https":
        return http.client.HTTPSConnection(
            host,
            port,
            timeout=600,
            context=ssl.create_default_context(),
        )
    return http.client.HTTPConnection(host, port, timeout=600)


def _stream_upstream_http_response(
    handler: SimpleHTTPRequestHandler,
    resp: http.client.HTTPResponse,
) -> None:
    handler.send_response(resp.status)
    handler._send_cors_headers()
    for key, value in resp.getheaders():
        if key.lower() in _LLM_PROXY_SKIP_RESPONSE_HEADERS:
            continue
        handler.send_header(key, value)
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()
    try:
        handler.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except OSError:
        pass
    # 须走 wfile，让 BaseHTTPRequestHandler 自动做 chunked 分块；直接 sendall 会导致
    # 客户端等到连接关闭才解析 SSE，表现为「非流式」。
    while True:
        chunk = resp.read(_LLM_PROXY_STREAM_CHUNK_SIZE)
        if not chunk:
            break
        handler.wfile.write(chunk)
        handler.wfile.flush()


class DistHTTPRequestHandler(SimpleHTTPRequestHandler):
    """修补 Windows 等平台下 mimetypes / 注册表将 .js 标为 text/plain 的问题。

    Chromium 对 ``<script type=\"module\">`` 要求脚本为 JavaScript MIME，否则会拒绝执行（白屏）。
    """

    def _send_cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        )
        self.send_header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, X-Api-Key, X-Requested-With, "
            "Anthropic-Beta, Anthropic-Dangerous-Direct-Browser-Access, "
            "Anthropic-Version, User-Agent",
        )
        self.send_header("Access-Control-Max-Age", "86400")

    def _handle_llm_proxy(self, method: str) -> None:
        parsed = urlparse(self.path)
        target_url = _resolve_llm_proxy_target(parsed.path, parsed.query)
        if not target_url:
            self.send_error(404, "Unknown llm-proxy target")
            return

        content_length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(content_length) if content_length > 0 else None

        forward_headers: dict[str, str] = {}
        for key, value in self.headers.items():
            if key.lower() in _LLM_PROXY_SKIP_REQUEST_HEADERS:
                continue
            forward_headers[key] = value

        parsed_target = urlparse(target_url)
        path = parsed_target.path or "/"
        if parsed_target.query:
            path = f"{path}?{parsed_target.query}"

        conn: http.client.HTTPConnection | http.client.HTTPSConnection | None = None
        try:
            conn = _open_upstream_http_connection(parsed_target)
            conn.request(method, path, body=body, headers=forward_headers)
            resp = conn.getresponse()
            _stream_upstream_http_response(self, resp)
            resp.close()
        except HTTPError as exc:
            payload = exc.read()
            self.send_response(exc.code)
            self._send_cors_headers()
            for key, value in exc.headers.items():
                if key.lower() in _LLM_PROXY_SKIP_RESPONSE_HEADERS:
                    continue
                self.send_header(key, value)
            self.end_headers()
            if payload:
                self.wfile.write(payload)
                self.wfile.flush()
        except (URLError, OSError, http.client.HTTPException) as exc:
            message = str(getattr(exc, "reason", None) or exc)
            body_bytes = json.dumps(
                {"error": {"message": message, "type": "proxy_error"}},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(502)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body_bytes)))
            self.end_headers()
            self.wfile.write(body_bytes)
            self.wfile.flush()
        finally:
            if conn is not None:
                conn.close()

    def do_OPTIONS(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/llm-proxy/"):
            self.send_response(204)
            self._send_cors_headers()
            self.end_headers()
            return
        self.send_error(405)

    def do_POST(self) -> None:
        if urlparse(self.path).path.startswith("/llm-proxy/"):
            self._handle_llm_proxy("POST")
            return
        self.send_error(405)

    def do_GET(self) -> None:
        if urlparse(self.path).path.startswith("/llm-proxy/"):
            self._handle_llm_proxy("GET")
            return
        # WebView2 真实加载页面（非后端探活）即视为启动成功，清除"上次启动失败"标记。
        if self.headers.get("X-DeepSeekWrite-Probe") != "1":
            _clear_boot_flag_once()
        return super().do_GET()

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

    def log_message(self, format: str, *args: object) -> None:
        if self.headers.get("X-DeepSeekWrite-Probe") == "1":
            return
        super().log_message(format, *args)


class _DistServerState:
    """本机页面服务运行态：serve_forever 异常退出后由同线程自动重启，避免 WebView2 导航到死端口。"""

    def __init__(self, httpd: ThreadingHTTPServer, port: int, handler) -> None:
        self.httpd = httpd
        self.port = port
        self.handler = handler
        self.lock = threading.Lock()
        self.restart_count = 0
        self.fatal = False

    @property
    def probe_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/?pywebview=1"


def _serve_dist_with_watchdog(state: _DistServerState) -> None:
    """serve_forever 异常退出时自动同端口重启；重启失败置 fatal 并打印致命错误。"""
    while not state.fatal:
        try:
            state.httpd.serve_forever()
            return  # 正常 shutdown（程序退出）
        except Exception as exc:  # noqa: BLE001
            print(f"本机页面服务异常退出：{exc}，尝试重启...", file=sys.stderr)
        time.sleep(0.5)
        with state.lock:
            if state.fatal:
                return
            try:
                state.httpd.server_close()
            except Exception:  # noqa: BLE001
                pass
            try:
                state.httpd = ThreadingHTTPServer(
                    ("127.0.0.1", state.port),
                    state.handler,
                )
                state.restart_count += 1
                print(
                    f"本机页面服务已重启（第 {state.restart_count} 次，端口 {state.port}）",
                    file=sys.stderr,
                )
            except OSError as exc:
                print(
                    f"致命错误：本机页面服务重启失败（端口 {state.port}）：{exc}\n"
                    "WebView2 将无法加载页面，请重启应用。",
                    file=sys.stderr,
                )
                state.fatal = True
                return


def _start_local_dist_server(dist_dir: Path) -> tuple[ThreadingHTTPServer, str]:
    """本机回环 HTTP 提供 dist，与 `npm run dev` 同为 http 源，避免 file:// 下 fetch 异常。

    绑定/探活失败时重试最多 3 次；全部失败则明确报错退出，避免 WebView2 导航到死端口
    而显示原生错误页（错误代码 39）。serve_forever 运行期异常由看门狗自动同端口重启。
    """
    handler = functools.partial(
        DistHTTPRequestHandler,
        directory=str(dist_dir.resolve()),
    )
    last_error: BaseException | None = None
    for attempt in range(3):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        except OSError as exc:
            last_error = exc
            print(
                f"本机页面服务绑定失败（第 {attempt + 1} 次）：{exc}",
                file=sys.stderr,
            )
            time.sleep(0.2)
            continue
        port = httpd.server_address[1]
        state = _DistServerState(httpd, port, handler)
        threading.Thread(
            target=_serve_dist_with_watchdog,
            args=(state,),
            daemon=True,
            name="dist-http-server",
        ).start()
        if _wait_for_local_dist_server(state.probe_url):
            host = os.environ.get("DEEPSEEKWRITE_DESKTOP_HOST", "").strip() or "127.0.0.1"
            return httpd, f"http://{host}:{port}/?pywebview=1"
        print(
            f"本机页面服务探活失败（第 {attempt + 1} 次）：{state.probe_url}",
            file=sys.stderr,
        )
        try:
            state.fatal = True
            httpd.shutdown()
            httpd.server_close()
        except Exception:  # noqa: BLE001
            pass
        last_error = RuntimeError(f"probe failed: {state.probe_url}")
        time.sleep(0.2)
    print(
        "致命错误：本机页面服务在多次重试后仍不可用，无法启动窗口。\n"
        "可能原因：127.0.0.1 被防火墙拦截、端口资源耗尽、dist 目录不可读。\n"
        "可尝试：设置 DEEPSEEKWRITE_FORCE_FILE_URL=1 改用 file:// 模式启动后排查。",
        file=sys.stderr,
    )
    if last_error is not None:
        print(f"最后错误：{last_error}", file=sys.stderr)
    sys.exit(1)


def _wait_for_local_dist_server(url: str, timeout_seconds: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout_seconds
    last_error: BaseException | None = None
    while time.monotonic() < deadline:
        try:
            request = Request(
                url,
                headers={"Cache-Control": "no-cache", "X-DeepSeekWrite-Probe": "1"},
            )
            with urlopen(request, timeout=0.5) as response:
                return 200 <= response.status < 500
        except HTTPError as exc:
            return 200 <= exc.code < 500
        except (OSError, URLError) as exc:
            last_error = exc
            time.sleep(0.05)
    if last_error is not None:
        print(f"本机页面服务探活失败：{last_error}", file=sys.stderr)
    return False


def _dist_file_url(dist_dir: Path) -> str:
    return _dist_file_url_for_page(dist_dir, "index.html")


def _dist_file_url_for_page(dist_dir: Path, page_name: str) -> str:
    return f"{(dist_dir / page_name).resolve().as_uri()}?pywebview=1"


def _resolve_main_window_url(
    dist_dir: Path,
    base_url: str,
) -> str:
    """未检测到 WebView2 时加载独立提示页（兼容 MSHTML 回退，避免白屏无提示）。"""
    if not sys.platform.startswith("win") or _windows_webview2_runtime_hint():
        return base_url
    page = dist_dir / _WEBVIEW2_REQUIRED_PAGE
    if not page.is_file():
        return base_url
    parsed = urlparse(base_url)
    query = f"?{parsed.query}" if parsed.query else ""
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}/{_WEBVIEW2_REQUIRED_PAGE}{query}"
    return _dist_file_url_for_page(dist_dir, _WEBVIEW2_REQUIRED_PAGE)


def _resolve_desktop_url(dist_dir: Path) -> tuple[ThreadingHTTPServer | None, str]:
    force_file = os.environ.get("DEEPSEEKWRITE_FORCE_FILE_URL", "")
    if force_file.strip().lower() in ("1", "true", "yes", "on"):
        return None, _dist_file_url(dist_dir)
    return _start_local_dist_server(dist_dir)


def _resolve_webview_user_data_folder() -> str | None:
    """固定 WebView2/浏览器后端用户数据目录到可写位置，避免临时目录损坏导致渲染进程启动失败。

    Windows 上 WebView2 会在此目录存缓存、IndexedDB 与渲染状态；异常关机、杀毒软件隔离、
    磁盘错误都可能让该目录损坏，表现为"此页存在问题 错误代码:39"。固定到用户数据目录后，
    可通过 DEEPSEEKWRITE_RESET_WEBVIEW_DATA=1 启动时清空重建，自愈该类故障而不必重装应用。
    """
    if not sys.platform.startswith("win"):
        # macOS WKWebView / Linux Qt 后端对 user_data_folder 支持不一，保持默认行为。
        return None
    folder = app_data_root() / "WebViewData"
    reset = os.environ.get("DEEPSEEKWRITE_RESET_WEBVIEW_DATA", "").strip().lower()
    if reset in ("1", "true", "yes", "on"):
        try:
            if folder.exists():
                shutil.rmtree(folder)
                print(f"已清空 WebView2 用户数据目录：{folder}", file=sys.stderr)
        except OSError as exc:
            print(f"清空 WebView2 用户数据目录失败：{exc}", file=sys.stderr)
    return str(folder)


def _webview_start_accepts_parameter(name: str) -> bool:
    try:
        signature = inspect.signature(webview.start)
    except (TypeError, ValueError):
        return False
    if name in signature.parameters:
        return True
    return any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    )


def _webview_start_options(debug: bool) -> dict[str, object]:
    options: dict[str, object] = {
        "debug": debug,
        "icon": _app_icon_path(),
    }
    user_data_folder = _resolve_webview_user_data_folder()
    if user_data_folder is None:
        return options

    if _webview_start_accepts_parameter("storage_path"):
        options["storage_path"] = user_data_folder
    elif _webview_start_accepts_parameter("user_data_folder"):
        options["user_data_folder"] = user_data_folder
    else:
        print(
            "警告：当前 pywebview 版本不支持固定浏览器用户数据目录，"
            "将使用 pywebview 默认缓存目录启动。",
            file=sys.stderr,
        )
        return options

    if _webview_start_accepts_parameter("private_mode"):
        options["private_mode"] = False
    return options


_BOOT_FLAG_FILE = ".webview_boot.flag"
_boot_flag_lock = threading.Lock()
_boot_flag_cleared = False


def _boot_flag_path() -> Path:
    return data_root() / _BOOT_FLAG_FILE


def _clear_boot_flag_once() -> None:
    """WebView2 首次真实加载页面时清除启动失败标记（幂等，线程安全）。"""
    global _boot_flag_cleared
    with _boot_flag_lock:
        if _boot_flag_cleared:
            return
        _boot_flag_cleared = True
    try:
        _boot_flag_path().unlink(missing_ok=True)
    except OSError:
        pass


def _mark_boot_start() -> None:
    """记录本次启动开始；WebView2 成功加载页面后由 HTTP handler 清除。"""
    try:
        _boot_flag_path().write_text(str(time.time()), encoding="utf-8")
    except OSError:
        pass


def _check_and_reset_stale_webview_data() -> None:
    """启动时若上次启动的标记仍在，说明上次窗口没能成功加载页面（WebView2 渲染进程崩溃 /
    用户数据目录损坏的典型表现，即"此页存在问题 错误代码:39"）。自动清空 WebView2 用户数据
    目录后重建，让本次启动自愈——普通用户只需"关闭再打开"即可恢复，无需手动设置环境变量。
    """
    if not sys.platform.startswith("win"):
        return
    flag = _boot_flag_path()
    if not flag.is_file():
        return
    folder = app_data_root() / "WebViewData"
    try:
        if folder.exists():
            shutil.rmtree(folder)
            print(
                "检测到上次启动未能正常加载页面，已自动清空 WebView2 用户数据目录以尝试恢复。",
                file=sys.stderr,
            )
    except OSError as exc:
        print(f"自动清空 WebView2 用户数据目录失败：{exc}", file=sys.stderr)


def _app_icon_path() -> str | None:
    assets = bundle_root() / "app" / "assets"
    # Linux GTK：GdkPixbuf 无法载入「PNG 压缩帧」的 .ico，窗口图标需使用 PNG。
    if sys.platform.startswith("linux"):
        png = assets / "app-icon.png"
        return str(png.resolve()) if png.is_file() else None
    ico = assets / "app-icon.ico"
    return str(ico.resolve()) if ico.is_file() else None


_COVER_MIME_BY_SUFFIX: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
}
_COVER_FILE_NAMES: tuple[str, ...] = (
    "cover.png",
    "cover.jpg",
    "cover.jpeg",
    "cover.webp",
    "cover.gif",
    "cover.svg",
)


def _safe_zip_leaf(name: str, fallback: str) -> str:
    raw = Path(str(name or "").replace("\\", "/")).name.strip()
    if not raw:
        raw = fallback
    for ch in '<>:"/\\|?*\n\r\t':
        raw = raw.replace(ch, "_")
    raw = raw.strip(" .")
    return raw or fallback


def _safe_zip_text_path(*parts: str) -> str:
    return "/".join(_safe_zip_leaf(part, "untitled") for part in parts if part)


def _normalize_zip_path(path: str) -> str:
    return (
        str(path or "")
        .replace("\\", "/")
        .lstrip("/")
        .replace("//", "/")
        .rstrip("/")
    )


def _find_zip_member(zf, candidates: list[str]) -> str | None:
    normalized = [_normalize_zip_path(candidate) for candidate in candidates]
    for name in zf.namelist():
        path = _normalize_zip_path(name)
        if not path:
            continue
        if any(path == candidate or path.endswith(f"/{candidate}") for candidate in normalized):
            return name
    return None


def _read_zip_json(zf, candidates: list[str]) -> dict | None:
    member = _find_zip_member(zf, candidates)
    if not member:
        return None
    data = json.loads(zf.read(member).decode("utf-8"))
    return data if isinstance(data, dict) else None


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _image_suffix_from_bytes(data: bytes, fallback: str = ".png") -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return ".gif"
    return fallback


def _cover_data_to_bytes(raw: str) -> tuple[bytes, str] | None:
    value = (raw or "").strip()
    if not value:
        return None
    suffix = ".png"
    if value.startswith("data:"):
        header, sep, payload = value.partition(",")
        if not sep:
            return None
        mime = header[5:].split(";", 1)[0].lower()
        suffix = next(
            (ext for ext, ext_mime in _COVER_MIME_BY_SUFFIX.items() if ext_mime == mime),
            suffix,
        )
        if mime == "image/svg+xml" and ";base64" not in header:
            try:
                return unquote_to_bytes(payload), ".svg"
            except Exception:
                return None
        value = payload
    try:
        data = base64.b64decode(value, validate=False)
    except Exception:
        return None
    if suffix == ".svg" or _is_supported_image(data):
        return data, _image_suffix_from_bytes(data, suffix)
    return None


def _safe_export_title(title: object) -> str:
    value = str(title or "未命名").strip() or "未命名"
    return "".join(c for c in value if c not in r'\/:*?"<>|').strip() or "未命名"


def _normalize_export_body(content: str | None) -> str:
    return (content or "").replace("\r\n", "\n").replace("\r", "\n")


def _export_paragraphs(content: str | None) -> list[str]:
    paragraphs = [
        line
        for line in _normalize_export_body(content).split("\n")
        if line.strip()
    ]
    return paragraphs or [""]


def _write_docx_export(
    output_path: Path,
    content: str | None,
    cover_data: str | None = None,
) -> None:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Inches

    doc = Document()

    if cover_data:
        tmp_path: str | None = None
        try:
            decoded_cover = _cover_data_to_bytes(cover_data)
            if not decoded_cover:
                raise ValueError("unsupported cover data")
            image_bytes, image_suffix = decoded_cover
            with tempfile.NamedTemporaryFile(suffix=image_suffix, delete=False) as tmp:
                tmp.write(image_bytes)
                tmp_path = tmp.name
            paragraph = doc.add_paragraph()
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = paragraph.add_run()
            run.add_picture(tmp_path, width=Inches(4.5))
            doc.add_page_break()
        except Exception as e:
            print(f"插入封面失败: {e}")
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    for paragraph_text in _export_paragraphs(content):
        doc.add_paragraph(paragraph_text)

    doc.save(str(output_path))


def _write_txt_export(output_path: Path, content: str | None) -> None:
    output_path.write_text(_normalize_export_body(content), encoding="utf-8")


def _write_epub_export(
    output_path: Path,
    title: str,
    book_id: str,
    stage_id: str,
    content: str | None,
    cover_data: str | None = None,
) -> None:
    import zipfile

    escaped_title = html.escape(title, quote=True)
    identifier = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, f'writeclaw:{book_id}:{stage_id}')}"
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    paragraphs = _export_paragraphs(content)
    paragraph_html = "\n".join(
        f"      <p>{html.escape(paragraph)}</p>"
        for paragraph in paragraphs
    )

    cover_manifest = ""
    cover_section = ""
    cover_payload: tuple[bytes, str, str] | None = None
    if cover_data:
        decoded_cover = _cover_data_to_bytes(cover_data)
        if decoded_cover:
            cover_bytes, cover_suffix = decoded_cover
            cover_mime = _COVER_MIME_BY_SUFFIX.get(cover_suffix.lower())
            if cover_mime:
                cover_payload = (cover_bytes, cover_suffix.lower(), cover_mime)
                cover_href = f"images/cover{cover_suffix.lower()}"
                cover_manifest = (
                    f'    <item id="cover-image" href="{cover_href}" '
                    f'media-type="{cover_mime}" properties="cover-image"/>\n'
                )
                cover_section = (
                    '    <section epub:type="cover" class="cover">\n'
                    f'      <img src="../{cover_href}" alt="{escaped_title}"/>\n'
                    "    </section>\n"
                )

    container_xml = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""
    package_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">{identifier}</dc:identifier>
    <dc:title>{escaped_title}</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">{modified}</meta>
  </metadata>
  <manifest>
{cover_manifest}    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="styles/style.css" media-type="text/css"/>
    <item id="body" href="text/body.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="body"/>
  </spine>
</package>
"""
    nav_xhtml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
  <head>
    <title>{escaped_title}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>目录</h1>
      <ol>
        <li><a href="text/body.xhtml">{escaped_title}</a></li>
      </ol>
    </nav>
  </body>
</html>
"""
    body_xhtml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
  <head>
    <title>{escaped_title}</title>
    <link rel="stylesheet" type="text/css" href="../styles/style.css"/>
  </head>
  <body>
{cover_section}    <section epub:type="bodymatter">
      <h1>{escaped_title}</h1>
{paragraph_html}
    </section>
  </body>
</html>
"""
    style_css = """body {
  font-family: serif;
  line-height: 1.75;
}
h1 {
  text-align: center;
  margin: 1.2em 0 1.6em;
}
p {
  margin: 0 0 0.75em;
  text-indent: 2em;
}
.cover {
  text-align: center;
  page-break-after: always;
}
.cover img {
  max-width: 100%;
  max-height: 95vh;
}
"""

    with zipfile.ZipFile(output_path, "w") as zf:
        mimetype_info = zipfile.ZipInfo("mimetype")
        mimetype_info.compress_type = zipfile.ZIP_STORED
        zf.writestr(mimetype_info, "application/epub+zip")
        zf.writestr("META-INF/container.xml", container_xml, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/content.opf", package_xml, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/nav.xhtml", nav_xhtml, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/text/body.xhtml", body_xhtml, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("OEBPS/styles/style.css", style_css, compress_type=zipfile.ZIP_DEFLATED)
        if cover_payload:
            cover_bytes, cover_suffix, _cover_mime = cover_payload
            zf.writestr(
                f"OEBPS/images/cover{cover_suffix}",
                cover_bytes,
                compress_type=zipfile.ZIP_DEFLATED,
            )


def _write_cover_data(output_dir: str, cover_data: str) -> None:
    if not output_dir:
        return
    decoded = _cover_data_to_bytes(cover_data)
    if not decoded:
        return
    data, suffix = decoded
    try:
        root = Path(output_dir)
        root.mkdir(parents=True, exist_ok=True)
        (root / f"cover{suffix}").write_bytes(data)
    except OSError:
        pass


def _read_book_cover_data(output_dir: str) -> str | None:
    if not output_dir:
        return None
    root = Path(output_dir)
    cover = next((root / name for name in _COVER_FILE_NAMES if (root / name).is_file()), None)
    if cover is None:
        return None
    try:
        data = cover.read_bytes()
        encoded = base64.b64encode(data).decode("utf-8")
        if cover.suffix.lower() == ".png":
            return encoded
        mime = _COVER_MIME_BY_SUFFIX.get(cover.suffix.lower(), "image/png")
        return f"data:{mime};base64,{encoded}"
    except Exception:
        return None


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

    def open_external_url(self, url: str) -> bool:
        target = str(url or "").strip()
        if not target.startswith(("http://", "https://")):
            return False
        try:
            import webbrowser  # noqa: PLC0415

            return bool(webbrowser.open(target))
        except Exception:
            return False

    def create_book(
        self,
        title: str,
        book_type: str,
        categories: list[str],
        workspace_root: str | None = None,
        linked_skill_id: str | None = None,
        linked_material_id: str | None = None,
    ) -> dict:
        return self._store.create_book(
            title,
            book_type,
            categories,
            workspace_root,
            linked_skill_id,
            linked_material_id,
        )

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
        linked_skill_id: str | None = None,
        memory_auto_capture_enabled: bool | None = None,
    ) -> dict | None:
        return self._store.save_book(
            book_id,
            content=content,
            stages=stages,
            linked_material_id=linked_material_id,
            expert_draft=expert_draft,
            title=title,
            status=status,
            linked_skill_id=linked_skill_id,
            memory_auto_capture_enabled=memory_auto_capture_enabled,
        )

    def get_book_memories(self, book_id: str) -> list[dict]:
        return self._store.get_book_memories(book_id)

    def set_book_memories(
        self,
        book_id: str,
        memories: list[dict] | None = None,
    ) -> list[dict]:
        return self._store.set_book_memories(book_id, memories or [])

    def get_user_memories(self, workspace_type: str | None = None) -> list[dict]:
        return read_user_memories(workspace_type)

    def set_user_memories(
        self,
        workspace_type: str | None = None,
        memories: list[dict] | None = None,
    ) -> list[dict]:
        return write_user_memories(workspace_type, memories or [])

    def delete_book(self, book_id: str) -> bool:
        ok = self._store.delete_book(book_id)
        if ok:
            delete_ai_chat_sessions_for_owner("book", book_id)
        return ok

    # ==================== 素材库 API ====================

    def list_ai_chat_sessions(self, scope: dict | None = None) -> list[dict]:
        return list_ai_chat_sessions(scope or {})

    def get_ai_chat_session(self, session_id: str) -> dict | None:
        return get_ai_chat_session(session_id)

    def save_ai_chat_session(self, session: dict | None = None) -> dict | None:
        return save_ai_chat_session(session or {})

    def delete_ai_chat_session(self, session_id: str) -> bool:
        return delete_ai_chat_session(session_id)

    def delete_ai_chat_sessions_for_owner(self, owner_type: str, owner_id: str) -> int:
        return delete_ai_chat_sessions_for_owner(owner_type, owner_id)

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
            material_type: 素材类型，'short'、'long' 或 'script'
            parent_genre: 父分类，短篇/剧本时为一级分类
            sub_genre: legacy 子分类字段；新建素材不再写入
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
        ok = self._store.delete_material(material_id)
        if ok:
            delete_ai_chat_sessions_for_owner("material", material_id)
        return ok

    def get_material_genres(self) -> dict[str, list[str]]:
        """获取素材分类结构"""
        from app.models import SCRIPT_MATERIAL_GENRES, SHORT_MATERIAL_GENRES
        return {
            "short": list(SHORT_MATERIAL_GENRES.keys()),
            "script": list(SCRIPT_MATERIAL_GENRES.keys()),
        }

    # ==================== 技能库 API ====================

    def list_skills(self) -> list[dict]:
        """列出所有技能集合"""
        return self._store.list_skills()

    def get_skill(self, skill_id: str) -> dict | None:
        """获取单个技能详情"""
        return self._store.get_skill(skill_id)

    def create_skill(
        self,
        title: str,
        skill_type: str = "short",
        workspace_root: str | None = None,
        load_common_skills: bool = False,
    ) -> dict:
        """创建新技能集合"""
        if workspace_root is None and str(skill_type or "").strip() not in {"short", "long", "script"}:
            workspace_root = skill_type
            skill_type = "short"
        return self._store.create_skill(
            title,
            skill_type,
            workspace_root,
            bool(load_common_skills),
        )

    def read_common_skills(self) -> list[dict]:
        """读取随应用发布、不会写入用户数据目录的通用技能配置。"""
        from app.common_skill_store import read_common_skills

        return read_common_skills()

    def save_common_skills(self, skills: list | None = None) -> list[dict]:
        """保存随应用发布的通用技能配置。"""
        from app.common_skill_store import save_common_skills

        return save_common_skills(skills or [])

    def load_common_skills_to_skill(self, skill_id: str) -> dict | None:
        """将通用技能合并到已有技能库，已加载的条目不会重复添加。"""
        return self._store.load_common_skills_to_skill(skill_id)

    def save_skill(
        self,
        skill_id: str,
        payload: dict | None = None,
    ) -> dict | None:
        """保存技能集合及阶段技能列表。"""
        data = payload if isinstance(payload, dict) else {}
        return self._store.save_skill(
            skill_id,
            title=data.get("title") if "title" in data else None,
            skill_type=data.get("skill_type") if "skill_type" in data else None,
            stages=data.get("stages") if "stages" in data else None,
        )

    def delete_skill(self, skill_id: str) -> bool:
        """删除技能"""
        ok = self._store.delete_skill(skill_id)
        if ok:
            delete_ai_chat_sessions_for_owner("skill", skill_id)
        return ok

    def get_workspace_root(self) -> str | None:
        return read_saved_workspace_root()

    def set_workspace_root(self, path: str | None) -> None:
        write_saved_workspace_root(path)

    def get_appearance_style(self) -> str:
        return read_appearance_style()

    def set_appearance_style(self, style: str) -> str:
        return write_appearance_style(style)

    def get_text_display_mode(self) -> str:
        return read_text_display_mode()

    def set_text_display_mode(self, mode: str) -> str:
        return write_text_display_mode(mode)

    # ==================== 软件更新 API ====================

    def check_for_update(self) -> dict[str, object]:
        return _check_for_update()

    def download_latest_update(self) -> dict[str, object]:
        return _download_latest_update()

    def get_workspace_agent_read_access(self, workspace_type: str | None = None) -> dict[str, object]:
        """全局创作空间智能体可读的 workspace/material 阶段列表。"""
        if workspace_type:
            return read_workspace_agent_read_access_for_type(workspace_type)
        return read_workspace_agent_read_access()

    def set_workspace_agent_read_access(
        self,
        config: dict[str, object],
        workspace_type: str | None = None,
    ) -> None:
        if not isinstance(config, dict):
            raise ValueError("workspace_agent_read_access 须为对象")
        if workspace_type:
            write_workspace_agent_read_access_for_type(workspace_type, config)
            return
        write_workspace_agent_read_access(config)

    def sync_workspace_agent_read_access_defaults(
        self,
        workspace_type: str | None = None,
    ) -> dict[str, object]:
        """将用户 AppData 中的读取范围覆盖同步为内置默认 JSON 文件。"""
        return sync_workspace_agent_read_access_defaults(workspace_type)

    def sync_workspace_settings_defaults(
        self,
        workspace_type: str | None = None,
    ) -> dict[str, object]:
        """将用户 AppData 中的提示词覆盖和读取范围同步为内置默认配置。"""
        prompt_paths = _sync_workspace_prompt_defaults(workspace_type)
        read_access = sync_workspace_agent_read_access_defaults(workspace_type)
        return {
            "prompts": prompt_paths,
            "read_access": read_access,
        }

    def get_default_workspace_agent_read_access(
        self,
        workspace_type: str | None = None,
    ) -> dict[str, object]:
        """从内置默认 JSON 文件读取读取范围默认配置。"""
        return read_workspace_agent_read_access_defaults(workspace_type)

    def get_ai_model_config(self) -> dict[str, object]:
        """读取本地模型配置，首次为空时从旧 `.env` 导入。"""
        return read_ai_model_config()

    def save_ai_model_config(self, config: dict[str, object]) -> dict[str, object]:
        """保存模型配置到用户数据 `.data/preferences.json`。"""
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
        workspace_type: str | None = None,
    ) -> str:
        return render_from_api_context(stage_id, context_json, workspace_type)

    def read_workspace_agent_prompt_template(
        self,
        agent_id: str,
        workspace_type: str | None = None,
    ) -> str:
        return read_raw_workspace_agent_prompt_for_editor(agent_id, workspace_type)

    def save_workspace_agent_prompt_override(
        self,
        agent_id: str,
        body: str,
        workspace_type: str | None = None,
    ) -> None:
        _save_workspace_agent_prompt_override(agent_id, body, workspace_type)

    def reset_workspace_agent_prompt_override(
        self,
        agent_id: str,
        workspace_type: str | None = None,
    ) -> bool:
        return _reset_workspace_agent_prompt_override(agent_id, workspace_type)

    # ==================== 素材库提示词 API ====================

    def get_material_system_prompt(
        self,
        material_kind: str,
        stage_id: str,
        context_json: str,
        material_type: str | None = None,
    ) -> str:
        if material_type:
            try:
                ctx = json.loads(context_json) if isinstance(context_json, str) else dict(context_json)
            except Exception:
                ctx = {}
            if isinstance(ctx, dict):
                ctx["material_type_key"] = material_type
                context_json = json.dumps(ctx, ensure_ascii=False)
        return render_material_from_api_context(material_kind, stage_id, context_json)

    def read_material_prompt_template(
        self, material_kind: str, stage_id: str, material_type: str | None = None
    ) -> str:
        return read_raw_material_prompt_for_editor(material_kind, stage_id, material_type)

    def save_material_prompt_override(
        self,
        material_kind: str,
        stage_id: str,
        body: str,
        material_type: str | None = None,
    ) -> None:
        _save_material_prompt_override(material_kind, stage_id, body, material_type)

    def reset_material_prompt_override(
        self, material_kind: str, stage_id: str, material_type: str | None = None
    ) -> bool:
        return _reset_material_prompt_override(material_kind, stage_id, material_type)

    def read_material_agent_prompt_template(self, material_type: str | None = None) -> str:
        return read_raw_material_agent_prompt_for_editor(material_type)

    def save_material_agent_prompt_override(
        self,
        body: str,
        material_type: str | None = None,
    ) -> None:
        _save_material_agent_prompt_override(body, material_type)

    def reset_material_agent_prompt_override(self, material_type: str | None = None) -> bool:
        return _reset_material_agent_prompt_override(material_type)

    # ==================== 技能库提示词 API ====================

    def get_skill_system_prompt(
        self,
        stage_id: str,
        context_json: str,
        skill_type: str | None = None,
    ) -> str:
        if skill_type:
            try:
                ctx = json.loads(context_json) if isinstance(context_json, str) else dict(context_json)
            except Exception:
                ctx = {}
            if isinstance(ctx, dict):
                ctx["skill_type"] = skill_type
                context_json = json.dumps(ctx, ensure_ascii=False)
        return render_skill_from_api_context(stage_id, context_json)

    def read_skill_agent_prompt_template(self, skill_type: str | None = None) -> str:
        return read_raw_skill_agent_prompt_for_editor(skill_type)

    def save_skill_agent_prompt_override(
        self,
        body: str,
        skill_type: str | None = None,
    ) -> None:
        _save_skill_agent_prompt_override(body, skill_type)

    def reset_skill_agent_prompt_override(self, skill_type: str | None = None) -> bool:
        return _reset_skill_agent_prompt_override(skill_type)

    # ==================== 学习仿写提示词 API ====================

    def get_learning_imitation_system_prompt(
        self,
        stage_id: str,
        context_json: str,
    ) -> str:
        return render_learning_imitation_from_api_context(stage_id, context_json)

    def read_learning_imitation_prompt_template(self, stage_id: str) -> str:
        return read_raw_learning_imitation_prompt_for_editor(stage_id)

    def save_learning_imitation_prompt_override(
        self,
        stage_id: str,
        body: str,
    ) -> None:
        _save_learning_imitation_prompt_override(stage_id, body)

    def reset_learning_imitation_prompt_override(self, stage_id: str) -> bool:
        return _reset_learning_imitation_prompt_override(stage_id)

    def get_book_cover(self, book_id: str) -> dict:
        """获取书籍封面图片（base64）。

        Returns:
            {"cover_data": str | None}  base64 编码的 PNG 图片，不含 data URI 前缀
        """
        output_dir = self._store.get_book_output_dir(book_id)
        return {"cover_data": _read_book_cover_data(output_dir)}

    def get_book_covers(self, book_ids: list[str]) -> dict:
        """批量获取书籍封面，避免首页 N 次 JS/Python 桥接调用。"""
        ids: list[str] = []
        seen: set[str] = set()
        for raw_id in (book_ids if isinstance(book_ids, list) else []):
            book_id = str(raw_id or "").strip()
            if not book_id or book_id in seen:
                continue
            seen.add(book_id)
            ids.append(book_id)
        output_dirs = self._store.get_book_output_dirs(ids)
        return {
            "covers": {
                book_id: _read_book_cover_data(output_dirs.get(book_id, ""))
                for book_id in ids
            }
        }

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

    # ==================== 创作空间 导入导出 API ====================

    def export_book(self, book_id: str) -> dict:
        """将单个创作空间导出为 zip，兼容移动端 book.json 书籍包。"""
        import zipfile as _zipfile

        try:
            book = self._store.get_book(book_id)
            if not book:
                return {"success": False, "error": "书籍不存在", "path": None}

            default_name = f"{_safe_zip_leaf(book.get('title', '书籍'), '书籍')}.zip"
            if not webview.windows:
                return {"success": False, "error": "窗口未就绪", "path": None}
            win = webview.windows[0]
            result = win.create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename=default_name,
                file_types=("Zip 压缩包 (*.zip)",),
            )
            if not result:
                return {"success": False, "error": None, "path": None}
            save_path = str(result) if not isinstance(result, (list, tuple)) else str(result[0])
            if not save_path:
                return {"success": False, "error": None, "path": None}
            if not save_path.lower().endswith(".zip"):
                save_path += ".zip"

            metadata = {
                "library_type": "book",
                "data": book,
                "app": "deepseekwrite-desktop",
                "schemaVersion": 1,
                "exported_at": _now_iso(),
            }
            book_type = str(book.get("book_type") or "short")
            stages = book.get("stages") if isinstance(book.get("stages"), dict) else {}
            if book_type == "long":
                stage_keys = long_stage_keys_from_stages(stages)
            else:
                stage_keys = SCRIPT_STAGE_KEYS if book_type == "script" else SHORT_STAGE_KEYS

            with _zipfile.ZipFile(save_path, "w", _zipfile.ZIP_DEFLATED) as zf:
                book_json = json.dumps(book, ensure_ascii=False, indent=2)
                zf.writestr("book.json", book_json)
                zf.writestr(
                    "metadata.json",
                    json.dumps(metadata, ensure_ascii=False, indent=2),
                )

                for stage_id in stage_keys:
                    zf.writestr(
                        _safe_zip_text_path("stages", f"{stage_id}.txt"),
                        str(stages.get(stage_id, "") or ""),
                    )

                expert_draft = book.get("expert_draft")
                if isinstance(expert_draft, dict):
                    zf.writestr(
                        "expert_draft.json",
                        json.dumps(expert_draft, ensure_ascii=False, indent=2),
                    )
                    sections = expert_draft.get("sections")
                    states = expert_draft.get("character_states")
                    state_by_section = {
                        str(item.get("section_id") or ""): item
                        for item in (states if isinstance(states, list) else [])
                        if isinstance(item, dict)
                    }
                    if isinstance(sections, list):
                        for index, section in enumerate(sections, start=1):
                            if not isinstance(section, dict):
                                continue
                            title = str(section.get("title") or f"小节{index}")
                            prefix = f"{index:02d}-{_safe_zip_leaf(title, f'小节{index}')}"
                            zf.writestr(
                                _safe_zip_text_path("expert_draft", f"{prefix}.txt"),
                                str(section.get("body") or ""),
                            )
                            state = state_by_section.get(str(section.get("id") or ""))
                            if state:
                                zf.writestr(
                                    _safe_zip_text_path(
                                        "expert_draft",
                                        f"{prefix}-人物状态.txt",
                                    ),
                                    str(state.get("body") or ""),
                                )

                output_dir = str(book.get("output_dir") or "")
                if output_dir and Path(output_dir).is_dir():
                    for file in Path(output_dir).iterdir():
                        if file.is_file():
                            zf.write(file, f"files/{_safe_zip_leaf(file.name, 'file')}")

            return {"success": True, "error": None, "path": save_path}
        except Exception as e:
            return {"success": False, "error": str(e), "path": None}

    def import_book(self, workspace_root: str | None = None) -> dict:
        """从移动端/桌面端书籍 zip 导入单个创作空间。"""
        import zipfile as _zipfile

        try:
            if not webview.windows:
                return {"success": False, "error": "窗口未就绪", "item": None}
            win = webview.windows[0]
            result = win.create_file_dialog(
                webview.FileDialog.OPEN,
                file_types=("Zip 压缩包 (*.zip)",),
            )
            if not result:
                return {"success": False, "error": None, "item": None}
            zip_path = str(result[0]) if isinstance(result, (list, tuple)) else str(result)
            if not zip_path:
                return {"success": False, "error": None, "item": None}
            if not Path(zip_path).is_file():
                return {"success": False, "error": "文件不存在", "item": None}

            with _zipfile.ZipFile(zip_path, "r") as zf:
                book_data = _read_zip_json(zf, ["book.json"])
                if not book_data:
                    metadata = _read_zip_json(zf, ["metadata.json"])
                    if metadata and metadata.get("library_type") in ("book", "workspace"):
                        data = metadata.get("data")
                        book_data = data if isinstance(data, dict) else None
                if not book_data:
                    return {"success": False, "error": "无效的书籍包（缺少 book.json）", "item": None}

                title = str(book_data.get("title") or "导入书籍")
                book_type = str(book_data.get("book_type") or "short")
                raw_categories = book_data.get("categories")
                categories = [
                    str(item)
                    for item in (raw_categories if isinstance(raw_categories, list) else [])
                    if str(item).strip()
                ]
                created = self._store.create_book(
                    title,
                    book_type,
                    categories,
                    (workspace_root or "").strip() or None,
                    str(book_data.get("linked_skill_id") or "") or None,
                    str(book_data.get("linked_material_id") or "") or None,
                )

                stages = book_data.get("stages")
                expert_draft = book_data.get("expert_draft")
                saved = self._store.save_book(
                    created["id"],
                    content=str(book_data.get("content") or "") if not isinstance(stages, dict) else None,
                    stages=stages if isinstance(stages, dict) else None,
                    linked_material_id=str(book_data.get("linked_material_id") or ""),
                    expert_draft=expert_draft if isinstance(expert_draft, dict) else None,
                    title=title,
                    status=str(book_data.get("status") or "editing"),
                    linked_skill_id=str(book_data.get("linked_skill_id") or ""),
                    memory_auto_capture_enabled=(
                        bool(book_data.get("memory_auto_capture_enabled"))
                        if "memory_auto_capture_enabled" in book_data
                        else None
                    ),
                )
                if isinstance(book_data.get("memories"), list):
                    self._store.set_book_memories(created["id"], book_data.get("memories"))

                final = self._store.get_book(created["id"]) or saved or created
                output_dir = str(final.get("output_dir") or "")
                if output_dir:
                    dest = Path(output_dir)
                    dest.mkdir(parents=True, exist_ok=True)
                    copied_cover = False
                    for info in zf.infolist():
                        if info.is_dir():
                            continue
                        name = _normalize_zip_path(info.filename)
                        if name.startswith("files/"):
                            fname = _safe_zip_leaf(name[len("files/"):], "")
                            if not fname:
                                continue
                            (dest / fname).write_bytes(zf.read(info.filename))
                            if fname.lower() in _COVER_FILE_NAMES:
                                copied_cover = True
                    for info in zf.infolist():
                        if info.is_dir():
                            continue
                        name = _normalize_zip_path(info.filename)
                        leaf = _safe_zip_leaf(name, "")
                        if "/" not in name and leaf.lower() in _COVER_FILE_NAMES:
                            (dest / leaf).write_bytes(zf.read(info.filename))
                            copied_cover = True
                    if not copied_cover:
                        cover_data_url = book_data.get("cover_data_url")
                        if isinstance(cover_data_url, str):
                            _write_cover_data(output_dir, cover_data_url)

                final = self._store.get_book(created["id"]) or final
                return {"success": True, "error": None, "item": final}
        except _zipfile.BadZipFile:
            return {"success": False, "error": "无效的 zip 文件", "item": None}
        except Exception as e:
            return {"success": False, "error": str(e), "item": None}

    # ==================== 素材/技能 导入导出 API ====================

    def export_library(self, library_type: str, item_id: str) -> dict:
        """将素材或技能导出为 zip 压缩包，弹出保存对话框。

        Args:
            library_type: 'material' 或 'skill'
            item_id: 素材或技能 ID

        Returns:
            {"success": bool, "error": str | None, "path": str | None}
        """
        import zipfile as _zipfile

        try:
            if library_type == "material":
                item = self._store.get_material(item_id)
                if not item:
                    return {"success": False, "error": "素材不存在", "path": None}
                default_name = f"{item.get('title', '素材')}.zip"
            elif library_type == "skill":
                item = self._store.get_skill(item_id)
                if not item:
                    return {"success": False, "error": "技能不存在", "path": None}
                default_name = f"{item.get('title', '技能')}.zip"
            else:
                return {"success": False, "error": "无效的库类型", "path": None}

            if not webview.windows:
                return {"success": False, "error": "窗口未就绪", "path": None}
            win = webview.windows[0]
            result = win.create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename=default_name,
                file_types=("Zip 压缩包 (*.zip)",),
            )
            if not result:
                return {"success": False, "error": None, "path": None}
            save_path = str(result) if not isinstance(result, (list, tuple)) else str(result[0])
            if not save_path:
                return {"success": False, "error": None, "path": None}
            if not save_path.lower().endswith(".zip"):
                save_path += ".zip"

            metadata = {
                "library_type": library_type,
                "data": item,
            }

            with _zipfile.ZipFile(save_path, "w", _zipfile.ZIP_DEFLATED) as zf:
                zf.writestr(
                    "metadata.json",
                    json.dumps(metadata, ensure_ascii=False, indent=2),
                )
                output_dir = item.get("output_dir", "")
                if output_dir and Path(output_dir).is_dir():
                    for file in Path(output_dir).iterdir():
                        if file.is_file():
                            zf.write(file, f"files/{file.name}")

            return {"success": True, "error": None, "path": save_path}
        except Exception as e:
            return {"success": False, "error": str(e), "path": None}

    def import_library(self, library_type: str, workspace_root: str | None = None) -> dict:
        """从 zip 压缩包导入素材或技能，弹出打开对话框。

        Args:
            library_type: 期望导入的类型 'material' 或 'skill'，若 zip 中有 metadata 则以 metadata 为准
            workspace_root: 工作目录

        Returns:
            {"success": bool, "error": str | None, "item": dict | None}
        """
        import zipfile as _zipfile

        try:
            if not webview.windows:
                return {"success": False, "error": "窗口未就绪", "item": None}
            win = webview.windows[0]
            result = win.create_file_dialog(
                webview.FileDialog.OPEN,
                file_types=("Zip 压缩包 (*.zip)",),
            )
            if not result:
                return {"success": False, "error": None, "item": None}
            zip_path = str(result[0]) if isinstance(result, (list, tuple)) else str(result)
            if not zip_path:
                return {"success": False, "error": None, "item": None}

            if not Path(zip_path).is_file():
                return {"success": False, "error": "文件不存在", "item": None}

            with _zipfile.ZipFile(zip_path, "r") as zf:
                if "metadata.json" not in zf.namelist():
                    return {"success": False, "error": "无效的压缩包（缺少 metadata.json）", "item": None}
                meta_raw = zf.read("metadata.json").decode("utf-8")
                metadata = json.loads(meta_raw)

                actual_type = metadata.get("library_type", library_type)
                data = metadata.get("data", {})

                ws = (workspace_root or "").strip()
                if actual_type == "material":
                    title = data.get("title", "导入素材")
                    material_type = data.get("material_type", "short")
                    parent_genre = data.get("parent_genre")
                    sub_genre = data.get("sub_genre")
                    created = self._store.create_material(
                        title, material_type, parent_genre, sub_genre, ws or None
                    )
                    stages = data.get("stages")
                    if stages:
                        self._store.save_material(created["id"], stages=stages)

                    output_dir = created.get("output_dir", "")
                    if output_dir:
                        dest = Path(output_dir)
                        dest.mkdir(parents=True, exist_ok=True)
                        for name in zf.namelist():
                            if name.startswith("files/") and not name.endswith("/"):
                                fname = name[len("files/"):]
                                if fname:
                                    (dest / fname).write_bytes(zf.read(name))

                    final = self._store.get_material(created["id"])
                    return {"success": True, "error": None, "item": final}

                elif actual_type == "skill":
                    title = data.get("title", "导入技能")
                    skill_type = data.get("skill_type", "short")
                    created = self._store.create_skill(title, skill_type, ws or None)
                    stages = data.get("stages")
                    if stages:
                        self._store.save_skill(created["id"], stages=stages)

                    output_dir = created.get("output_dir", "")
                    if output_dir:
                        dest = Path(output_dir)
                        dest.mkdir(parents=True, exist_ok=True)
                        for name in zf.namelist():
                            if name.startswith("files/") and not name.endswith("/"):
                                fname = name[len("files/"):]
                                if fname:
                                    (dest / fname).write_bytes(zf.read(name))

                    final = self._store.get_skill(created["id"])
                    return {"success": True, "error": None, "item": final}

                else:
                    return {"success": False, "error": f"不支持的库类型: {actual_type}", "item": None}

        except _zipfile.BadZipFile:
            return {"success": False, "error": "无效的 zip 文件", "item": None}
        except Exception as e:
            return {"success": False, "error": str(e), "item": None}

    def export_text(
        self,
        book_id: str,
        stage_id: str,
        folder_path: str,
        content: str,
        cover_data: str | None = None,
        export_format: str = "docx",
    ) -> dict:
        """将指定阶段内容导出为 docx / txt / epub，文件名使用小说名。

        Args:
            book_id: 书籍 ID
            stage_id: 阶段 ID
            folder_path: 用户选择的保存文件夹
            content: 阶段文本内容
            cover_data: 封面图片 base64（不含 data URI 前缀），可选
            export_format: 导出格式，支持 docx / txt / epub

        Returns:
            {"success": bool, "error": str | None, "path": str | None}
        """
        try:
            book = self._store.get_book(book_id)
            if not book:
                return {"success": False, "error": "书籍不存在", "path": None}

            normalized_format = str(export_format or "docx").lower().lstrip(".")
            if normalized_format not in {"docx", "txt", "epub"}:
                return {
                    "success": False,
                    "error": f"不支持的导出格式: {export_format}",
                    "path": None,
                }

            title = str(book.get("title", "未命名")).strip() or "未命名"
            safe_title = _safe_export_title(title)
            output_dir = Path(folder_path)
            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / f"{safe_title}.{normalized_format}"

            if normalized_format == "docx":
                _write_docx_export(output_path, content, cover_data)
            elif normalized_format == "txt":
                _write_txt_export(output_path, content)
            else:
                _write_epub_export(output_path, title, book_id, stage_id, content, cover_data)

            return {"success": True, "error": None, "path": str(output_path)}
        except Exception as e:
            return {"success": False, "error": str(e), "path": None}

    def export_docx(
        self,
        book_id: str,
        stage_id: str,
        folder_path: str,
        content: str,
        cover_data: str | None = None,
    ) -> dict:
        """兼容旧前端：仍导出 docx。"""
        return self.export_text(book_id, stage_id, folder_path, content, cover_data, "docx")


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


def generate_image(prompt: str, output_dir: str | Path | None = None) -> Path | None:
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

        dest = Path(output_dir) if output_dir is not None else data_root() / "image"
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
    _ensure_windows_webview2()
    # 先检查上次启动是否失败（失败则自动清空损坏的 WebView2 数据目录），再写本次启动标记。
    _check_and_reset_stale_webview_data()
    _mark_boot_start()
    store = BookStore()
    api = Api(store)
    _httpd, url = _resolve_desktop_url(_dist_dir())
    url = _resolve_main_window_url(_dist_dir(), url)
    webview.create_window(
        "DeepSeekWrite",
        url,
        js_api=api,
        width=1500,
        height=1048,
        min_size=(640, 480),
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
    _debug = os.environ.get("DEEPSEEKWRITE_DEBUG", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    webview.start(**_webview_start_options(debug=_debug))


if __name__ == "__main__":
    main()
