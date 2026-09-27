# Сборка и запуск одним образом: зависимостей мало, разделять незачем.
FROM node:22-alpine

WORKDIR /app

# Сначала манифесты — слой с зависимостями переиспользуется между сборками.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .

# Клиент собирается на этапе образа, чтобы контейнер стартовал сразу.
RUN npm run build

# База лежит на томе: прохождения переживают пересоздание контейнера.
ENV PORT=5400 DB_FILE=/data/smena400.db
VOLUME /data
EXPOSE 5400

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
