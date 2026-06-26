---
name: publish-deepseekwrite-mac
description: Prepare DeepSeekWrite macOS release metadata for Gitee Releases without copying installer files. Use when the user says "发布mac安装包", "发布 mac 安装包", "发布苹果安装包", or asks to verify `dist/DeepSeekWrite-arm.dmg` and `dist/DeepSeekWrite-intel.dmg` and update the macOS entries in `/Users/fafeng/project/openwrite/deepseekpush/deepseekwrite/updata.json` to Gitee Release asset URLs.
---

# Publish DeepSeekWrite macOS release metadata

Run the bundled deterministic publisher:

```bash
python3 .codex/skills/publish-deepseekwrite-mac/scripts/publish_mac.py
```

The script must:

1. Read the release version from `app/version.json`.
2. Verify both canonical artifacts with `hdiutil verify`:
   - `dist/DeepSeekWrite-arm.dmg`
   - `dist/DeepSeekWrite-intel.dmg`
3. Do not create a version directory and do not copy either DMG into the publishing repository. The user uploads both canonical DMGs while creating the Gitee Release.
4. Update only these release fields in `updata.json`:
   - top-level `latest_version`
   - `packages.macos-arm64.file_name`
   - `packages.macos-arm64.url`
   - `packages.macos-x64.file_name`
   - `packages.macos-x64.url`
5. Set the Gitee Release URLs to:
   - `https://gitee.com/swjai001/deepseekwrite/releases/download/<version>/DeepSeekWrite-arm.dmg`
   - `https://gitee.com/swjai001/deepseekwrite/releases/download/<version>/DeepSeekWrite-intel.dmg`
6. Preserve Windows configuration and release notes.
7. Refuse to publish a version lower than the existing `latest_version`.

Use the default paths embedded in the script unless the user explicitly supplies alternatives.

Do not commit or push the publishing repository. Report the verified local files, generated URLs, updated config path, and the publishing repository's `git status --short`.

If the user explicitly provides another version, pass `--version <version>`; otherwise always use `app/version.json`.

If `app/version.json` is older than `updata.json.latest_version`, stop and ask the user to bump the application version. Never lower the published version automatically.
