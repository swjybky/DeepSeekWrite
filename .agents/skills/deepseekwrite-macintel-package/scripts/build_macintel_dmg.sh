#!/usr/bin/env bash
set -Eeuo pipefail

PYTHON_BUILD="cpython-3.12.13-macos-x86_64-none"

log() {
  printf '\n==> %s\n' "$*"
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

run_x86_python() {
  arch -x86_64 "$@"
}

python_arch() {
  run_x86_python "$1" - <<'PY'
import platform
print(platform.machine())
PY
}

python_version_ok() {
  run_x86_python "$1" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY
}

ROOT="${1:-$PWD}"
ROOT="$(cd "$ROOT" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ "$(uname -s)" == "Darwin" ]] || fail "DeepSeekWrite-intel.dmg must be built on macOS."
arch -x86_64 /usr/bin/true >/dev/null 2>&1 || fail "x86_64 execution is unavailable. On Apple Silicon, install Rosetta first: softwareupdate --install-rosetta"

for cmd in node npm sips iconutil hdiutil ditto codesign file; do
  require_cmd "$cmd"
done

[[ -f "$ROOT/packaging/pyi_entry.py" ]] || fail "Not a Write Claw repo root: missing packaging/pyi_entry.py"
[[ -f "$ROOT/app/main.py" ]] || fail "Not a Write Claw repo root: missing app/main.py"
[[ -f "$ROOT/web/package.json" ]] || fail "Not a Write Claw repo root: missing web/package.json"
[[ -f "$ROOT/requirements.txt" ]] || fail "Not a Write Claw repo root: missing requirements.txt"

BUILD_DIR="$ROOT/build/macos-intel"
INTEL_PYTHON_DIR="$ROOT/.macintel-python"
INTEL_PYTHON="$INTEL_PYTHON_DIR/$PYTHON_BUILD/bin/python3.12"
VENV_DIR="$ROOT/.venv-macintel-build"
DIST_DIR="$ROOT/dist"
APP_PATH="$DIST_DIR/DeepSeekWrite.app"
APP_EXE="$APP_PATH/Contents/MacOS/DeepSeekWrite"
DMG_PATH="$DIST_DIR/DeepSeekWrite-intel.dmg"
DMG_ROOT="$BUILD_DIR/dmgroot"
SPEC_FILE="$SCRIPT_DIR/DeepSeekWrite-macintel.spec"
ICON_PNG="$ROOT/app/assets/app-icon.png"
ICONSET="$BUILD_DIR/app-icon.iconset"
ICON_ICNS="$BUILD_DIR/app-icon.icns"

mkdir -p "$BUILD_DIR" "$DIST_DIR"

log "Locating Intel Python"
if [[ -n "${WRITECLAW_INTEL_PYTHON:-}" ]]; then
  INTEL_PYTHON="$WRITECLAW_INTEL_PYTHON"
fi

if [[ ! -x "$INTEL_PYTHON" ]]; then
  require_cmd uv
  log "Installing $PYTHON_BUILD with uv"
  uv python install "$PYTHON_BUILD" --install-dir "$INTEL_PYTHON_DIR"
fi

[[ -x "$INTEL_PYTHON" ]] || fail "Missing Intel Python: $INTEL_PYTHON"
[[ "$(python_arch "$INTEL_PYTHON")" == "x86_64" ]] || fail "Python is not x86_64: $INTEL_PYTHON"
python_version_ok "$INTEL_PYTHON" || fail "Intel Python must be 3.10 or newer: $INTEL_PYTHON"

log "Building frontend"
(
  cd "$ROOT/web"
  if [[ -f package-lock.json ]]; then
    npm ci
    npm rebuild
  else
    npm install
  fi
  npm run build
)
[[ -f "$ROOT/web/dist/index.html" ]] || fail "Frontend build did not create web/dist/index.html"

log "Preparing x86_64 Python build environment"
if [[ ! -x "$VENV_DIR/bin/python" ]] || [[ "$(python_arch "$VENV_DIR/bin/python" 2>/dev/null || true)" != "x86_64" ]]; then
  rm -rf "$VENV_DIR"
  run_x86_python "$INTEL_PYTHON" -m venv "$VENV_DIR"
fi

PYTHON_BIN="$VENV_DIR/bin/python"
[[ "$(python_arch "$PYTHON_BIN")" == "x86_64" ]] || fail "Build venv Python is not x86_64: $PYTHON_BIN"

run_x86_python "$PYTHON_BIN" -m pip install --upgrade pip setuptools wheel
run_x86_python "$PYTHON_BIN" -m pip install -r "$ROOT/requirements.txt" pyinstaller
run_x86_python "$PYTHON_BIN" - <<'PY'
import platform
import webview
import PyInstaller
print("arch", platform.machine())
print("webview", getattr(webview, "__version__", "ok"))
print("pyinstaller", PyInstaller.__version__)
PY

log "Generating macOS icon"
if [[ -f "$ICON_PNG" ]]; then
  rm -rf "$ICONSET"
  mkdir -p "$ICONSET"
  sips -z 16 16 "$ICON_PNG" --out "$ICONSET/icon_16x16.png" >/dev/null
  sips -z 32 32 "$ICON_PNG" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$ICON_PNG" --out "$ICONSET/icon_32x32.png" >/dev/null
  sips -z 64 64 "$ICON_PNG" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$ICON_PNG" --out "$ICONSET/icon_128x128.png" >/dev/null
  sips -z 256 256 "$ICON_PNG" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$ICON_PNG" --out "$ICONSET/icon_256x256.png" >/dev/null
  sips -z 512 512 "$ICON_PNG" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$ICON_PNG" --out "$ICONSET/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$ICON_PNG" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$ICONSET" -o "$ICON_ICNS"
else
  printf 'WARN: Missing icon source: %s\n' "$ICON_PNG" >&2
  ICON_ICNS=""
fi

log "Building DeepSeekWrite.app with PyInstaller"
rm -rf "$APP_PATH" "$DIST_DIR/DeepSeekWrite" "$DMG_PATH"
env WRITECLAW_PROJECT_ROOT="$ROOT" \
  WRITECLAW_MAC_ICON="$ICON_ICNS" \
  arch -x86_64 "$PYTHON_BIN" -m PyInstaller \
    --clean \
    --noconfirm \
    --distpath "$DIST_DIR" \
    --workpath "$BUILD_DIR/pyinstaller-work" \
    "$SPEC_FILE"

[[ -d "$APP_PATH" ]] || fail "PyInstaller did not create $APP_PATH"
[[ -x "$APP_EXE" ]] || fail "Missing app executable: $APP_EXE"
file "$APP_EXE"
file "$APP_EXE" | grep -q "x86_64" || fail "App executable is not x86_64: $APP_EXE"

log "Ad-hoc signing app"
codesign --force --deep --sign - "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"

log "Creating DMG"
rm -rf "$DMG_ROOT"
mkdir -p "$DMG_ROOT"
ditto "$APP_PATH" "$DMG_ROOT/DeepSeekWrite.app"
ln -s /Applications "$DMG_ROOT/Applications"
hdiutil create \
  -volname "DeepSeekWrite Intel" \
  -srcfolder "$DMG_ROOT" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

log "Verifying DMG"
hdiutil verify "$DMG_PATH"
ls -lh "$DMG_PATH"

log "Done: $DMG_PATH"
