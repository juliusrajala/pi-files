#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
expected_version=$(node -p "require('$repo_root/package.json').devDependencies['@earendil-works/pi-coding-agent']")
target="$repo_root/pi-source"

if [[ -e "$target" && ! -d "$target/.git" ]]; then
  echo "Refusing to replace non-Git path: $target" >&2
  exit 1
fi

if [[ ! -d "$target/.git" ]]; then
  git clone https://github.com/earendil-works/pi-mono.git "$target"
fi

git -C "$target" fetch --tags --force
if git -C "$target" rev-parse -q --verify "refs/tags/v$expected_version" >/dev/null; then
  git -C "$target" checkout --detach "v$expected_version"
elif git -C "$target" rev-parse -q --verify "refs/tags/$expected_version" >/dev/null; then
  git -C "$target" checkout --detach "$expected_version"
else
  echo "No Pi source tag found for $expected_version; check out a matching commit manually." >&2
  exit 1
fi

cd "$repo_root"
npm run check:pi-version -- --require-source
