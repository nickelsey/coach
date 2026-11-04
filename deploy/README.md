# Deploying the backend

Three containers: Tailscale (`ts`), Postgres (`db`) and the Go API (`api`).
Nothing is published on the LAN. Clients reach the server at
`https://coach.<your-tailnet>.ts.net` over Tailscale.

## One-time Tailscale setup

1. In the Tailscale admin console, enable **MagicDNS** and **HTTPS certificates** (DNS page).
2. Create an auth key (Settings > Keys) and put it in `.env` as `TS_AUTHKEY`.
3. Install Tailscale on the iPhone and the laptop, signed in to the same tailnet.

## Synology (DS2419+II, DSM 7.2)

1. Install **Container Manager** from Package Center.
2. Copy the repo to the NAS, e.g. `/volume1/docker/coach` (the `server/` and `deploy/` folders are what's needed).
3. In `deploy/`, `cp .env.example .env` and fill it in. Set `DATA_DIR=/volume1/docker/coach/data`.
4. Build the API image **on the Mac** and load it onto the NAS (enable SSH in Control Panel > Terminal first):

   ```sh
   deploy/build-image.sh you@nas-hostname
   ```

   This cross-builds for linux/amd64, copies the image over, loads it and runs
   `docker compose up -d`. It asks for your NAS password for sudo.
   Without an argument it only writes `deploy/dist/coach-api.tar`, which you can
   load through Container Manager > Image > Add > From file instead.

   **Don't build on the NAS.** DSM's kernel has no seccomp support, so
   `docker compose up --build` (or a Container Manager project build) fails with
   `seccomp: config provided but seccomp not supported`. Running containers works fine.
5. Check it's up from the laptop: `curl https://coach.<tailnet>.ts.net/healthz` should return `{"status":"ok"}`.
   The first request can take a few seconds while the certificate is issued.
6. Schedule `backup.sh` (see the comment at the top of it).
7. Schedule `restore-check.sh` weekly (see [Backups](#backups)).

To deploy later, run `deploy/build-image.sh you@nas-hostname` again. It copies
the deploy files too, and backs up the database before restarting anything. If
the backup fails, nothing is deployed.

## Backups

`backup.sh` writes a nightly dump, and `restore-check.sh` proves the dumps work.
The check restores the newest dump into a scratch database and compares row
counts with the live one. It fails if the dump is missing, more than 26 hours
old, unreadable, or well short of the live data.

Run it once by hand on the NAS, from `deploy/`:

```sh
sudo sh restore-check.sh /volume1/backups/coach
```

Then add a weekly task in Control Panel > Task Scheduler, as root, with
**Send run details by email** and **only when the script terminates
abnormally** ticked (this needs DSM's email notifications set up):

```sh
/volume1/docker/coach/deploy/restore-check.sh /volume1/backups/coach
```

To check that the email arrives, point a one-off run at a broken dump:

```sh
mkdir /volume1/backups/coach-broken
head -c 4096 "$(ls -t /volume1/backups/coach/coach-*.dump | head -1)" \
  > /volume1/backups/coach-broken/coach-broken.dump
```

Temporarily set the task's path to `/volume1/backups/coach-broken`, run it from
Task Scheduler, then set it back and delete that folder.

To restore for real, stop the API and replace the database from a dump:

```sh
sudo /usr/local/bin/docker compose stop api
sudo /usr/local/bin/docker exec coach-db dropdb -U coach --force coach
sudo /usr/local/bin/docker exec coach-db createdb -U coach coach
sudo /usr/local/bin/docker exec -i coach-db pg_restore -U coach -d coach --exit-on-error \
  < /volume1/backups/coach/coach-YYYYMMDD-HHMMSS.dump
sudo /usr/local/bin/docker compose start api
```

## Tailscale tags and access

Tagged machines don't expire, and tags are what the access policy refers to.
Do these in order, so nothing loses access halfway:

1. In the admin console's Access Controls page, add the `tagOwners` block from
   `tailscale-policy.example.hujson`, leaving your existing rules alone.
2. On the Machines page, open the `coach` machine's menu and use **Edit ACL
   tags** to add `tag:coach-prod`. Check it now shows **Expiry disabled**, and
   that the phone still syncs.
3. Create a new auth key tagged `tag:coach-prod` and put it in `.env` as
   `TS_AUTHKEY`, for rebuilding the machine later.
4. Replace the default allow-everything rule with the `grants` and `hosts` from
   the example, filling in the laptop's Tailscale IP. Keep any rules you added
   for other machines.
5. Check it: the laptop can reach `coach.<tailnet>.ts.net:5432` with
   `nc -z coach.<tailnet>.ts.net 5432`, and the phone still syncs but can't
   open that port.

## Local development (Mac)

Use the same compose file with Docker Desktop running and a separate auth key
(it shows up as another `coach` node, e.g. `coach-1`). Or run only Postgres
and the API directly:

```sh
docker run -d --name coach-dev-db -e POSTGRES_PASSWORD=dev -p 127.0.0.1:5432:5432 postgres:17.11
cd server
DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres?sslmode=disable \
COACH_API_TOKEN=$(openssl rand -hex 32) go run ./cmd/api
```

Integration tests need a disposable database. They drop the schema:

```sh
COACH_TEST_DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres?sslmode=disable go test ./...
```

## Analysis access

Postgres is forwarded on the tailnet at `coach.<tailnet>.ts.net:5432`, for
psql, Python notebooks and the like. Use the read-only `analyst` role, not the
`coach` user the API uses. Create it once on the NAS, from `deploy/` (the
password prompt is silent; `openssl rand -hex 32` makes a good one):

```sh
read -rs ANALYST_PASSWORD; export ANALYST_PASSWORD
sudo -E /usr/local/bin/docker exec -i -e ANALYST_PASSWORD coach-db \
  psql -U coach -d coach < sql/analyst-role.sql
unset ANALYST_PASSWORD
```

Then connect from the laptop:

```sh
psql "postgres://analyst@coach.<tailnet>.ts.net:5432/coach?sslmode=disable"
```

The tailnet encrypts the connection, which is why `sslmode=disable` is fine here.

## Moving to a Mac mini later

Stop the project, copy `DATA_DIR` and `.env`, and run `docker compose up -d`
on the new machine. The tailnet name stays `coach` as long as the `tailscale`
state directory comes along.
