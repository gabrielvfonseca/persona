# Runs the linked-device bot (src/node.ts). Build from the repository root:
#   docker build -f apps/persona/Dockerfile -t persona-bot .
FROM oven/bun:1

WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile

# Session credentials (.auth) and the persona file (data) live on volumes,
# not in the image. See DEPLOY.md.
WORKDIR /app/apps/persona
VOLUME ["/app/apps/persona/.auth", "/app/apps/persona/data"]

USER bun
CMD ["bun", "src/node.ts"]
