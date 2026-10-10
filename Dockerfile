FROM oven/bun:latest AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile || bun install

COPY . .

RUN DATABASE_HOST=localhost \
    DATABASE_PORT=5432 \
    DATABASE_NAME=dummy \
    DATABASE_USER=dummy \
    DATABASE_PASSWORD=dummy \
    bun run db:generate

RUN bun run build

FROM oven/bun:latest AS runner
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./

RUN bun install --production

USER bun
EXPOSE 3000

ENV NODE_ENV=production
CMD ["bun", "run", "start"]
