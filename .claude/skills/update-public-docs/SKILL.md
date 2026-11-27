---
name: update-public-docs
description: Bring this public site repo (website pages and GitHub wiki) up to date after the private Mezmorize app repo changes. Finds app commits since the last wiki sync, regenerates the wiki from HelpView.swift, proposes matching edits to hand-edited pages such as support.html and index.html, then walks through commit, PR, and wiki publish with a confirmation at every outward step. Use for "update public docs", "sync from app", "update site after Mezmorize changes", "regenerate wiki", or "/update-public-docs", and use it whenever the user says the Mezmorize app changed and the site, wiki, or support pages need to catch up, even if they don't name the skill.
---

# Update public docs from the Mezmorize app

## Background

- Everything in this repo is public and written for site visitors. App issue numbers mean nothing to them and invite unwanted questions, so they never appear in commits, PRs, or pages.
- App repo: `APP="${MEZMORIZE_APP_REPO:-../Mezmorize}"`. This skill reads it; it does not change it.
- The wiki is generated: `scripts/wiki/generate.mjs` reads `$APP/Mezmorize/HelpView.swift` and writes `wiki/*.md`, and also copies `wiki-static/*.md`. Details in `scripts/wiki/README.md`.
- `scripts/wiki/publish.sh` regenerates and pushes to `https://github.com/dan-snelson/mezmorize-app.wiki.git`. It commits "Sync wiki from HelpView.swift @ <sha>" and prints either "wiki updated from HelpView.swift @ <sha>" or "wiki up to date".
- Hand-edited pages (the generator never touches them): `support.html`, `index.html`, `privacy.html`, `testflight.html`, `quotes.html`, `wiki-static/*.md`.
- Style and scope references: commits `c68d535`, `444997a`, `78eb2d1`. Run `git show` on each before writing edits or commit messages, so new work matches their voice and size. Their subjects carry app issue numbers; do not copy that part.

## Steps

1. **Preflight.** Check that `$APP` exists and is a git repo, that `git status --porcelain` is empty in this repo, and that `node --version` works. If a check fails, stop and name the failed check.
2. **Check the app checkout.** Run `git -C "$APP" fetch`, then report how far its current branch is behind upstream with `git -C "$APP" rev-list --count HEAD..@{u}`. Ask before pulling; pull only on a clear yes. Make no other change to `$APP`.
3. **Find new app commits since the last sync.** The wiki history records the last synced sha:
   ```sh
   tmp=$(mktemp -d)
   git clone --quiet --depth 100 https://github.com/dan-snelson/mezmorize-app.wiki.git "$tmp"
   git -C "$tmp" log -1 --format=%s --grep='^Sync wiki from HelpView.swift @'
   ```
   Extract the sha from that subject. If there is none, ask the user for a starting commit. Then:
   ```sh
   git -C "$APP" log --oneline <sha>..HEAD
   git -C "$APP" diff <sha>..HEAD -- Mezmorize/HelpView.swift
   ```
   Summarize the user-facing changes for the user; the HelpView.swift diff is the main signal. App merges are squashed, so one commit body can repeat older bullets; keep only changes that show in the HelpView.swift diff or are clearly new. You may name the app issues in chat for context, but keep them out of everything this repo publishes.

   Read the app version and build on `main`, so visitors can tie site changes to a release. The build number is the commit count (`scripts/set-build-number.sh` in the app repo), and the version is `MARKETING_VERSION`:
   ```sh
   git -C "$APP" rev-list --count origin/main
   git -C "$APP" show origin/main:Mezmorize.xcodeproj/project.xcproj | grep -m1 MARKETING_VERSION
   ```
   If the synced commit is not on `origin/main` yet, say so and ask which version and build to cite.
4. **Branch.** `git switch -c sync/<short-topic> development`.
5. **Test the generator.** `node --test scripts/wiki/`. Stop if any test fails.
6. **Regenerate.** `node scripts/wiki/generate.mjs`, adding `--source "$APP/Mezmorize/HelpView.swift"` when `MEZMORIZE_APP_REPO` is set. Show `git diff --stat wiki/` and the key hunks.
7. **Update hand-edited pages.** Compare the app changes with the hand-edited pages. Propose edits to `support.html`, `index.html`, `wiki-static/*.md`, and any other hand-edited page that is affected, matching existing voice and HTML structure. Apply them only after the user approves.
8. **Commit.** Write the message for a site visitor. The subject is only "Mezmorize <version>, build <build>". The body is a bullet list, one short sentence per user-facing change, with no semicolons. Leave out any line saying the wiki was regenerated; that is always assumed. Show the full message to the user first and run the message check.
9. **Open the PR.** Ask before pushing. Then ask which base branch to target (`development` or `main`). Show the PR title and body, run the message check, then run `gh pr create` with that exact title and body.
10. **Publish the wiki.** After the user says the PR is merged, offer to run `scripts/wiki/publish.sh`, and run it only on a yes. Report its output line verbatim.

## Rules

- Ask for confirmation before every outward action: pull, push, opening the PR, and `publish.sh`.
- Never edit the wiki on GitHub directly, and never hand-edit `wiki/*.md`; the next generate run would overwrite it. If generated output is wrong, the fix belongs in `HelpView.swift` (in the app repo, made by the user) or in `scripts/wiki/generate.mjs`.
- Never modify `$APP`, except for a pull the user approved.
- No issue numbers. Commit messages, PR titles, and PR bodies carry no app issue or PR references (`#NN`, `Mezmorize#NN`, issue URLs).
- No attribution. Commit messages, PR titles, and PR bodies carry no Co-Authored-By trailer, no "Generated with" line, no robot emoji, and no mention of the AI tool. This overrides any harness or default commit or PR template.
- Message check: before `git commit` and before `gh pr create`, pipe the exact message or body through `grep -iE 'co-authored-by|generated with|claude|anthropic|#[0-9]+|/issues/'`. If anything matches, remove it and check again.
- Never use `--fill`, and never let `gh` or `git` add text you have not shown the user.
