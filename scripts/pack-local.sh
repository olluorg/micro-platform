#!/usr/bin/env bash
# Pack all public SDK packages into dist-pack/ as .tgz tarballs that
# consumer projects (e.g. reader) can install via `bun add file:...`.
#
# pnpm pack rewrites `workspace:*` deps to the actual package version
# at pack time, so the tarballs reference each other by version. A
# consumer must install all of them in one shot so bun can satisfy the
# inter-package deps from sibling tarballs instead of npmjs.
#
# Usage:
#   ./scripts/pack-local.sh
#   # then in the consumer project (e.g. reader):
#   bun add file:/abs/path/to/micro-platform/dist-pack/ollu-shared-types-*.tgz \
#           file:/abs/path/to/micro-platform/dist-pack/ollu-sdk-core-*.tgz \
#           file:/abs/path/to/micro-platform/dist-pack/ollu-sdk-idb-*.tgz \
#           file:/abs/path/to/micro-platform/dist-pack/ollu-sdk-backup-gdrive-*.tgz
#
# After re-running pack-local.sh, re-install in the consumer with
# `bun install --force` to pick up the new tarball contents.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist-pack"

PACKAGES=(
  "shared-types"
  "sdk-core"
  "sdk-idb"
  "sdk-backup-gdrive"
)

rm -rf "$OUT"
mkdir -p "$OUT"

for name in "${PACKAGES[@]}"; do
  echo "→ packing @ollu/$name"
  ( cd "$ROOT/packages/$name" && pnpm pack --pack-destination "$OUT" >/dev/null )
done

echo ""
echo "Packed into $OUT:"
ls -1 "$OUT"

echo ""
echo "To install in a consumer (run from the consumer's directory):"
echo ""
printf '  bun add'
for tgz in "$OUT"/*.tgz; do
  printf ' \\\n    file:%s' "$tgz"
done
echo
