#!/usr/bin/env bash
# Build release tarballs for the SDK packages, with inter-package
# `@ollu/*` deps rewritten to point at GitHub Release asset URLs.
#
# Source `package.json` files stay at version 0.0.0; the requested
# version lives only in the produced tarballs. This way the working
# tree doesn't need a version bump per release.
#
# Usage:
#   ./scripts/release.sh 0.1.0
#
# Env overrides:
#   REPO   GitHub repo slug, default "olluorg/micro-platform"
#
# Output: dist-release/*.tgz, ready to upload as assets of a release
# tagged v<VERSION>. The script prints the suggested `gh release create`
# command and the consumer-side install lines.

set -euo pipefail

VERSION="${1:-}"
REPO="${REPO:-olluorg/micro-platform}"

if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>" >&2
  echo "       e.g. $0 0.1.0" >&2
  exit 1
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]; then
  echo "error: version '$VERSION' is not semver-shaped (e.g. 0.1.0 or 0.1.0-rc.1)" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist-release"
PACKAGES=(shared-types sdk-core sdk-idb sdk-backup-gdrive)
URL_BASE="https://github.com/$REPO/releases/download/v$VERSION"

rm -rf "$OUT"
mkdir -p "$OUT"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Step 1: copy each package to a temp dir and bump version there. We
# don't mutate the source tree so the working copy stays at 0.0.0.
for name in "${PACKAGES[@]}"; do
  cp -R "$ROOT/packages/$name" "$tmp/$name"
  VERSION="$VERSION" node -e "
    const fs = require('fs');
    const p = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    pkg.version = process.env.VERSION;
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
  " "$tmp/$name/package.json"
done

# Step 2: pack each (still with workspace:* deps — pnpm pack rewrites
# them to the literal version string we just set).
for name in "${PACKAGES[@]}"; do
  echo "→ packing @ollu/$name@$VERSION"
  ( cd "$tmp/$name" && pnpm pack --pack-destination "$OUT" >/dev/null )
done

# Step 3: rewrite @ollu/* deps in each tarball to GitHub Release URLs.
for tgz in "$OUT"/*.tgz; do
  base="$(basename "$tgz")"
  workdir="$tmp/extract-$base"
  rm -rf "$workdir"
  mkdir -p "$workdir"
  tar -xzf "$tgz" -C "$workdir"

  URL_BASE="$URL_BASE" VERSION="$VERSION" node -e "
    const fs = require('fs');
    const p = process.argv[1];
    const base = process.env.URL_BASE;
    const version = process.env.VERSION;
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    const sections = ['dependencies', 'devDependencies', 'peerDependencies'];
    let changed = false;
    for (const sec of sections) {
      if (!pkg[sec]) continue;
      for (const dep of Object.keys(pkg[sec])) {
        if (!dep.startsWith('@ollu/')) continue;
        const local = dep.slice('@ollu/'.length);
        const url = base + '/ollu-' + local + '-' + version + '.tgz';
        if (pkg[sec][dep] !== url) {
          pkg[sec][dep] = url;
          changed = true;
        }
      }
    }
    if (changed) fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
  " "$workdir/package/package.json"

  ( cd "$workdir" && tar -czf "$tgz" package )
done

echo ""
echo "Release tarballs in $OUT:"
ls -1 "$OUT"

echo ""
echo "Create the release (locally with gh CLI):"
echo ""
printf '  gh release create v%s \\\n' "$VERSION"
for tgz in "$OUT"/*.tgz; do
  printf '    %s \\\n' "$tgz"
done
printf '    --title "v%s" --notes "Release v%s"\n' "$VERSION" "$VERSION"

echo ""
echo "Consumers install with:"
for name in "${PACKAGES[@]}"; do
  echo "  bun add $URL_BASE/ollu-$name-$VERSION.tgz"
done
