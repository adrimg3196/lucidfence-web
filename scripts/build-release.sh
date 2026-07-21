#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
EXPECTED_TAG="v${VERSION}"
if [[ -n "${GITHUB_REF_NAME:-}" && "${GITHUB_REF_NAME}" != "$EXPECTED_TAG" ]]; then
  echo "Tag ${GITHUB_REF_NAME} does not match package version ${EXPECTED_TAG}" >&2
  exit 1
fi

DIST="$ROOT/dist"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/lucidfence-release.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
rm -rf "$DIST"
mkdir -p "$DIST" "$TMP/local" "$TMP/cloud"

LOCAL_FILES=(
  index.html web.html web-core.js web-store.js web-cloud.js web-app.js web-worker.js
  sw.js runtime.json manifest.webmanifest lucidfence-icon.svg .nojekyll
  README.md SELF_HOST.md LICENSE
)
for file in "${LOCAL_FILES[@]}"; do cp "$file" "$TMP/local/$file"; done
cp -R deploy gateway "$TMP/local/"
(
  cd "$TMP/local"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS
)

while IFS= read -r -d '' file; do
  [[ -f "$file" ]] || continue
  mkdir -p "$TMP/cloud/$(dirname "$file")"
  cp "$file" "$TMP/cloud/$file"
done < <(git ls-files -co --exclude-standard -z)
[[ -f "$TMP/cloud/api/runtime.js" ]] || { echo "Cloud bundle missing api/" >&2; exit 1; }
[[ -f "$TMP/cloud/supabase/migrations/202607210001_initial.sql" ]] || { echo "Cloud bundle missing supabase/" >&2; exit 1; }
(
  cd "$TMP/cloud"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS
)

(cd "$TMP/local" && zip -q -X -r "$DIST/lucidfence-web-local-${VERSION}.zip" .)
(cd "$TMP/cloud" && zip -q -X -r "$DIST/lucidfence-web-cloud-${VERSION}.zip" .)
(
  cd "$DIST"
  shasum -a 256 "lucidfence-web-local-${VERSION}.zip" "lucidfence-web-cloud-${VERSION}.zip" > SHA256SUMS
)
printf 'Built %s\n' "$DIST/lucidfence-web-local-${VERSION}.zip"
printf 'Built %s\n' "$DIST/lucidfence-web-cloud-${VERSION}.zip"
