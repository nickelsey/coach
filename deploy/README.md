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

To deploy a new API version later, run `deploy/build-image.sh you@nas-hostname` again.

## Local development (Mac)

Use the same compose file with Docker Desktop running and a separate auth key
(it shows up as another `coach` node, e.g. `coach-1`). Or run only Postgres
and the API directly:

```sh
docker run -d --name coach-dev-db -e POSTGRES_PASSWORD=dev -p 127.0.0.1:5432:5432 postgres:17
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
psql, Python notebooks and the like. Consider creating a read-only role for
analysis, separate from the `coach` user the API uses.

## Moving to a Mac mini later

Stop the project, copy `DATA_DIR` and `.env`, and run `docker compose up -d`
on the new machine. The tailnet name stays `coach` as long as the `tailscale`
state directory comes along.
