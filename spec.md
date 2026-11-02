# Coach — Spec (draft 2)

A personal fitness app for one user: workouts, fasting, health metrics, and later diet. The data lives in a backend the user owns. A laptop, a web UI or an LLM can read it and write to it. The original notes are in `inital_spec.md`.

## Decisions so far

| Area | Decision |
|---|---|
| Platform | Native SwiftUI iPhone app, plus a minimal Apple Watch companion that arrives with lifting |
| Storage | Local-first: SQLite on the device, and the app works fully offline |
| Sync | Opportunistic background sync to a home server reached over Tailscale |
| Backend | Postgres plus a small HTTP API on the home server. Keep the schema portable so it can move to managed Postgres (e.g. Supabase) later |
| Languages | iOS/watchOS: Swift (SwiftUI). API and MCP server: Go. Web app: TypeScript. Ad-hoc analysis: Python against Postgres |
| Home server | Synology DS2419+II for now (x86, Docker via Container Manager; Tailscale runs as a container). May move to a Mac mini later, so everything runs in containers |
| Units | Both. Store SI units internally; imperial or metric is a display preference |
| Export | None for now (no Strava, FIT export and the like) |
| Source of truth | The backend. HealthKit is imported into it, and the app's own workouts are written back to HealthKit |
| LLM integration | An MCP server on the home server, so Claude Desktop / Claude Code can query history and write plans |
| Desktop | A web app served from the home server, reachable over Tailscale |
| Workouts | Structured (intervals, sets, segments), built one type at a time, cycling first |
| Trainer | Record only in v1. The design leaves room for ERG / target control later |
| Fasting v1 | Start/stop, a timer, a goal, notifications. No history, widgets or Live Activity yet |
| Diet v1 | Fasting only. Diet logging comes later |
| Lifting | Sets logged live, on the Watch where possible, otherwise on the phone |
| Running | Both outdoor (GPS) and treadmill (Bluetooth FTMS where available) |
| Visual style | Retro "NEON//OS": chamfered panels, purple grid, glowing cyan/magenta/amber, segmented bars, monospace data, text-only tab bar. Scanlines are a user setting (on by default) |

Mockups: https://claude.ai/artifact/96T2a41yw2PCG3S9DBhFs4 (the second row is the chosen direction)

## Architecture

```
 iPhone app (SwiftUI)                 Home server (on the tailnet only)
 ┌───────────────────────┐            ┌──────────────────────────────┐
 │ UI                    │            │ HTTP API  ──┐                │
 │ Recording engine      │   sync     │ MCP server ─┼─> Postgres     │
 │ BLE sensor layer      │ <────────> │ Web app  ───┘                │
 │ HealthKit bridge      │ (Tailscale)│ Backups                      │
 │ SQLite + sync outbox  │            └──────────────────────────────┘
 └──────────┬────────────┘                  ^               ^
            │ WatchConnectivity             │ Tailscale     │ MCP (stdio/HTTP)
 ┌──────────┴────────────┐            Laptop browser    Claude Desktop / Code
 │ Watch app (later)     │
 └───────────────────────┘
```

### iOS app
- **Local DB:** SQLite through GRDB. GRDB gives explicit SQL and migrations, and that control makes the sync logic simpler than it would be with SwiftData.
- **Sensors (CoreBluetooth):** standard GATT profiles: Heart Rate (0x180D), Cycling Power (0x1818), Cycling Speed & Cadence (0x1816), and Fitness Machine / FTMS (0x1826) for trainers and treadmills. FTMS is also the way to control a trainer later.
- **Tymewear:** the VitalPro HR strap is a normal BLE/ANT+ heart-rate strap. The breathing sensor is BLE-only and uses a proprietary, undocumented service: Garmin and Wahoo support it through vendor integrations, not a standard profile. See *Tymewear plan* below.
- **Background:** the `bluetooth-central` background mode keeps a recording going with the screen locked. Save samples to disk as they arrive so a crash doesn't lose the ride.
- **HealthKit:** import sleep, HRV, resting HR, weight and workouts recorded by other apps. Export finished workouts with HR and energy.
- **Notifications:** scheduled locally on the device, such as the fasting goal, T-minus alerts and workout reminders. No push server is needed.

### Sync model
- Every row has a client-generated UUID, `created_at`, `updated_at`, a `deleted_at` tombstone and an `origin` (`phone`, `watch`, `web`, `mcp`).
- The phone keeps an **outbox** of local changes and pushes them when the server is reachable. It pulls everything changed since the last sync cursor.
- Conflicts are resolved last-writer-wins per record. There's little to conflict over in practice: recordings come from the phone, and plans mostly come from the desktop or MCP.
- Plan changes made off the phone show up as an **"incoming changes" review** in the app, not as silent edits.
- Sample streams (per-second power, HR, cadence, breathing) are stored as compressed chunks per recording instead of one row per sample.

### Backend
- Go services: the HTTP API and the MCP server (official Go MCP SDK), sharing one data-access package. Each is a single static binary in a small container.
- Deployment: Docker Compose on the Synology (Postgres, API, MCP server, web app), with data on a NAS volume. The same compose file moves to a Mac mini unchanged.
- Plain Postgres with nothing vendor-specific, so moving to Supabase later is just a data migration.
- Network: a Tailscale container in the Compose project joins the tailnet as `coach` and serves HTTPS (with a real certificate, which iOS requires) to the API. Postgres is forwarded on the tailnet for analysis tools. Nothing is published on the LAN.
- Auth: a bearer token for now, with Tailscale providing the network-level security. Per-device tokens can come later.
- Backups: a nightly `pg_dump` to a NAS share, picked up by Synology Hyper Backup for an off-box copy.

### MCP server
Starting tools:
- `get_profile` / `update_profile` (FTP, HR zones, weight)
- `list_workouts(from, to, type)` and `get_workout(id)`, including summaries and downsampled streams
- `get_metrics(kind, from, to)` for sleep, HRV, resting HR, fasting
- `create_plan`, `update_plan`, `schedule_workout`, validated against the workout schema
- `get_schema(type)`, so the LLM always writes valid structured workouts

Privacy note: anything the MCP tools return goes to the LLM provider during that session. Tools should return summaries by default and full streams only when asked.

## Structured workouts

There's one JSON schema per workout type, and it's both the storage format and what an LLM writes. Cycling comes first. Here is a draft:

```json
{
  "type": "cycling",
  "schema_version": 1,
  "name": "Sweet Spot 3x12",
  "target_basis": "ftp_fraction",
  "steps": [
    { "kind": "warmup",   "duration_s": 600, "power": { "from": 0.50, "to": 0.75 } },
    { "kind": "repeat", "count": 3, "steps": [
      { "kind": "work",     "duration_s": 720, "power": { "low": 0.88, "high": 0.93 }, "cadence": { "low": 85, "high": 95 } },
      { "kind": "recovery", "duration_s": 300, "power": { "value": 0.55 } }
    ]},
    { "kind": "cooldown", "duration_s": 600, "power": { "from": 0.65, "to": 0.45 } }
  ],
  "notes": "Stay seated, smooth cadence."
}
```

- Targets are fractions of FTP, resolved against the profile when the ride starts. This keeps old plans valid after an FTP change. The profile keeps an FTP history.
- Each step can have alerts, such as a cue a few seconds before the next step.
- Lifting (sets × reps × load / RPE), running (segments by time or distance, with pace or HR targets) and mobility (holds and flows) get their own schemas when we reach them.

## Tymewear plan

The breathing data (breath rate, tidal volume, minute ventilation) is the only sensor without a public protocol. Try these in order:

1. **Ask Tymewear.** They already integrate with Garmin, Wahoo and Apple Watch, so a partner or developer BLE spec exists. Email support or partnerships and ask for the breathing sensor's GATT service and data format for a personal app.
2. **Inspect your own device.** Use a BLE explorer (nRF Connect or LightBlue) to list its services and characteristics, and see whether the notifications are readable. Only for personal use with your own device, and check Tymewear's terms first.
3. **Fallback:** record breathing through Tymewear's own path (their app, or Garmin/Wahoo, which write breathing fields into the FIT file), then import that file afterwards and merge it onto the ride by timestamp. Live breathing would then be missing from the ride screen, but the data would still reach the backend.

The sensor layer treats Tymewear as an optional plugin, so cycling recording doesn't wait on this.

## Data model sketch (v1)

- `profile`: FTP history, HR zones, display units (imperial/metric)
- `fast`: start, end, goal duration, notes
- `workout_plan`: type, JSON body, `schema_version`, origin
- `scheduled_workout`: plan id, date/time, status (planned / done / skipped)
- `recording`: type, start, end, scheduled_workout id, summary stats, sensors used, HealthKit UUID
- `recording_stream`: recording id, channel (power / hr / cadence / breath_rate / ventilation / gps), compressed chunk
- `metric_sample`: kind (sleep, hrv, rhr, weight…), timestamp, value, source
- `sensor_device`: BLE identifier, type, name, last seen

## Milestones

1. **Foundation:** Xcode project; design-system components (chamfered panel, segmented bar, glowing text, tab bar); GRDB setup; home server running Postgres and the API; Tailscale; one entity syncing end to end.
2. **Fasting:** start/stop, goal, notifications, the Today card. Synced.
3. **Cycling recording:** BLE pairing; HR, power, cadence and FTMS data; Tymewear if feasible; the live ride screen; save, export to HealthKit, sync streams.
4. **Structured cycling:** the schema; the plan calendar (Train tab); running a workout with targets shown (no ERG); the MCP server with plan tools; the incoming-changes review.
5. **Health import:** HealthKit sleep / HRV / RHR into the Body tab and the Today vitals.
6. **Web app v1:** calendar, plan editor, ride analysis charts.

Later, roughly in order: ERG / trainer control; lifting plus the Watch app; running (GPS plus treadmill); mobility; diet logging; Live Activities and widgets.

## Open questions

- Synology model: Container Manager needs a supported (mostly x86 "+" series) model.
- Tymewear: the answer from Tymewear, or what a BLE scan shows.
- Web framework (React, Svelte…), to decide at milestone 6.
- Minimum iOS version: assume the newest only.
