# Production server

Read this for deploys and ops work (Claude may do both, see CLAUDE.md).

- **Deploy** = Actions → deploy → Run workflow (`gh workflow run deploy`; `-f ref=<sha>` rolls back,
  `-f reset_db=true` wipes the DB — needed after any schema change). It builds backend, web and
  `tolerance-runtime` (= `arena-runtime:1`) into `ghcr.io/tolerance-dev` and runs `server.sh` on the host over SSH
  (secrets in the `production` environment).
- **Host**: UpCloud `STARTER-2xCPU-4GB` (pl-waw1, 30 GB disk, 3 GB swap, ~$21/month since 2026-10-20),
  81.27.103.131, `/opt/tolerance`, user `deploy`. Enough for one run at a time (`ARENA_RUN_CONCURRENCY=1`); more
  parallel runs need a bigger plan first. Nothing else lives there. No backups (no data to keep).
- `compose.yml` and `Caddyfile` are the server's source of truth. The Caddyfile also serves `mentor.nualimov.dev`
  (its stack is `/root/nualimov.dev`): keep that block.
- Ports 80/443 accept only Cloudflare (iptables chain `TOLERANCE-CF-LOCK`), so the bare IP doesn't answer.
- Stack: api + gateway + web + postgres + caddy.
- **Live previews** are `https://p-<hex>.tolerance.cc`: a proxied wildcard `*` A record in Cloudflare and a
  Cloudflare Origin CA cert for `*.tolerance.cc` in `/opt/tolerance/origin-tls/` (both made once by hand, not by
  deploys; `server.sh` refuses to deploy without the cert).
- `/opt/tolerance/.env` holds the OAuth keys.
