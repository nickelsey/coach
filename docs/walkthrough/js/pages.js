/* Overview, Architecture, Journey, Runbook, Tests and Review pages. */
(function () {
  "use strict";
  const { h, $, $$ } = Coach;
  const { esc } = h;

  /* ================= OVERVIEW ================= */
  Coach.register({
    id: "overview", order: 1, group: "walk", title: "Overview", eyebrow: "Start here",
    lede: "A personal, local-first fitness system: an iPhone app that works offline, a small Go API and Postgres on your Synology, and Tailscale as the only way in. Milestone 1 (foundation) and the core of milestone 2 (fasting) are live.",
    render() {
      const pagesInfo = [
        ["architecture", "The parts, how they connect, the data model, configuration and the trust boundaries."],
        ["journey", "One tap on START FAST followed through every layer, with what can go wrong at each step."],
        ["sync", "The sync protocol as a reference, plus a live simulator of the exact rules."],
        ["code", "Every source file with its real doc comments, symbols and syntax-highlighted code, in reading order."],
        ["runbook", "Commands for deploying, operating and troubleshooting what exists."],
        ["tests", "What the automated tests cover, how to run them, and the gaps."],
        ["review", "Risks and gaps in what's built, each linked to the roadmap phase that addresses it."],
        ["roadmap", "The ordered plan: hardening, delivery pipeline, accounts, then features, with implementation details."],
        ["decisions", "Open choices with options and a recommendation: iOS delivery, environments, accounts, agents."],
      ];
      return `
        <div class="chips">
          ${h.chip("live", "Go API · live on NAS")}${h.chip("live", "Postgres 17 · live")}${h.chip("live", "Tailscale HTTPS · live")}
          ${h.chip("live", "iOS app · fasting + sync")}${h.chip("plan", "MCP server · planned")}${h.chip("plan", "Web app · planned")}${h.chip("plan", "Watch · planned")}
        </div>
        ${h.panel(`<div class="statgrid">
          <div class="stat"><b>4</b><span>commits</span></div>
          <div class="stat"><b>~850</b><span>lines of Go</span></div>
          <div class="stat"><b>~2,100</b><span>lines of Swift</span></div>
          <div class="stat"><b>26</b><span>automated tests</span></div>
          <div class="stat"><b>1</b><span>synced record type</span></div>
        </div>`)}
        ${h.block("What works today", h.list([
          "Start, end and adjust a fast on the phone, fully offline, with alerts at the goal, one hour before, and optionally every 4 hours.",
          "Changes sync to Postgres on the NAS over HTTPS on your tailnet, and changes made elsewhere sync back. Conflicts resolve to the newest edit.",
          "The server runs as a Compose project on the DS2419+II with nothing exposed on the LAN, a cross-built API image, and a nightly backup script.",
          "The app has the NEON//OS look from the mockups: chamfered panels, glow, segmented bars, grid and optional scanlines.",
        ]))}
        ${h.block("Pages", `<div class="grid3 cards">${pagesInfo.map(([id, d]) => {
          const p = Coach.pages.find((x) => x.id === id);
          const n = Coach.pages.indexOf(p) + 1;
          return `<a class="card" href="#${id}"><div class="edge"><div class="panel"><span class="n">${String(n).padStart(2, "0")}</span><h3>${esc(p.title)}</h3><p>${esc(d)}</p></div></div></a>`;
        }).join("")}</div>`)}
        ${h.block("How the repo is laid out", h.table(["Path", "What it is", "Language"], [
          ["<code>server/</code>", "Sync API: HTTP layer, sync store, migrations, tests, Dockerfile", "Go"],
          ["<code>deploy/</code>", "Compose project, Tailscale serve config, image build and backup scripts", "YAML, shell"],
          ["<code>ios/</code>", "XcodeGen project, app sources (App, Data, Sync, Theme, Features), tests", "Swift"],
          ["<code>docs/walkthrough/</code>", "This site and the generator that builds the Code page from the sources", "HTML/JS, Python"],
        ]))}`;
    },
  });

  /* ================= ARCHITECTURE ================= */
  const NODES = {
    phone: {
      title: "iPhone app", status: ["live", "Live"],
      body: "SwiftUI app with the NEON//OS design system. Works fully offline: every change is written to a local SQLite database first and queued for sync.",
      points: [
        "GRDB database with three tables: <code>fast</code>, <code>pending_change</code> (the push queue) and <code>sync_state</code> (the pull cursor).",
        "Timestamps are stored as integer milliseconds so they survive SQLite, JSON and Postgres unchanged. Sync's conflict rule depends on that.",
        "Syncs on launch, on returning to the foreground, and one second after any edit. One sync runs at a time.",
        "Server address in UserDefaults, API token in the Keychain. Reaches the server through the Tailscale app's VPN.",
      ],
      files: ["ios/Coach/App/AppModel.swift", "ios/Coach/Sync/SyncEngine.swift", "ios/Coach/Data/AppDatabase.swift"],
    },
    laptop: {
      title: "Laptop", status: ["live", "Live"],
      body: "Any machine on your tailnet. Today it is for analysis and operations; later it is where Claude plans workouts through the MCP server.",
      points: [
        "Postgres is forwarded on the tailnet at <code>coach.&lt;tailnet&gt;.ts.net:5432</code> for psql, notebooks and similar.",
        "Deploys happen from GitHub, not from here: a push to main is all the laptop does.",
        "Can call the API directly with the bearer token for debugging.",
      ],
      files: [".github/workflows/server.yml", "deploy/README.md"],
    },
    watch: {
      title: "Apple Watch (planned)", status: ["plan", "Planned"],
      body: "A minimal companion for live set logging when lifting arrives: current set, reps and load, a done button and a rest timer. It talks to the phone, not the server.",
      points: ["Planned with the lifting phase.", "Also provides wrist heart rate and GPS for outdoor runs."],
      files: [],
    },
    ts: {
      title: "Tailscale container (ts)", status: ["live", "Live"],
      body: "Joins your tailnet as the machine \"coach\" and is the only way in. It terminates HTTPS with a real certificate for coach.<tailnet>.ts.net, which iOS requires, and proxies to the API.",
      points: [
        "Runs in userspace mode, so it needs no kernel TUN device on DSM.",
        "<code>serve.json</code> maps :443 to the API on 127.0.0.1:8080 and forwards :5432 to the database.",
        "The API shares this container's network namespace (<code>network_mode: service:ts</code>), which is why 127.0.0.1 reaches it.",
        "Machine state persists in <code>DATA_DIR/tailscale</code>, so the name and certificate survive restarts and a move to new hardware.",
      ],
      files: ["deploy/compose.yaml", "deploy/config/serve.json"],
    },
    api: {
      title: "Go API (api)", status: ["live", "Live"],
      body: "A single static binary in a distroless container. Applies migrations on start, then serves the sync endpoints.",
      points: [
        "<code>GET /healthz</code> (no auth), <code>POST /v1/sync/push</code>, <code>GET /v1/sync/pull?since=&amp;limit=</code> (bearer token).",
        "Push validates every record, then writes the batch in one transaction holding an advisory lock, so <code>server_seq</code> values become visible in order.",
        "Upsert only replaces a row when the incoming <code>updated_at</code> is newer. Equal or older pushes come back as stale.",
        "Rejects unknown JSON fields, so the app and server must agree on the schema.",
      ],
      files: ["server/cmd/api/main.go", "server/internal/api/api.go", "server/internal/store/sync.go", "server/internal/store/fast.go"],
    },
    db: {
      title: "Postgres 17 (db)", status: ["live", "Live"],
      body: "The source of truth. Data lives on the NAS volume under DATA_DIR/postgres.",
      points: [
        "<code>fasts</code> table plus the <code>sync_seq</code> sequence that orders every synced write.",
        "<code>schema_migrations</code> records which embedded migrations have run.",
        "Plain Postgres with nothing vendor-specific, so a move to Supabase or a Mac mini is a data copy.",
      ],
      files: ["server/internal/db/migrations/0001_init.sql", "server/internal/db/db.go"],
    },
    backup: {
      title: "Backups", status: ["warn", "Set up, untested"],
      body: "backup.sh runs pg_dump in custom format to a NAS folder, keeps 30 days, and is scheduled nightly in DSM Task Scheduler with Hyper Backup copying the folder off the box.",
      points: ["A restore has never been rehearsed. See Review and roadmap phase 1.", "Dumps are compressed and restore with <code>pg_restore</code>."],
      files: ["deploy/backup.sh"],
    },
    mcp: {
      title: "MCP server and web app (planned)", status: ["plan", "Planned"],
      body: "The MCP server will let Claude read history and write structured plans; the web app will be the calendar, plan editor and analysis view. Both run in the same Compose project behind the same Tailscale machine.",
      points: ["MCP in Go, sharing the store package with the API (phase 6).", "Web app in TypeScript (phase 8).", "Plan changes from either appear on the phone as an incoming-changes review."],
      files: [],
    },
  };
  const WIRES = { phone: ["w-phone-ts"], laptop: ["w-laptop-ts"], watch: ["w-watch"], ts: ["w-phone-ts", "w-laptop-ts", "w-ts-api", "w-ts-db"], api: ["w-ts-api", "w-api-db"], db: ["w-api-db", "w-ts-db", "w-db-bk"], backup: ["w-db-bk"], mcp: ["w-mcp"] };

  const MAP_SVG = `<svg class="map" viewBox="0 0 660 470" role="group" aria-label="Architecture diagram">
    <rect class="zone" x="10" y="20" width="190" height="430"></rect>
    <text class="zlabel" x="22" y="40">YOUR DEVICES</text>
    <rect class="zone" x="290" y="20" width="360" height="430"></rect>
    <text class="zlabel" x="302" y="40">SYNOLOGY DS2419+II · COMPOSE "coach"</text>
    <path id="w-phone-ts" class="wire" d="M180 105 C 240 105, 250 120, 310 120"></path>
    <text class="wlabel" x="214" y="98">HTTPS :443</text>
    <path id="w-laptop-ts" class="wire" d="M180 255 C 240 255, 250 140, 310 140"></path>
    <text class="wlabel" x="206" y="238">:5432 · :443</text>
    <path id="w-ts-api" class="wire" d="M420 150 L 420 200"></path>
    <text class="wlabel" x="428" y="180">127.0.0.1:8080</text>
    <path id="w-api-db" class="wire" d="M420 262 L 420 312"></path>
    <text class="wlabel" x="428" y="292">db:5432</text>
    <path id="w-ts-db" class="wire" d="M500 140 C 590 140, 590 340, 500 340"></path>
    <text class="wlabel" x="552" y="262">TCP fwd</text>
    <path id="w-db-bk" class="wire" d="M420 372 L 420 398"></path>
    <path id="w-mcp" class="wire" d="M565 240 L 500 230" stroke-dasharray="4 4"></path>
    <path id="w-watch" class="wire" d="M105 380 L 105 140" stroke-dasharray="4 4"></path>
    ${[
      ["phone", 30, 70, 150, 70, "iPHONE APP", "SwiftUI · GRDB · sync", false],
      ["laptop", 30, 220, 150, 70, "LAPTOP", "psql · Python · Claude", false],
      ["watch", 30, 380, 150, 56, "APPLE WATCH", "planned · lifting", true],
      ["ts", 310, 90, 190, 60, "TAILSCALE · ts", "machine \"coach\" · serve", false],
      ["api", 310, 200, 190, 62, "GO API · api", "/v1/sync/push · /pull", false],
      ["db", 310, 312, 190, 60, "POSTGRES 17 · db", "fasts · sync_seq", false],
      ["backup", 310, 398, 190, 40, "BACKUPS · nightly", "", false],
      ["mcp", 520, 200, 120, 70, "MCP + WEB", "planned", true],
    ].map(([id, x, y, w, ht, lbl, sub, planned]) => `<g class="node${planned ? " planned" : ""}" data-node="${id}" tabindex="0" role="button" aria-label="${esc(lbl)}">
      <rect x="${x}" y="${y}" width="${w}" height="${ht}"></rect>
      <text class="lbl" x="${x + 14}" y="${y + (sub ? 27 : 25)}" font-size="${w < 160 ? 13.5 : 15}">${esc(lbl)}</text>
      ${sub ? `<text class="sub" x="${x + 14}" y="${y + 48}">${esc(sub)}</text>` : ""}
    </g>`).join("")}
  </svg>`;

  Coach.register({
    id: "architecture", order: 2, group: "walk", title: "Architecture", eyebrow: "Walkthrough",
    lede: "Select any box to see what it is, where it lives in the repo and how it connects. Dashed boxes are planned. The only way into the server is your tailnet; nothing is published on the LAN.",
    render() {
      return `
        <div class="arch">
          ${h.panel(MAP_SVG, { cls: "diagram-scroll" })}
          <div class="edge cyan"><div class="panel detail" id="detail" aria-live="polite"></div></div>
        </div>
        ${h.block("Design principles", h.list([
          "<b>Local-first.</b> The phone writes to its own database and never waits on the network. Sync is a background reconciliation, so a ride in a basement or a dead NAS doesn't stop anything.",
          "<b>Server is the source of truth.</b> Everything converges in Postgres, where SQL, Python and Claude can reach it. HealthKit will be imported into it rather than queried live.",
          "<b>Ordering by sequence, conflicts by time.</b> Pull uses a server-assigned <code>server_seq</code>, which can't be skewed by device clocks. Conflicts use <code>updated_at</code>, newest wins.",
          "<b>Private by network.</b> Tailscale is the front door. The bearer token is a second lock, not the only one.",
          "<b>Portable by containers.</b> Everything server-side is a Compose service with data on one directory, so moving to a Mac mini or Supabase is a copy, not a rewrite.",
        ]))}
        ${h.block("Data model today", `<p class="muted">One synced record type. The same fields exist in three places, and they must agree exactly.</p>` + h.table(
          ["Field", "Postgres (fasts)", "SQLite on iPhone (fast)", "JSON on the wire", "Notes"], [
            ["id", "uuid PK", "text PK", "\"id\": string", "Generated on the device (UUID v4, lowercase), so records can be created offline."],
            ["started_at", "timestamptz", "integer ms", "RFC 3339, 3 fraction digits", "Set when the fast starts."],
            ["ended_at", "timestamptz NULL", "integer ms NULL", "string or null", "NULL while the fast runs."],
            ["goal_seconds", "integer > 0", "integer", "number", "Changing the goal is an ordinary edit."],
            ["notes", "text", "text", "string", "Unused in the UI so far."],
            ["created_at / updated_at", "timestamptz", "integer ms", "string", "updated_at decides conflicts; every edit makes it strictly larger."],
            ["deleted_at", "timestamptz NULL", "integer ms NULL", "string or null", "Soft delete (tombstone), so deletions sync."],
            ["origin", "text", "text", "phone · watch · web · mcp", "Which client made the last edit."],
            ["server_seq", "bigint from sync_seq", "integer NULL", "number (server → client only)", "Bumped on every applied write; the pull cursor."],
          ]))}
        ${h.block("Trust boundaries", h.table(["Path", "Protected by", "Notes"], [
          ["Phone or laptop → coach:443", "Tailscale (WireGuard) + TLS + bearer token", "Only devices on your tailnet can connect at all."],
          ["coach:443 → api", "Same network namespace", "Plain HTTP on 127.0.0.1 inside the ts container's namespace."],
          ["api → db", "Compose network + Postgres password", "Unencrypted inside the project network; never leaves the NAS."],
          ["Laptop → coach:5432", "Tailscale + Postgres password", "Uses the same owner role as the API today. See Review."],
          ["Backups", "NAS permissions + Hyper Backup", "Dumps are not encrypted by the script; Hyper Backup can encrypt the copy."],
        ]))}
        ${h.block("Configuration", h.table(["Where", "Key", "Purpose"], [
          ["deploy/.env", "TS_AUTHKEY", "Joins the ts container to your tailnet the first time."],
          ["deploy/.env", "POSTGRES_PASSWORD", "Database owner password; part of DATABASE_URL."],
          ["deploy/.env", "COACH_API_TOKEN", "The bearer token clients send (at least 32 characters)."],
          ["deploy/.env", "DATA_DIR", "Where Postgres and Tailscale state live on the NAS."],
          ["api container", "DATABASE_URL · LISTEN_ADDR", "Set by compose.yaml from the values above."],
          ["iPhone · UserDefaults", "server.url", "Server address from Settings."],
          ["iPhone · Keychain", "dev.coach.api-token", "API token from Settings."],
          ["iPhone · UserDefaults", "display.* · fast.*", "Scanlines, units, default goal, alert toggles."],
        ]))}`;
    },
    mount(main) {
      const select = (key) => {
        const n = NODES[key];
        $$("svg.map .node", main).forEach((g) => g.classList.toggle("sel", g.dataset.node === key));
        $$("svg.map .wire", main).forEach((w) => w.classList.toggle("hot", (WIRES[key] || []).includes(w.id)));
        $("#detail", main).innerHTML = `<div class="ptitle" style="color:var(--cyan)">Component</div>
          <div class="stack"><h3>${esc(n.title)}</h3><div>${h.chip(n.status[0], n.status[1])}</div>
          <p>${esc(n.body)}</p>${h.list(n.points)}${n.files.length ? `<div class="tracklabel">Source</div>${h.files(n.files)}` : ""}</div>`;
      };
      $$("svg.map .node", main).forEach((g) => {
        g.addEventListener("click", () => select(g.dataset.node));
        g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(g.dataset.node); } });
      });
      select("api");
    },
  });

  /* ================= JOURNEY ================= */
  const HOPS = ["Button", "SQLite", "Observers", "Sync engine", "Tailscale", "API", "Postgres", "Pull", "Backup"];
  const JOURNEY = [
    { hop: 0, where: "ios/Coach/Features/Fast/FastView.swift → AppModel.startFast", title: "Tap START FAST",
      body: "The button calls the app model with your default goal. The model asks the repository to start the fast and, the first time, requests notification permission. Nothing here touches the network.",
      code: `<span class="k">Button</span>(<span class="s">"START FAST"</span>) { model.startFast(goalHours: defaultGoalHours) }`,
      fails: [["A fast is already running", "the repository throws FastError.alreadyActive and the message shows under the buttons."]],
      files: ["ios/Coach/Features/Fast/FastView.swift", "ios/Coach/App/AppModel.swift"] },
    { hop: 1, where: "ios/Coach/Data/FastRepository.swift", title: "Write locally and queue it",
      body: "In one SQLite transaction: refuse if a fast is already running, insert the row with a new UUID and millisecond timestamps, and add its id to pending_change. If the phone dies right after this, the fast is safe and will still sync later.",
      code: `<span class="k">try</span> fast.insert(db)\n<span class="k">try</span> db.markPending(Fast.entity, id: fast.id)   <span class="c">// INSERT OR IGNORE INTO pending_change</span>`,
      fails: [["Disk full or database locked", "the write throws and nothing is queued; the UI shows the error."]],
      files: ["ios/Coach/Data/FastRepository.swift", "ios/Coach/Data/AppDatabase.swift"] },
    { hop: 2, where: "AppModel.start → GRDB ValueObservation", title: "The UI and alerts update",
      body: "A database observation of the active fast fires. The Today card and Fuel tab start ticking, and FastNotifications clears and reschedules the alerts. Changes that arrive by sync take exactly the same path, so the UI never needs to know where a change came from.",
      code: `<span class="k">for try await</span> fast <span class="k">in</span> observation.values(in: database.writer) {\n    activeFast = fast\n    <span class="k">await</span> notifications.reschedule(for: fast)\n}`,
      fails: [["Notifications denied", "alerts silently don't fire; the timer still works."], ["Observation throws", "the loop ends and the UI stops updating (see Review)."]],
      files: ["ios/Coach/App/AppModel.swift", "ios/Coach/App/FastNotifications.swift"] },
    { hop: 3, where: "AppModel.scheduleSync → SyncEngine.run → push", title: "Push, about a second later",
      body: "Sync is debounced so a burst of edits becomes one request, and only one sync runs at a time. The engine reads up to 200 queued records and POSTs them with the bearer token.",
      code: `POST /v1/sync/push\nAuthorization: Bearer ••••\n{<span class="s">"fasts"</span>:[{<span class="s">"id"</span>:<span class="s">"7f1c…"</span>,<span class="s">"started_at"</span>:<span class="s">"2026-11-02T16:30:00.123Z"</span>,<span class="s">"goal_seconds"</span>:57600,…}]}`,
      fails: [["Server not configured", "the badge shows NO LINK CFG and nothing is sent."], ["Offline or VPN off", "the request fails, the badge shows OFFLINE, and the record stays queued for the next attempt."]],
      files: ["ios/Coach/Sync/SyncEngine.swift", "ios/Coach/Sync/SyncTransport.swift"] },
    { hop: 4, where: "deploy/config/serve.json", title: "Tailscale terminates HTTPS",
      body: "The Tailscale app on the phone routes coach.<tailnet>.ts.net over WireGuard to the ts container on the NAS. It holds a real Let's Encrypt certificate for that name, terminates TLS and proxies to 127.0.0.1:8080, which is the API because both containers share one network namespace.",
      code: `<span class="s">"Web"</span>: { <span class="s">"\${TS_CERT_DOMAIN}:443"</span>: { <span class="s">"Handlers"</span>: { <span class="s">"/"</span>: { <span class="s">"Proxy"</span>: <span class="s">"http://127.0.0.1:8080"</span> } } } }`,
      fails: [["Node key expired", "the coach machine drops off the tailnet until re-authenticated (see Review)."], ["First request after a restart", "can take a few seconds while the certificate is fetched."]],
      files: ["deploy/config/serve.json", "deploy/compose.yaml"] },
    { hop: 5, where: "server/internal/api/api.go → store/sync.go → store/fast.go", title: "The API applies last-writer-wins",
      body: "The token is compared in constant time, the JSON is decoded with unknown fields rejected, and every record is validated before anything is written. One transaction takes an advisory lock and upserts each record. The WHERE clause means an equal or older version changes nothing and is reported as stale.",
      code: `<span class="k">ON CONFLICT</span> (id) <span class="k">DO UPDATE SET</span> …, server_seq = nextval(<span class="s">'sync_seq'</span>)\n<span class="k">WHERE</span> fasts.updated_at &lt; EXCLUDED.updated_at`,
      fails: [["Wrong token", "401; the sync status shows the server's message."], ["Invalid record", "400 with the field that failed; nothing in the batch is written."], ["App newer than server", "unknown fields are rejected, so deploy the server first."]],
      files: ["server/internal/api/api.go", "server/internal/store/sync.go", "server/internal/store/fast.go"] },
    { hop: 6, where: "SyncEngine.push (after the response)", title: "The queue entry is cleared",
      body: "Applied and stale records both leave the queue; a stale one means the server has something newer, which the pull brings down next. An entry is only cleared if the record wasn't edited again while the request was in flight, so a quick second edit is never lost.",
      code: `<span class="k">if</span> current?.updatedAt == sent.updatedAt {\n    <span class="k">try</span> db.clearPending(Fast.entity, id: sent.id)\n}`,
      fails: [["Response lost after the server committed", "the record stays queued and is pushed again; the server reports it stale. Harmless."]],
      files: ["ios/Coach/Sync/SyncEngine.swift"] },
    { hop: 7, where: "SyncEngine.pull", title: "Pull everything past the cursor",
      body: "GET /v1/sync/pull?since=<cursor> returns rows whose server_seq is greater, in order, 500 at a time. Each is merged with the same newer-wins rule and the cursor is saved in the same transaction. Your own push comes back here too and is ignored because it isn't newer.",
      code: `GET /v1/sync/pull?since=41&amp;limit=500\n→ {<span class="s">"changes"</span>:{<span class="s">"fasts"</span>:[…]}, <span class="s">"cursor"</span>:42, <span class="s">"has_more"</span>:<span class="k">false</span>}`,
      fails: [["Interrupted mid-way", "each page commits its rows and cursor together, so the next sync resumes where it stopped."]],
      files: ["ios/Coach/Sync/SyncEngine.swift", "server/internal/store/sync.go"] },
    { hop: 8, where: "deploy/backup.sh via DSM Task Scheduler", title: "Nightly: dump and copy off the box",
      body: "pg_dump writes a compressed custom-format dump to a NAS folder and prunes dumps older than 30 days. Hyper Backup copies that folder elsewhere.",
      code: `compose.sh prod exec -T db pg_dump -U coach -d coach -Fc &gt; coach-20261102-030000.dump`,
      fails: [["Task not scheduled or failing", "the weekly restore check fails when the newest dump is over 26 hours old."], ["Dump unusable", "the weekly restore check restores it into a scratch database and emails you if that fails."]],
      files: ["deploy/backup.sh"] },
  ];

  Coach.register({
    id: "journey", order: 3, group: "walk", title: "A change's journey", eyebrow: "Walkthrough",
    lede: "Follow one action, tapping START FAST, through every layer. Each step names the code involved and what can go wrong there. Use the buttons or the arrow keys.",
    render() {
      return `${h.panel(`<div class="journey">
          <div class="chips" id="hops">${HOPS.map((x, i) => `<span class="chip plan" data-hop="${i}">${esc(x)}</span>`).join("")}</div>
          <div class="steps" id="jsteps">${JOURNEY.map((_, i) => `<button type="button" data-step="${i}" aria-label="Step ${i + 1}"></button>`).join("")}</div>
          <div class="where" id="jwhere"></div>
          <h3 id="jtitle"></h3>
          <p id="jbody"></p>
          <pre id="jcode"></pre>
          <div><div class="tracklabel">What can go wrong here</div><ul class="bullets fails" id="jfails"></ul></div>
          <div id="jfiles"></div>
          <div class="btn-row">
            <button class="btn ghost" id="jprev" type="button">Previous</button>
            <button class="btn fill" id="jnext" type="button">Next step</button>
            <span class="muted mono" id="jcount"></span>
          </div></div>`)}
        ${h.block("Why it is built this way", h.list([
          "The phone never blocks on the network: steps 1 to 3 finish instantly even with no signal.",
          "The push queue plus the strict <code>updated_at</code> bump makes retries safe. Sending the same version twice is a no-op.",
          "The pull cursor is a server sequence number, not a timestamp, so a phone with a wrong clock still sees every change exactly once.",
          "The advisory lock makes sequence numbers visible in commit order. Without it, a pull could skip a row whose transaction committed late.",
        ]))}`;
    },
    mount(main) {
      let step = 0;
      const draw = () => {
        const s = JOURNEY[step];
        $("#jwhere", main).textContent = s.where;
        $("#jtitle", main).textContent = s.title;
        $("#jbody", main).textContent = s.body;
        $("#jcode", main).innerHTML = s.code;
        $("#jfails", main).innerHTML = s.fails.map(([a, b]) => `<li><b>${esc(a)}:</b> ${esc(b)}</li>`).join("");
        $("#jfiles", main).innerHTML = h.files(s.files);
        $("#jcount", main).textContent = `${step + 1} / ${JOURNEY.length}`;
        $$("#jsteps button", main).forEach((b, i) => b.classList.toggle("on", i <= step));
        $$("#hops .chip", main).forEach((c) => { const on = Number(c.dataset.hop) === s.hop; c.className = "chip " + (on ? "info" : "plan"); });
        $("#jprev", main).disabled = step === 0;
        $("#jnext", main).disabled = step === JOURNEY.length - 1;
      };
      const go = (i) => { step = Math.max(0, Math.min(JOURNEY.length - 1, i)); draw(); };
      $("#jprev", main).addEventListener("click", () => go(step - 1));
      $("#jnext", main).addEventListener("click", () => go(step + 1));
      $$("#jsteps button", main).forEach((b) => b.addEventListener("click", () => go(Number(b.dataset.step))));
      main.addEventListener("keydown", (e) => {
        if (e.target.closest("input, textarea")) return;
        if (e.key === "ArrowRight") go(step + 1);
        if (e.key === "ArrowLeft") go(step - 1);
      });
      draw();
    },
  });

  /* ================= RUNBOOK ================= */
  const card = (title, desc, cmd) => h.panel(`<div class="stack"><p class="muted">${desc}</p>${h.cmd(cmd)}</div>`, { title });
  const TROUBLE = [
    ["NAS build fails with “seccomp: config provided but seccomp not supported”", "DSM's kernel has no seccomp, which Docker needs for RUN steps during a build.", "Images are built in GitHub Actions and pulled by the NAS. Never run <code>compose up --build</code> on the NAS."],
    ["App shows OFFLINE", "The phone can't reach coach.&lt;tailnet&gt;.ts.net. Most often the Tailscale VPN is off on the phone.", "Turn on Tailscale on the phone, then pull to refresh by reopening the app. Settings › TEST LINK shows the exact error."],
    ["TEST LINK: “Server address isn't a valid https:// URL”", "The address is missing <code>https://</code> or has a typo.", "Use the full <code>https://coach.&lt;tailnet&gt;.ts.net</code> form; no port, no path."],
    ["TEST LINK: “Server returned 401”", "The token in the app doesn't match COACH_API_TOKEN in that environment's .env on the NAS.", "Paste the token again. If you rotated it, restart the api service first."],
    ["api container restarts in a loop", "Usually a missing or short COACH_API_TOKEN, or DATABASE_URL can't connect.", "Read the logs (runbook card above). The first line says which."],
    ["“database not ready” in the API logs", "Postgres was still starting.", "Normal right after the project starts; the API retries for a minute."],
    ["First HTTPS request is slow or fails", "Tailscale is fetching the certificate.", "Retry after a few seconds. MagicDNS and HTTPS certificates must be enabled in the admin console."],
    ["New Swift file isn't compiled", "The Xcode project is generated from project.yml.", "Run <code>xcodegen</code> in <code>ios/</code> after adding or removing files."],
    ["Simulator can't reach the server", "The simulator uses the Mac's network.", "Make sure the Mac is connected to the tailnet."],
  ];
  Coach.register({
    id: "runbook", order: 6, group: "walk", title: "Runbook", eyebrow: "Operations",
    lede: "Commands for running and maintaining what exists. Replace <code>&lt;tailnet&gt;</code> with your own value. The NAS commands need sudo; setup steps are in <code>deploy/README.md</code>.",
    render() {
      return `
        ${h.block("Deploy", `<div class="grid2">
          ${card("Deploy", "Push to main. GitHub tests, builds and deploys to dev, then waits for your approval before prod.", "jj git push   # then approve the prod deployment on the run's page in GitHub")}
          ${card("Deploy or roll back by hand", "On the NAS. The commit and digest are on any workflow run's summary page.", "sudo /volume1/docker/coach/bin/coach-deploy prod <commit-sha> sha256:<digest>")}
          ${card("Check the server is up", "No token needed. The version is the commit that is live.", "curl https://coach.<tailnet>.ts.net/healthz\ncurl https://coach-dev.<tailnet>.ts.net/healthz")}
          ${card("Read API logs", "On the NAS. compose.sh picks the right project and files for an environment.", "cd /volume1/docker/coach/prod/current/deploy\nsudo sh compose.sh prod logs --tail 100 api")}
          ${card("Restart one service", "On the NAS, after changing that environment's .env, for example.", "cd /volume1/docker/coach/prod/current/deploy\nsudo sh compose.sh prod up -d api")}
        </div>`)}
        ${h.block("Data", `<div class="grid2">
          ${card("Query the database", "Over the tailnet, with the read-only analyst role.", "psql 'postgres://analyst@coach.<tailnet>.ts.net:5432/coach?sslmode=disable' \\\n  -c 'select id, started_at, ended_at, goal_seconds, server_seq from fasts order by server_seq desc limit 10'")}
          ${card("Back up now", "On the NAS. The same command the nightly task runs.", "sudo /volume1/docker/coach/prod/current/deploy/backup.sh /volume1/backups/coach")}
          ${card("Check a restore", "Restores the newest dump into a scratch database and compares row counts, leaving the real one alone. The weekly task runs the same command.", "sudo /volume1/docker/coach/prod/current/deploy/restore-check.sh /volume1/backups/coach")}
          ${card("Python against Postgres", "For notebooks and analysis, with the read-only role.", "python3 -m pip install 'psycopg[binary]' pandas\npython3 - <<'EOF'\nimport pandas as pd, psycopg\nconn = psycopg.connect('postgresql://analyst:<password>@coach.<tailnet>.ts.net/coach')\nprint(pd.read_sql('select * from fasts', conn))\nEOF")}
        </div>`)}
        ${h.block("Secrets", `<div class="grid2">
          ${card("Rotate the API token", "Then paste the new token into the app's Settings.", "openssl rand -hex 32   # put this in COACH_API_TOKEN in /volume1/docker/coach/prod/.env\ncd /volume1/docker/coach/prod/current/deploy\nsudo sh compose.sh prod up -d api")}
          ${card("Stop the node key expiring", "Admin console › Machines › coach › ⋯ › Disable key expiry. Or tag the machine.", "# no command: done in the Tailscale admin console")}
        </div>`)}
        ${h.block("Local development", `<div class="grid2">
          ${card("Run all tests", "Server tests need Docker for the Postgres round trip; iOS tests need Xcode.", "docker run -d --rm --name coach-test-db -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:17\n(cd server && COACH_TEST_DATABASE_URL='postgres://postgres:test@127.0.0.1:55432/postgres?sslmode=disable' go test ./...)\n(cd ios && xcodegen && xcodebuild test -project Coach.xcodeproj -scheme Coach -destination 'platform=iOS Simulator,name=iPhone 17')\ndocker stop coach-test-db")}
          ${card("Run the API locally", "Against a local Postgres, for curl experiments.", "docker run -d --name coach-dev-db -e POSTGRES_PASSWORD=dev -p 127.0.0.1:5432:5432 postgres:17\ncd server && DATABASE_URL='postgres://postgres:dev@localhost:5432/postgres?sslmode=disable' \\\n  COACH_API_TOKEN=$(openssl rand -hex 32) go run ./cmd/api")}
          ${card("Regenerate these docs", "Rebuilds the Code page from the current sources.", "python3 docs/walkthrough/gen_code_docs.py")}
        </div>`)}
        ${h.block("Troubleshooting", h.panel(TROUBLE.map(([sym, cause, fix]) => `<details class="x"><summary>${sym}</summary><div class="xbody"><p><span class="muted">Cause:</span> ${cause}</p><p><span class="muted">Fix:</span> ${fix}</p></div></details>`).join("")))}
        ${h.block("Adding a new synced record type", h.panel(h.list([
          "Server: a new migration in <code>server/internal/db/migrations/</code> with the same metadata columns as <code>fasts</code> (<code>id</code>, timestamps, <code>deleted_at</code>, <code>origin</code>, <code>server_seq DEFAULT nextval('sync_seq')</code>).",
          "Server: a struct with <code>Validate</code>, <code>upsertX</code> and <code>pullX</code> in <code>internal/store</code>, mirroring <code>fast.go</code>.",
          "Server: add the field to <code>Changes</code> and wire it into <code>Push</code> and <code>Pull</code> in <code>sync.go</code>. Extend the round-trip test.",
          "iOS: a GRDB migration (timestamps as integer milliseconds) and a record struct whose coding keys match the server's JSON.",
          "iOS: add the field to <code>Changes</code> in <code>WireFormat.swift</code> and push and merge it in <code>SyncEngine.swift</code>.",
          "Deploy the server before shipping the app: the server rejects unknown JSON fields, so a newer app talking to an older server fails its push.",
        ], true), { edge: "amber" }))}`;
    },
  });

  /* ================= TESTS ================= */
  Coach.register({
    id: "tests", order: 7, group: "walk", title: "Tests", eyebrow: "Quality",
    lede: "26 automated tests across Go and Swift, focused on the parts where a bug would lose or corrupt data: validation, sync and timestamps.",
    render() {
      return `
        ${h.block("Coverage", h.panel(h.table(["Area", "Tests", "Covers"], [
          ["Server API", "6", "Health needs no token; 401 on missing or wrong token; pull parameter parsing and limits; push decoding; unknown fields and malformed JSON rejected; validation errors map to 400."],
          ["Server store", "3", "Field validation, migration ordering, and a round trip against real Postgres: idempotent migrations, re-push is stale, newer edit wins, older edit loses, paging with has_more. Needs <code>COACH_TEST_DATABASE_URL</code>."],
          ["iOS wire format", "4 (11 cases)", "Go timestamps with 0 to 9 fraction digits, offsets, invalid input, exact millisecond round trip, server field names only."],
          ["iOS repository", "6", "Start queues for sync, one active fast, end and goal changes bump updated_at, end never before start, tombstones, NULL written on update."],
          ["iOS sync engine", "6", "Push clears the queue, edits made mid-push stay queued, pull advances the cursor, newer remote edit wins, older remote copy ignored, paging."],
          ["iOS alerts", "1", "Which fasting alerts are scheduled for each preference."],
        ])))}
        ${h.block("Checked by hand only", h.list([
          "The fasting screens while a fast is running, and the Settings screen.",
          "Real notifications firing on a device.",
          "Sync from a device against the NAS (you confirmed it works).",
          "The Compose stack on the NAS, the Tailscale certificate, and the backup task.",
        ]))}
        ${h.block("How the tests are built", h.list([
          "Go: standard <code>testing</code>. API tests use <code>httptest</code> with a fake store, so they need no database. The store round trip is skipped unless a disposable database URL is given; it drops the schema, so never point it at real data.",
          "Swift: Swift Testing (<code>@Test</code>, <code>#expect</code>) against an in-memory GRDB database. <code>FakeServer</code> is an actor that applies the same last-writer-wins rule as Postgres, which lets sync be tested without a network.",
          "The millisecond bug found during the first test run is the reason timestamps are integers everywhere. The round-trip tests keep it from coming back.",
        ]))}
        ${h.block("Gaps to close", h.table(["Gap", "Planned in"], [
          ["No CI: tests only run when someone runs them", "<a href=\"#roadmap\">Phase 2 · Agent-ready repo and CI</a>"],
          ["Server and app tested separately, never together", "Phase 2: a contract test that runs the iOS JSON fixtures through the Go decoder"],
          ["No UI tests", "Phase 5 onward: snapshot or UI tests for the live ride screen, where layout matters most"],
          ["Backups and restores untested", "<a href=\"#roadmap\">Phase 1 · Hardening</a>"],
          ["Multi-user isolation", "Phase 4: tests that one user's token can never read another's rows"],
        ]))}`;
    },
  });

  /* ================= REVIEW ================= */
  const SEV = { now: ["crit", "Do soon"], plan: ["warn", "Plan for"], note: ["info", "Note"] };
  const FINDINGS = [
    ["now", "Backups have never been restored", "deploy", "P1",
      "backup.sh runs, but nothing proves a dump restores. A backup is only real once a restore has worked.",
      "Run the restore rehearsal in the Runbook once, then automate it: a weekly task that restores the newest dump to a scratch database and checks row counts."],
    ["now", "Tailscale node key expiry", "deploy", "P1",
      "Tailscale node keys expire after 180 days by default. When the coach machine's key expires, the phone and laptop lose the server until it re-authenticates.",
      "Disable key expiry for the coach machine in the admin console, or give it a tag (tagged machines don't expire)."],
    ["now", "Image versions float", "deploy", "P1",
      "tailscale/tailscale:stable, postgres:17 and golang:1.27 can change underneath you. A Postgres minor update is usually fine, but deploys aren't reproducible.",
      "Pin exact tags or digests and update them deliberately, ideally from an automated dependency PR."],
    ["now", "One token, full access, and Postgres on the tailnet", "security", "P1 · P4",
      "A single bearer token reads and writes everything, and Postgres is reachable from any device on the tailnet with the API's own database user.",
      "Phase 1: a read-only Postgres role for analysis and a Tailscale ACL restricting :5432 to your laptop. Phase 4: per-device tokens tied to users, revocable one at a time."],
    ["plan", "No CI", "tooling", "P2",
      "Tests only run when someone runs them, and the Postgres test is skipped unless a database is set up.",
      "GitHub Actions: Go tests with a Postgres service container, iOS tests on a GitHub-hosted macOS runner (free for a public repo), and an image build. Also the guardrail for agent-written changes."],
    ["plan", "Deploys are manual and there's only one environment", "deploy", "P3",
      "Every change went straight to the database holding your real data, by hand from the Mac.",
      "The pipeline is in the repo: images built in CI, deployed to dev automatically and to prod after approval, with backup and rollback. It takes effect once the one-time NAS setup in deploy/README.md is done."],
    ["plan", "Single-user data model", "data model", "P4",
      "No users table and no user_id on records. Adding them later means migrating every table that exists by then.",
      "Add users and devices now, while there is one table, and scope every query by the authenticated user."],
    ["plan", "Sync only runs while the app is open", "ios", "P5 · P7",
      "Changes made on the desktop won't reach the phone or its notifications until you open the app.",
      "Add a BGAppRefreshTask for periodic background sync. HealthKit background delivery (phase 7) gives more wake-ups."],
    ["plan", "Last-writer-wins trusts device clocks", "sync", "later",
      "updated_at comes from whichever device made the edit. A device with a slow clock can lose an edit it made later. Try the clock-skew case in the simulator.",
      "Fine for one person with NTP-synced devices. If it ever matters, use hybrid logical clocks or let the server stamp updated_at."],
    ["plan", "Two fasts can be active at once across devices", "data model", "P4",
      "The one-active-fast rule is checked locally. Starting a fast on two offline devices produces two running fasts after sync; the app shows the most recent.",
      "Decide the rule. Likely: when merging, if two fasts are active, end the older one at the newer one's start."],
    ["plan", "No request logging or uptime alert", "server", "P3",
      "The API logs only errors and startup. Nothing alerts you if the stack goes down or backups stop.",
      "A request-log middleware (method, path, status, duration, record counts) and a simple uptime check that notifies you."],
    ["plan", "No backup before migrations", "deploy", "P3",
      "Migrations run automatically when a new API image starts. A bad migration would run against live data with no fresh dump.",
      "The prod deploy script takes a backup before restarting the API."],
    ["note", "Database observation stops on error", "ios", "P5",
      "If the GRDB observation in AppModel.start throws, the loop ends and the UI stops updating, with only lastError set.",
      "Restart the observation after a short delay, or surface the failure more visibly."],
    ["note", "TEST LINK checks the token with a pull", "ios", "P4",
      "HTTPTransport.check confirms the token by pulling from an impossible cursor. It works but is indirect.",
      "Add GET /v1/me with accounts in phase 4 and use it for the check."],
    ["note", "Tombstones are kept forever", "sync", "later",
      "Deleted records stay as rows with deleted_at so every device learns about the deletion. Harmless at this scale.",
      "Purge tombstones older than every device's cursor if tables ever grow large."],
    ["note", "Generated Xcode project is committed", "ios", "—",
      "Coach.xcodeproj is generated from project.yml. Editing it in Xcode and then running xcodegen discards those edits.",
      "Make project changes in project.yml; run xcodegen after adding or removing files."],
  ];
  Coach.register({
    id: "review", order: 8, group: "walk", title: "Review", eyebrow: "Quality",
    lede: "An honest pass over what is built. Nothing here is broken today; these are what to address before the system holds data you can't afford to lose. Each finding names the roadmap phase that handles it.",
    render() {
      return `<div class="filters" role="group" aria-label="Filter findings" id="filters"></div>
        ${h.panel(`<div id="findings"></div>`)}`;
    },
    mount(main) {
      let filter = "all";
      const draw = () => {
        const counts = { all: FINDINGS.length };
        FINDINGS.forEach(([s]) => (counts[s] = (counts[s] || 0) + 1));
        $("#filters", main).innerHTML = [["all", "All"], ...Object.entries(SEV).map(([k, v]) => [k, v[1]])].map(([k, label]) =>
          `<button type="button" class="btn ghost" data-filter="${k}" aria-pressed="${filter === k}">${label} · ${counts[k] || 0}</button>`).join("");
        $("#findings", main).innerHTML = FINDINGS.filter(([s]) => filter === "all" || s === filter).map(([s, title, area, phase, what, fix]) =>
          `<div class="finding"><div>${h.chip(SEV[s][0], SEV[s][1])}</div>
            <div><h3>${esc(title)}</h3><p>${esc(what)}</p><p class="fix">${esc(fix)}</p>
            <div class="meta2"><span>area: ${esc(area)}</span><span>roadmap: ${phase.startsWith("P") ? `<a href="#roadmap">${esc(phase)}</a>` : esc(phase)}</span></div></div></div>`).join("");
      };
      main.addEventListener("click", (e) => {
        const b = e.target.closest("[data-filter]");
        if (!b) return;
        filter = b.dataset.filter;
        draw();
      });
      draw();
    },
  });
})();
