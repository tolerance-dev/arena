# Production server

Read this for deploys and ops work (Claude may do both, see CLAUDE.md).

- **Deploy** = Actions → deploy → Run workflow (`gh workflow run deploy`; `-f ref=<sha>` rolls back,
  `-f reset_db=true` wipes the DB — only to start over: schema changes are migrations, applied by every deploy). It builds backend, web and
  `tolerance-runtime` (= `arena-runtime:1`) into `ghcr.io/tolerance-dev` and runs `server.sh` on the host over SSH
  (secrets in the `production` environment).
- **Host**: UpCloud `STARTER-4xCPU-16GB` (pl-waw1, 3 GB swap, ~$34/month for the plan plus disk and IP; was
  `STARTER-2xCPU-4GB` until 2026-10-26), 81.27.103.131, `/opt/tolerance`, user `deploy`. Two runs at a time
  (`ARENA_RUN_CONCURRENCY`, default 2 in `compose.yml`): an agent may take 6 GB and 2 CPUs (`runs/worker.go`), the
  stack about 1 GB. A third needs more memory first. The account is prepaid: the API reports `credits` in cents. Nothing else lives there.
- **Backups**: `server.sh backup` dumps the DB to `/opt/tolerance/backups/` (newest 30 kept, same disk, not
  off-site): daily at 03:17 UTC from the `deploy` crontab (installed by every deploy) and before every deploy, so a
  deploy (a `reset_db` one too) leaves `arena-<time>-pre-<sha>.dump` behind. After migrating, a reset loads users,
  user_identities, sessions and agents back from that dump (all or nothing; if the columns changed it warns in the
  deploy log and leaves them in the dump). By hand: `bash server.sh restore backups/<dump> [table...]`.
- **Off-site copies** (off until set in `/opt/tolerance/.env`): each dump is also encrypted (`openssl`, AES-256,
  `BACKUP_PASSPHRASE`) and copied by rclone (the `rclone/rclone` image, nothing installed) to `BACKUP_REMOTE`, e.g.
  `offsite:tolerance-backups/arena`; copies older than 30 days are deleted there. The remote is `RCLONE_CONFIG_OFFSITE_*`
  lines, for Cloudflare R2: `_TYPE=s3`, `_PROVIDER=Cloudflare`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`,
  `_ENDPOINT=https://<account>.r2.cloudflarestorage.com`. Keep the passphrase somewhere other than the server too:
  without it the copies are useless. Get one back: `bash server.sh offsite-get arena-<time>.dump.enc`, then restore.
  A failed copy warns and doesn't fail the backup.
- `compose.yml` and `Caddyfile` are the server's source of truth. The Caddyfile also serves `mentor.nualimov.dev`
  (its stack is `/root/nualimov.dev`): keep that block.
- **Domains, DNS, the relay in Russia, what's left on Cloudflare**: see [Domains](#domains-bunny-the-relay-cloudflare)
  below.
- **Live previews** are `https://p-<hex>.tolerance.cc`: the `*` script record and the wildcard certificate (below).
- `/opt/tolerance/.env` holds the OAuth keys and `BUNNY_API_KEY`.
- **Hidden checks**: `/opt/tolerance/tasks-hidden/<task>/checks.json` (mounted into the worker and the api as
  `ARENA_TASKS_HIDDEN_DIR`, read at start). They run after the public checks on other records of the same data
  (picked at random when generated) and count in the score; the site shows them only as `hidden check N`, with no
  details. The repo is public, so these files are the secret: never commit them. Make a new set and copy it, then restart the worker
  and the api (the worker first finishes the runs in flight, up to an hour) or deploy:
  `python3 backend/internal/tasks/gen_data.py --hidden ~/tolerance-hidden && chmod -R a+rX ~/tolerance-hidden &&
  scp -r ~/tolerance-hidden/. deploy@81.27.103.131:/opt/tolerance/tasks-hidden/ &&
  ssh deploy@81.27.103.131 'cd /opt/tolerance && docker compose restart api worker'`.
  A new set changes the score of later runs only: compare runs checked with the same set.
- **Sandbox hardening** (off until done by hand on the host; `ARENA_SANDBOX_RUNTIME`, `ARENA_SANDBOX_DISK` in
  `/opt/tolerance/.env`, read by worker and gateway, `internal/sandbox`). Pause the queue in /admin first: restarting
  Docker kills running containers.
  - gVisor: **on since 2026-10-26** (runsc release-20261019.0 from gVisor's apt repo, `ARENA_SANDBOX_RUNTIME=runsc`).
    Installed with `runsc install --runtime runsc -- --overlay2=none && systemctl reload docker` (reload, not
    restart: `live-restore` is on anyway). `--overlay2=none` is required: gVisor's default keeps a container's file
    changes in sandbox memory, so `docker commit` (the snapshot) and `docker cp` (sources, /verify/out) see nothing and
    every run ends in infra_error. Names on a run's network don't resolve under gVisor (no embedded DNS), so
    `sandbox.Create` writes them into /etc/hosts. Checked: the demo agent on hotels → 37/37 with both screenshots, and
    the live preview, all under runsc. Back to runc: unset the variable and deploy.
  - Disk cap per container (`ARENA_SANDBOX_DISK=20G` → `--storage-opt size=`): only works when Docker's data dir is
    overlay2 on XFS mounted with `pquota`; on ext4 Docker refuses to create the containers, so every run would fail.
    Without it a single file is capped at 500 MB (`--ulimit fsize`).
- **Alerts** (`internal/alerts`, in the api): every 5 minutes, disk under 15% free, a spike of `infra_error` (3+ in an
  hour and half of the hour's runs), or a queued run waiting 30+ minutes with a slot free (queue not paused). Always
  logged (`"msg":"alert"`); also sent to Telegram when `ARENA_ALERT_TELEGRAM_TOKEN` (a bot from @BotFather) and
  `ARENA_ALERT_TELEGRAM_CHAT` (your chat id) are in `/opt/tolerance/.env`. Each kind repeats at most hourly. Uptime
  of the site itself needs an outside checker (#74).
- **Logs in Grafana Cloud** (off until set): the `alloy` service (profile `logs`, `config.alloy`) ships the stack's
  container logs (compose project `tolerance` only: not sandboxes, not the other site) to Grafana Cloud Loki. To turn
  on, add to `/opt/tolerance/.env`: `COMPOSE_PROFILES=logs`, `GRAFANA_LOKI_URL` (Grafana Cloud → Loki → Details:
  `https://logs-prod-…grafana.net/loki/api/v1/push`), `GRAFANA_LOKI_USER` (the numeric user there), `GRAFANA_LOKI_TOKEN`
  (an access policy token with `logs:write`), then deploy. Labels: `service`, `level`, `env`. Queries in Explore:
  `{service="api"} | json | status >= 500`, `{service=~"api|worker|gateway", level="ERROR"}`,
  `{service="api"} | json | msg="alert"`, `sum by (status) (count_over_time({service="api"} | json [5m]))`.
  Uptime: UptimeRobot watches https://tolerance.cc.

## Domains: Bunny, the relay, Cloudflare

Why it looks like this: Russian ISPs choke connections to foreign hosting after ~16 KB, Cloudflare's proxy included,
so the site needed a VPN in Russia. Until 2026-10-26 everything went through Cloudflare (DNS + proxy, #156 dropped
the proxy); now DNS is Bunny and Russia goes through a relay inside Russia (#184, #186, #188).

```
visitor ── DNS: tolerance.cc? ──► Bunny (kiki/coco.bunny.net, script tolerance-geo)
                                     │ country == RU          │ everyone else (VPN users included)
                                     ▼                        ▼
                         139.100.217.119 (Selectel)     81.27.103.131 (UpCloud)
                         HAProxy, TCP only ──────────────► Caddy: TLS, routing ──► web / api / gateway (previews)
                         443 with PROXY v2, 80 as is
```

**Bunny** (bunny.net, the owner's account) is only DNS here: no CDN, no pull zone, no DDoS shield.
- Registrar Namecheap; tolerance.cc's NS are `kiki.bunny.net` and `coco.bunny.net` (DNS zone 969831).
- tolerance.cc, www and `*` (so `p-<hex>` previews and `edge.tolerance.cc` too) are *script records*: Bunny runs
  the DNS edge script `tolerance-geo` (Edge Scripting, script 99095) for every query. It answers an A record from
  the visitor's country: RU → the relay, anything else → this host. TTL 60 s, so a change reaches people in a minute.
  `bunny-geo.js` is a read-only copy: edit the script in Bunny's dashboard (Edge Scripting → tolerance-geo), then
  mirror it here. Why not the relay for everyone: some VPNs can't reach Selectel at all.
- Certificates: Caddy (`tolerance-caddy` = caddy + `caddy-dns/bunny`, `caddy/Dockerfile`) gets Let's Encrypt
  certificates for tolerance.cc, www and the `*.tolerance.cc` wildcard through DNS-01, writing TXT records into the
  Bunny zone with `BUNNY_API_KEY` (Bunny's account API key) from `/opt/tolerance/.env`. `server.sh` refuses to
  deploy without it. A rotated key goes into `.env` and a deploy, or certificate renewals start failing.
- Check what Bunny answers: `dig +short tolerance.cc @kiki.bunny.net` (this host) and, as if from Russia,
  `dig +short +subnet=95.163.0.0/24 tolerance.cc @kiki.bunny.net` (the relay).

**The relay** (`139.100.217.119`, Selectel VM `tolerance-relay`: project "My First Project", ru-1b, SL1.1-1024 +
8 GB basic disk; SSH as root with the owner's key, from an address Selectel lets in). Selectel to UpCloud is a clean
datacenter link, so the 16 KB choke doesn't apply. HAProxy passes TCP 443 to this host with PROXY protocol v2 and
TCP 80 as is. TLS ends here, not there: the relay holds no certificate or secret. Caddy trusts the PROXY header only
from the relay's IP (`listener_wrappers` in the Caddyfile), so the api and logs see the real client; HTTP/3 is
off because the relay carries TCP only. The Selectel account is prepaid in rubles: keep the balance up or Russia
loses the site. Relay down → change the script to return `81.27.103.131` for everyone (Russia then needs a VPN
again until it's back). A new relay IP → change it in the script, `bunny-geo.js` and the Caddyfile's `allow`.

**Cloudflare** — what's left:
- Nothing for **nualimov.dev** either: its NS moved to Bunny too (zone 969837, registrar Namecheap). There
  mentor.nualimov.dev, the other site on this host, is a script record on the same `tolerance-geo` script, so it
  gets the same RU split; Caddy gets its certificate by HTTP-01. nualimov.dev and www are plain A records to this
  host, which serves no site for them. The Cloudflare zone is left over and answers nothing.
- **R2** for the off-site backups, if `BACKUP_REMOTE` points there (see Off-site copies above).
- The GitHub `production` secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are leftovers from the proxy days:
  nothing uses them now.
- Nothing about tolerance.cc lives in Cloudflare any more: no DNS, proxy, Origin CA certificate or cache purge.
