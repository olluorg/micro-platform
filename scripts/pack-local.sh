#!/usr/bin/env bash
# Pack all public SDK packages into dist-pack/ as .tgz tarballs ready for
# `bun add file:...` in consumer projects.
#
# pnpm pack rewrites `workspace:*` deps to literal version strings ("0.0.0"),
# which makes bun in the consumer try to fetch them from npmjs.org and fail.
# To make the tarballs self-contained, we post-process each one: every
# `@ollu/*` dep is rewritten to a `file:<abs path>` referencing its sibling
# tarball in dist-pack/.
#
# Usage:
#   ./scripts/pack-local.sh
#   # then in the consumer (e.g. reader):
#   bun add file:/abs/path/to/dist-pack/ollu-*.tgz
#
# Re-running pack-local.sh produces tarballs with the same name; in the
# consumer use `bun install --force` (or remove node_modules/@ollu) to
# pick up the new contents.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist-pack"
PACKAGES=(shared-types sdk-core sdk-idb sdk-backup-gdrive)

rm -rf "$OUT"
mkdir -p "$OUT"

for name in "${PACKAGES[@]}"; do
  echo "→ packing @ollu/$name"
  ( cd "$ROOT/packages/$name" && pnpm pack --pack-destination "$OUT" >/dev/null )
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for tgz in "$OUT"/*.tgz; do
  base="$(basename "$tgz")"
  workdir="$tmp/${base%.tgz}"
  rm -rf "$workdir"
  mkdir -p "$workdir"
  tar -xzf "$tgz" -C "$workdir"

  OUT_DIR="$OUT" node -e "
    const fs = require('fs');
    const path = process.argv[1];
    const outDir = process.env.OUT_DIR;
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    const sections = ['dependencies', 'devDependencies', 'peerDependencies'];
    let changed = false;
    for (const sec of sections) {
      if (!pkg[sec]) continue;
      for (const dep of Object.keys(pkg[sec])) {
        if (!dep.startsWith('@ollu/')) continue;
        const localName = dep.slice('@ollu/'.length);
        const newSpec = 'file:' + outDir + '/ollu-' + localName + '-0.0.0.tgz';
        if (pkg[sec][dep] !== newSpec) {
          pkg[sec][dep] = newSpec;
          changed = true;
        }
      }
    }
    if (changed) fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  " "$workdir/package/package.json"

  ( cd "$workdir" && tar -czf "$tgz" package )
done

echo ""
echo "Packed into $OUT:"
ls -1 "$OUT"
echo ""
echo "Install in a consumer (bun's one-shot add of multiple file: tarballs"
echo "fails to resolve inter-package deps; install them sequentially):"
for tgz in "$OUT"/*.tgz; do
  echo "  bun add file:$tgz"
done
