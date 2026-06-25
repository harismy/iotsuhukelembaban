#!/usr/bin/env bash
set -euo pipefail

APP_NAME="esp32-longsor-monitor"
DEFAULT_PORT="3000"
REQUESTED_PORT="${3:-${PORT:-}}"
DOMAIN="${1:-${DOMAIN:-}}"
INPUT_API_KEY="${2:-${API_KEY_INPUT:-}}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$APP_DIR/.env"
NGINX_CONF="/etc/nginx/sites-available/${APP_NAME}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${APP_NAME}.conf"
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
HTTPS_URL="http://${DOMAIN}/"

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

install_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y "$@"
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y "$@"
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y "$@"
  else
    echo "Error: package manager tidak didukung."
    exit 1
  fi
}

is_ip_address() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ || "$1" =~ ^[0-9a-fA-F:]+$ ]]
}

ensure_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    return
  fi

  echo "Certbot belum ada, mencoba install..."
  if command -v apt-get >/dev/null 2>&1; then
    install_packages certbot python3-certbot-nginx
  elif command -v dnf >/dev/null 2>&1; then
    install_packages certbot python3-certbot-nginx
  elif command -v yum >/dev/null 2>&1; then
    install_packages certbot python3-certbot-nginx
  fi
}

enable_https() {
  local enable_https_value
  local cert_email

  enable_https_value="$(grep -m1 '^ENABLE_HTTPS=' "$ENV_FILE" | cut -d= -f2- || true)"
  cert_email="$(grep -m1 '^LETSENCRYPT_EMAIL=' "$ENV_FILE" | cut -d= -f2- || true)"

  if [[ "${enable_https_value:-true}" == "false" || "${enable_https_value:-true}" == "0" ]]; then
    echo "HTTPS dilewati karena ENABLE_HTTPS=${enable_https_value}"
    return
  fi

  if is_ip_address "$DOMAIN"; then
    echo "HTTPS dilewati: Let's Encrypt membutuhkan domain, bukan IP (${DOMAIN})."
    return
  fi

  ensure_certbot

  local certbot_args=(--nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --keep-until-expiring)
  if [[ -n "$cert_email" ]]; then
    certbot_args+=(--email "$cert_email")
  else
    certbot_args+=(--register-unsafely-without-email)
  fi

  echo "Aktifkan HTTPS Let's Encrypt untuk ${DOMAIN}..."
  if sudo certbot "${certbot_args[@]}"; then
    HTTPS_URL="https://${DOMAIN}/"
    sudo nginx -t
    sudo systemctl reload nginx
  else
    echo "Error: gagal membuat sertifikat HTTPS. Pastikan DNS domain sudah mengarah ke IP VPS dan port 80/443 terbuka."
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
ENABLE_HTTPS=true
LETSENCRYPT_EMAIL=
SOIL_WET_PERCENT=70
SOIL_DAMP_PERCENT=50
COLD_TEMPERATURE=24
VIBRATION_STRONG=70
VIBRATION_MEDIUM=35
VIBRATION_MAX_RAW=4
VIBRATION_DANGER_DURATION_MS=3000
SOIL_DRY_RAW=3200
SOIL_WET_RAW=1200
EOF
  echo ".env dibuat otomatis"
else
  get_env_value() {
    local key="$1"
    grep -m1 "^${key}=" "$ENV_FILE" | cut -d= -f2- || true
  }

  EXISTING_PORT="$(get_env_value "PORT")"
  APP_PORT="${REQUESTED_PORT:-${EXISTING_PORT:-$DEFAULT_PORT}}"

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
    EXISTING_API_KEY="$(get_env_value "API_KEY")"
    if [[ -z "$EXISTING_API_KEY" ]]; then
      NEW_KEY="$(openssl rand -hex 32)"
      echo "API_KEY=${NEW_KEY}" >> "$ENV_FILE"
      echo "API key ditambahkan ke .env"
    fi
  fi

  ensure_env_default() {
    local key="$1"
    local value="$2"
    if ! grep -q "^${key}=" "$ENV_FILE"; then
      echo "${key}=${value}" >> "$ENV_FILE"
    fi
  }

  ensure_env_default "SOIL_WET_PERCENT" "70"
  ensure_env_default "ENABLE_HTTPS" "true"
  ensure_env_default "LETSENCRYPT_EMAIL" ""
  ensure_env_default "SOIL_DAMP_PERCENT" "50"
  ensure_env_default "COLD_TEMPERATURE" "24"
  ensure_env_default "VIBRATION_STRONG" "70"
  ensure_env_default "VIBRATION_MEDIUM" "35"
  ensure_env_default "VIBRATION_MAX_RAW" "4"
  ensure_env_default "VIBRATION_DANGER_DURATION_MS" "3000"
  ensure_env_default "SOIL_DRY_RAW" "3200"
  ensure_env_default "SOIL_WET_RAW" "1200"
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

    location /api/v1/events {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        add_header X-Accel-Buffering no;
    }

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
enable_https

echo "Deploy selesai"
echo "Domain : ${DOMAIN}"
echo "App dir: ${APP_DIR}"
echo "Lihat API key di: ${ENV_FILE}"
echo "Endpoint ingest ESP32 : ${HTTPS_URL%/}/api/v1/readings"
echo "Endpoint dashboard    : ${HTTPS_URL}"
echo "API key ESP32         : $(grep '^API_KEY=' "$ENV_FILE" | cut -d= -f2-)"
