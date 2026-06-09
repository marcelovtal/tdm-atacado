# Build do front (Vite)
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json vite.config.js ./
COPY client ./client

RUN npm ci && npm run client:build

# Runtime: API + dependências nativas (sqlite3)
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY scripts ./scripts
COPY support ./support
COPY config ./config
COPY --from=builder /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=3333

EXPOSE 3333

CMD ["node", "server/index.js"]
