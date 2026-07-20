# Build do front (Vite) + dependências de produção (sem sqlite — só local)
# Playwright: pacote npm no node_modules; Chromium Linux vem de deploy/playwright-browsers
# (preparado no PC com deploy/prepare-playwright-browsers.cmd — cluster bloqueia CDN).
FROM node:22-bookworm AS builder

WORKDIR /app

COPY package.json package-lock.json vite.config.js ./
COPY client ./client

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci \
  && npm run client:build \
  && npm prune --omit=dev

# Runtime — bookworm (não slim) para libs comuns de Node + Chromium empacotado
FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY server ./server
COPY scripts ./scripts
COPY support ./support
COPY config ./config
COPY --from=builder /app/client/dist ./client/dist

# Chromium Linux gerado por deploy/prepare-playwright-browsers.cmd (obrigatório no OpenShift)
COPY deploy/playwright-browsers /ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN test -d /ms-playwright \
  && ls /ms-playwright | grep -qi chromium \
  || (echo "ERRO: Chromium ausente. Rode deploy\\prepare-playwright-browsers.cmd no PC antes do deploy." && exit 1) \
  && chmod -R a+rx /ms-playwright

ENV NODE_ENV=production
ENV PORT=3333

EXPOSE 3333

CMD ["node", "server/index.js"]
