#!/usr/bin/env bash
#
# Развёртывание «Смены 400» на чистой Ubuntu.
#
# Скрипт идемпотентен: повторный запуск обновляет код и перезапускает
# службу, а не ломается на том, что что-то уже установлено.
#
set -euo pipefail

REPO=https://github.com/DARK1ANGELZOV/msk_transport.git
DIR=/opt/smena400
PORT=2456
DB=$DIR/data/smena400.db
export DB_FILE="$DB"

say() { printf '\n=== %s ===\n' "$1"; }

# --------------------------------------------------------------- подкачка
# На этой машине 1.9 ГБ ОЗУ и один процессор. Сборка Vite вместе с tsc
# упирается в память, и OOM-killer убивает процесс на середине. Гигабайт
# подкачки снимает этот риск и остаётся полезным при работе службы.
# Проверяем не наличие файла, а наличие подкачки: в образе провайдера
# /swapfile уже лежал готовым, но не был ни подключён, ни прописан
# в fstab — то есть не работал.
if [ "$(free -m | awk '/^Swap:/{print $2}')" -eq 0 ] && [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 2500 ]; then
  say "Подкачка"
  if [ ! -f /swapfile ]; then
    fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  free -h | awk '/^Swap:/{print "подкачка: "$2}'
fi

# ---------------------------------------------------------------- Node.js
# Нужен 22.5+: продукт использует встроенный node:sqlite, а до этой версии
# модуля просто нет.
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  say "Установка Node.js 22"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v), npm $(npm -v)"

# ------------------------------------------------------------------- код
say "Код"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin
  git -C "$DIR" reset --hard --quiet origin/main
  echo "обновлено до $(git -C "$DIR" rev-parse --short HEAD)"
else
  rm -rf "$DIR"
  git clone --quiet --depth 1 "$REPO" "$DIR"
  echo "склонировано $(git -C "$DIR" rev-parse --short HEAD)"
fi

# --------------------------------------------------------------- сборка
say "Сборка"
mkdir -p "$DIR/data"
cd "$DIR/smena400"
npm ci --no-audit --no-fund --silent 2>&1 | tail -3 || npm install --no-audit --no-fund --silent 2>&1 | tail -3
npm run build 2>&1 | tail -4
npm run db:seed 2>&1 | tail -3

# ---------------------------------------------------------------- служба
# systemd, а не ручной запуск: стенд должен подниматься сам после
# перезагрузки и перезапускаться, если процесс упадёт.
say "Служба"
cat > /etc/systemd/system/smena400.service <<UNIT
[Unit]
Description=СМЕНА 400 — тренажёр решений для проводников ВСМ
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR/smena400
Environment=PORT=$PORT
Environment=DB_FILE=$DB
Environment=NODE_ENV=production
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=3
# Ограничения: служба ничего не пишет за пределами своего каталога данных.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$DIR/data

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --quiet smena400
systemctl restart smena400
sleep 4
systemctl is-active smena400

# -------------------------------------------------------------- firewall
say "Порт $PORT"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow "$PORT"/tcp >/dev/null
  echo "ufw: порт открыт"
else
  echo "ufw неактивен — правила не нужны"
fi

# --------------------------------------------------------------- проверка
say "Проверка"
curl -s --max-time 10 "http://127.0.0.1:$PORT/api/health" && echo
curl -s -o /dev/null -w "клиент: HTTP %{http_code}\n" --max-time 10 "http://127.0.0.1:$PORT/"
