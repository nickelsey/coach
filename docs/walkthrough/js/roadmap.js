/* Roadmap page: ordered phases with expandable implementation details.
   Order is the plan: platform work that gets harder later (CI, environments,
   accounts) comes before features; features follow the spec's milestone order. */
(function () {
  "use strict";
  const { h, $, $$ } = Coach;
  const { esc } = h;

  const CATS = {
    ops: ["Ops", "warn"], dev: ["Dev workflow", "info"], deploy: ["Deployment", "mag"], platform: ["Platform", "vio"],
    feature: ["Feature", "live"], auto: ["Automation", "info"], release: ["Release", "plan"],
  };

  const code = (s) => `<pre>${esc(s)}</pre>`;

  const PHASES = [
    {
      n: 1, title: "Hardening", cat: "ops", hours: [2, 4], now: true, deps: "none",
      why: "Before anything else touches the database, make sure the data can't be lost and the server can't quietly drop off the tailnet. These are the review's do-soon items.",
      deliver: [
        "A rehearsed restore, then a weekly automated restore check that emails on failure.",
        "The coach machine tagged in Tailscale so its key never expires, with ACLs for who reaches what.",
        "Every image pinned to an exact version.",
        "A read-only Postgres role for analysis, and :5432 limited to your laptop.",
        "A backup taken automatically before each deploy.",
      ],
      impl: [
        ["Status", `<p>The repo side is done: the scripts, SQL, pinned images and policy template are in <code>deploy/</code>, and <code>deploy/README.md</code> has the steps. What remains happens on the NAS and in the Tailscale console: deploy once, run the first restore check, schedule it, tag the machine, apply the policy and create the analyst role.</p>`],
        ["Restore check script", `<p><code>deploy/restore-check.sh</code> restores the newest dump into a scratch database and compares every public table with the live one, so new tables are covered automatically. It fails if the dump is missing, over 26 hours old, unreadable, or short by more than 50 rows or 10%, whichever is larger. Schedule it weekly in DSM Task Scheduler with “send run details by email only when the script terminates abnormally”.</p>`],
        ["Tailscale tags and ACLs", `<p>Tag the running machine from the admin console; tagged machines don't expire. The compose file now sets <code>TS_AUTH_ONCE</code>, so the container logs in only when it has no saved state and an expired auth key can't keep it off the tailnet after a restart. <code>deploy/tailscale-policy.example.hujson</code> limits the database port to the laptop. The order matters, so follow the README: add the tag owners, tag the machine, then replace the default allow-all rule.</p>`],
        ["Pin image versions", `<p>Postgres, Tailscale, Go and the distroless base are each pinned to a version and digest. <code>coach-api:latest</code> is the one exception: it is built locally, and phase 3 replaces it with registry digests. Phase 2 adds automated update PRs so pinning doesn't mean falling behind.</p>`],
        ["Read-only analysis role", `<p><code>deploy/sql/analyst-role.sql</code> creates the role and can be run again to change the password, which comes from the environment. Default privileges make future tables readable too, and the role's sessions default to read-only as a second lock.</p>`],
        ["Backup before deploy (stopgap)", `<p><code>build-image.sh</code> now copies the deploy files to the NAS and runs <code>backup.sh</code> before loading the image. If the backup fails, nothing is deployed. Phase 3 replaces this with the prod deploy script.</p>`],
      ],
      done: ["A restore check passes and a deliberately broken one emails you.", "The coach machine shows as tagged with no expiry.", "<code>docker compose config</code> shows no floating third-party tags.", "The analyst role can SELECT but not INSERT; the phone can't reach :5432."],
      learn: "Postgres roles and privileges, Tailscale policy syntax.",
      agent: "Scripts and SQL are good agent tasks. The Tailscale admin console and DSM Task Scheduler steps are yours.",
    },
    {
      n: 2, title: "Agent-ready repo and CI", cat: "dev", hours: [3, 6], deps: "P1",
      why: "CI is the guardrail that makes it safe to let agents, or future you at midnight, change things. Agents work best with written conventions, small well-specified tasks and fast feedback. This is also where the agentic-development experiments start.",
      deliver: [
        "A <code>CLAUDE.md</code> (with <code>AGENTS.md</code> pointing to it) describing the repo, commands and invariants.",
        "GitHub Actions: Go tests with a Postgres service, iOS build and tests, an image build, and a docs-freshness check.",
        "Contract tests: shared JSON fixtures that both the Swift encoder and the Go decoder must accept.",
        "Automated dependency update PRs.",
        "An issue template for agent-sized tasks, and branch protection on main.",
        "Public-repo guardrails, so workflows and secrets are safe with the code in the open.",
      ],
      impl: [
        ["What goes in CLAUDE.md", h.list([
          "Repo map and the commands to build, test and deploy each part.",
          "Invariants: timestamps are integer milliseconds; edits bump <code>updated_at</code> strictly; the server rejects unknown fields, so deploy the server before the app; migrations are forward-only and backward-compatible; never build images on the NAS.",
          "Workflow: jj for version control, one change per logical commit, tests with every change, run <code>gen_code_docs.py</code> when sources change.",
          "Boundaries: agents may deploy to dev, never prod; never read <code>deploy/.env</code>.",
        ])],
        ["Server CI workflow", code(`name: server
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_PASSWORD: test }
        ports: ["5432:5432"]
        options: --health-cmd pg_isready --health-interval 2s --health-retries 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version-file: server/go.mod }
      - run: go test ./...
        working-directory: server
        env:
          COACH_TEST_DATABASE_URL: postgres://postgres:test@localhost:5432/postgres?sslmode=disable`)],
        ["iOS CI", `<p>Runs on GitHub-hosted macOS runners, free because the repo is public (see <a href="#decisions">Decisions › iOS delivery</a>). New Xcode versions can take time to reach those runners: if Xcode 27 isn't available yet, keep this check non-blocking until it is. The job itself is short:</p>` + code(`brew install xcodegen
cd ios && xcodegen
xcodebuild test -project Coach.xcodeproj -scheme Coach \\
  -destination 'platform=iOS Simulator,name=iPhone 17'`)],
        ["Public-repo guardrails", h.list([
          "PR workflows use <code>pull_request</code>, never <code>pull_request_target</code>, with <code>permissions: contents: read</code>. Forked PRs then run without secrets.",
          "Deploy credentials are environment secrets, and the <code>dev</code> and <code>prod</code> environments accept only <code>main</code>.",
          "Actions settings require approval before workflows run for outside contributors.",
          "No self-hosted runners, on the NAS or your Mac.",
          "Secret scanning and push protection are on (free for public repos).",
          "Third-party actions are pinned to a commit SHA.",
          "CI logs are public, so workflows print no hostnames or tokens. Test fixtures are synthetic: no real rides or health data in the repo.",
        ])],
        ["Contract tests", `<p>A <code>contracts/fixtures/</code> folder of JSON bodies. A Swift test encodes known records and compares them with the fixtures; a Go test decodes every fixture with unknown fields disallowed. Schema drift between app and server then fails CI instead of failing a push from your phone.</p>`],
        ["Docs freshness", `<p>CI runs <code>gen_code_docs.py</code> and fails if <code>data/code.json</code> changes, so the Code page never silently lags the source.</p>`],
        ["Dependency updates", `<p>Dependabot for Go modules, GitHub Actions and Docker base images; or Renovate, which also understands Swift packages. Pair with phase 1's pinning.</p>`],
        ["Agent-sized issues", `<p>An issue template with: goal, links to the relevant walkthrough pages, acceptance criteria, and the tests that prove it. Label <code>agent-ok</code> for tasks an agent may take end to end. The roadmap phases below break into these.</p>`],
      ],
      done: ["A PR shows green server, iOS, image and docs checks.", "main requires passing checks.", "A PR from a fork runs with no access to secrets.", "An agent completes one small issue end to end as a PR you only review."],
      learn: "GitHub Actions, contract testing.",
      agent: "The ideal first agent task: “add the server CI workflow”, with this page as the spec.",
    },
    {
      n: 3, title: "Environments and automated delivery", cat: "deploy", hours: [6, 10], deps: "P2",
      why: "Separate a place to break things (dev) from the place that holds your data (prod), and turn deploys into a merge instead of a script on your Mac. Dev is also where agents are allowed to deploy, with synthetic data only.",
      deliver: [
        "Two Compose projects on the NAS from one compose file: <code>coach-dev</code> and <code>coach-prod</code>, each with its own tailnet machine, database and data directory.",
        "Images built in CI and pushed to GitHub Container Registry, so the NAS never builds.",
        "Merging to main deploys to dev automatically; promoting the same image to prod takes one approval.",
        "The prod deploy takes a backup first, checks health and rolls back on failure.",
        "Request logging and an uptime alert.",
        "Dev and prod builds of the iPhone app that install side by side.",
      ],
      impl: [
        ["Topology", h.table(["", "dev", "prod"], [
          ["Tailnet machine", "<code>coach-dev</code> · tag:coach-dev", "<code>coach</code> · tag:coach-prod"],
          ["Compose project", "coach-dev", "coach-prod"],
          ["Data directory", "/volume1/docker/coach/dev", "/volume1/docker/coach/prod"],
          ["Data", "Synthetic, reseedable", "Yours"],
          ["Deployed by", "Every merge to main", "Approval of a dev-tested image"],
          ["Agents", "May deploy", "Never"],
        ])],
        ["Parameterize the compose file", `<p>Hostnames, image and data paths come from the env file, and the fixed <code>container_name</code> goes away (two projects can't share one).</p>` + code(`services:
  ts:
    hostname: \${COACH_TS_HOSTNAME}          # coach-dev / coach
  api:
    image: \${COACH_API_IMAGE}                # ghcr.io/nickelsey/coach-api@sha256:…
  db:
    volumes: ["\${DATA_DIR}/postgres:/var/lib/postgresql/data"]

# docker compose -p coach-dev --env-file dev.env up -d`)],
        ["Build in CI, push to GHCR", `<p>On every push to main, build <code>linux/amd64</code> with <code>docker/build-push-action</code> and push <code>ghcr.io/nickelsey/coach-api</code> tagged with the commit and referenced by digest. Make the package public to match the repo: the image holds only the compiled server, with all configuration in the NAS env files, so the NAS can pull without a registry login. This also removes the seccomp workaround from day-to-day use.</p>`],
        ["How CI reaches the NAS", `<p>Recommended in <a href="#decisions">Decisions › Deploy mechanism</a>: install Synology's Tailscale package on the NAS host as <code>tag:nas</code>. The workflow joins the tailnet with <code>tailscale/github-action</code> as an ephemeral <code>tag:ci</code> machine. The ACL allows only <code>tag:ci → tag:nas:22</code>. The SSH key in <code>authorized_keys</code> is forced to run one script, so CI can do nothing else. Store the NAS hostname as a secret so it is masked in the public run logs:</p>` + code(`command="/volume1/docker/coach/deploy/deploy.sh",no-port-forwarding,no-pty ssh-ed25519 AAAA… ci-deploy`)],
        ["deploy.sh", code(`#!/bin/sh
# deploy.sh <dev|prod> <image-digest>   (called only through the forced SSH command)
set -eu
set -- $SSH_ORIGINAL_COMMAND
env=$1; image=$2
case "$env" in dev|prod) ;; *) echo "bad env"; exit 2 ;; esac
case "$image" in ghcr.io/nickelsey/coach-api@sha256:*) ;; *) echo "bad image"; exit 2 ;; esac
cd /volume1/docker/coach/deploy
[ "$env" = prod ] && ./backup.sh /volume1/backups/coach
prev=$(cat "state/$env.image" 2>/dev/null || true)
COACH_API_IMAGE=$image docker compose -p "coach-$env" --env-file "$env.env" up -d api
if ! ./wait-healthy.sh "$env"; then
  [ -n "$prev" ] && COACH_API_IMAGE=$prev docker compose -p "coach-$env" --env-file "$env.env" up -d api
  exit 1
fi
echo "$image" > "state/$env.image"`)],
        ["Promotion with approval", `<p>Two GitHub Environments. <code>dev</code> deploys automatically after the image job. <code>prod</code> requires your approval and reuses the exact digest that is running on dev, so what you tested is what ships. Required reviewers are free on public repos. Leave “prevent self-review” off, since you are the only reviewer.</p>`],
        ["Migrations across two environments", `<p>Migrations stay forward-only and backward-compatible (expand, then contract in a later release), so an older app keeps working against a newer server. Prod migrations always run after a fresh backup.</p>`],
        ["Logging and uptime", `<p>A Go middleware logging method, path, status, duration and record counts as JSON. For alerts, an Uptime Kuma container in the prod project that checks <code>/healthz</code> on both environments and the age of the newest backup, and notifies you by email, Pushover or Telegram.</p>`],
        ["iPhone app per environment", `<p>Three build configurations in <code>project.yml</code>: Debug and Beta build <code>dev.coach.Coach.dev</code> named “Coach Dev” with a tinted icon and the dev server preset; Release builds the prod app. Beta is an optimized build, so TestFlight can ship Coach Dev from phase 5. Both apps can be installed at once. Until then they reach the phone from Xcode (see <a href="#decisions">Decisions › iOS delivery</a>).</p>`],
      ],
      done: ["A merge to main is running on coach-dev within about five minutes, with your Mac off.", "Promoting to prod is one approval, and the run log shows the backup.", "A deliberately failing image rolls back automatically.", "Both apps sit on your home screen, pointing at different servers."],
      learn: "Container registries, GitHub Environments, SSH forced commands.",
      agent: "Agents can own the CI and compose changes. The Synology package, SSH user and secrets setup are yours.",
    },
    {
      n: 4, title: "Accounts groundwork", cat: "platform", hours: [5, 8], deps: "P3",
      why: "Adding users now touches one table; after recordings, streams and plans exist it touches all of them. It also gives every client its own revocable token, which you want before handing credentials to an MCP client or an agent. This keeps open-source and App Store releases possible.",
      deliver: [
        "<code>users</code> and <code>devices</code> tables; every record has a <code>user_id</code>; every query is scoped to the caller.",
        "Per-device tokens, stored hashed, with scopes, revocable one at a time.",
        "<code>GET /v1/me</code>, and a <code>coachctl</code> CLI to create users and devices.",
        "The app uses its own device token; the shared token is retired.",
        "A merge rule for two active fasts.",
        "Tests proving one user can never read or overwrite another's data.",
      ],
      impl: [
        ["Schema", code(`CREATE TABLE users (
  id uuid PRIMARY KEY, display_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE devices (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users,
  name text NOT NULL, token_hash bytea NOT NULL UNIQUE, scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz, revoked_at timestamptz
);
ALTER TABLE fasts ADD COLUMN user_id uuid REFERENCES users;
UPDATE fasts SET user_id = '<owner-id>';
ALTER TABLE fasts ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX fasts_user_seq ON fasts (user_id, server_seq);`)],
        ["Tokens and scopes", `<p>32 random bytes, base64url, shown once by <code>coachctl device add</code>. Only the SHA-256 is stored, so a database leak doesn't leak tokens. Scopes: <code>sync</code> for apps, <code>plans:write</code> and <code>read</code> for the MCP server, <code>admin</code> for coachctl. <code>last_seen_at</code> updates at most once a minute.</p>`],
        ["Request scoping", `<p>The auth middleware resolves the token to a <code>Principal{UserID, DeviceID, Scopes}</code> in the request context. Store functions take the user ID as an explicit argument rather than reading a global, so a missing scope is a compile error, not a data leak. Push takes <code>user_id</code> from the principal, never from the body, and the upsert refuses to touch another user's row even if an id is guessed:</p>` + code(`ON CONFLICT (id) DO UPDATE SET …
WHERE fasts.updated_at < EXCLUDED.updated_at
  AND fasts.user_id = EXCLUDED.user_id`)],
        ["Analyst role", `<p>The analyst role can read future tables by default, so revoke its access to the token table in the same migration that creates it.</p>`],
        ["Sync cursor", `<p>The global <code>sync_seq</code> still works: each user sees gaps where other users' writes were, which is harmless. Pull filters by <code>user_id</code> using the new index.</p>`],
        ["Migrating off the shared token", `<p>One release accepts both: the old <code>COACH_API_TOKEN</code> maps to the owner user. Create device tokens for the phone and laptop with coachctl, switch the app, then remove the old token.</p>`],
        ["Two active fasts", `<p>After a pull, if more than one fast is active, end the older one at the newer one's start, as a normal edit so it syncs. Deterministic, so every device reaches the same result.</p>`],
        ["What a public release adds later", h.list([
          "Sign-in to mint device tokens: Sign in with Apple for the App Store, or OIDC for self-hosters.",
          "Account deletion in the app (App Store rule) and data export.",
          "Postgres row-level security as a second layer if the backend moves to Supabase.",
          "Rate limiting and abuse protection once the API is reachable outside a tailnet.",
        ])],
      ],
      done: ["Isolation tests pass: user B's token can't pull or overwrite user A's rows.", "Revoking a device cuts it off on its next request.", "The phone runs on its own token and the shared token is gone.", "Settings shows the device name from /v1/me."],
      learn: "Auth design, Go contexts and middleware.",
      agent: "Good for an agent if the isolation tests are written first.",
    },
    {
      n: 5, title: "Cycling recording", cat: "feature", hours: [17, 27], deps: "P4", milestone: "M3",
      why: "The first workout type. It proves the Bluetooth layer, the recording engine and stream storage, which every later workout type reuses.",
      deliver: [
        "Sensor pairing for heart rate, cycling power, speed/cadence and smart trainers, remembered between rides.",
        "A recording engine that survives a locked screen, a crash or a force-quit.",
        "The live ride screen from the mockups.",
        "Rides saved with a summary, exported to Apple Health once, and synced with their full streams.",
        "The Tymewear question answered, and background sync.",
        "Apple Developer Program membership, with Xcode Cloud shipping both apps to TestFlight.",
      ],
      impl: [
        ["iOS delivery setup", `<p>Do this first, since rides will depend on the app not expiring. Join the Developer Program, set <code>DEVELOPMENT_TEAM</code>, register both bundle IDs (pick a new prefix if <code>dev.coach</code> is taken) and create two App Store Connect records. Then add two Xcode Cloud workflows:</p>` + h.table(["Workflow", "Trigger", "Builds", "Goes to"], [
          ["Coach Dev", "Push to main", "Beta configuration", "Internal TestFlight"],
          ["Coach", "Tag <code>v*</code>", "Release configuration", "Internal TestFlight"],
        ]) + `<p>Internal testing needs no App Review. The generated project and <code>Package.resolved</code> are committed, so Xcode Cloud needs no XcodeGen step. Set <code>ITSAppUsesNonExemptEncryption</code> to false, since the app uses only standard HTTPS, to skip the export prompt on each build. TestFlight builds expire after 90 days, so tag a prod release at least that often. Enrollment and the App Store Connect setup are yours; an agent can do the project changes.</p>`],
        ["Bluetooth layer", `<p>A <code>SensorManager</code> actor owns <code>CBCentralManager</code>. Each sensor publishes an <code>AsyncStream</code> of typed samples. Parsing is done by pure functions from <code>Data</code> to samples, so it can be tested with captured byte fixtures and no hardware. Known devices go in a <code>sensor_device</code> table, with automatic reconnection. Enable the <code>bluetooth-central</code> background mode.</p>`],
        ["Profiles to parse", h.table(["Service", "UUID", "What we read"], [
          ["Heart Rate", "0x180D", "BPM as uint8 or uint16 (by flag), RR intervals for HRV during rides"],
          ["Cycling Power", "0x1818", "Instantaneous power (sint16 W); cadence from cumulative crank revolutions and event time (1/1024 s)"],
          ["Cycling Speed and Cadence", "0x1816", "Wheel and crank revolution counters"],
          ["Fitness Machine (FTMS)", "0x1826", "Indoor Bike Data: speed, cadence (0.5 rpm units), power; fields present depend on flags"],
        ])],
        ["Recording engine", `<p>A 1 Hz clock samples the latest value from each sensor (gaps stay gaps; nothing is invented). Samples are appended to a journal file as they arrive and flushed to GRDB in 30-second chunks, so a crash loses at most a few seconds. Pause/resume and laps. The summary covers duration, average and normalized power, max power, HR, cadence and kJ, plus TSS once FTP exists in phase 6.</p>`],
        ["Streams storage and sync", `<p>Streams are stored as immutable chunks rather than one row per second: 5 minutes per channel, delta-encoded integers, zlib-compressed (Swift's Compression framework and Go's <code>compress/zlib</code> both speak it). Chunks are insert-only, so sync never has conflicts, and each push stays well under the 5 MB limit.</p>` + code(`recording (id, user_id, type, started_at, ended_at, summary jsonb, healthkit_uuid, … sync columns)
recording_chunk (recording_id, channel, chunk_index, start_offset_s, encoding, data bytea)
  channel: power | hr | cadence | speed | rr | breath_rate | ventilation`)],
        ["Live ride screen", `<p>The approved mockup: 3-second power, HR with zone segments, cadence, breathing if available, sensor status, elapsed time. Keeps the screen awake while recording. Readability was approved, so the work here is wiring, not design.</p>`],
        ["Apple Health export", `<p><code>HKWorkoutBuilder</code> with the cycling activity type, heart-rate samples and active energy. The HealthKit UUID is stored on the recording so it is never exported twice. Requires the HealthKit capability and permission prompts.</p>`],
        ["Tymewear", `<p>Run the nRF Connect scan from the spec. If the breathing characteristic is readable, it becomes a sensor plugin; if not, the fallback is importing the FIT file from Tymewear's own path in phase 7.</p>`],
        ["Background sync", `<p>Register a <code>BGAppRefreshTask</code> that runs a sync. iOS decides when it fires, so it's best-effort.</p>`],
      ],
      done: ["A merge to main reaches Coach Dev on your phone through TestFlight, with your Mac off.", "A 60-minute ride with HR strap and trainer, screen locked for most of it, records completely.", "Force-quitting mid-ride and reopening recovers the ride.", "The ride appears in Apple Health exactly once.", "Its streams can be read back in Python from Postgres."],
      learn: "CoreBluetooth, binary parsing in Swift, actors, HealthKit.",
      agent: "The parsers and the stream encoding are ideal agent tasks: pure functions with byte-level tests. On-device sensor testing is yours.",
    },
    {
      n: 6, title: "Structured cycling and the MCP server", cat: "feature", hours: [15, 25], deps: "P5", milestone: "M4",
      why: "This is where the LLM side starts paying off: Claude can write a plan that the phone can actually run.",
      deliver: [
        "A profile with FTP history and zones.",
        "Plans and scheduled workouts, synced, validated against a versioned JSON schema in both Go and Swift.",
        "The Train tab: calendar and plan detail.",
        "A workout player that shows targets and cues each step (ERG comes in phase 9).",
        "An MCP server in Go with the tools from the spec.",
        "An incoming-changes review, so plans from Claude never change silently.",
      ],
      impl: [
        ["One schema, two languages", `<p><code>schemas/cycling.v1.json</code> (JSON Schema) is the source of truth. Go validates with a JSON Schema library before storing; Swift decodes into an enum of steps (<code>warmup</code>, <code>work</code>, <code>recovery</code>, <code>repeat</code>, <code>cooldown</code>) and expands repeats into a flat timeline for the player. The contract fixtures from phase 2 cover it.</p>`],
        ["Tables", code(`profile (user_id, units, …) + ftp_history (user_id, effective_from, watts)
workout_plan (id, user_id, type, schema_version, name, body jsonb, review_state, … sync columns)
scheduled_workout (id, user_id, plan_id, scheduled_for, status, recording_id, … sync columns)`)],
        ["Workout player", `<p>A state machine over the flattened steps: current step, time remaining, and a target range resolved as FTP × fraction when the ride starts. Haptic and sound cues 5 seconds before each change. Per-step compliance (time in range, average versus target) is stored on the recording.</p>`],
        ["MCP server", `<p>Go, using the official MCP Go SDK, sharing the <code>store</code> package with the API. Served over streamable HTTP at <code>https://coach.&lt;tailnet&gt;.ts.net/mcp</code> behind the same Tailscale machine, authenticated with a device token that has only <code>read</code> and <code>plans:write</code>. Tools: <code>get_profile</code>, <code>list_workouts</code>, <code>get_workout</code>, <code>get_metrics</code>, <code>get_schema</code>, <code>create_plan</code>, <code>update_plan</code>, <code>schedule_workout</code>.</p>`],
        ["Incoming-changes review", `<p>Plans written by <code>mcp</code> or <code>web</code> arrive with <code>review_state = 'proposed'</code>. The Train tab shows the banner from the mockup; accepting marks them accepted, rejecting soft-deletes them. An agent can propose but never silently rearrange your week.</p>`],
        ["Privacy defaults", `<p>Tools return summaries and aggregates. Raw streams need an explicit <code>get_streams</code> call with a time range, so a casual question doesn't send a month of heart-rate data to the model.</p>`],
      ],
      done: ["“Schedule three sweet-spot rides next week” in Claude produces proposed plans that appear in the app.", "You accept one, ride it with targets and cues, and the recording links to it.", "Claude can then summarize how well you hit the targets."],
      learn: "JSON Schema, the MCP protocol, state machines in Swift.",
      agent: "Schema, validation and MCP tools suit agents well. The player needs on-device feel testing.",
    },
    {
      n: 7, title: "Health import", cat: "feature", hours: [6, 10], deps: "P6", milestone: "M5",
      why: "Sleep, HRV and resting heart rate are the inputs any later coaching or readiness logic needs, and they fill the Today vitals and the Body tab.",
      deliver: [
        "Incremental import of sleep, HRV, resting HR, weight and other apps' workouts.",
        "<code>metric_sample</code> synced to Postgres; the Body tab and the Today vitals.",
        "Updates in the background without opening the app.",
        "Optional FIT import as the Tymewear fallback.",
      ],
      impl: [
        ["Incremental reads", `<p>One <code>HKAnchoredObjectQuery</code> per type, with its anchor saved in <code>sync_state</code>, so each run reads only what's new or deleted. <code>HKObserverQuery</code> with background delivery wakes the app when Health changes, then it imports and syncs.</p>`],
        ["Data model", `<p><code>metric_sample (id, user_id, kind, start, end, value, unit, source)</code> with the HealthKit sample UUID as the id, so reinstalling never duplicates. Values in SI units. Sleep stored as stage segments. Other apps' workouts become summary-only recordings with <code>source = 'healthkit'</code>. Samples deleted in Health become tombstones.</p>`],
        ["Body tab", `<p>Trends with segmented sparklines and 7- and 28-day baselines. A simple readiness indicator (HRV and resting HR versus your own baseline), clearly labeled as a heuristic.</p>`],
        ["FIT import", `<p>If Tymewear's breathing can't be read live: import a FIT file through the share sheet, parse it server-side with a Go FIT library, and merge breathing channels onto the matching ride by timestamp.</p>`],
      ],
      done: ["The last 90 days import once, with no duplicates after a reinstall.", "Last night's sleep appears without opening the app.", "Today shows real vitals."],
      learn: "HealthKit queries and background delivery.",
      agent: "Mapping and storage code suits agents; HealthKit behavior must be checked on a device.",
    },
    {
      n: 8, title: "Web app v1", cat: "feature", hours: [15, 25], deps: "P6", milestone: "M6",
      why: "Planning a week, editing a plan and analyzing a ride are easier on a big screen, and this is your TypeScript learning ground.",
      deliver: [
        "A TypeScript web app on the same tailnet address as the API.",
        "Calendar, plan editor driven by the JSON schema, ride analysis charts, fasting history.",
        "Read endpoints for the web (online-only, unlike the phone).",
      ],
      impl: [
        ["Stack", `<p>Framework choice is in <a href="#decisions">Decisions › Web framework</a>. Built to static files and served by the same Tailscale machine at <code>/</code>, with the API at <code>/v1</code>: same origin, no CORS.</p>`],
        ["Auth on the tailnet", `<p>Tailscale serve can pass the caller's tailnet identity to the backend as request headers (for example <code>Tailscale-User-Login</code>), which the API can map to a user. That's a login-free web app for tailnet users. Confirm the header behavior for your setup before relying on it; the fallback is a device token stored by the browser.</p>`],
        ["Read API", `<p>The sync endpoints suit clients with local databases. The web app gets plain reads: calendar range, recording list and detail, and downsampled streams (<code>/v1/recordings/{id}/streams?resolution=5s</code>) so charts load fast.</p>`],
        ["Charts and editor", `<p>A canvas-based time-series library suited to dense 1 Hz data. The plan editor renders a form from the schema, shows the interval profile live and validates with the same schema as the server.</p>`],
      ],
      done: ["Plan next week on the laptop; it appears on the phone.", "Open last ride's power and HR charts with zones."],
      learn: "TypeScript and the chosen framework.",
      agent: "Front-end work is a strong agent fit, especially with screenshots in review.",
    },
    {
      n: 9, title: "Trainer control (ERG)", cat: "feature", hours: [6, 10], deps: "P6",
      why: "Structured workouts become far better when the trainer holds the target for you. The design left room for this from the start.",
      deliver: ["ERG mode during structured workouts over FTMS.", "Smooth target changes, a safe release on pause or stop, and a resistance fallback."],
      impl: [
        ["FTMS control point", h.table(["Op code", "Meaning"], [
          ["0x00", "Request control (required first)"],
          ["0x05", "Set target power (sint16, watts)"],
          ["0x07 / 0x08", "Start or resume / stop or pause"],
        ]) + `<p>Commands are written to the Fitness Machine Control Point (0x2AD9) and acknowledged by indication; Fitness Machine Status reports state changes.</p>`],
        ["Behavior", `<p>Ramp target changes over 2 to 3 seconds, release resistance on pause, end and disconnect, and fall back to a resistance level if the trainer refuses power targets. Tested against a simulated FTMS peripheral before your real trainer.</p>`],
      ],
      done: ["A sweet-spot workout drives the trainer through every interval.", "Pausing the app releases the resistance immediately."],
      learn: "BLE writes and indications.", agent: "Command encoding and the state machine suit agents; the feel test is yours.",
    },
    {
      n: 10, title: "Lifting and the Watch app", cat: "feature", hours: [20, 30], deps: "P6",
      why: "The second workout type, and the reason the Watch app exists: logging sets live without picking up the phone.",
      deliver: ["A lifting schema (exercises, sets × reps × load, RPE, rest) and an exercise library.", "A phone logger and a Watch app with a workout session, set logging, rest timer and heart rate.", "Watch-to-phone transfer that survives disconnects."],
      impl: [
        ["Schema sketch", code(`{ "type": "lifting", "schema_version": 1, "name": "Lower A",
  "blocks": [ { "exercise": "back_squat", "sets": [ { "reps": 5, "load_kg": 100, "rpe": 7 } ], "rest_s": 180 } ] }`)],
        ["Watch architecture", `<p>A watchOS target in <code>project.yml</code>. An <code>HKWorkoutSession</code> on the Watch keeps the app alive and provides heart rate. Completed sets go to the phone with <code>WatchConnectivity</code>'s queued transfers, which survive disconnects; the phone stores and syncs them. The Watch keeps only a small local store.</p>`],
      ],
      done: ["A whole session logged from the wrist with the phone in a bag.", "It appears in Apple Health as a strength workout."],
      learn: "watchOS, WatchConnectivity, HKWorkoutSession.", agent: "Schema and phone UI suit agents; the Watch needs device testing.",
    },
    {
      n: 11, title: "Running", cat: "feature", hours: [12, 20], deps: "P10",
      why: "The third workout type, reusing the Watch foundation and the sensor layer.",
      deliver: ["Outdoor runs with GPS from the phone or the Watch.", "Treadmill runs from FTMS treadmill data, and footpods.", "A running schema with pace and HR zones, auto-pause, and route storage."],
      impl: [
        ["Sources", h.table(["Source", "How"], [
          ["Outdoor", "Core Location with background updates, or the Watch's GPS; route saved as a stream"],
          ["Treadmill", "FTMS Treadmill Data (0x2ACD)"],
          ["Footpod", "Running Speed and Cadence (0x1814)"],
        ])],
      ],
      done: ["An outdoor run and a treadmill run both record, sync and show in Health."],
      learn: "Core Location, battery-aware sampling.", agent: "Parsers and schema suit agents.",
    },
    {
      n: 12, title: "Mobility", cat: "feature", hours: [4, 8], deps: "P6",
      why: "The simplest type: timed holds and flows, little sensor work. A good quick win after running.",
      deliver: ["A mobility schema (holds, flows, sides), a small library, and a guided timer with cues."],
      impl: [["Reuse", `<p>Built on the workout player from phase 6 with different step kinds, so most of the work is content and UI.</p>`]],
      done: ["A 10-minute hip flow runs from start to finish with cues."],
      learn: "—", agent: "Almost entirely agent-suitable.",
    },
    {
      n: 13, title: "Daily and weekly automations", cat: "auto", hours: [8, 15], deps: "P7, P6",
      why: "The automations you mentioned for after the core features: a daily readiness note, a weekly review, and proposed plan adjustments.",
      deliver: ["A scheduled job runner on the server.", "A daily readiness note and a weekly review.", "Plan adjustments delivered as proposals through the incoming-changes review.", "Cost and privacy limits per job."],
      impl: [
        ["Where jobs run", `<p>Either a small Go job runner in the Compose project that calls the Claude API with the same store functions the MCP server uses, or a scheduled remote agent that connects through the MCP server. The first is simpler to control; the second reuses everything from phase 6. Decide when you get here; both write results the same way.</p>`],
        ["Outputs", `<p>Notes are stored as records and shown on Today. Plan changes are always proposals with <code>origin = 'mcp'</code>, reviewed in the app. Nothing is changed silently.</p>`],
        ["Delivery", `<p>Push notifications need APNs (a paid developer account and a server-side sender). The cheaper path is to let background sync pick the note up and raise a local notification.</p>`],
        ["Limits", `<p>A per-job token budget, summaries rather than raw streams, and a log of every prompt and response kept in Postgres so you can audit what was sent.</p>`],
      ],
      done: ["A readiness note is waiting each morning.", "Sunday's review proposes next week's plan, which you accept or reject in the app."],
      learn: "LLM tool use, scheduling.", agent: "High, and a natural home for the orchestration experiments.",
    },
    {
      n: 14, title: "Polish: Live Activities, widgets, diet", cat: "feature", hours: [8, 15], deps: "P7",
      why: "Quality-of-life features that were deliberately left out of v1.",
      deliver: ["Live Activities for a running fast and an active ride.", "Home and lock screen widgets.", "Fasting history and stats.", "Simple diet logging."],
      impl: [["Notes", `<p>Live Activities use ActivityKit and a widget extension target. Diet starts as quick entries (meal, notes, rough macros, photo), not a food database.</p>`]],
      done: ["The fasting timer is on the lock screen; last week's fasts show as a chart."],
      learn: "ActivityKit, WidgetKit.", agent: "Suitable.",
    },
    {
      n: 15, title: "Release track", cat: "release", hours: [20, 60], deps: "P4 + your decision",
      why: "Open source, App Store, or neither. The work differs a lot; Decisions › Distribution lays out the options.",
      deliver: ["For open source: a license, self-hosting docs (Compose plus Tailscale), and an onboarding flow (scan a QR code for server and token).", "For the App Store: a hosted backend, sign-in, account deletion, a privacy policy, HealthKit review requirements and App Review."],
      impl: [["Why the groundwork matters", `<p>Phase 4's users, device tokens and scoped queries are shared by both paths. Everything hosted-specific waits until you choose, so none of it is built speculatively.</p>`]],
      done: ["Someone else can run their own Coach, or download it from the App Store."],
      learn: "Release engineering.", agent: "Docs and onboarding suit agents.",
    },
  ];

  const TRACK = {
    title: "Parallel track: agentic development",
    why: "You want this project to test agent-driven development, remote agent control and orchestrators. This track runs alongside the phases above and gets more ambitious as the guardrails arrive.",
    stages: [
      ["From phase 2", "Local agents with guardrails", "Claude Code in the repo, guided by CLAUDE.md. Small, labeled issues; every change arrives as a PR with tests; you review, optionally with an automated code review pass."],
      ["From phase 3", "Remote and cloud agents", "Agents work from GitHub issues in cloud sessions and deploy to coach-dev, never prod. You review and approve from your phone. Dev holds synthetic data, so agents never see your health data."],
      ["From phase 6", "Orchestration experiments", "Try orchestrators such as Hermes or OpenClaw, running in a container on the NAS or Mac, assigning issues to agents. Scope credentials tightly: a fine-grained GitHub token for this repo (contents and pull requests only), a Tailscale tag that reaches coach-dev only, no prod secrets, and a spending cap."],
      ["Throughout", "Measure it", "Track time from issue to merge, how much review each PR needed, rework, and which kinds of task agents handled well. The roadmap's “agent fit” notes are hypotheses to check."],
    ],
  };

  const HOURS_PER_WEEK = 3.5;

  Coach.register({
    id: "roadmap", order: 9, group: "plan", title: "Roadmap", eyebrow: "Planning",
    lede: "The plan in order. Platform work that gets more expensive later (hardening, CI, environments, accounts) comes first; features then follow the spec's milestones. Expand any phase for implementation details. Hours are rough ranges for orientation, not commitments.",
    render() {
      let cum = 0;
      const rows = PHASES.map((p) => {
        const start = cum;
        cum += (p.hours[0] + p.hours[1]) / 2;
        return { p, start, end: cum };
      });
      const total = cum;
      return `
        ${h.block("At a glance", h.panel(`
          <p class="muted" style="margin-bottom:12px">Bars show each phase's midpoint estimate laid end to end. At about ${HOURS_PER_WEEK} hours a week, the whole plan is roughly ${Math.round(total / HOURS_PER_WEEK / 4.3)} months; the first four phases, which set up everything else, take about ${Math.round(rows[3].end / HOURS_PER_WEEK)} weeks.</p>
          <div class="gantt">${rows.map(({ p, start, end }) => `
            <div class="row"><span class="lbl">P${p.n} · ${esc(p.title)}</span>
              <div class="bar"><i style="left:${(start / total) * 100}%;width:${Math.max(0.8, ((end - start) / total) * 100)}%;background:var(--${{ ops: "amber", dev: "cyan", deploy: "magenta", platform: "violet", feature: "mint", auto: "cyan", release: "muted" }[p.cat]})"></i></div></div>`).join("")}
          </div>`))}
        <div class="filters" id="catfilter" role="group" aria-label="Filter by category"></div>
        <div class="timeline" id="phases"></div>
        ${h.block(TRACK.title, h.panel(`<p class="muted" style="margin-bottom:12px">${esc(TRACK.why)}</p>` + h.table(["When", "Stage", "What it looks like"], TRACK.stages.map(([w, s, d]) => [`<span class="mono">${esc(w)}</span>`, `<b>${esc(s)}</b>`, esc(d)])), { edge: "cyan" }))}`;
    },
    mount(main) {
      let filter = "all";
      const draw = () => {
        $("#catfilter", main).innerHTML = [["all", "All phases"], ...Object.entries(CATS).map(([k, v]) => [k, v[0]])].map(([k, label]) =>
          `<button type="button" class="btn ghost" data-cat="${k}" aria-pressed="${filter === k}">${esc(label)}</button>`).join("");
        $("#phases", main).innerHTML = PHASES.filter((p) => filter === "all" || p.cat === filter).map((p) => `
          <div class="phase${p.now ? " now" : ""}" id="phase-${p.n}">
            <div class="rail"><div class="num">P${p.n}</div></div>
            <div class="body"><details${p.now ? " open" : ""}>
              <summary>
                <div class="ttl"><h3>${esc(p.title)}</h3>${h.chip(CATS[p.cat][1], CATS[p.cat][0])}${p.milestone ? h.chip("plan", "spec " + p.milestone) : ""}${p.now ? h.chip("crit", "Next up") : ""}<span class="open-ind"></span></div>
                <p class="why">${esc(p.why)}</p>
                <div class="facts"><span>effort <b>${p.hours[0]}–${p.hours[1]} h</b></span><span>needs <b>${esc(p.deps)}</b></span></div>
              </summary>
              <div class="pbody">
                <div><h4>Delivers</h4>${h.list(p.deliver)}</div>
                <div><h4>Implementation details</h4><div class="impl">${p.impl.map(([t, body]) => `<details class="x"><summary>${esc(t)}</summary><div class="xbody">${body}</div></details>`).join("")}</div></div>
                <div class="grid2">
                  <div><h4>Done when</h4>${h.list(p.done)}</div>
                  <div class="stack"><div><h4>You'll learn</h4><p>${esc(p.learn)}</p></div><div><h4>Agent fit</h4><p>${esc(p.agent)}</p></div></div>
                </div>
              </div>
            </details></div>
          </div>`).join("");
      };
      main.addEventListener("click", (e) => {
        const b = e.target.closest("[data-cat]");
        if (!b) return;
        filter = b.dataset.cat;
        draw();
      });
      draw();
    },
  });
})();
