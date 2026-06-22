# Build do front (Vite) + dependências de produção (sem sqlite — só local)
# Playwright: pacote fica no node_modules; browser NÃO é baixado aqui (rede do cluster bloqueia CDN).
FROM node:22-bookworm AS builder

WORKDIR /app

COPY package.json package-lock.json vite.config.js ./
COPY client ./client

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci \
  && npm run client:build \
  && npm prune --omit=dev

# Runtime — bookworm (não slim) para libs comuns de Node
FROM node:22-bookworm

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
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

EXPOSE 3333

CMD ["node", "server/index.js"]
