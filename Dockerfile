# syntax=docker/dockerfile:1
# TT Alarms - production image (web server and scheduler worker share it).
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json /app/next.config.ts ./
USER node
EXPOSE 3000
# Apply pending migrations, then start the web server.
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start"]
