# tolerance web (Next.js, standalone output).
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm config set store-dir /root/.local/share/pnpm/store && pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.mjs reads API_URL at build time: the /api rewrite target is
# written into the routes manifest, so a runtime env var would not change it.
ARG API_URL=http://api:8080
ENV API_URL=$API_URL
# Static pages (and the site's share card) are rendered here, at build time: metadataBase and the card's footer
# take the site URL now, and the runtime ARENA_PUBLIC_URL from compose.yml reaches only dynamic pages.
ARG ARENA_PUBLIC_URL=
ENV ARENA_PUBLIC_URL=$ARENA_PUBLIC_URL
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN adduser -D -u 10001 arena
COPY --from=build --chown=arena:arena /app/.next/standalone ./
COPY --from=build --chown=arena:arena /app/.next/static ./.next/static
COPY --from=build --chown=arena:arena /app/public ./public
USER arena
EXPOSE 3000
CMD ["node", "server.js"]
