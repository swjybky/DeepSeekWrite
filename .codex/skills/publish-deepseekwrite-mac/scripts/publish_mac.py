#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


DEFAULT_SOURCE_ROOT = Path("/Users/fafeng/project/openwrite/write-claw")
DEFAULT_PUBLISH_ROOT = Path(
    "/Users/fafeng/project/openwrite/deepseekpush/deepseekwrite"
)
RELEASE_BASE_URL = "https://gitee.com/swjai001/deepseekwrite/releases/download"
VERSION_PATTERN = re.compile(
    r"^(?P<core>\d+\.\d+\.\d+)(?:-(?P<prerelease>[0-9A-Za-z.-]+))?$"
)

ARTIFACTS = {
    "macos-arm64": {
        "source": "DeepSeekWrite-arm.dmg",
        "file_name": "DeepSeekWrite-{version}-macos-arm64.dmg",
    },
    "macos-x64": {
        "source": "DeepSeekWrite-intel.dmg",
        "file_name": "DeepSeekWrite-{version}-macos-x64.dmg",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Update Gitee Release metadata for DeepSeekWrite macOS DMGs.",
    )
    parser.add_argument(
        "--source-root",
        type=Path,
        default=DEFAULT_SOURCE_ROOT,
        help="Write Claw repository root.",
    )
    parser.add_argument(
        "--publish-root",
        type=Path,
        default=DEFAULT_PUBLISH_ROOT,
        help="Local deepseekwrite release repository root.",
    )
    parser.add_argument(
        "--version",
        help="Release version. Defaults to app/version.json.",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"缺少文件：{path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"无法读取 JSON：{path}: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"JSON 根节点必须是对象：{path}")
    return value


def resolve_version(source_root: Path, override: str | None) -> str:
    if override:
        version = override.strip()
    else:
        config = read_json(source_root / "app" / "version.json")
        version = str(config.get("version") or "").strip()
    if not VERSION_PATTERN.fullmatch(version):
        raise RuntimeError(f"版本号格式无效：{version!r}，应类似 2.1.0")
    return version


def version_sort_key(version: str) -> tuple[tuple[int, int, int], int, tuple[str, ...]]:
    match = VERSION_PATTERN.fullmatch(version)
    if match is None:
        raise RuntimeError(f"版本号格式无效：{version!r}，应类似 2.1.0")
    core = tuple(int(part) for part in match.group("core").split("."))
    prerelease = match.group("prerelease")
    return (
        (core[0], core[1], core[2]),
        1 if prerelease is None else 0,
        tuple(prerelease.split(".")) if prerelease else (),
    )


def ensure_version_does_not_regress(
    version: str,
    manifest: dict[str, Any],
) -> None:
    published = str(manifest.get("latest_version") or "").strip()
    if not published:
        return
    if version_sort_key(version) < version_sort_key(published):
        raise RuntimeError(
            f"待发布版本 {version} 低于配置中的 latest_version {published}；"
            "请先更新 app/version.json，禁止自动回退线上版本"
        )


def verify_source_artifacts(source_root: Path) -> dict[str, Path]:
    if shutil.which("hdiutil") is None:
        raise RuntimeError("未找到 hdiutil；macOS DMG 发布必须在 macOS 上执行")

    sources: dict[str, Path] = {}
    for package_key, artifact in ARTIFACTS.items():
        path = source_root / "dist" / str(artifact["source"])
        if not path.is_file():
            raise RuntimeError(f"缺少安装包：{path}")
        if path.stat().st_size <= 0:
            raise RuntimeError(f"安装包为空：{path}")
        subprocess.run(
            ["hdiutil", "verify", str(path)],
            check=True,
        )
        sources[package_key] = path
    return sources


def validate_manifest(manifest: dict[str, Any], path: Path) -> dict[str, Any]:
    packages = manifest.get("packages")
    if not isinstance(packages, dict):
        raise RuntimeError(f"配置缺少 packages 对象：{path}")
    for package_key in ARTIFACTS:
        if not isinstance(packages.get(package_key), dict):
            raise RuntimeError(f"配置缺少 packages.{package_key}：{path}")
    return packages


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def update_manifest(
    manifest_path: Path,
    manifest: dict[str, Any],
    packages: dict[str, Any],
    version: str,
) -> dict[str, str]:
    urls: dict[str, str] = {}
    manifest["latest_version"] = version
    for package_key, artifact in ARTIFACTS.items():
        file_name = str(artifact["file_name"]).format(version=version)
        release_asset_name = str(artifact["source"])
        url = f"{RELEASE_BASE_URL}/{version}/{release_asset_name}"
        package = packages[package_key]
        package["file_name"] = file_name
        package["url"] = url
        urls[package_key] = url
    atomic_write_json(manifest_path, manifest)
    return urls


def git_status(repo: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), "status", "--short"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout.rstrip()


def main() -> int:
    args = parse_args()
    source_root = args.source_root.expanduser().resolve()
    publish_root = args.publish_root.expanduser().resolve()
    if not (publish_root / ".git").is_dir():
        raise RuntimeError(f"发布目录不是 Git 仓库：{publish_root}")

    version = resolve_version(source_root, args.version)
    manifest_path = publish_root / "updata.json"
    manifest = read_json(manifest_path)
    ensure_version_does_not_regress(version, manifest)
    packages = validate_manifest(manifest, manifest_path)
    sources = verify_source_artifacts(source_root)

    urls = update_manifest(
        manifest_path,
        manifest,
        packages,
        version,
    )

    print(f"macOS Gitee Release 配置已更新：v{version}")
    for package_key in ARTIFACTS:
        print(f"  已校验: {sources[package_key]}")
        print(f"  URL: {urls[package_key]}")
    print(f"  配置文件: {manifest_path}")
    print("未复制 DMG；请在创建 Gitee Release 时上传上述两个本地安装包。")
    print("未执行 git commit 或 git push。")
    status = git_status(publish_root)
    print("发布仓库变更：")
    print(status or "  （无变更）")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"发布失败：{exc}") from exc
