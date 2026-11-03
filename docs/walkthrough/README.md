# Coach walkthrough

A small static site: the system walkthrough (architecture, sync, code docs,
runbook, tests, review) and the planning pages (roadmap, decisions).
Published as a Claude artifact; also opens locally.

```sh
python3 docs/walkthrough/gen_code_docs.py      # refresh data/code.json from the sources
cd docs/walkthrough && python3 -m http.server   # then open http://localhost:8000
```

- `index.html`: page shell (no doctype; the artifact host adds it).
- `style.css`: NEON//OS styles.
- `js/core.js`: hash router (`#roadmap`, `#code-<file-slug>`) and shared helpers.
- `js/pages.js`, `sync.js`, `code.js`, `roadmap.js`, `decisions.js`: one or more pages each.
- `gen_code_docs.py`: reads the files listed in its `GROUPS` (reading order and notes),
  extracts doc comments and declarations, and writes `data/code.json`. It warns
  about tracked source files missing from `GROUPS`.

Run the generator whenever sources change, so the Code page doesn't drift.
