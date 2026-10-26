#!/usr/bin/env bash
# One release, three places that must agree.
#
#   package.json version == npm latest == GitHub tag/Release
#
# Run from the repo root. It refuses to continue when the tree is dirty, when the
# three places already disagree, or when the tag exists — a forced resync there
# would publish a version number that does not match its contents.
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

echo "版本: $VERSION"

# 1. Working tree must be clean: a release should be exactly what was reviewed.
if [ -n "$(git status --porcelain)" ]; then
  echo "工作区不干净，先提交:" >&2
  git status --short >&2
  exit 1
fi

# 2. The same tag must not exist twice: npm forbids republishing a version, and a
#    tag that already exists would point at an older commit.
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "tag $TAG 已存在。要发新版就先改 package.json 的 version。" >&2
  exit 1
fi

if npm view "dsh-one-click-polish@$VERSION" version >/dev/null 2>&1; then
  echo "npm 上已存在 $VERSION。请先提升 package.json 的 version。" >&2
  exit 1
fi

# 3. Syntax and encoding before anything leaves the machine.
node --check index.js
node --check client.js
node -e '
const fs = require("node:fs"), path = require("node:path")
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(d, e.name)
    e.isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}
let bad = 0
for (const f of walk(".")) {
  const b = fs.readFileSync(f)
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { console.log("BOM", f); bad++ }
  try { new TextDecoder("utf-8", { fatal: true }).decode(b) } catch { console.log("BAD UTF-8", f); bad++ }
}
if (bad) process.exit(1)
'
echo "编码干净"

# 4. Runtime state must never be inside the package.
LEAK=$(ls -1 .one-click-polish*.json *.tgz 2>/dev/null || true)
if [ -n "$LEAK" ]; then
  echo "运行时文件在仓库里，先清掉:" >&2
  echo "$LEAK" >&2
  exit 1
fi

# 5. Commit, tag, push, then publish. The tag is created only after the commit so
#    it points at the exact bytes npm will receive.
git push
git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"
npm publish --access public

echo
echo "发布完成: $TAG"
echo "  npm     https://www.npmjs.com/package/dsh-one-click-polish"
echo "  release 需要在网页上手动创建，附件用 npm pack 产出的 tgz"
