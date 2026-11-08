# Bun version pinned to the one this project is verified with (see README).
FROM oven/bun:1.2.20 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Migrations are committed in drizzle/ and never generated at build time.
RUN bun run build

FROM oven/bun:1.2.20 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --chown=bun:bun package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY --from=builder --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun public ./public
COPY --chown=bun:bun drizzle ./drizzle

# Local storage provider target (LOCAL_STORAGE_PATH=/app/uploads).
RUN mkdir -p /app/uploads && chown bun:bun /app/uploads
VOLUME ["/app/uploads"]

USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Run Bun directly (not through a package script) so SIGTERM reaches the
# server and triggers the graceful shutdown.
CMD ["bun", "dist/index.js"]
