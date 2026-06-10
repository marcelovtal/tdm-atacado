# Build do front (Vite) + dependências de produção (sem sqlite — só local)
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json vite.config.js ./
COPY client ./client

RUN npm ci && npm run client:build && npm prune --omit=dev

# Runtime leve — sem apt-get (cluster corporativo bloqueia deb.debian.org)
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY server ./server
COPY scripts ./scripts
COPY support ./support
COPY config ./config
COPY --from=builder /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=3333

EXPOSE 3333

CMD ["node", "server/index.js"]
