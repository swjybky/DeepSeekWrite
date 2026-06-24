---
name: deepseekwrite-macarm-package
description: Build the local Write Claw/DeepSeekWrite repository into a macOS Apple Silicon arm64 installer DMG. Use when the user says "打macarm包", "打 mac-arm 包", "打 mac arm 包", "构建 DeepSeekWrite-arm.dmg", or asks to package this project for macOS arm64 distribution.
---

# DeepSeekWrite mac-arm Package

## Workflow

When this skill triggers, package the current Write Claw/DeepSeekWrite repo for macOS Apple Silicon by running the bundled script:

```bash
/Users/fafeng/.codex/skills/deepseekwrite-macarm-package/scripts/build_macarm_dmg.sh /Users/fafeng/project/openwrite/write-claw
```

If the user provides a different repo path, pass that path as the first argument. If no path is provided and the current working directory is the repo root, the script can be run without arguments.

## What The Script Does

The script performs the full packaging flow:

1. Verifies it is running on macOS arm64.
2. Builds `web/dist` with `npm ci` and `npm run build`.
3. Creates or reuses `.venv-macarm-build`.
4. Installs Python requirements and PyInstaller into that venv.
5. Generates a temporary `.icns` icon from `app/assets/app-icon.png`.
6. Builds `dist/DeepSeekWrite.app` with PyInstaller using the bundled mac-arm spec.
7. Ad-hoc signs the app with `codesign`.
8. Creates and verifies `dist/DeepSeekWrite-arm.dmg`.

## Completion Criteria

Before reporting success, confirm that this exact file exists:

```bash
/Users/fafeng/project/openwrite/write-claw/dist/DeepSeekWrite-arm.dmg
```

Do not rename the final DMG. If packaging fails, report the failing step and the most relevant terminal output. If the machine is not macOS arm64, stop and tell the user that this package must be built on an Apple Silicon Mac.
