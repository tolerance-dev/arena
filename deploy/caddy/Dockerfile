# Caddy with the Cloudflare DNS module: the certificates (the *.tolerance.cc wildcard for the previews among them)
# come from Let's Encrypt through DNS-01, which needs it. Built by deploy.yml as tolerance-caddy:<sha>.
FROM caddy:2.10.2-builder AS build
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2.10.2-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
