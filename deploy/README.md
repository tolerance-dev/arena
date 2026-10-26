# Production server

Read this for deploys and ops work (Claude may do both, see CLAUDE.md).

- **Deploy** = Actions → deploy → Run workflow (`gh workflow run deploy`; `-f ref=<sha>` rolls back,
  `-f reset_db=true` wipes the DB — needed after any schema change). It builds backend, web and
  `tolerance-runtime` (= `arena-runtime:1`) into `ghcr.io/tolerance-dev` and runs `server.sh` on the host over SSH
  (secrets in the `production` environment).
- **Host**: UpCloud `STARTER-4xCPU-16GB` (pl-waw1, 3 GB swap, ~$34/month for the plan plus disk and IP; was
  `STARTER-2xCPU-4GB` until 2026-10-26), 81.27.103.131, `/opt/tolerance`, user `deploy`. Two runs at a time
  (`ARENA_RUN_CONCURRENCY`, default 2 in `compose.yml`): an agent may take 6 GB and 2 CPUs (`runs/worker.go`), the
  stack about 1 GB. A third needs more memory first. The account is prepaid: the API reports `credits` in cents. Nothing else lives there.
- **Backups**: `server.sh backup` dumps the DB to `/opt/tolerance/backups/` (newest 30 kept, same disk, not
  off-site): daily at 03:17 UTC from the `deploy` crontab (installed by every deploy) and before every deploy, so a
  `reset_db` deploy leaves `arena-<time>-pre-<sha>.dump` behind. After migrating, a reset loads users,
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
- Ports 80/443 accept only Cloudflare (iptables chain `TOLERANCE-CF-LOCK`), so the bare IP doesn't answer.
- Stack: api + gateway + web + postgres + caddy.
- **Live previews** are `https://p-<hex>.tolerance.cc`: a proxied wildcard `*` A record in Cloudflare and a
  Cloudflare Origin CA cert for `*.tolerance.cc` in `/opt/tolerance/origin-tls/` (both made once by hand, not by
  deploys; `server.sh` refuses to deploy without the cert).
- `/opt/tolerance/.env` holds the OAuth keys.
- **Sandbox hardening** (off until done by hand on the host; `ARENA_SANDBOX_RUNTIME`, `ARENA_SANDBOX_DISK` in
  `/opt/tolerance/.env`, read by api and gateway, `internal/sandbox`). Pause the queue in /admin first: restarting
  Docker kills running containers.
  - gVisor: install runsc from gVisor's apt repo (gvisor.dev/docs/user_guide/install), `sudo runsc install &&
    sudo systemctl restart docker`, check `docker run --rm --runtime=runsc --network none arena-runtime:1 node -v`,
    then set `ARENA_SANDBOX_RUNTIME=runsc` and deploy. Afterwards run the demo agent on each task and check it still
    gets every check (Chromium screenshots included); unset the variable to go back to runc.
  - Disk cap per container (`ARENA_SANDBOX_DISK=20G` → `--storage-opt size=`): only works when Docker's data dir is
    overlay2 on XFS mounted with `pquota`; on ext4 Docker refuses to create the containers, so every run would fail.
    Without it a single file is capped at 500 MB (`--ulimit fsize`).
