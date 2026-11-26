# Mezmorize web site

Static web site for Mezmorize, a native app for macOS, iOS, and iPadOS, with a review-only Apple Watch companion, that applies the Three-minute Memory Method to quotable quotes.

This repository contains the public site only (no app source code).
It is deployed from the `main` branch via GitHub Pages at https://dan-snelson.github.io/mezmorize-app/.

The site includes a TestFlight page with beta-testing instructions.

## Wiki

The [wiki](https://github.com/dan-snelson/mezmorize-app/wiki) is generated from the app's in-app Help (`Mezmorize/HelpView.swift` in the app repository, checked out next to this one as `../Mezmorize`). Do not edit it on GitHub.

```sh
node --test scripts/wiki/          # test the generator
node scripts/wiki/generate.mjs     # regenerate wiki/ from HelpView.swift
scripts/wiki/publish.sh            # regenerate and push to the wiki
```

Pages for content that is only on the site live in `wiki-static/` and are copied as-is.
