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
  index.html web.html web-core.js web-store.js web-cloud.js web-fleet.js web-app.js web-worker.js
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

SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct)}"
reproducible_zip() {
  local source_dir="$1" output_file="$2"
  python3 - "$source_dir" "$output_file" "$SOURCE_DATE_EPOCH" <<'PY'
import datetime
import pathlib
import stat
import sys
import zipfile

source = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
epoch = max(int(sys.argv[3]), 315532800)
stamp = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc)
date_time = (stamp.year, stamp.month, stamp.day, stamp.hour, stamp.minute, stamp.second - stamp.second % 2)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(item for item in source.rglob('*') if item.is_file()):
        info = zipfile.ZipInfo(path.relative_to(source).as_posix(), date_time)
        info.create_system = 3
        mode = 0o755 if path.stat().st_mode & stat.S_IXUSR else 0o644
        info.external_attr = (stat.S_IFREG | mode) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
PY
}

reproducible_zip "$TMP/local" "$DIST/lucidfence-web-local-${VERSION}.zip"
reproducible_zip "$TMP/cloud" "$DIST/lucidfence-web-cloud-${VERSION}.zip"
(
  cd "$DIST"
  shasum -a 256 "lucidfence-web-local-${VERSION}.zip" "lucidfence-web-cloud-${VERSION}.zip" > SHA256SUMS
)
printf 'Built %s\n' "$DIST/lucidfence-web-local-${VERSION}.zip"
printf 'Built %s\n' "$DIST/lucidfence-web-cloud-${VERSION}.zip"
