# ESP32 Pendeteksi Potensi Tanah Longsor

Dashboard web + API Node.js Express untuk prototipe UAS pendeteksi dini potensi tanah longsor berbasis ESP32 DevKit V1.

Sensor utama:
- Sensor kelembapan tanah capacitive pada pin analog ESP32.
- Sensor getaran/pergeseran SW-420 pada pin digital ESP32.
- Buzzer pada pin digital ESP32.
- Sensor DHT11/DHT22 opsional untuk suhu dingin dan kelembapan udara.

## Deploy cepat di VPS

Clone project, lalu jalankan:

```bash
bash start.sh domain-anda.com API_KEY_ANDA
```

Kalau belum punya API key, cukup isi domain. Script akan membuat API key otomatis di `.env`:

```bash
bash start.sh domain-anda.com
```

Jika port `3000` bentrok:

```bash
bash start.sh domain-anda.com API_KEY_ANDA 3010
```

Script akan otomatis:
- membuat atau memperbarui `.env`
- install dependency Node.js
- menjalankan aplikasi dengan PM2
- install atau memperbaiki Nginx jika belum tersedia
- membuat reverse proxy Nginx ke aplikasi
- mengaktifkan HTTPS Let's Encrypt jika `ENABLE_HTTPS=true`
- menampilkan endpoint dan API key yang harus dipakai ESP32

Sebelum mengaktifkan HTTPS, pastikan DNS domain sudah mengarah ke IP VPS dan firewall membuka port `80` serta `443`.

Jika ingin memakai email untuk notifikasi sertifikat Let's Encrypt, isi di `.env` lalu jalankan ulang `start.sh`:

```env
ENABLE_HTTPS=true
LETSENCRYPT_EMAIL=email-kamu@example.com
```

Untuk mematikan setup HTTPS otomatis:

```env
ENABLE_HTTPS=false
```

## Auto install dari link

Jalankan langsung dari server Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/harismy/iotsuhukelembaban/main/install.sh | bash -s -- domain-anda.com API_KEY_ANDA
```

Jika key dikosongkan pada mode clone manual, `start.sh` akan membuat key sendiri. Untuk mode `install.sh`, masukkan key agar firmware ESP32 bisa langsung disamakan.

## Endpoint

- `POST /api/v1/readings` butuh header `x-api-key`
- `GET /api/v1/latest` untuk dashboard
- `GET /api/v1/events` realtime stream untuk dashboard
- `GET /data` kompatibilitas endpoint lama
- `GET /health`

Contoh request ESP32:

```json
{
  "deviceId": "esp32-longsor-uas",
  "soilRaw": 1840,
  "soilMoisture": 68,
  "vibration": true,
  "vibrationRaw": 5,
  "vibrationLevel": 42,
  "temperature": 23.7,
  "humidity": 81.2
}
```

Backend menghitung `riskLevel`:
- `AMAN`: tanah normal dan tidak ada getaran berarti.
- `WASPADA`: tanah mulai lembap/basah atau kondisi dingin mendukung risiko.
- `BAHAYA`: tanah basah dan ada pergeseran, atau getaran kuat. Buzzer harus menyala.

## Konfigurasi threshold

Edit `.env` jika perlu menyesuaikan kalibrasi:

```env
SOIL_WET_PERCENT=70
SOIL_DAMP_PERCENT=50
COLD_TEMPERATURE=24
VIBRATION_STRONG=70
VIBRATION_MEDIUM=35
VIBRATION_MAX_RAW=4
SOIL_DRY_RAW=3200
SOIL_WET_RAW=1200
```

`SOIL_DRY_RAW` dan `SOIL_WET_RAW` harus disesuaikan dari nilai sensor yang terlihat di Serial Monitor saat tanah kering dan tanah basah.

Cara kalibrasi cepat:
- Buka dashboard, lihat bagian `Sebelum kalibrasi` pada kartu kelembapan tanah.
- Saat sensor di tanah kering, catat nilai ADC dan masukkan ke `SOIL_DRY_RAW`.
- Saat sensor di tanah basah/jenuh air, catat nilai ADC dan masukkan ke `SOIL_WET_RAW`.
- Guncangkan sensor SW-420 sekuat skenario bahaya, catat nilai pulsa terbesar, lalu masukkan ke `VIBRATION_MAX_RAW`.
- Restart aplikasi dengan `pm2 restart esp32-longsor-monitor --update-env`.

Untuk mengurangi delay tampilan, firmware membaca getaran lebih sering dan dashboard memakai realtime stream `/api/v1/events`. Jika sebelumnya `.env` di VPS masih memakai `VIBRATION_MAX_RAW=12`, ubah ke sekitar `4` dulu lalu kalibrasi ulang dari dashboard.

Dashboard menampilkan dua nilai:
- `Sebelum kalibrasi`: nilai mentah dari sensor, misalnya ADC tanah atau pulsa SW-420.
- `Sesudah kalibrasi`: nilai persen hasil hitung backend dari raw + threshold `.env`.

## Firmware ESP32

File firmware ada di `sketch_apr23a/sketch_apr23a.ino`.

Pin default:
- `SOIL_PIN`: GPIO34
- `VIBRATION_PIN`: GPIO27
- `BUZZER_PIN`: GPIO26
- `DHTPIN`: GPIO4, opsional

Ubah bagian berikut sebelum upload:

```cpp
const char* WIFI_SSID = "NAMA_WIFI";
const char* WIFI_PASSWORD = "PASSWORD_WIFI";
const char* API_URL = "https://domain-anda.com/api/v1/readings";
const char* API_KEY = "isi_api_key_yang_sama_dengan_env";
```

Jika tidak memakai DHT11/DHT22:

```cpp
#define USE_DHT false
```

## Local development

```bash
cp .env.example .env
npm install
npm start
```

Buka dashboard di `http://localhost:3000`.
