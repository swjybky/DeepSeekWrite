#!/usr/bin/env bash
set -Eeuo pipefail

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

ROOT="${1:-$PWD}"
ROOT="$(cd "$ROOT" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ "$(uname -s)" == "Darwin" ]] || fail "DeepSeekWrite-arm.dmg must be built on macOS."
[[ "$(uname -m)" == "arm64" ]] || fail "DeepSeekWrite-arm.dmg must be built on an Apple Silicon arm64 Mac."

for cmd in node npm python3 sips iconutil hdiutil ditto codesign; do
  require_cmd "$cmd"
done

[[ -f "$ROOT/packaging/pyi_entry.py" ]] || fail "Not a Write Claw repo root: missing packaging/pyi_entry.py"
[[ -f "$ROOT/app/main.py" ]] || fail "Not a Write Claw repo root: missing app/main.py"
[[ -f "$ROOT/web/package.json" ]] || fail "Not a Write Claw repo root: missing web/package.json"
[[ -f "$ROOT/requirements.txt" ]] || fail "Not a Write Claw repo root: missing requirements.txt"

BUILD_DIR="$ROOT/build/macos-arm"
VENV_DIR="$ROOT/.venv-macarm-build"
DIST_DIR="$ROOT/dist"
APP_PATH="$DIST_DIR/DeepSeekWrite.app"
DMG_PATH="$DIST_DIR/DeepSeekWrite-arm.dmg"
DMG_ROOT="$BUILD_DIR/dmgroot"
SPEC_FILE="$SCRIPT_DIR/DeepSeekWrite-macarm.spec"
ICON_PNG="$ROOT/app/assets/app-icon.png"
ICONSET="$BUILD_DIR/app-icon.iconset"
ICON_ICNS="$BUILD_DIR/app-icon.icns"

mkdir -p "$BUILD_DIR" "$DIST_DIR"

log "Building frontend"
(
  cd "$ROOT/web"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
)
[[ -f "$ROOT/web/dist/index.html" ]] || fail "Frontend build did not create web/dist/index.html"

log "Preparing Python build environment"
if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  python3 -m venv "$VENV_DIR"
fi

PYTHON_BIN="$VENV_DIR/bin/python"
PY_ARCH="$("$PYTHON_BIN" - <<'PY'
import platform
print(platform.machine())
PY
)"
[[ "$PY_ARCH" == "arm64" ]] || fail "Build venv Python is $PY_ARCH, expected arm64. Remove $VENV_DIR and recreate it with an arm64 Python."

"$PYTHON_BIN" -m pip install --upgrade pip setuptools wheel
"$PYTHON_BIN" -m pip install -r "$ROOT/requirements.txt" pyinstaller

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
WRITECLAW_PROJECT_ROOT="$ROOT" \
WRITECLAW_MAC_ICON="$ICON_ICNS" \
  "$PYTHON_BIN" -m PyInstaller \
    --clean \
    --noconfirm \
    --distpath "$DIST_DIR" \
    --workpath "$BUILD_DIR/pyinstaller-work" \
    "$SPEC_FILE"

[[ -d "$APP_PATH" ]] || fail "PyInstaller did not create $APP_PATH"

log "Ad-hoc signing app"
codesign --force --deep --sign - "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"

log "Creating DMG"
rm -rf "$DMG_ROOT"
mkdir -p "$DMG_ROOT"
ditto "$APP_PATH" "$DMG_ROOT/DeepSeekWrite.app"
ln -s /Applications "$DMG_ROOT/Applications"
hdiutil create \
  -volname "DeepSeekWrite" \
  -srcfolder "$DMG_ROOT" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

log "Verifying DMG"
hdiutil verify "$DMG_PATH"
ls -lh "$DMG_PATH"

log "Done: $DMG_PATH"
