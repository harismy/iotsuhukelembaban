# ESP32 Suhu Kelembaban Monitor

Dashboard web + API Node.js Express untuk menerima data suhu dan kelembaban dari ESP32 (DHT11).

## Auto install dari link (server Linux)

Jalankan langsung dari server:

```bash
curl -fsSL https://raw.githubusercontent.com/harismy/iotsuhukelembaban/main/install.sh | bash -s -- domain-anda.com API_KEY_ANDA
```

Contoh:

```bash
curl -fsSL https://raw.githubusercontent.com/harismy/iotsuhukelembaban/main/install.sh | bash -s -- sensor.example.com key123sensor
```

Jika port `3000` bentrok dengan app lain, tambahkan argumen port:

```bash
curl -fsSL https://raw.githubusercontent.com/harismy/iotsuhukelembaban/main/install.sh | bash -s -- sensor.example.com key123sensor 3010
```

Script akan otomatis:
- clone/update project ke `/opt/iotsuhukelembaban`
- simpan `DOMAIN` dan `API_KEY` ke `.env`
- install dependency node
- jalankan app dengan PM2
- setup Nginx reverse proxy ke app

## Jalankan deployment manual dari folder project

```bash
bash start.sh domain-anda.com API_KEY_ANDA
```

Atau dengan port custom:

```bash
bash start.sh domain-anda.com API_KEY_ANDA 3010
```

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
