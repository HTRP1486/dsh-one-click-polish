#!/usr/bin/env bash
# One release, four places that must agree.
#
#   package.json version == npm latest == GitHub tag == GitHub Release
#
# Run from the repo root. It refuses to continue when the tree is dirty, when the
# three places already disagree, or when the tag exists — a forced resync there
# would publish a version number that does not match its contents.
#
# The GitHub Release step needs a token in the environment, never on the command
# line and never in this file:
#
#   GITHUB_TOKEN=... ./release.sh
#
# Without it the release still publishes to npm and pushes the tag; only the
# Release page and its tarball are skipped, with a reminder printed at the end.
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

# 6. GitHub Release + tarball.
#
# Same bytes npm received, attached where someone can download them without a
# registry client. The token stays in the environment: passing it as an argument
# would put it in the shell history and in `ps`.
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "  release 跳过：没有设置 GITHUB_TOKEN"
  echo "          用 GITHUB_TOKEN=... ./release.sh 重跑，或去网页手动创建，附件用 npm pack 产出的 tgz"
  exit 0
fi

REMOTE=$(git remote get-url origin)
REPO=$(printf '%s' "$REMOTE" | sed -E 's#.*[:/]([^/]+/[^/]+?)(\.git)?$#\1#')
echo "  release $REPO@$TAG"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
npm pack --pack-destination "$TMP" >/dev/null
TGZ=$(ls "$TMP"/*.tgz | head -n 1)

# A body is generated from the commit subjects since the previous tag, so the
# Release says what changed without anyone retyping it.
PREV=$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || true)
if [ -n "$PREV" ]; then
  NOTES=$(git log --pretty=format:'- %s' "$PREV..$TAG^" 2>/dev/null || true)
else
  NOTES=$(git log --pretty=format:'- %s' -n 20 "$TAG^" 2>/dev/null || true)
fi
[ -n "${NOTES:-}" ] || NOTES="- $TAG"

node -e '
const [tag, notes, out] = process.argv.slice(1)
require("node:fs").writeFileSync(out, JSON.stringify({
  tag_name: tag,
  name: tag,
  body: notes,
  draft: false,
  prerelease: false,
}))
' "$TAG" "$NOTES" "$TMP/body.json"

CODE=$(curl -sS -o "$TMP/resp.json" -w '%{http_code}' \
  -X POST "https://api.github.com/repos/$REPO/releases" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "User-Agent: dsh-one-click-polish-release" \
  -H "Content-Type: application/json" \
  --data-binary "@$TMP/body.json")

case "$CODE" in
  201) echo "  release 已创建" ;;
  422) echo "  release 已存在，改为补传附件" ;;
  *)   echo "  release 创建失败 HTTP $CODE"; cat "$TMP/resp.json"; exit 1 ;;
esac

# Resolve the release id, then upload. 422 on the asset means it was already there.
RELEASE_ID=$(node -e '
const fs = require("node:fs")
try { process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).id ?? "")) } catch {}
' "$TMP/resp.json")
if [ -z "$RELEASE_ID" ]; then
  RELEASE_ID=$(curl -sS "https://api.github.com/repos/$REPO/releases/tags/$TAG" \
    -H "Authorization: token $GITHUB_TOKEN" -H "User-Agent: dsh-one-click-polish-release" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).id??""))}catch{}})')
fi

NAME=$(basename "$TGZ")
UP=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$NAME" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "User-Agent: dsh-one-click-polish-release" \
  -H "Content-Type: application/gzip" \
  --data-binary "@$TGZ")
case "$UP" in
  201) echo "  附件已上传: $NAME" ;;
  422) echo "  附件已存在: $NAME" ;;
  *)   echo "  附件上传失败 HTTP $UP"; exit 1 ;;
esac

echo "  release https://github.com/$REPO/releases/tag/$TAG"
