/* Sync page: protocol reference and a live simulator of the same rules. */
(function () {
  "use strict";
  const { h, $, $$ } = Coach;
  const { esc } = h;

  const PUSH_EX = `POST /v1/sync/push
Authorization: Bearer <COACH_API_TOKEN>
Content-Type: application/json

{
  "fasts": [{
    "id": "7f1c5e3a-2b4d-4c6e-8f00-112233445566",
    "started_at": "2026-11-02T16:30:00.123Z",
    "ended_at": null,
    "goal_seconds": 57600,
    "notes": "",
    "created_at": "2026-11-02T16:30:00.123Z",
    "updated_at": "2026-11-02T16:30:00.123Z",
    "deleted_at": null,
    "origin": "phone"
  }]
}

200 OK
{ "applied": ["7f1c5e3a-…"], "stale": [] }`;

  const PULL_EX = `GET /v1/sync/pull?since=41&limit=500
Authorization: Bearer <COACH_API_TOKEN>

200 OK
{
  "changes": { "fasts": [ { …same fields…, "server_seq": 42 } ] },
  "cursor": 42,
  "has_more": false
}`;

  Coach.register({
    id: "sync", order: 4, group: "walk", title: "Sync protocol", eyebrow: "Walkthrough",
    lede: "How the phone and the server agree. The reference covers the endpoints, the rules both sides enforce and the edge cases; the simulator runs those exact rules so you can try them.",
    render() {
      return `
        ${h.block("Endpoints", h.panel(h.table(["Method", "Path", "Auth", "Purpose"], [
          ["GET", "<code>/healthz</code>", "none", "Liveness check: <code>{\"status\":\"ok\"}</code>."],
          ["POST", "<code>/v1/sync/push</code>", "bearer", "Send changed records. Body up to 5 MB. Atomic: all or nothing."],
          ["GET", "<code>/v1/sync/pull?since=&amp;limit=</code>", "bearer", "Records with <code>server_seq &gt; since</code>, in order. limit 1 to 2000, default 500."],
        ])))}
        <div class="grid2">
          ${h.panel(`<pre>${esc(PUSH_EX)}</pre>`, { title: "Push", color: "var(--cyan)" })}
          ${h.panel(`<pre>${esc(PULL_EX)}</pre>`, { title: "Pull", color: "var(--mint)" })}
        </div>
        ${h.block("Rules both sides enforce", h.panel(h.list([
          "<b>Identity.</b> Records are created with a UUID on the device, so creation never needs the server.",
          "<b>Newer wins.</b> A write replaces the stored copy only if its <code>updated_at</code> is strictly greater. Ties and older versions change nothing (reported as stale).",
          "<b>Edits always move forward.</b> The app sets <code>updated_at = max(now, previous + 1 ms)</code>, so a quick second edit is never mistaken for a duplicate.",
          "<b>Exact time.</b> Timestamps travel as whole milliseconds. SQLite stores integers, JSON carries 3 fraction digits, Postgres keeps microseconds, and all three agree exactly.",
          "<b>Ordered changes.</b> Every applied write takes the next <code>server_seq</code>. Writers hold an advisory lock, so sequence numbers become visible in order and a pull can never skip one.",
          "<b>Deletes are records.</b> Deleting sets <code>deleted_at</code>; the tombstone syncs like any edit.",
          "<b>Strict schema.</b> The server rejects unknown fields and invalid values with a 400 that names the field, and writes nothing from that batch.",
        ]), { edge: "cyan" }))}
        ${h.block("Edge cases", h.panel(h.table(["Situation", "What happens"], [
          ["The response to a push is lost", "The record stays queued, is pushed again, and the server reports it stale. No duplicate, no harm."],
          ["You edit a fast while its push is in flight", "The queue entry survives because the stored <code>updated_at</code> no longer matches what was sent. The next sync pushes the new edit."],
          ["Phone offline for a week", "Edits pile up in <code>pending_change</code>. The next sync pushes them in batches of 200, then pulls 500 at a time until <code>has_more</code> is false."],
          ["Same fast edited on two devices", "Whichever edit has the later <code>updated_at</code> wins on the server and, after both sync, everywhere."],
          ["A device's clock is behind", "Its edits can lose to older edits from a device with a correct clock. Rare with NTP; see the simulator's clock-skew scenario."],
          ["Two devices each start a fast offline", "Both fasts exist after syncing; the app shows the most recently started. A merge rule is planned in phase 4."],
          ["A sync is interrupted mid-pull", "Each page commits its rows and cursor together, so the next sync resumes where it stopped."],
          ["App updated before the server", "The server rejects the unknown field and the push fails until the server is deployed. Deploy the server first."],
        ])))}
        ${h.block("Simulator", `
          <p class="muted">Two clients and the server, running the same push, pull and merge logic as <code>SyncEngine.swift</code> and <code>store/sync.go</code>. Time is in ticks; each client can have its clock skewed. Pick a scenario to set it up and run it, or drive it yourself.</p>
          <div class="btn-row" id="scenarios">
            <button class="btn ghost" type="button" data-scn="offline">Offline edit</button>
            <button class="btn ghost" type="button" data-scn="conflict">Conflict</button>
            <button class="btn ghost" type="button" data-scn="skew">Clock skew</button>
            <button class="btn ghost" type="button" data-scn="twofasts">Two active fasts</button>
            <button class="btn ghost" type="button" data-scn="midpush">Edit during push</button>
            <button class="btn amber" type="button" data-scn="reset">Reset</button>
          </div>
          <div class="callout cyan" id="scn-note"><p>Free play. Start a fast on the iPhone, then sync it.</p></div>
          <div class="sim-cols">
            ${h.panel(`<div id="c-phone"></div>`, { edge: "cyan" })}
            ${h.panel(`<div id="c-web"></div>`, { edge: "magenta" })}
            ${h.panel(`<div id="c-server"></div>`, { edge: "mint" })}
          </div>
          ${h.panel(`<div class="log" id="log" aria-live="polite"></div>`, { title: "Event log" })}`)}`;
    },
    mount(main) {
      let sim;
      const newClient = (name) => ({ name, rows: {}, pending: new Set(), cursor: 0, online: true, skew: 0, flash: new Set() });
      const log = (kind, msg) => { sim.log.unshift({ t: sim.tick, kind, msg }); sim.log = sim.log.slice(0, 120); };
      const now = (c) => { sim.tick++; return sim.tick + c.skew; };
      const active = (c) => Object.values(c.rows).filter((r) => !r.ended).sort((a, b) => b.started - a.started)[0];
      const localWrite = (c, row) => { c.rows[row.id] = row; c.pending.add(row.id); c.flash.add(row.id); };

      function reset(note) {
        sim = { tick: 1, server: { rows: {}, seq: 0, flash: new Set() }, clients: { phone: newClient("iPhone"), web: newClient("Web / MCP") }, log: [], nextId: 1, duringPush: null };
        log("info", "Reset. Both clients online, server empty.");
        $("#scn-note", main).innerHTML = `<p>${note || "Free play. Start a fast on the iPhone, then sync it."}</p>`;
      }
      const act = {
        start(key) {
          const c = sim.clients[key];
          if (active(c)) return log("err", `${c.name}: a fast is already running (FastError.alreadyActive).`);
          const t = now(c), id = "F" + sim.nextId++;
          localWrite(c, { id, goal: 16, ended: false, started: t, updated: t });
          log("info", `${c.name}: started ${id} (16h), updated_at=${t}. Queued.`);
        },
        goal(key) {
          const c = sim.clients[key], f = active(c);
          if (!f) return log("err", `${c.name}: no running fast to change.`);
          const t = Math.max(now(c), f.updated + 1);
          localWrite(c, { ...f, goal: f.goal + 1, updated: t });
          log("info", `${c.name}: ${f.id} goal → ${f.goal + 1}h, updated_at=${t}. Queued.`);
        },
        end(key) {
          const c = sim.clients[key], f = active(c);
          if (!f) return log("err", `${c.name}: no running fast to end.`);
          const t = Math.max(now(c), f.updated + 1);
          localWrite(c, { ...f, ended: true, updated: t });
          log("info", `${c.name}: ended ${f.id}, updated_at=${t}. Queued.`);
        },
        online(key) { const c = sim.clients[key]; c.online = !c.online; log("info", `${c.name} is now ${c.online ? "online" : "offline"}.`); },
        sync(key) {
          const c = sim.clients[key];
          sim.tick++;
          if (!c.online) return log("err", `${c.name}: sync failed, offline. ${c.pending.size} change(s) stay queued.`);
          const batch = [...c.pending].map((id) => ({ ...c.rows[id] })).filter((r) => r.id);
          if (batch.length) {
            if (sim.duringPush) { const hook = sim.duringPush; sim.duringPush = null; hook(); }
            const applied = [], stale = [];
            for (const r of batch) {
              const ex = sim.server.rows[r.id];
              if (ex && ex.updated >= r.updated) { stale.push(r.id); continue; }
              sim.server.seq++;
              sim.server.rows[r.id] = { ...r, seq: sim.server.seq };
              sim.server.flash.add(r.id);
              applied.push(`${r.id}→seq ${sim.server.seq}`);
            }
            const kept = [];
            batch.forEach((r) => { if (c.rows[r.id].updated === r.updated) c.pending.delete(r.id); else kept.push(r.id); });
            if (applied.length) log("ok", `${c.name} push: applied ${applied.join(", ")}.`);
            if (stale.length) log("stale", `${c.name} push: stale ${stale.join(", ")} (server copy is as new or newer).`);
            if (kept.length) log("info", `${c.name}: ${kept.join(", ")} changed during the push, so it stays queued.`);
          } else {
            log("info", `${c.name} push: nothing queued.`);
          }
          const newer = Object.values(sim.server.rows).filter((r) => r.seq > c.cursor).sort((a, b) => a.seq - b.seq);
          const took = [], keptLocal = [];
          for (const r of newer) {
            const local = c.rows[r.id];
            if (local && local.updated >= r.updated) { keptLocal.push(r.id); continue; }
            c.rows[r.id] = { id: r.id, goal: r.goal, ended: r.ended, started: r.started, updated: r.updated };
            c.pending.delete(r.id);
            c.flash.add(r.id);
            took.push(r.id);
          }
          const old = c.cursor;
          if (newer.length) c.cursor = newer[newer.length - 1].seq;
          log("ok", `${c.name} pull since ${old}: ${newer.length} row(s); took ${took.join(", ") || "none"}${keptLocal.length ? `, kept local ${keptLocal.join(", ")}` : ""}. Cursor → ${c.cursor}.`);
        },
      };

      const SCENARIOS = {
        offline: ["An edit made offline stays queued until the device can reach the server, then syncs normally.", [
          () => act.online("phone"), () => act.start("phone"), () => act.sync("phone"), () => act.online("phone"), () => act.sync("phone"), () => act.sync("web")]],
        conflict: ["Both clients edit the same fast without syncing. The web edit is made later, so it wins on the server and, after a second sync, on the iPhone too.", [
          () => act.start("phone"), () => act.sync("phone"), () => act.sync("web"), () => act.goal("phone"), () => act.goal("web"), () => act.goal("web"),
          () => act.sync("phone"), () => act.sync("web"), () => act.sync("phone")]],
        skew: ["Same as the conflict, but the web client's clock is 5 ticks behind. Its edit is made last yet carries an older updated_at, so it loses. This is the cost of trusting device clocks.", [
          () => { sim.clients.web.skew = -5; log("info", "Web / MCP clock skew set to -5."); },
          () => act.start("phone"), () => act.sync("phone"), () => act.sync("web"), () => act.goal("phone"), () => act.goal("web"),
          () => act.sync("phone"), () => act.sync("web"), () => act.sync("phone")]],
        twofasts: ["Both clients are offline and each starts a fast. After syncing, both fasts exist everywhere and both are running. Phase 4 adds a merge rule for this.", [
          () => act.online("phone"), () => act.online("web"), () => act.start("phone"), () => act.start("web"),
          () => act.online("phone"), () => act.online("web"), () => act.sync("phone"), () => act.sync("web"), () => act.sync("phone")]],
        midpush: ["The iPhone pushes a fast and, while the request is in flight, you change the goal. The sent version is applied, but the queue entry survives, so the newer edit goes out on the next sync.", [
          () => act.start("phone"),
          () => { sim.duringPush = () => { log("info", "(while the push is in flight…)"); act.goal("phone"); }; },
          () => act.sync("phone"), () => act.sync("phone")]],
      };

      function rowsTable(rows, opts) {
        const list = Object.values(rows).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        if (!list.length) return `<div class="empty">No fasts yet.</div>`;
        return `<div class="tablebox"><table><thead><tr><th>ID</th><th>Goal</th><th>State</th><th>updated</th><th>${opts.server ? "seq" : ""}</th></tr></thead><tbody>${list.map((r) =>
          `<tr${opts.flash.has(r.id) ? ' class="flash"' : ""}><td class="m">${r.id}</td><td class="m">${r.goal}h</td><td>${r.ended ? "ended" : '<span style="color:var(--amber)">running</span>'}</td><td class="m">${r.updated}</td><td>${opts.server ? `<span class="m">${r.seq}</span>` : opts.pending.has(r.id) ? '<span class="pend">QUEUED</span>' : ""}</td></tr>`).join("")}</tbody></table></div>`;
      }
      function clientPanel(key, color) {
        const c = sim.clients[key];
        return `<div class="dev-head"><h3 style="color:${color}">${c.name}</h3>
          <button type="button" class="online ${c.online ? "" : "off"}" data-act="online" data-c="${key}" aria-pressed="${c.online}"><i></i>${c.online ? "ONLINE" : "OFFLINE"}</button></div>
          <div class="meta"><span>cursor <b>${c.cursor}</b></span><span>queued <b>${c.pending.size}</b></span></div>
          <label class="skew" for="skew-${key}">clock skew <input type="range" id="skew-${key}" min="-5" max="5" step="1" value="${c.skew}" data-skew="${key}"><b>${c.skew > 0 ? "+" : ""}${c.skew}</b></label>
          <div class="btn-row" style="margin-bottom:10px">
            <button type="button" class="btn amber" data-act="start" data-c="${key}">Start</button>
            <button type="button" class="btn ghost" data-act="goal" data-c="${key}">Goal +1h</button>
            <button type="button" class="btn ghost" data-act="end" data-c="${key}">End</button>
            <button type="button" class="btn fill" data-act="sync" data-c="${key}">Sync</button>
          </div>
          ${rowsTable(c.rows, { pending: c.pending, flash: c.flash })}`;
      }
      function draw() {
        $("#c-phone", main).innerHTML = clientPanel("phone", "var(--cyan)");
        $("#c-web", main).innerHTML = clientPanel("web", "var(--magenta)");
        $("#c-server", main).innerHTML = `<div class="dev-head"><h3 style="color:var(--mint)">Server · Postgres</h3></div>
          <div class="meta"><span>sync_seq <b>${sim.server.seq}</b></span><span>rule <b>newer updated_at wins</b></span></div>
          ${rowsTable(sim.server.rows, { server: true, flash: sim.server.flash })}`;
        $("#log", main).innerHTML = sim.log.map((e) => `<div><span class="t">t=${e.t}</span><span class="${e.kind}">${esc(e.msg)}</span></div>`).join("");
        Object.values(sim.clients).forEach((c) => c.flash.clear());
        sim.server.flash.clear();
      }

      main.addEventListener("click", (e) => {
        const s = e.target.closest("[data-scn]");
        if (s) {
          const key = s.dataset.scn;
          if (key === "reset") { reset(); return draw(); }
          const [note, steps] = SCENARIOS[key];
          reset(`<b>${esc(s.textContent)}.</b> ${esc(note)} Read the log from the bottom up.`);
          steps.forEach((f) => f());
          return draw();
        }
        const b = e.target.closest("[data-act]");
        if (!b) return;
        act[b.dataset.act](b.dataset.c);
        draw();
      });
      main.addEventListener("input", (e) => {
        const r = e.target.closest("[data-skew]");
        if (!r) return;
        sim.clients[r.dataset.skew].skew = Number(r.value);
        r.nextElementSibling.textContent = (r.value > 0 ? "+" : "") + r.value;
      });
      main.addEventListener("change", (e) => {
        const r = e.target.closest("[data-skew]");
        if (!r) return;
        const c = sim.clients[r.dataset.skew];
        log("info", `${c.name} clock skew set to ${c.skew > 0 ? "+" : ""}${c.skew}.`);
        draw();
        const again = document.getElementById(r.id);
        if (again) again.focus();
      });
      reset();
      draw();
    },
  });
})();
