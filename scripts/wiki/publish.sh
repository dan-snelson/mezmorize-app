#!/usr/bin/env bash
#
#  publish.sh
#  Regenerate the wiki from the app's in-app Help (HelpView.swift) and push it to
#  https://github.com/dan-snelson/mezmorize-app/wiki. Run from anywhere:
#
#    scripts/wiki/publish.sh
#
#  Environment:
#    MEZMORIZE_APP_REPO   path to the private Mezmorize app repository (default: ../Mezmorize)
#    WIKI_REPO_URL        wiki remote (default: https://github.com/dan-snelson/mezmorize-app.wiki.git)
#
#  The generated pages are also written to wiki/ in this repository; commit them with the site.
#

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app_repo="${MEZMORIZE_APP_REPO:-$repo_root/../Mezmorize}"
wiki_url="${WIKI_REPO_URL:-https://github.com/dan-snelson/mezmorize-app.wiki.git}"

# 1. Generate (stops here on any error; nothing is written unless HelpView.swift parses).
node "$repo_root/scripts/wiki/generate.mjs" --source "$app_repo/Mezmorize/HelpView.swift"
app_sha="$(git -C "$app_repo" rev-parse --short HEAD)"

# 2. Clone the wiki into a temporary directory.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if ! git clone --quiet "$wiki_url" "$tmp/wiki"; then
	echo "error: could not clone $wiki_url" >&2
	echo "hint: the wiki repository does not exist until its first page is created." >&2
	echo "      Create any page at https://github.com/dan-snelson/mezmorize-app/wiki, then run this again." >&2
	exit 1
fi

# 3. Mirror wiki/ into it.
rsync -a --delete --exclude .git "$repo_root/wiki/" "$tmp/wiki/"

# 4. Commit and push only when something changed.
cd "$tmp/wiki"
git add -A
if git diff --cached --quiet; then
	echo "wiki up to date"
	exit 0
fi
git commit --quiet -m "Sync wiki from HelpView.swift @ $app_sha"
git push --quiet origin HEAD
echo "wiki updated from HelpView.swift @ $app_sha"
