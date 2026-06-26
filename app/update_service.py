from __future__ import annotations

import json
import os
import platform
import re
import sys
import uuid
import webbrowser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from app.runtime_paths import bundle_root


_DEFAULT_VERSION = "2.1.1"
_DEFAULT_MANIFEST_URL = (
    "https://gitee.com/swjai001/deepseekwrite/raw/master/updata.json"
)
_REQUEST_TIMEOUT_SECONDS = 30
_DOWNLOAD_TIMEOUT_SECONDS = 300
_DOWNLOAD_CHUNK_SIZE = 1024 * 1024
_VERSION_PATTERN = re.compile(
    r"^[vV]?(?P<core>\d+(?:\.\d+){0,3})(?:-(?P<prerelease>[0-9A-Za-z.-]+))?$"
)


def _read_local_version_config() -> dict[str, str]:
    path = bundle_root() / "app" / "version.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    version = str(raw.get("version") or _DEFAULT_VERSION).strip()
    manifest_url = str(
        raw.get("update_manifest_url") or _DEFAULT_MANIFEST_URL
    ).strip()
    return {
        "version": version or _DEFAULT_VERSION,
        "update_manifest_url": manifest_url or _DEFAULT_MANIFEST_URL,
    }


def _parse_version(value: str) -> tuple[tuple[int, ...], tuple[str, ...] | None]:
    match = _VERSION_PATTERN.fullmatch(str(value or "").strip())
    if match is None:
        raise ValueError(f"无效版本号：{value}")
    core = tuple(int(part) for part in match.group("core").split("."))
    padded_core = core + (0,) * (4 - len(core))
    prerelease = match.group("prerelease")
    return padded_core, tuple(prerelease.split(".")) if prerelease else None


def _is_newer_version(latest: str, current: str) -> bool:
    latest_core, latest_prerelease = _parse_version(latest)
    current_core, current_prerelease = _parse_version(current)
    if latest_core != current_core:
        return latest_core > current_core
    if latest_prerelease is None:
        return current_prerelease is not None
    if current_prerelease is None:
        return False
    return latest_prerelease > current_prerelease


def _platform_package_key() -> str | None:
    machine = platform.machine().strip().lower()
    if sys.platform.startswith("win"):
        if machine in {"amd64", "x86_64", "x64"}:
            return "windows-x64"
        return None
    if sys.platform == "darwin":
        if machine in {"arm64", "aarch64"}:
            return "macos-arm64"
        if machine in {"x86_64", "amd64", "x64"}:
            return "macos-x64"
        return None
    return None


def _validate_download_url(value: object) -> str:
    url = str(value or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("安装包下载地址无效")
    return url


def _fetch_manifest(url: str) -> dict[str, Any]:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "DeepSeekWrite-Updater/1.0",
        },
    )
    try:
        with urlopen(request, timeout=_REQUEST_TIMEOUT_SECONDS) as response:
            body = response.read()
    except HTTPError as exc:
        raise RuntimeError(f"更新配置请求失败：HTTP {exc.code}") from exc
    except URLError as exc:
        reason = str(exc.reason or exc)
        raise RuntimeError(f"无法连接更新服务器：{reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError("连接更新服务器超时") from exc

    try:
        manifest = json.loads(body.decode("utf-8-sig"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("更新配置不是有效的 JSON") from exc
    if not isinstance(manifest, dict):
        raise RuntimeError("更新配置根节点必须是 JSON 对象")
    return manifest


def _normalize_release_notes(value: object) -> list[str]:
    if isinstance(value, list):
        return [
            str(item).strip()
            for item in value
            if str(item or "").strip()
        ]
    text = str(value or "").strip()
    return [text] if text else []


def _resolve_manifest_package(
    manifest: dict[str, Any],
    package_key: str,
) -> tuple[str, str, str, list[str]]:
    latest_version = str(manifest.get("latest_version") or "").strip()
    _parse_version(latest_version)
    packages = manifest.get("packages")
    if not isinstance(packages, dict):
        raise ValueError("更新配置缺少 packages")
    package = packages.get(package_key)
    if not isinstance(package, dict):
        raise ValueError(f"更新配置中没有适用于 {package_key} 的安装包")
    download_url = _validate_download_url(package.get("url"))
    file_name = Path(str(package.get("file_name") or "").strip()).name
    if not file_name or file_name in {".", ".."}:
        file_name = Path(urlparse(download_url).path).name
    if not file_name:
        raise ValueError("更新配置缺少安装包文件名")
    release_notes = _normalize_release_notes(manifest.get("release_notes"))
    return latest_version, file_name, download_url, release_notes


def _downloads_directory() -> Path:
    path = Path.home() / "Downloads"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _open_download_url_in_browser(url: str) -> None:
    try:
        opened = webbrowser.open(url, new=2, autoraise=True)
    except Exception as exc:
        raise RuntimeError(
            f"安装包需要登录后下载，请在浏览器中打开：{url}"
        ) from exc
    if not opened:
        raise RuntimeError(f"安装包需要登录后下载，请在浏览器中打开：{url}")


def _error_message(exc: Exception) -> str:
    if isinstance(exc, ValueError):
        return str(exc)
    return str(exc) or "更新操作失败"


def check_for_update() -> dict[str, object]:
    config = _read_local_version_config()
    current_version = config["version"]
    package_key = _platform_package_key()
    result: dict[str, object] = {
        "success": False,
        "error": None,
        "current_version": current_version,
        "latest_version": None,
        "update_available": False,
        "platform_key": package_key,
        "file_name": None,
        "release_notes": [],
    }
    if package_key is None:
        result["error"] = "当前操作系统或处理器架构暂不支持下载安装包"
        return result
    try:
        manifest = _fetch_manifest(config["update_manifest_url"])
        latest_version, file_name, _url, release_notes = _resolve_manifest_package(
            manifest,
            package_key,
        )
        result.update(
            {
                "success": True,
                "latest_version": latest_version,
                "update_available": _is_newer_version(
                    latest_version,
                    current_version,
                ),
                "file_name": file_name,
                "release_notes": release_notes,
            }
        )
    except Exception as exc:
        result["error"] = _error_message(exc)
    return result


def download_latest_update() -> dict[str, object]:
    config = _read_local_version_config()
    current_version = config["version"]
    package_key = _platform_package_key()
    result: dict[str, object] = {
        "success": False,
        "error": None,
        "up_to_date": False,
        "current_version": current_version,
        "latest_version": None,
        "path": None,
        "browser_opened": False,
        "file_name": None,
        "release_notes": [],
    }
    if package_key is None:
        result["error"] = "当前操作系统或处理器架构暂不支持下载安装包"
        return result

    temporary_path: Path | None = None
    try:
        manifest = _fetch_manifest(config["update_manifest_url"])
        latest_version, file_name, download_url, release_notes = (
            _resolve_manifest_package(manifest, package_key)
        )
        result.update(
            {
                "latest_version": latest_version,
                "file_name": file_name,
                "release_notes": release_notes,
            }
        )
        if not _is_newer_version(latest_version, current_version):
            result.update({"success": True, "up_to_date": True})
            return result

        downloads_dir = _downloads_directory()
        destination = downloads_dir / file_name
        temporary_path = downloads_dir / f".{file_name}.{uuid.uuid4().hex}.part"
        request = Request(
            download_url,
            headers={"User-Agent": "DeepSeekWrite-Updater/1.0"},
        )
        try:
            with urlopen(
                request,
                timeout=_DOWNLOAD_TIMEOUT_SECONDS,
            ) as response:
                with temporary_path.open("wb") as output:
                    while True:
                        chunk = response.read(_DOWNLOAD_CHUNK_SIZE)
                        if not chunk:
                            break
                        output.write(chunk)
        except HTTPError as exc:
            if exc.code in {401, 403}:
                _open_download_url_in_browser(download_url)
                result.update(
                    {
                        "success": True,
                        "browser_opened": True,
                    }
                )
                return result
            raise RuntimeError(f"安装包下载失败：HTTP {exc.code}") from exc
        except URLError as exc:
            reason = str(exc.reason or exc)
            raise RuntimeError(f"无法下载安装包：{reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("下载安装包超时") from exc

        if not temporary_path.is_file() or temporary_path.stat().st_size == 0:
            raise RuntimeError("下载得到的安装包为空")
        os.replace(temporary_path, destination)
        temporary_path = None
        result.update(
            {
                "success": True,
                "path": str(destination),
            }
        )
    except Exception as exc:
        result["error"] = _error_message(exc)
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
    return result
