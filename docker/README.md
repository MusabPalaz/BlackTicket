# Black Ticket — Docker deployment

One Linux server, an internal network, an internal DNS name. Not exposed to the
internet.

```
browser ──https──▶ proxy (Caddy)  ──/api/*──▶ api ──▶ db
                         └────────/────────▶ web
                   migrate (one-shot) ──▶ db     [api waits for it]
```

One origin: the browser only ever talks to `https://ticketing.example.local`.
The web client calls the API through the relative path `/api/v1`, so CORS never
comes into play.

---

## Requirements

| | |
|---|---|
| Docker Engine | 24+ |
| Docker Compose | v2 (`docker compose`, no hyphen) |
| Server | Linux, static IP, internal DNS record |
| Certificate | From the organisation's own CA, for `PUBLIC_HOST` |

Docker Engine and Compose are open source and free (Apache 2.0). **Docker
Desktop** is the paid product; it is a Mac/Windows developer tool and is not used
on a server.

---

## First installation

```bash
git clone <repository> && cd <repository>/docker
cp .env.example .env
```

**1. Generate the secrets.** Generate each once and put it in the organisation's
secret store:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 48   # TOTP_ENCRYPTION_KEY
openssl rand -base64 32   # POSTGRES_PASSWORD
```

> ### TOTP_ENCRYPTION_KEY cannot be recovered
>
> This key decrypts every user's two-factor seed, the SSO client secret and the
> outbound mail password. Those are stored **encrypted** in the database; the
> key is not. A restore without the key gives a system where everyone's
> two-factor is broken, SSO cannot authenticate and mail cannot send, with no
> way to recover any of it.
>
> **Do not store it next to the backups.** One stolen folder must not yield both
> the data and the key.

**2. Set `PUBLIC_HOST`.** The name you registered in internal DNS, for example
`ticketing.example.local`. It must be identical in three places: `.env`, the
certificate's CN/SAN, and (if SSO is used) the redirect URI registered with the
identity provider. If one is an IP and another a name, SSO and the links in
e-mails break.

**3. Install the certificate.**

```
docker/certs/server.crt    certificate (intermediates appended)
docker/certs/server.key    its private key
```

No public CA can issue a certificate for an internal name, so Caddy is
configured not to attempt automatic certificates.

**4. Start.**

```bash
docker compose pull
docker compose up -d
docker compose ps
```

**5. Create the administrator account.** Once, on first installation:

```bash
docker compose run --rm \
  -e SEED_ADMIN_USERNAME=admin \
  -e SEED_ADMIN_PASSWORD='<temporary-password>' \
  -e SEED_ADMIN_EMAIL=admin@example.local \
  -e SEED_RECOVERY_PASSWORD='<temporary-password-2>' \
  -e SEED_RECOVERY_EMAIL=recovery@example.local \
  api node dist/seed.cjs
```

The passwords are temporary; changing them at first sign-in is mandatory. **The
seed is for first installation only** — it is never run on update; it would
overwrite data.

Without `SEED_RECOVERY_PASSWORD` the recovery account is **not created**, and the
seed says so in a single warning line. It is the only account that can sign in
with a local password once SSO is on (`mayUseLocalPassword`, see
`packages/shared/src/auth-policy.ts`); skip it at installation and there is no
way in when the identity provider fails.

**6. Lock the organisation domain.** In the interface, on the `Organisation Domain`
screen.

---

## Updating

```bash
sh update.sh             # to the TAG in .env, or to an offline bundle's release
sh update.sh v1.4.0      # to a specific release
```

The order of the script is not accidental:

1. **It backs up first.** Prisma has no down-migrations; if a release turns out
   wrong, the way back is a restore, and a backup taken *after* the migration is
   no way back.
2. It pulls the new images.
3. `up -d` runs the one-shot `migrate` service. The API only starts once that has
   **finished successfully**, so the schema is never older than the code talking
   to it.
4. It waits until the API reports healthy.

`migrate deploy` only applies pending migrations, in order. It does not reset and
drops no data. It is the only Prisma command this deployment runs: `migrate dev`,
`db push` and the seed are not on the image's update path at all.

**If you need to roll back a release**, the new migrations have already been
applied and the old code may not understand them. The right way back is not to
set `TAG` back in `.env`, but to restore the backup taken before the update.

---

## Backups

Manually:

```bash
docker compose run --rm backup
```

Scheduled — with the server's own scheduler, not with cron inside a container. A
backup that fails silently in a sidecar nobody watches is worse than none:

`/etc/systemd/system/blackticket-backup.service`
```ini
[Unit]
Description=Black Ticket database backup
[Service]
Type=oneshot
WorkingDirectory=/opt/blackticket/docker
ExecStart=/usr/bin/docker compose run --rm backup
```

`/etc/systemd/system/blackticket-backup.timer`
```ini
[Unit]
Description=Back up Black Ticket every night
[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
[Install]
WantedBy=timers.target
```

```bash
systemctl enable --now blackticket-backup.timer
systemctl list-timers blackticket-backup.timer
```

Backups are written to `BACKUP_DIR` and pruned after `BACKUP_KEEP_DAYS`. **The key
is not in the backup**; the script reminds you every time it runs.

### Restoring

```bash
docker compose stop api
docker compose exec -T db pg_restore -U blackticket -d blackticket \
  --clean --if-exists --no-owner < backups/blackticket-<timestamp>.dump
docker compose up -d
```

If the backup you restore is older than the code, `docker compose up -d` runs the
migration and brings the schema up to date. **Open it with the same
`TOTP_ENCRYPTION_KEY`**, or none of the encrypted secrets can be decrypted.

**Test** a restore from time to time; an untested backup is not a backup.

---

## Building a customer bundle

Do not hand a customer the `docker/` folder as it stands. The two Dockerfiles
and the nginx configuration in it are **build-time** files: the Dockerfiles need
the whole repository as build context, so a customer who tries
`docker compose build` gets a meaningless error, and the nginx config is already
baked into the web image and never read at runtime.

The bundle is built by a script, and **you must say where the images come from**:

```powershell
# The customer pulls from a registry
./docker/package.ps1 -Version v1.0.0 -Registry ghcr.io/<account>

# The images travel inside the bundle as tar files
./docker/package.ps1 -Version v1.0.0 -Offline
```

If neither is given, the script **refuses** to build the bundle. This is not a
convenience but the prevention of a bug that actually happened: a bundle pointing
at an address nobody published to fails on the customer's server with `denied`.
That reads like a permissions problem and is not one — the image never existed.
For the same reason `compose.yml` has no default image name; if `IMAGE_API` is
empty, compose stops and says so.

`-Offline` puts the images into the bundle with `docker save`, and when
`update.sh` sees an `images/` folder it loads from there instead of pulling. The
`IMAGE_API`/`IMAGE_WEB` written into `.env.example` must match exactly the names
`docker save` produced; the script sets them itself. It checks that the images
exist locally before packaging, rather than failing halfway through a 600 MB
export.

The customer README keeps its two start procedures between
`<!-- ONLINE:START/END -->` and `<!-- OFFLINE:START/END -->` markers, and the
script puts **only the one that applies** into the bundle. A bundle without an
`images/` folder that says "load the tar files in `images/`" hands the customer
an instruction that cannot work.

`-Readme` ships a different installation guide as `README.md`, for example a
translation for a customer who needs one. It must carry the same markers.

`update.sh` is written with LF line endings; in a shell script produced on Windows
and run on Linux, CRLF gives a confusing "bad interpreter" error. The zip is not
built with `Compress-Archive` either, but with entry names written with forward
slashes: Windows PowerShell writes backslashes, which the zip format forbids, and
some extractors then produce a single file named `certs\README.txt` instead of a
`certs/` folder.

## Troubleshooting

| Symptom | Where to look |
|---|---|
| The API does not start | `docker compose logs migrate` — if the migration fails, the API deliberately does not start |
| Certificate warning in the browser | The internal CA's root certificate has not been distributed to the clients |
| Error after SSO sign-in | Does the redirect URI match `PUBLIC_HOST` exactly? |
| Links in e-mails are wrong | `WEB_BASE_URL`, i.e. `PUBLIC_HOST`, is wrong |
| An empty frame on a dashboard | The application refuses to be embedded in an iframe; add it **as a link** |
| Slowness | `DATABASE_POOL_MAX`, and `docker compose stats` |

Logs: `docker compose logs -f api`

---

## Scale

Load test (see PLAN.md, Phase 8): a single API instance meets its targets with
800 registered accounts and **~40 concurrent analysts**. If you need more, the
application is stateless, so `docker compose up -d --scale api=3` with load
balancing in front of the proxy — no code change needed.
