#!/usr/bin/env bash
# Stop hook: Claude can't finish a turn that changed code until the repo's
# checks pass and the verify-app reviewer has written PASS.
#
#   exit 0  nothing changed, or everything passed (attempt counter reset),
#           or 3 blocked rounds in a row (gives up so the session can't loop forever)
#   exit 2  something failed; the reasons go to stderr and Claude keeps working
#
# Checks, in order (each only if it exists in this repo):
#   npm run lint, npm run typecheck, npm test (vitest; live-API tests stay skipped)
#   npx tsx .claude/hooks/owner-rules.ts   (Conrad's stated rules, pinned)
#   hard checks: no .env file tracked, no edit to a migration that is already on main
#   review/verdict.txt: first line exactly PASS, written after the latest change
#   (a changed file edited, or deleted, after the verdict makes it stale)
#   (on FAIL, the reviewer's verdict, with its next instructions, is handed back as the reason)
#
# Note: `claude --bare -p` (bare headless mode) skips local hooks, so this does not run there.

set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT" || exit 0

REVIEW_DIR="review"
VERDICT="$REVIEW_DIR/verdict.txt"
ATTEMPTS_FILE="$REVIEW_DIR/.stop-attempts"
MAX_ROUNDS=3

cat >/dev/null 2>&1 || true # hook input (JSON on stdin) is not needed

# ---- What changed: uncommitted + untracked + this branch's commits not on main ----
BASE=""
for ref in origin/main main; do
  if git rev-parse --verify -q "$ref" >/dev/null; then
    BASE="$(git merge-base HEAD "$ref" 2>/dev/null || true)"
    break
  fi
done

changed="$(
  {
    git diff --name-only HEAD 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
    [ -n "$BASE" ] && git diff --name-only "$BASE" HEAD 2>/dev/null
  } | grep -v "^$REVIEW_DIR/" | sort -u
)"

if [ -z "$changed" ]; then
  rm -f "$ATTEMPTS_FILE"
  exit 0
fi

mkdir -p "$REVIEW_DIR"
attempts="$(cat "$ATTEMPTS_FILE" 2>/dev/null || echo 0)"
case "$attempts" in '' | *[!0-9]*) attempts=0 ;; esac

if [ "$attempts" -ge "$MAX_ROUNDS" ]; then
  rm -f "$ATTEMPTS_FILE"
  msg="Verification still failing after $MAX_ROUNDS rounds; stopping anyway. Tell Conrad exactly what is still failing."
  printf '{"systemMessage": "%s"}\n' "$msg"
  exit 0
fi

failures=""
add_failure() { failures="${failures}
---- $1 ----
$2
"; }

run_check() { # name, command...
  local name="$1"; shift
  local out
  if ! out="$("$@" 2>&1)"; then
    add_failure "$name failed" "$(printf '%s\n' "$out" | tail -n 40)"
  fi
}

has_script() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)" 2>/dev/null; }

if [ -f package.json ]; then
  if [ ! -d node_modules ]; then
    add_failure "dependencies missing" "node_modules is missing. Run: npm ci"
  else
    has_script lint && run_check "npm run lint" npm run --silent lint
    has_script typecheck && run_check "npm run typecheck" npm run --silent typecheck
    has_script test && run_check "npm test" npm test --silent
    [ -f .claude/hooks/owner-rules.ts ] && run_check "owner rules (.claude/hooks/owner-rules.ts)" npx --no-install tsx .claude/hooks/owner-rules.ts
  fi
fi

# ---- Hard checks ----
envs="$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.env\.example$' || true)"
[ -n "$envs" ] && add_failure "secret file tracked" "These .env files are tracked by git; untrack them and keep secrets out of the repo:
$envs"

if [ -n "$BASE" ]; then
  edited="$(git diff --name-status "$BASE" -- supabase/migrations 2>/dev/null | awk '$1 ~ /^(M|D|R)/ {print $NF}')"
  [ -n "$edited" ] && add_failure "applied migration edited" "Never edit a migration that is already on main; add a new one instead:
$edited"
fi

# ---- Reviewer verdict ----
if [ ! -f "$VERDICT" ]; then
  add_failure "no reviewer verdict" "$VERDICT is missing. Run the verify-app subagent; it writes PASS or FAIL there."
else
  first="$(head -n 1 "$VERDICT" | tr -d '[:space:]')"
  if [ "$first" != "PASS" ]; then
    add_failure "reviewer verdict is FAIL: follow its next instructions" "$(head -n 80 "$VERDICT")"
  else
    stale=""
    while IFS= read -r f; do
      if [ -e "$f" ]; then
        [ "$f" -nt "$VERDICT" ] && stale="$stale
$f"
      else
        # Deleted after the review? Deleting a file bumps its directory's mtime.
        d="$(dirname "$f")"
        while [ ! -d "$d" ]; do d="$(dirname "$d")"; done
        [ "$d" -nt "$VERDICT" ] && stale="$stale
$f (deleted)"
      fi
    done <<<"$changed"
    [ -n "$stale" ] && add_failure "reviewer verdict is stale" "These files changed after $VERDICT was written; delete it and run verify-app again:$stale"
  fi
fi

if [ -n "$failures" ]; then
  echo $((attempts + 1)) >"$ATTEMPTS_FILE"
  {
    echo "Not done yet (verification round $((attempts + 1)) of $MAX_ROUNDS). Fix these, then rerun the verify-app subagent:"
    printf '%s\n' "$failures"
  } >&2
  exit 2
fi

rm -f "$ATTEMPTS_FILE"
exit 0
