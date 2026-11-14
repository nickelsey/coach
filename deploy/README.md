# Deploying the backend

Three containers per environment: Tailscale (`ts`), Postgres (`db`) and the Go
API (`api`). Nothing is published on the LAN. Clients reach prod at
`https://coach.<your-tailnet>.ts.net` and dev at
`https://coach-dev.<your-tailnet>.ts.net`, over Tailscale.

## How a deploy works

1. A push to `main` that touches `server/` or `deploy/` runs
   `.github/workflows/server.yml`: tests, then an image build pushed to
   `ghcr.io/nickelsey/coach-api`. (The NAS can't build images: DSM's kernel has
   no seccomp support.)
2. The workflow joins the tailnet and SSHes to the NAS with a key that can run
   exactly one command, `coach-deploy`, for one environment.
3. `coach-deploy` checks the commit is on `main`, downloads `deploy/` at that
   commit from GitHub, and runs that commit's `deploy.sh`. Nothing is copied to
   the NAS by hand, and the scripts on the NAS always match the running image.
4. `deploy.sh` backs up prod, starts the new image, and waits for `/healthz` to
   report the new commit. If it doesn't within a minute, it starts the previous
   release again and the workflow fails.
5. Dev deploys on every push. Prod waits for your approval in GitHub, then
   gets the same image.

On the NAS, each environment is a folder:

```
/volume1/docker/coach/
  bin/coach-deploy         installed once, by hand
  prod/
    .env                   secrets and settings (see .env.example)
    data/                  Postgres and Tailscale state
    releases/<commit>/     deploy/ from the repo at that commit (last five)
    current -> releases/<commit>
    release.env            the commit and image that are live
  dev/                     the same again
```

Scheduled tasks use `prod/current/deploy/...`, so they follow each deploy.
For anything by hand, `compose.sh` wraps `docker compose` with the right
project and files:

```sh
cd /volume1/docker/coach/prod/current/deploy
sudo sh compose.sh prod ps
sudo sh compose.sh dev logs -f api
```

To deploy or roll back by hand, run `coach-deploy` with a commit and digest
from a workflow run's summary page:

```sh
sudo /volume1/docker/coach/bin/coach-deploy prod <commit-sha> sha256:<digest>
```

## One-time setup

### 1. Tailscale basics

1. In the Tailscale admin console, enable **MagicDNS** and **HTTPS certificates** (DNS page).
2. Install Tailscale on the iPhone and the laptop, signed in to the same tailnet.

### 2. First image

Push to `main` and let the workflow's `test` and `image` jobs finish (the
deploy jobs stay off until step 6). Then, on GitHub, open the `coach-api`
package's settings and change its visibility to **Public**, so the NAS can pull
it without a login. The image holds only the compiled server; all secrets stay
in the `.env` files on the NAS.

### 3. Install coach-deploy on the NAS

Needs **Container Manager** from Package Center, and SSH enabled in Control
Panel > Terminal.

```sh
sudo mkdir -p /volume1/docker/coach/bin
sudo curl -fsSL -o /volume1/docker/coach/bin/coach-deploy \
  https://raw.githubusercontent.com/nickelsey/coach/main/deploy/nas/coach-deploy
sudo chown root:root /volume1/docker/coach/bin/coach-deploy
sudo chmod 755 /volume1/docker/coach/bin/coach-deploy
```

Read it before trusting it: it is the only thing CI can run. It rarely
changes; reinstall it the same way if it does.

### 4. Prod

**Moving the existing install** (the one started from `/volume1/docker/coach/deploy`).
Take a backup first, then stop the old project and move its data and `.env`.
Nothing is deleted, and the tailnet name and certificate carry over with the data:

```sh
cd /volume1/docker/coach/deploy
sudo sh backup.sh /volume1/backups/coach
sudo /usr/local/bin/docker compose down
sudo mkdir -p /volume1/docker/coach/prod
sudo mv /volume1/docker/coach/data /volume1/docker/coach/prod/data   # wherever DATA_DIR pointed
sudo mv .env /volume1/docker/coach/prod/.env
sudo chown root:root /volume1/docker/coach/prod/.env
sudo chmod 600 /volume1/docker/coach/prod/.env
```

Edit `/volume1/docker/coach/prod/.env`: set
`DATA_DIR=/volume1/docker/coach/prod/data`, and add `TS_HOSTNAME=coach` and
`BACKUP_DIR=/volume1/backups/coach`. Then deploy, using the commit and digest
from the workflow run's summary:

```sh
sudo /volume1/docker/coach/bin/coach-deploy prod <commit-sha> sha256:<digest>
curl https://coach.<tailnet>.ts.net/healthz   # from the laptop: {"status":"ok","version":"<commit-sha>"}
```

Check the phone still syncs, then delete the old `/volume1/docker/coach/deploy`
and `server` folders, and point any existing backup task at the new path (see
[Backups](#backups)).

**A fresh install** is the same without the move: create `prod/.env` from
`.env.example`, then run `coach-deploy`.

### 5. Dev

Dev is a second copy with its own tailnet machine, database and secrets. It
holds test data only; never copy prod's data into it.

1. Create a Tailscale auth key tagged `tag:coach-dev` (add the tag owners from
   `tailscale-policy.example.hujson` first).
2. Create `/volume1/docker/coach/dev/.env` from `.env.example` (root-owned,
   mode 600) with `TS_HOSTNAME=coach-dev`, that key, fresh passwords and
   `DATA_DIR=/volume1/docker/coach/dev/data`. Leave `BACKUP_DIR` out.
3. `sudo /volume1/docker/coach/bin/coach-deploy dev <commit-sha> sha256:<digest>`

### 6. Let CI deploy

1. **Put the NAS itself on the tailnet.** Install Tailscale from Package
   Center, add the `tag:nas` and `tag:ci` owners and grants from
   `tailscale-policy.example.hujson`, then on the NAS run
   `sudo tailscale up --advertise-tags=tag:nas`. This is a separate machine
   from the `coach` containers.
2. **Give CI a way onto the tailnet.** In the admin console, create an OAuth
   client (Settings > OAuth clients) with write access to auth keys and the tag
   `tag:ci`. Runners join as short-lived `tag:ci` machines that can reach
   only SSH on the NAS.
3. **Create the deploy user.** In DSM, add a user `coach-deploy` with a long
   random password you never use, in the `administrators` group (DSM only
   lets administrators use SSH), and enable the user home service (Control
   Panel > User & Group > Advanced).
4. **Make one SSH key per environment**, on the laptop:

   ```sh
   ssh-keygen -t ed25519 -N '' -C coach-deploy-dev -f coach-deploy-dev
   ssh-keygen -t ed25519 -N '' -C coach-deploy-prod -f coach-deploy-prod
   ```

   On the NAS, put the two public keys in
   `/var/services/homes/coach-deploy/.ssh/authorized_keys`, each tied to its
   environment, so the dev key can never deploy to prod:

   ```
   command="sudo /volume1/docker/coach/bin/coach-deploy dev $SSH_ORIGINAL_COMMAND",restrict ssh-ed25519 AAAA... coach-deploy-dev
   command="sudo /volume1/docker/coach/bin/coach-deploy prod $SSH_ORIGINAL_COMMAND",restrict ssh-ed25519 AAAA... coach-deploy-prod
   ```

   sshd ignores the file unless the permissions are strict:

   ```sh
   cd /var/services/homes/coach-deploy
   sudo chown -R coach-deploy:users .ssh
   sudo chmod 755 . && sudo chmod 700 .ssh && sudo chmod 600 .ssh/authorized_keys
   ```

5. **Allow that one command as root**, without a password:

   ```sh
   echo 'coach-deploy ALL=(root) NOPASSWD: /volume1/docker/coach/bin/coach-deploy' |
     sudo tee /etc/sudoers.d/coach-deploy
   sudo chmod 440 /etc/sudoers.d/coach-deploy
   ```

   A DSM update can remove this file. If deploys start failing with a sudo
   password prompt, add it again.
6. **Test it from the laptop.** This should print `coach-deploy: bad commit sha`
   and nothing else should be possible with the key:

   ```sh
   ssh -i coach-deploy-dev coach-deploy@<nas-tailscale-ip> nope nope
   ```

7. **Set up GitHub.** In the repo's settings, create environments `dev` and
   `prod`, both limited to the `main` branch, and add yourself as a required
   reviewer on `prod`. Give each environment these secrets:

   | Secret | Value |
   | --- | --- |
   | `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` | the OAuth client from step 2 |
   | `DEPLOY_SSH_KEY` | that environment's private key file |
   | `NAS_SSH` | `coach-deploy@<nas-tailscale-ip>` |
   | `NAS_KNOWN_HOSTS` | the output of `ssh-keyscan -t ed25519 <nas-tailscale-ip>` |

   Then delete the private key files from the laptop, and add a repository
   variable `DEPLOY_ENABLED` set to `true`. The next push to `main` deploys to
   dev and waits for your approval for prod.

## Backups

`backup.sh` writes a nightly dump, and `restore-check.sh` proves the dumps work.
The check restores the newest dump into a scratch database and compares row
counts with the live one. It fails if the dump is missing, more than 26 hours
old, unreadable, or well short of the live data.

Both run from Control Panel > Task Scheduler as root. The nightly backup:

```sh
/volume1/docker/coach/prod/current/deploy/backup.sh /volume1/backups/coach
```

Include `/volume1/backups/coach` in a Hyper Backup task for an off-box copy.
Every prod deploy also takes a backup first, and stops if it fails.

The weekly restore check, with
**Send run details by email** and **only when the script terminates
abnormally** ticked (this needs DSM's email notifications set up):

```sh
/volume1/docker/coach/prod/current/deploy/restore-check.sh /volume1/backups/coach
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
cd /volume1/docker/coach/prod/current/deploy
sudo sh compose.sh prod stop api
sudo sh compose.sh prod exec -T db dropdb -U coach --force coach
sudo sh compose.sh prod exec -T db createdb -U coach coach
sudo sh compose.sh prod exec -T db pg_restore -U coach -d coach --exit-on-error \
  < /volume1/backups/coach/coach-YYYYMMDD-HHMMSS.dump
sudo sh compose.sh prod start api
```

## Tailscale tags and access

Tagged machines don't expire, and tags are what the access policy refers to.
Do these in order, so nothing loses access halfway:

1. In the admin console's Access Controls page, add the `tagOwners` block from
   `tailscale-policy.example.hujson`, leaving your existing rules alone.
2. On the Machines page, open the `coach` machine's menu and use **Edit ACL
   tags** to add `tag:coach-prod`. Check it now shows **Expiry disabled**, and
   that the phone still syncs.
3. Create a new auth key tagged `tag:coach-prod` and put it in `prod/.env` as
   `TS_AUTHKEY`, for rebuilding the machine later.
4. Replace the default allow-everything rule with the `grants` and `hosts` from
   the example, filling in the laptop's Tailscale IP. Keep any rules you added
   for other machines.
5. Check it: the laptop can reach `coach.<tailnet>.ts.net:5432` with
   `nc -z coach.<tailnet>.ts.net 5432`, and the phone still syncs but can't
   open that port.

## Local development (Mac)

To run the whole stack, fill in a `deploy/.env` with its own auth key and
`TS_HOSTNAME`, then `docker compose -p coach-local --env-file .env up --build`
from `deploy/`. Usually it's enough to run only Postgres and the API directly:

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
`coach` user the API uses. Create it once on the NAS, from
`/volume1/docker/coach/prod/current/deploy` (the
password prompt is silent; `openssl rand -hex 32` makes a good one):

```sh
read -rs ANALYST_PASSWORD; export ANALYST_PASSWORD
sudo -E sh compose.sh prod exec -T -e ANALYST_PASSWORD db \
  psql -U coach -d coach < sql/analyst-role.sql
unset ANALYST_PASSWORD
```

Then connect from the laptop:

```sh
psql "postgres://analyst@coach.<tailnet>.ts.net:5432/coach?sslmode=disable"
```

The tailnet encrypts the connection, which is why `sslmode=disable` is fine here.

## Moving to a Mac mini later

Stop each environment (`compose.sh <env> down`), copy `/volume1/docker/coach`
across, install Docker, and repeat step 6 for the new machine. The tailnet
names stay the same as long as the `data/tailscale` folders come along. The
scripts assume `/volume1/docker/coach`. If that changes, set `ROOT` in
`coach-deploy`, and `COACH_ROOT` for scheduled tasks and `compose.sh`.
