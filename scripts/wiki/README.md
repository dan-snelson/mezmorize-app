# Wiki generator

The [wiki](https://github.com/dan-snelson/mezmorize-app/wiki) is generated from the app's in-app Help (`Mezmorize/HelpView.swift` in the app repository, checked out next to this one as `../Mezmorize`). Do not edit it on GitHub.

Run from the repository root:

```sh
node --test scripts/wiki/          # test the generator
node scripts/wiki/generate.mjs     # regenerate wiki/ from HelpView.swift
scripts/wiki/publish.sh            # regenerate and push to the wiki
```

Pages for content that is only on the site live in `wiki-static/` and are copied as-is.
