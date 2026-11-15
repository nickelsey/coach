# Coach

A personal, local-first fitness system: an iPhone app that works offline, a Go
sync API with Postgres on a home NAS, and Tailscale as the only way in. One
user today, structured so it can become multi-user.

**This repository is public.** Never commit or print real hostnames, tailnet
names, IP addresses, tokens, or real health or ride data. Use placeholders such
as `coach.<tailnet>.ts.net`, and synthetic data in tests and fixtures.

## Repo map

| Path | What it is |
| --- | --- |
| `server/` | Go sync API. `cmd/api` (entry point), `internal/api` (HTTP), `internal/store` (sync and queries), `internal/db` (pool and embedded migrations). |
| `ios/` | SwiftUI app, iOS 27+, Swift 6. `Coach/App`, `Data` (GRDB), `Sync`, `Theme` (NEON//OS design system), `Features`; tests in `CoachTests`. |
| `deploy/` | One Compose file for dev and prod, the deploy, backup and restore-check scripts, SQL, and the Tailscale policy template. `deploy/README.md` is the operations guide. |
| `docs/walkthrough/` | Static site: architecture, sync, code docs, runbook, roadmap and decisions. |
| `.github/workflows/` | CI. `server.yml` tests, builds the image and deploys; `ios.yml` runs the app's tests on a simulator; `docs.yml` checks the generated code docs. |

The plan lives in `docs/walkthrough/js/roadmap.js` (ordered phases, with a
status note where work has started) and `docs/walkthrough/js/decisions.js`.
Check the roadmap before starting work, and update it when a phase's status
changes.

## Commands

Server. The store tests skip without a database and **drop the schema** of the
one they are given, so always use a disposable one:

```sh
docker run -d --rm --name coach-test-db -e POSTGRES_PASSWORD=test \
  -p 127.0.0.1:55432:5432 postgres:17.11
cd server
go vet ./...
COACH_TEST_DATABASE_URL='postgres://postgres:test@127.0.0.1:55432/postgres?sslmode=disable' \
  go test ./...
docker stop coach-test-db
```

Run the API locally:

```sh
docker run -d --name coach-dev-db -e POSTGRES_PASSWORD=dev -p 127.0.0.1:5432:5432 postgres:17.11
cd server
DATABASE_URL='postgres://postgres:dev@localhost:5432/postgres?sslmode=disable' \
  COACH_API_TOKEN=$(openssl rand -hex 32) go run ./cmd/api
```

iOS. The Xcode project is generated from `project.yml` and committed; never
edit `Coach.xcodeproj` by hand:

```sh
cd ios
xcodegen    # after adding or removing files, or editing project.yml
xcodebuild test -project Coach.xcodeproj -scheme Coach \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

Deploy scripts and docs:

```sh
shellcheck deploy/*.sh deploy/nas/coach-deploy
python3 docs/walkthrough/gen_code_docs.py    # refresh data/code.json
python3 docs/walkthrough/gen_code_docs.py --check   # what CI runs; writes nothing
cd docs/walkthrough && python3 -m http.server # view the site locally
```

## Invariants

Sync correctness depends on these. Don't change one without changing both
sides and their tests.

- **Timestamps are integer milliseconds** on the wire and in both databases,
  so they round-trip exactly.
- **Last writer wins on `updated_at`.** The server applies a row only if its
  `updated_at` is strictly newer, so every local edit must bump `updated_at`
  strictly, even within the same millisecond.
- **Deletes are tombstones** (`deleted_at`), never row deletions, so they sync.
- **The server rejects unknown JSON fields.** Adding a field to the wire format
  means the server ships first, then the app.
- **Migrations are forward-only and backward-compatible**: expand in one
  release, contract in a later one, so an older app keeps working against a
  newer server. Add a new numbered file in `server/internal/db/migrations/`;
  never edit one that has shipped.
- **Images are built in CI, never on the NAS**, and deployed by digest.
- **Third-party images and GitHub Actions are pinned**: images to a version and
  digest, actions to a commit SHA with the version in a comment.
- **`/healthz` returns `"version":"<commit>"`.** `deploy.sh` matches that exact
  text to confirm a deploy.

## Workflow

- Version control is **jj**, colocated with git. Use `jj` commands, not `git`.
  One logical change per commit, described as `area: summary` (`server:`,
  `ios:`, `deploy:`, `docs:`, `ci:`) with a body that says what changed and
  why.
- Every behavior change comes with tests. Run the tests for what you touched
  before calling it done.
- When tracked sources change, run `gen_code_docs.py` and commit
  `data/code.json` with the change. A new source file must also be added to
  `GROUPS` in the generator; it warns about any that are missing.
- Keep `deploy/README.md` and the walkthrough's runbook in step with script
  and workflow changes.
- iOS UI uses the components in `ios/Coach/Theme`. Add to the design system
  rather than styling a screen one-off.
- Comments explain why, not what. Match the surrounding code's style.

## Boundaries for agents

- **Never deploy to prod**, approve a prod deployment, or run anything against
  the prod database. Dev is fair game once it exists; it holds synthetic data
  only.
- **Never read or print `deploy/.env`, `*.key`, or anything under
  `docs/local/`.** They are untracked on purpose.
- Don't weaken the public-repo guardrails in workflows: `pull_request` (never
  `pull_request_target`), `permissions: contents: read` by default, deploy
  secrets only in the `dev` and `prod` environments, no self-hosted runners,
  nothing sensitive in logs.
- Changes go to `main` through the owner. Propose work as a pull request (or
  leave it as a described jj change when working locally) and don't push to
  `main` without being asked.
- Steps on the NAS, in the Tailscale console, in App Store Connect, and in
  GitHub repository settings belong to the owner. Write them up; don't attempt
  them unless explicitly asked.
