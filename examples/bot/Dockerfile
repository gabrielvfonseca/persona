# Runs the linked-device bot (examples/bot/src/node.ts) against Postgres (pgvector).
# Build from the repository root:
#   docker build -f examples/bot/Dockerfile -t persona-bot .
# Run with docker/compose.yaml, which also starts the database.
FROM oven/bun:1

WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile

# Session credentials (.auth) and the persona file (data) live on volumes, not
# in the image. Postgres is set with DATABASE_URL and USE_POSTGRES=true.
# See DEPLOY.md.
WORKDIR /app/examples/bot
VOLUME ["/app/examples/bot/.auth", "/app/examples/bot/data"]

# Model cache. Created here so the named volume mounted over it starts owned by bun.
RUN mkdir -p /home/bun/.cache/ggml-node && chown -R bun:bun /home/bun/.cache

USER bun
CMD ["bun", "src/node.ts"]
