#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/harismy/iotsuhukelembaban.git"
APP_DIR="${APP_DIR:-/opt/iotsuhukelembaban}"
DOMAIN="${1:-}"
INPUT_API_KEY="${2:-}"

if [[ -z "$DOMAIN" ]]; then
  read -r -p "Masukkan domain/IP server: " DOMAIN
fi

if [[ -z "$INPUT_API_KEY" ]]; then
  read -r -p "Masukkan API key untuk ESP32: " INPUT_API_KEY
fi

if [[ -z "$DOMAIN" || -z "$INPUT_API_KEY" ]]; then
  echo "Domain dan API key wajib diisi."
  exit 1
fi

for cmd in git bash; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: command '$cmd' belum terinstall."
    exit 1
  fi
done

if [[ -d "$APP_DIR/.git" ]]; then
  echo "Update project di $APP_DIR ..."
  git -C "$APP_DIR" pull --ff-only
else
  echo "Clone project ke $APP_DIR ..."
  sudo mkdir -p "$(dirname "$APP_DIR")"
  sudo chown "$(id -u):$(id -g)" "$(dirname "$APP_DIR")"
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "Jalankan setup aplikasi..."
cd "$APP_DIR"
bash start.sh "$DOMAIN" "$INPUT_API_KEY"

echo "Selesai."
