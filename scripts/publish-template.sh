#!/usr/bin/env bash
#
# Publish `templates/plugin/` to the standalone template repository.
#
# The template is canonical HERE (it is typechecked against the real API by
# `pnpm --filter @tumult/ui test:template`), and public THERE (authors use it
# without access to this repository). This script is the one-way sync: it
# re-runs the guards, mirrors the directory into a scratch clone, and pushes a
# single commit.
#
#   scripts/publish-template.sh            # push to main
#   scripts/publish-template.sh --dry-run  # show what would change
#
# Requires `gh` (authed) for the first run; the repository is created as a
# GitHub *template* repository so authors get the "Use this template" button.
set -euo pipefail

REPO="${TEMPLATE_REPO:-jackgraddon/tumult-plugin-template}"
SOURCE_DIR="templates/plugin"
DRY_RUN=""

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN="--dry-run" ;;
        *) echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

echo "==> guards"
pnpm --filter @tumult/ui test:template
node --import tsx packages/ui/scripts/emit-plugin-schema.ts

echo "==> scratch clone"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# The repo may not exist yet; `gh` uses the active account, so clone through
# the authenticated user explicitly (a plain https clone would go through the
# machine's stored credential, which may belong to a different account).
auth_user="$(gh api user --jq .login)"
clone_url="https://$auth_user@github.com/$REPO.git"

if ! git clone --quiet "$clone_url" "$work/template" 2>/dev/null; then
    echo "==> creating $REPO (public template repository)"
    gh repo create "$REPO" --public --description "Template for a Tumult plugin" >/dev/null
    gh repo edit "$REPO" --template >/dev/null
    git clone --quiet "$clone_url" "$work/template"
fi

echo "==> syncing $SOURCE_DIR -> $REPO"
rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'tsconfig.workspace.json' \
    --exclude 'types/workspace-shims.d.ts' \
    "$SOURCE_DIR"/ "$work/template"/

cd "$work/template"
git add -A
if git diff --cached --quiet; then
    echo "==> nothing to publish"
    exit 0
fi
git -c user.name="Tumult" -c user.email="noreply@github.com" \
    commit --quiet -m "Sync from jackgraddon/tumult@$(git -C "$root" rev-parse --short HEAD)"
if [ -n "$DRY_RUN" ]; then
    git show --stat --oneline HEAD
    echo "==> dry run: not pushing"
    exit 0
fi
git push --quiet origin HEAD:main
echo "==> published to https://github.com/$REPO"
