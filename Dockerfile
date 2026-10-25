# syntax=docker/dockerfile:1

# Pista headless host: Node sidecar plus the built UI, no Electron.
#
# Network note: the host binds 127.0.0.1 by design (apps/host/src/index.ts calls
# server.listen(PORT, "127.0.0.1")) and there is no bind-address variable. Inside a
# container that means `-p 4317:4317` alone will NOT reach it from outside. Reach it
# from a sidecar/proxy container sharing the same network namespace
# (`--network container:<name>` or a Kubernetes pod), or run with `--network host`.
# Browsers must also present an allowed Origin on the WebSocket upgrade; extra
# origins can be added with PISTA_ALLOWED_ORIGINS (comma-separated).
#
# Optional pieces (the built-in llama.cpp runtime) are not installed; they are opt-in.

# ---- builder ----------------------------------------------------------------
FROM node:22-slim AS builder
RUN corepack enable
# Electron's binary download is irrelevant here (the desktop shell is not built).
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 CI=true
WORKDIR /repo

# Manifests first so the dependency layer is cached until a manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/host/package.json apps/host/
COPY apps/ui/package.json apps/ui/
COPY apps/desktop/package.json apps/desktop/
COPY packages/pi-browser/package.json packages/pi-browser/
COPY packages/protocol/package.json packages/protocol/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
 && pnpm --filter @pista/host deploy --prod /deploy

# ---- runtime ----------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PISTA_HOME=/data \
    PISTA_HOST_PORT=4317
WORKDIR /app

# The host resolves the UI at ../../ui/dist relative to dist/host.mjs, so keep the
# apps/host and apps/ui layout. /deploy holds the host package, its dist/ and the
# production node_modules needed by the esbuild externals.
COPY --from=builder /deploy apps/host
COPY --from=builder /repo/apps/ui/dist apps/ui/dist

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4317
CMD ["node", "apps/host/dist/host.mjs"]
