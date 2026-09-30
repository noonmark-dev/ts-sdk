#!/usr/bin/env bash
# Cut a release of @noonmark/sdk.
#   npm run release -- <patch|minor|major|x.y.z> [--dry-run]
# Bumps package.json, commits, creates the annotated tag v<version> and prints
# the push command. Never pushes, never runs `npm publish`.
set -euo pipefail

usage() { echo "usage: npm run release -- <patch|minor|major|x.y.z> [--dry-run]" >&2; exit 2; }

DRY=0
BUMP=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h|--help) usage ;;
    -*) echo "unknown flag: $arg" >&2; usage ;;
    *) if [ -z "$BUMP" ]; then BUMP="$arg"; else usage; fi ;;
  esac
done
[ -n "$BUMP" ] || usage

cd "$(git rev-parse --show-toplevel)"
NAME="$(node -p "require('./package.json').name")"
CURRENT="$(node -p "require('./package.json').version")"

# Next version, computed without touching any file.
NEXT="$(node -e '
  const [cur, bump] = process.argv.slice(1);
  const m = cur.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) { console.error("current version is not x.y.z: " + cur); process.exit(1); }
  let [maj, min, pat] = m.slice(1).map(Number);
  if (bump === "patch") pat++;
  else if (bump === "minor") { min++; pat = 0; }
  else if (bump === "major") { maj++; min = 0; pat = 0; }
  else if (/^\d+\.\d+\.\d+$/.test(bump)) { console.log(bump); process.exit(0); }
  else { console.error("bad bump: " + bump); process.exit(1); }
  console.log(`${maj}.${min}.${pat}`);
' "$CURRENT" "$BUMP")"
TAG="v$NEXT"

FAILED=0
refuse() {
  echo "REFUSE: $1" >&2
  if [ "$DRY" = 1 ]; then FAILED=1; else exit 1; fi
}
step() { if [ "$DRY" = 1 ]; then echo "[dry-run] would run: $*"; else echo "+ $*"; "$@"; fi; }

echo "$NAME $CURRENT -> $NEXT (tag $TAG)"
if [ "$DRY" = 1 ]; then echo "[dry-run] nothing will be changed"; fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || refuse "on branch '$BRANCH', releases are cut from main"
[ -z "$(git status --porcelain)" ] || refuse "working tree is not clean"

if git remote get-url origin >/dev/null 2>&1; then
  git fetch --quiet origin main 2>/dev/null || echo "warn: could not fetch origin/main" >&2
  if git rev-parse --verify --quiet origin/main >/dev/null; then
    [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
      || refuse "HEAD is not origin/main (pull or push first)"
  fi
  if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
    refuse "tag $TAG already exists on origin"
  fi
else
  echo "warn: no 'origin' remote, skipping remote checks" >&2
fi

if [ -n "$(git tag --list "$TAG")" ]; then refuse "tag $TAG already exists locally"; fi

# npm view prints nothing and fails with E404 when the version (or the whole
# package) does not exist.
if VIEW="$(npm view "$NAME@$NEXT" version 2>&1)"; then
  if [ -n "$VIEW" ]; then refuse "$NAME@$NEXT already exists on npm"; fi
elif echo "$VIEW" | grep -q "E404"; then
  echo "ok: $NAME@$NEXT is not on npm yet"
else
  refuse "could not ask npm whether $NAME@$NEXT exists: $VIEW"
fi

step npm run typecheck
step npm run build
step npm test
step npm run smoke

if [ "$DRY" = 1 ]; then
  echo "[dry-run] would run: npm version $NEXT --no-git-tag-version"
  echo "[dry-run] would run: git add package.json package-lock.json"
  echo "[dry-run] would run: git commit -m \"chore: release v$NEXT\""
  echo "[dry-run] would run: git tag -a $TAG -m \"$NAME v$NEXT\""
else
  npm version "$NEXT" --no-git-tag-version >/dev/null
  git add package.json package-lock.json
  git commit -m "chore: release v$NEXT"
  git tag -a "$TAG" -m "$NAME v$NEXT"
fi

if [ "$FAILED" = 1 ]; then
  echo "[dry-run] one or more checks above would have REFUSED the real run" >&2
fi
echo
echo "Next, run this yourself (the script never pushes):"
echo "  git push origin main $TAG"
echo "Pushing the tag starts the release workflow, which publishes to npm."
