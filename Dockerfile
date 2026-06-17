# Build do front (Vite) + dependências de produção (sem sqlite — só local)
FROM node:22-bookworm AS builder

WORKDIR /app

COPY package.json package-lock.json vite.config.js ./
COPY client ./client

ENV PLAYWRIGHT_BROWSERS_PATH=/app/ms-playwright
RUN npm ci \
  && npx playwright install chromium \
  && npm run client:build \
  && npm prune --omit=dev

# Runtime — bookworm (não slim) traz libs do Chromium sem apt-get no pod
FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
ENV PLAYWRIGHT_BROWSERS_PATH=/app/ms-playwright
COPY --from=builder /app/ms-playwright ./ms-playwright
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
