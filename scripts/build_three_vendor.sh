#!/bin/sh
# docs/vendor/three.min.js ni qayta yig'adi (3D konfigurator uchun).
#
# Faqat `scripts/three-vendor/entry.js` dagi klasslar olinadi (tree-shaking),
# natija — bitta siqilgan IIFE: `window.THREE`. Mini App uni faqat
# konfigurator ochilganda yuklaydi (`docs/js/app.js -> ensureStudio3D`).
#
# Talab: Node.js 18+ va internet (npm).
#   sh scripts/build_three_vendor.sh
set -eu

THREE_VERSION="0.186.1"
ESBUILD_VERSION="0.25.12"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp "$ROOT/scripts/three-vendor/entry.js" "$WORK/entry.js"
cd "$WORK"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "three@$THREE_VERSION" "esbuild@$ESBUILD_VERSION"

mkdir -p "$ROOT/docs/vendor"
./node_modules/.bin/esbuild entry.js \
  --bundle \
  --minify \
  --format=iife \
  --global-name=THREE \
  --target=es2019 \
  --legal-comments=none \
  --banner:js="/* three.js v${THREE_VERSION} (MIT) — https://threejs.org — faqat konfigurator qismlari. Qayta yig'ish: scripts/build_three_vendor.sh */" \
  --outfile="$ROOT/docs/vendor/three.min.js"

echo "OK: docs/vendor/three.min.js ($(wc -c < "$ROOT/docs/vendor/three.min.js") bayt)"
