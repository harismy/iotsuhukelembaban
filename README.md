# ESP32 Suhu Kelembaban Monitor

Dashboard web + API Node.js Express untuk menerima data suhu dan kelembaban dari ESP32 (DHT11).

## Jalankan deployment otomatis (server Linux)

```bash
bash start.sh domain-anda.com
```

Script akan otomatis:
- generate `.env` + `API_KEY` (jika belum ada)
- install dependency node
- start app dengan PM2
- buat konfigurasi Nginx reverse proxy ke Express

## Endpoint

- `POST /api/v1/readings` (butuh `x-api-key`)
- `GET /api/v1/latest` (dashboard ambil data dari sini)
- `GET /data` (kompatibilitas endpoint lama)
- `GET /health`

### Contoh request ESP32

Header:
- `Content-Type: application/json`
- `x-api-key: <isi API_KEY dari .env>`

Body JSON:

```json
{
  "temperature": 27.3,
  "humidity": 61.2,
  "deviceId": "esp32-dht11"
}
```

## Local development

```bash
cp .env.example .env
npm install
npm start
```

Buka dashboard di `http://localhost:3000`.
