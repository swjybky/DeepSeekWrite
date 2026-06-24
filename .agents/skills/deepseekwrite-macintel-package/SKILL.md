---
name: deepseekwrite-macintel-package
description: Build the local Write Claw/DeepSeekWrite repository into a macOS Intel x86_64 installer DMG. Use when the user says "打intel包", "打 mac intel 包", "打 mac-intel 包", "打包intel芯片dmg", "构建 DeepSeekWrite-intel.dmg", or asks to package this project for Intel Mac distribution.
---

# DeepSeekWrite Intel Package

## Workflow

When this skill triggers, package the current Write Claw/DeepSeekWrite repo for Intel Mac by running:

```bash
/Users/fafeng/.codex/skills/deepseekwrite-macintel-package/scripts/build_macintel_dmg.sh /Users/fafeng/project/openwrite/write-claw
```

If the user provides a different repo path, pass that path as the first argument. If no path is provided and the current working directory is the repo root, the script can be run without arguments.

## Intel Environment

The script uses an x86_64 Python environment:

- Python runtime: `.macintel-python/cpython-3.12.13-macos-x86_64-none/bin/python3.12`
- Virtual environment: `.venv-macintel-build`

On Apple Silicon, all Python packaging commands must be prefixed with `arch -x86_64`. The script enforces this and validates `platform.machine() == "x86_64"` before packaging.

If the Intel Python runtime is missing, the script attempts to install it with:

```bash
uv python install cpython-3.12.13-macos-x86_64-none --install-dir .macintel-python
```

## What The Script Does

The script performs the full packaging flow:

1. Verifies it is running on macOS and can execute x86_64 binaries.
2. Builds `web/dist` with `npm ci` and `npm run build`.
3. Creates or repairs `.venv-macintel-build` using x86_64 Python.
4. Installs Python requirements and PyInstaller under x86_64.
5. Generates a temporary `.icns` icon from `app/assets/app-icon.png`.
6. Builds `dist/DeepSeekWrite.app` with PyInstaller using the bundled Intel spec.
7. Verifies the app executable is x86_64.
8. Ad-hoc signs the app with `codesign`.
9. Creates and verifies `dist/DeepSeekWrite-intel.dmg`.

## Completion Criteria

Before reporting success, confirm that this exact file exists:

```bash
/Users/fafeng/project/openwrite/write-claw/dist/DeepSeekWrite-intel.dmg
```

Do not rename the final DMG. If packaging fails, report the failing step and the most relevant terminal output.
