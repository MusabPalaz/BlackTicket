# Black Ticket — Installation

This bundle contains everything needed to install Black Ticket on your own
server. The application images come prebuilt; nothing is compiled on the server.

```
browser ──https──▶ proxy (Caddy)  ──/api/*──▶ api ──▶ database
                         └────────/────────▶ web
                   migrate (one-shot) ──▶ database
```

---

## Requirements

| | |
|---|---|
| Operating system | Linux |
| Docker Engine | 24 or later |
| Docker Compose | v2 (`docker compose`, no hyphen) |
| Network | A static IP and an internal DNS record |
| Certificate | From your organisation's own CA, for the `PUBLIC_HOST` below |
| Disk | 20 GB to start; the database grows over time |

Docker Engine and Compose are open source and free. Installation:
<https://docs.docker.com/engine/install/>

---

## Installation

### 1. Unpack the bundle

```bash
unzip blackticket-install-VERSION.zip -d /opt/blackticket
cd /opt/blackticket
```

### 2. Configure

```bash
cp .env.example .env
```

Open `.env`. **Required:**

`PUBLIC_HOST` — the internal DNS name the application is reached by, for example
`ticketing.example.local`. This name must be **identical in three places**: this
file, the certificate's CN/SAN, and, if you use single sign-on, the redirect URI
registered with your identity provider. If one is an IP and another a name,
sign-in and the links in e-mails break.

`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`TOTP_ENCRYPTION_KEY` — generate all four:

```bash
openssl rand -base64 48
```

> ## ⚠ TOTP_ENCRYPTION_KEY cannot be recovered if lost
>
> This key decrypts every user's two-factor seed, the single sign-on client
> secret and the outbound mail password. Those are stored **encrypted** in the
> database; the key is not.
>
> A restore without the key gives you a system where two-factor is broken for
> everyone, single sign-on does not work and mail cannot be sent, with no way
> to recover any of it.
>
> **Store all four in your organisation's password vault, and never in the same
> place as the backups.** A single stolen folder must not yield both the data
> and the key.

### 3. Install the certificate

```
certs/server.crt    the certificate (with any intermediates appended)
certs/server.key    its private key
```

No public certificate authority can issue a certificate for an internal DNS
name; get one from your own CA. Your root certificate must be distributed to
the users' machines, or the browser shows a warning.

<!-- ONLINE:START -->
### 4. Pull the images and start

```bash
docker compose pull
docker compose up -d
```

`docker compose pull` needs the server to reach the image registry. A `denied`
or `unauthorized` error means the server cannot reach the registry or is not
allowed to. In that case contact us: we can send the images as files, which
install without any internet access.
<!-- ONLINE:END -->
<!-- OFFLINE:START -->
### 4. Load the images and start

This bundle carries the images inside it; the server needs no internet access.
First load the tar files in the `images/` folder into Docker:

```bash
for f in images/*.tar; do docker load -i "$f"; done
```

Loading can take a few minutes. Then start:

```bash
docker compose up -d
```
<!-- OFFLINE:END -->

To check the state:

```bash
docker compose ps
```

Every service should be `running`, and `api` should be `healthy`. The `migrate`
service showing `exited (0)` is normal: it does its job and exits.

### 5. Create the administrator account

Once only, on first installation:

```bash
docker compose run --rm \
  -e SEED_ADMIN_USERNAME=admin \
  -e SEED_ADMIN_PASSWORD='a-temporary-password' \
  -e SEED_ADMIN_EMAIL=admin@example.local \
  -e SEED_RECOVERY_PASSWORD='another-temporary-password' \
  -e SEED_RECOVERY_EMAIL=recovery@example.local \
  api node dist/seed.cjs
```

Both passwords are temporary; each account is asked to change it at first sign-in.

> **Do not skip `SEED_RECOVERY_PASSWORD`.** It creates the recovery account, which
> cannot be deleted. If you turn on single sign-on (SSO) later, it is the **only**
> account that can still sign in with a local password; if the identity provider
> has a problem, there is no other way in. If you leave it out, the seed does not
> create the account and only mentions it in a single warning line.
>
> Keep its password **separate** from the administrator's, and do not use this
> account for day-to-day work.

You can now sign in at `https://PUBLIC_HOST`.

### 6. Lock the organisation domain

In the interface, open **Organisation domain**, enter your organisation's e-mail
domain and lock it. Every account created after the lock must be in that domain.

---

## Updating

```bash
./update.sh
```

In order, the script **backs up first**, fetches the new images (from the
registry or from the `images/` folder), updates the database schema, then
restarts the application and confirms that it is healthy.

Backing up first is deliberate: if a release causes trouble, the way back is a
restore, and a backup taken *after* the schema was updated is no way back.

The application **does not start** until the database schema has been updated.
So if an update stops halfway, the application does not try to run against the
old schema; it stops and tells you.

When a new release reaches you as a zip: keep your `.env` and `certs/`, replace
the rest of the bundle, and run `./update.sh`.

---

## Backups

A manual backup:

```bash
docker compose run --rm backup
```

Backups are written to the `BACKUP_DIR` folder set in `.env`, and those older
than `BACKUP_KEEP_DAYS` days are deleted.

**To back up every night automatically**, create two files:

`/etc/systemd/system/blackticket-backup.service`
```ini
[Unit]
Description=Black Ticket database backup
[Service]
Type=oneshot
WorkingDirectory=/opt/blackticket
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
sudo systemctl daemon-reload
sudo systemctl enable --now blackticket-backup.timer
```

> The backup file **does not contain the key.** Back up your `.env` file too,
> separately and somewhere else.

### Restoring

```bash
docker compose stop api
docker compose exec -T db pg_restore -U blackticket -d blackticket \
  --clean --if-exists --no-owner < BACKUP_DIR/blackticket-DATE.dump
docker compose up -d
```

Restore with the same `TOTP_ENCRYPTION_KEY`, or the encrypted data cannot be
decrypted.

**Test a restore a few times a year.** A backup that has never been restored is
not a backup.

---

## Troubleshooting

| Symptom | Where to look |
|---|---|
| `api` does not start | `docker compose logs migrate` — if the schema update fails, the application deliberately does not start |
| The browser shows a certificate warning | Your root certificate has not been distributed to the users' machines |
| The page does not open | Does `PUBLIC_HOST` resolve to this server in internal DNS, and is port 443 open? |
| Error after single sign-on | Does the redirect URI at the identity provider match `PUBLIC_HOST` exactly? |
| Links in e-mails are wrong | `PUBLIC_HOST` in `.env` is wrong |
| An empty frame on a dashboard | The application refuses to be embedded in another page, for security — add it **as a link** |
| Slowness | `docker compose stats`, and `DATABASE_POOL_MAX` in `.env` |

To follow the logs:

```bash
docker compose logs -f api
```

When asking for support, send: the output of `docker compose ps`, the output of
`docker compose logs --tail 200 api migrate`, and your `.env` file **with the
secrets removed**.

---

## Scale

This installation was measured with **800 registered users** and **about 40
analysts** working at the same time. If you need more, the application tier can
be scaled out:

```bash
docker compose up -d --scale api=3
```

No further configuration is needed, since the database and file system are shared.
