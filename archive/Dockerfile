# Сборка клиента и запуск сервера в одном образе.
#
# Сервер отдаёт и API, и статику из dist/, поэтому в проде нужен один контейнер
# и один порт. Node 22.5+ обязателен: SQLite подключается встроенным модулем
# node:sqlite, и внешних зависимостей у сервера нет вообще.

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY engine ./engine
COPY src ./src
RUN npx tsc --noEmit && npx vite build

# ---------------------------------------------------------------------------

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data

# Приложению не нужны node_modules: у сервера ноль внешних зависимостей.
COPY package.json ./
COPY engine ./engine
COPY server ./server
COPY tools ./tools
COPY content ./content
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
