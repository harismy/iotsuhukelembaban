#!/usr/bin/env bash
set -euo pipefail

APP_NAME="esp32-monitor"
DEFAULT_PORT="3000"
REQUESTED_PORT="${3:-${PORT:-}}"
DOMAIN="${1:-${DOMAIN:-}}"
INPUT_API_KEY="${2:-${API_KEY_INPUT:-}}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$APP_DIR/.env"
NGINX_CONF="/etc/nginx/sites-available/${APP_NAME}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${APP_NAME}.conf"
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: bash start.sh <domain-atau-ip> [api-key] [port]"
  echo "Contoh: bash start.sh sensor.example.com my-super-secret-key 3010"
  exit 1
fi

for cmd in node npm openssl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: command '$cmd' belum terinstall."
    exit 1
  fi
done

ensure_nginx() {
  if command -v nginx >/dev/null 2>&1 && [[ -f /etc/nginx/nginx.conf ]]; then
    return
  fi

  echo "Nginx belum siap, mencoba install/perbaiki..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y --reinstall nginx
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nginx
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y nginx
  else
    echo "Error: package manager tidak didukung untuk auto install nginx."
    exit 1
  fi

  if [[ ! -f /etc/nginx/nginx.conf ]]; then
    echo "Error: /etc/nginx/nginx.conf masih belum ada setelah install."
    exit 1
  fi
}

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 belum ada, install global..."
  sudo npm install -g pm2
fi

ensure_nginx

if [[ ! -f "$ENV_FILE" ]]; then
  APP_PORT="${REQUESTED_PORT:-$DEFAULT_PORT}"
  API_KEY_VALUE="${INPUT_API_KEY:-$(openssl rand -hex 32)}"
  cat > "$ENV_FILE" <<EOF
PORT=${APP_PORT}
DOMAIN=${DOMAIN}
API_KEY=${API_KEY_VALUE}
NODE_ENV=production
EOF
  echo ".env dibuat otomatis"
else
  source "$ENV_FILE"
  APP_PORT="${REQUESTED_PORT:-${PORT:-$DEFAULT_PORT}}"

  if ! grep -q '^DOMAIN=' "$ENV_FILE"; then
    echo "DOMAIN=${DOMAIN}" >> "$ENV_FILE"
  else
    sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" "$ENV_FILE"
  fi

  if ! grep -q '^PORT=' "$ENV_FILE"; then
    echo "PORT=${APP_PORT}" >> "$ENV_FILE"
  else
    sed -i "s|^PORT=.*|PORT=${APP_PORT}|" "$ENV_FILE"
  fi

  if [[ -n "$INPUT_API_KEY" ]]; then
    if grep -q '^API_KEY=' "$ENV_FILE"; then
      sed -i "s|^API_KEY=.*|API_KEY=${INPUT_API_KEY}|" "$ENV_FILE"
    else
      echo "API_KEY=${INPUT_API_KEY}" >> "$ENV_FILE"
    fi
  else
    EXISTING_API_KEY="${API_KEY:-}"
    if [[ -z "$EXISTING_API_KEY" ]]; then
      NEW_KEY="$(openssl rand -hex 32)"
      echo "API_KEY=${NEW_KEY}" >> "$ENV_FILE"
      echo "API key ditambahkan ke .env"
    fi
  fi
fi

echo "Install dependency node..."
cd "$APP_DIR"
npm install

echo "Start app via pm2..."
pm2 start ecosystem.config.cjs --name "$APP_NAME" --update-env || pm2 restart "$APP_NAME" --update-env
pm2 save

if [[ ! -d /etc/nginx/sites-available ]]; then
  sudo mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
fi

echo "Tulis konfigurasi nginx..."
sudo tee "$NGINX_CONF" >/dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

sudo ln -sf "$NGINX_CONF" "$NGINX_LINK"
# Jangan hapus default site otomatis agar aman untuk VPS yang sudah multi-website.

sudo nginx -t
sudo systemctl reload nginx

echo "Deploy selesai"
echo "Domain : ${DOMAIN}"
echo "App dir: ${APP_DIR}"
echo "Lihat API key di: ${ENV_FILE}"
echo "Endpoint ingest ESP32: http://${DOMAIN}/api/v1/readings"
echo "Endpoint dashboard   : http://${DOMAIN}/"
