# syntax=docker/dockerfile:1.7
#
# Orla: single monolithic image on Debian 13 (trixie).
# One container runs Nginx (edge) and the Node.js panel (API + SPA + jobs).

ARG DEBIAN_IMAGE=debian:13-slim

# ---------------------------------------------------------------------------
# Base: runtime packages shared by the build and final stages
# ---------------------------------------------------------------------------
FROM ${DEBIAN_IMAGE} AS base

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        nginx \
        libnginx-mod-http-brotli-filter \
        libnginx-mod-http-brotli-static \
        libnginx-mod-http-headers-more-filter \
        nodejs \
        ca-certificates \
        openssl \
        curl \
        tini \
        gosu \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system orla \
 && useradd --system --gid orla --home-dir /var/lib/orla --shell /usr/sbin/nologin orla

# ---------------------------------------------------------------------------
# Build: install dependencies, generate Prisma client, compile server + web
# ---------------------------------------------------------------------------
FROM base AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends npm \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/orla

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx prisma generate \
 && npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production \
    DATABASE_URL=file:/var/lib/orla/data/orla.db \
    ORLA_PANEL_HOST=0.0.0.0 \
    ORLA_PANEL_PORT=3000

WORKDIR /opt/orla

# Static Nginx layout. Debian's default site is removed: only Orla's default
# servers and generated hosts are loaded (see docker/nginx/nginx.conf).
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/* \
 && chown -R orla:orla /var/log/nginx /var/lib/nginx
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/orla/ /etc/nginx/orla/
COPY docker/entrypoint.sh /usr/local/bin/orla-entrypoint

COPY --from=build --chown=root:root /opt/orla/package.json ./package.json
COPY --from=build --chown=root:root /opt/orla/node_modules ./node_modules
COPY --from=build --chown=root:root /opt/orla/prisma ./prisma
COPY --from=build --chown=root:root /opt/orla/dist ./dist

RUN chmod 0755 /usr/local/bin/orla-entrypoint

VOLUME ["/var/lib/orla", "/etc/nginx/conf.d", "/etc/nginx/orla/generated", "/var/log/orla", "/var/cache/orla"]

EXPOSE 80/tcp 443/tcp 443/udp 3000/tcp

# tini -g forwards signals to the whole process group (nginx + panel).
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/orla-entrypoint"]
