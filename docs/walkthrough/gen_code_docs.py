#!/usr/bin/env python3
"""Generate data/code.json for the walkthrough's Code page.

Reads the source files listed in GROUPS (in reading order), pulls out each
file's summary comment and its documented declarations, and writes them with
the full source. Run it after changing code:

    python3 docs/walkthrough/gen_code_docs.py

It warns about tracked source files that aren't listed, so new files don't
silently go missing from the docs. Secrets (.env) are never read.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "data" / "code.json"

# (id, title, blurb, [(path, note)]) in the order a newcomer should read them.
GROUPS = [
    ("server", "Server · Go API", "The sync API. Start at main.go, then follow a request: api.go → sync.go → fast.go → SQL.", [
        ("server/cmd/api/main.go", "Entry point. Reads config from the environment, waits for Postgres, runs migrations, serves HTTP and shuts down cleanly on SIGTERM."),
        ("server/internal/api/api.go", "The HTTP layer: routes, the bearer-token check, JSON decoding that rejects unknown fields, and mapping validation errors to 400."),
        ("server/internal/store/sync.go", "The heart of sync. Push validates a batch and upserts it under an advisory lock; Pull merges tables by server_seq and pages with has_more."),
        ("server/internal/store/fast.go", "The fasts entity: struct, validation, and the last-writer-wins upsert (note the WHERE clause on updated_at)."),
        ("server/internal/db/db.go", "Connection pool and the tiny migration runner over embedded SQL files."),
        ("server/internal/db/migrations/0001_init.sql", "The schema: the sync_seq sequence and the fasts table."),
        ("server/internal/api/api_test.go", "Handler tests using a fake store: auth, parameter parsing, decoding and error mapping."),
        ("server/internal/store/store_test.go", "Validation tests plus a full round trip against a real, disposable Postgres."),
        ("server/Dockerfile", "Two-stage build: cross-compile on the build machine, ship a distroless image."),
        ("server/go.mod", "Module definition. The only dependency is pgx."),
    ]),
    ("deploy", "Deploy · Synology", "How the server runs: Compose topology, the Tailscale front door, image builds and backups.", [
        ("deploy/compose.yaml", "Three services. ts joins the tailnet; api shares its network namespace; db is reachable only inside the project and via the ts TCP forward."),
        ("deploy/serve.json", "Tailscale serve config: HTTPS on 443 to the API, TCP 5432 to Postgres."),
        ("deploy/build-image.sh", "Builds the amd64 API image on the Mac (the NAS can't build) and optionally ships and restarts it."),
        ("deploy/backup.sh", "Nightly pg_dump with 30-day retention."),
        ("deploy/.env.example", "Template for the secrets file. The real deploy/.env is git-ignored."),
        ("deploy/README.md", "Setup and operations guide."),
    ]),
    ("ios-data", "iOS · data and sync", "Everything below the UI. Read these before the views.", [
        ("ios/Coach/Data/AppDatabase.swift", "GRDB setup, the v1 migration, and helpers for the push queue and sync state."),
        ("ios/Coach/Data/Fast.swift", "The Fast record. One struct is both the SQLite row (integer ms) and the JSON wire format (server field names)."),
        ("ios/Coach/Data/FastRepository.swift", "All local writes for fasts. Each one bumps updated_at strictly and queues the record."),
        ("ios/Coach/Sync/SyncEngine.swift", "One sync pass: push the queue in batches, then pull pages past the cursor and merge newer-wins."),
        ("ios/Coach/Sync/WireFormat.swift", "Request/response types and timestamp coding that matches Go exactly."),
        ("ios/Coach/Sync/SyncTransport.swift", "The transport protocol (faked in tests) and the HTTPS implementation."),
        ("ios/Coach/Sync/ServerConfig.swift", "Server URL in UserDefaults, API token in the Keychain."),
    ]),
    ("ios-app", "iOS · app and screens", "State, notifications and the views.", [
        ("ios/Coach/App/CoachApp.swift", "App entry point."),
        ("ios/Coach/App/AppModel.swift", "Observable app state. Observes the active fast, schedules debounced syncs, exposes fasting actions."),
        ("ios/Coach/App/FastNotifications.swift", "Fasting alerts, rescheduled idempotently from the current state."),
        ("ios/Coach/App/RootView.swift", "Grid, tabs, scanlines and the NEON tab bar."),
        ("ios/Coach/Features/Today/TodayView.swift", "The Today tab: header with sync badge, fasting card, placeholders for vitals and the next workout."),
        ("ios/Coach/Features/Fast/FastView.swift", "The Fuel tab: octagon timer, hour bar, goal adjustment, alert toggles."),
        ("ios/Coach/Features/Settings/SettingsView.swift", "Server address and token, connection test, display preferences."),
        ("ios/Coach/Features/Placeholder/ModulePlaceholder.swift", "Stand-in for tabs not built yet."),
    ]),
    ("ios-theme", "iOS · NEON//OS design system", "Reusable visual building blocks. New screens should only need these.", [
        ("ios/Coach/Theme/Theme.swift", "Color tokens, domain accents, fonts and preference keys."),
        ("ios/Coach/Theme/Shapes.swift", "ChamferShape and OctagonShape, both insettable so borders sit inside."),
        ("ios/Coach/Theme/Components.swift", "Panels, titles, data rows, segmented bars, buttons, toggles, grid and scanlines."),
        ("ios/Coach/Theme/Format.swift", "24-hour, zero-padded, uppercase readout formats."),
    ]),
    ("ios-project", "iOS · tests and project", "Tests and the XcodeGen spec.", [
        ("ios/CoachTests/SyncEngineTests.swift", "Sync tests against an in-memory fake server that applies the same rule as Postgres."),
        ("ios/CoachTests/FastRepositoryTests.swift", "Repository behavior: queueing, one active fast, bumps, tombstones, NULL writes."),
        ("ios/CoachTests/WireFormatTests.swift", "Timestamp parsing from Go and exact millisecond round trips."),
        ("ios/project.yml", "XcodeGen spec. Edit this, not the .xcodeproj."),
        ("ios/README.md", "Build, test and run instructions."),
    ]),
    ("docs", "Project docs", "Decisions and the original notes.", [
        ("spec.md", "The living spec: decisions, architecture, workout schema, data model, milestones."),
        ("inital_spec.md", "The original one-page idea."),
    ]),
]

LANG = {".go": "go", ".swift": "swift", ".sql": "sql", ".yaml": "yaml", ".yml": "yaml",
        ".json": "json", ".sh": "bash", ".md": "markdown", ".mod": "go-mod", ".example": "bash"}

SOURCE_EXTS = {".go", ".swift", ".sql", ".yaml", ".yml", ".sh"}


def lang_for(path: Path) -> str:
    if path.name == "Dockerfile":
        return "dockerfile"
    return LANG.get(path.suffix, "plaintext")


def leading_comment(lines: list[str], marker: str) -> str:
    out = []
    for line in lines:
        s = line.strip()
        if s.startswith("#!"):
            continue
        if s.startswith(marker):
            out.append(s[len(marker):].strip())
        elif s == "" and not out:
            continue
        else:
            break
    return "\n".join(out).strip()


def doc_above(lines: list[str], i: int, markers: tuple[str, ...], skip=re.compile(r"^\s*@\w+(\(.*\))?\s*$")) -> str:
    """Collect the comment block directly above line i, skipping attribute lines."""
    j = i - 1
    while j >= 0 and skip.match(lines[j]):
        j -= 1
    block = []
    while j >= 0:
        s = lines[j].strip()
        m = next((mk for mk in markers if s.startswith(mk)), None)
        if not m or s.startswith("// MARK"):
            break
        block.append(s[len(m):].strip())
        j -= 1
    return "\n".join(reversed(block)).strip()


GO_FUNC = re.compile(r"^func\s+(?:\(\s*\w+\s+(\*?)(\w+)[^)]*\)\s*)?(\w+)")
GO_TYPE = re.compile(r"^type\s+(\w+)\s+(struct|interface)?")
GO_VAR = re.compile(r"^(var|const)\s+(\w+)")


def go_symbols(lines):
    syms = []
    for i, line in enumerate(lines):
        if m := GO_FUNC.match(line):
            star, recv, name = m.groups()
            label = f"({star}{recv}) {name}" if recv else name
            syms.append(("method" if recv else "func", label, i))
        elif m := GO_TYPE.match(line):
            syms.append((m.group(2) or "type", m.group(1), i))
        elif m := GO_VAR.match(line):
            syms.append((m.group(1), m.group(2), i))
    return [{"kind": k, "name": n, "line": i + 1, "depth": 0, "doc": doc_above(lines, i, ("//",))} for k, n, i in syms]


SWIFT_DECL = re.compile(
    r"^(?:(?:@\w+(?:\([^)]*\))?|public|private|fileprivate|internal|static|final|nonisolated|override|"
    r"mutating|private\(set\)|convenience|required|indirect|async)\s+)*"
    r"(struct|class|enum|protocol|extension|actor|func|init|var|let|case)\b\s*([A-Za-z_][\w.]*)?")
TYPE_KINDS = {"struct", "class", "enum", "protocol", "extension", "actor"}


def swift_symbols(lines):
    syms = []
    for i, line in enumerate(lines):
        stripped = line.lstrip(" ")
        indent = (len(line) - len(stripped)) // 4
        m = SWIFT_DECL.match(stripped)
        if not m:
            continue
        kind, name = m.group(1), m.group(2) or ""
        if kind == "init":
            name = "init"
        doc = doc_above(lines, i, ("///",))
        keep = kind in TYPE_KINDS or doc or (kind in {"func", "init"} and indent <= 1)
        if kind in {"case", "var", "let"} and not doc:
            keep = False
        if keep:
            syms.append({"kind": kind, "name": name, "line": i + 1, "depth": indent, "doc": doc})
    return syms


SQL_DECL = re.compile(r"^CREATE\s+(TABLE|SEQUENCE|INDEX)\s+(\w+)", re.I)


def sql_symbols(lines):
    return [{"kind": m.group(1).lower(), "name": m.group(2), "line": i + 1, "depth": 0,
             "doc": doc_above(lines, i, ("--",))}
            for i, line in enumerate(lines) if (m := SQL_DECL.match(line))]


def yaml_symbols(lines):
    syms, in_services = [], False
    for i, line in enumerate(lines):
        if re.match(r"^\S", line):
            in_services = line.startswith("services:")
            if m := re.match(r"^([\w-]+):", line):
                syms.append({"kind": "key", "name": m.group(1), "line": i + 1, "depth": 0,
                             "doc": doc_above(lines, i, ("#",))})
        elif in_services and (m := re.match(r"^  ([\w-]+):\s*$", line)):
            syms.append({"kind": "service", "name": m.group(1), "line": i + 1, "depth": 1,
                         "doc": doc_above(lines, i, ("#",))})
    return syms


def markdown_symbols(lines):
    return [{"kind": f"h{len(m.group(1))}", "name": m.group(2), "line": i + 1, "depth": len(m.group(1)) - 1, "doc": ""}
            for i, line in enumerate(lines) if (m := re.match(r"^(#{1,3})\s+(.*)", line))]


def summarize(path: Path, lang: str, lines: list[str]) -> str:
    if lang == "go":
        for i, line in enumerate(lines):
            if line.startswith("package "):
                return doc_above(lines, i, ("//",)) or leading_comment(lines, "//")
        return leading_comment(lines, "//")
    if lang == "swift":
        for i, line in enumerate(lines):
            if SWIFT_DECL.match(line) and not line.startswith(" "):
                return doc_above(lines, i, ("///",))
        return ""
    if lang == "sql":
        return leading_comment(lines, "--")
    if lang in {"bash", "yaml", "dockerfile"}:
        return leading_comment(lines, "#")
    if lang == "markdown":
        para = []
        for line in lines[1:]:
            if line.strip() == "" and para:
                break
            if line.strip() and not line.startswith("#"):
                para.append(line.strip())
        return " ".join(para)
    return ""


SYMBOLS = {"go": go_symbols, "swift": swift_symbols, "sql": sql_symbols, "yaml": yaml_symbols, "markdown": markdown_symbols}


def tracked_files() -> set[str]:
    for cmd in (["jj", "file", "list"], ["git", "ls-files"]):
        try:
            out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True).stdout
            return set(out.split())
        except (OSError, subprocess.CalledProcessError):
            continue
    return set()


def main() -> int:
    files, groups, listed = [], [], set()
    for gid, title, blurb, entries in GROUPS:
        ids = []
        for rel, note in entries:
            path = ROOT / rel
            if path.name == ".env" or not path.exists():
                print(f"warning: skipping missing {rel}", file=sys.stderr)
                continue
            listed.add(rel)
            text = path.read_text(encoding="utf-8")
            lines = text.splitlines()
            lang = lang_for(path)
            files.append({
                "path": rel, "group": gid, "lang": lang, "lines": len(lines), "note": note,
                "summary": summarize(path, lang, lines),
                "symbols": SYMBOLS.get(lang, lambda _: [])(lines),
                "source": text,
            })
            ids.append(rel)
        groups.append({"id": gid, "title": title, "blurb": blurb, "files": ids})

    unlisted = sorted(f for f in tracked_files()
                      if Path(f).suffix in SOURCE_EXTS and f not in listed and not f.startswith("docs/"))
    for f in unlisted:
        print(f"warning: {f} is tracked but not in GROUPS", file=sys.stderr)

    by_lang: dict[str, int] = {}
    for f in files:
        by_lang[f["lang"]] = by_lang.get(f["lang"], 0) + f["lines"]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"groups": groups, "files": files, "linesByLang": by_lang, "unlisted": unlisted}, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(files)} files, {sum(len(f['symbols']) for f in files)} symbols")
    return 0


if __name__ == "__main__":
    sys.exit(main())
