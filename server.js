const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.API_KEY;
const dataFile = path.join(__dirname, 'data', 'latest-reading.json');

if (!apiKey) {
  console.error('API_KEY belum diset di .env');
  process.exit(1);
}

let latestReading = {
  temperature: null,
  humidity: null,
  deviceId: 'unknown',
  receivedAt: null,
};

function ensureDataDir() {
  const dataDir = path.dirname(dataFile);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadLatestReading() {
  ensureDataDir();
  if (!fs.existsSync(dataFile)) {
    return;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Object.prototype.hasOwnProperty.call(parsed, 'temperature') &&
      Object.prototype.hasOwnProperty.call(parsed, 'humidity')
    ) {
      latestReading = {
        temperature: Number(parsed.temperature),
        humidity: Number(parsed.humidity),
        deviceId: parsed.deviceId || 'unknown',
        receivedAt: parsed.receivedAt || null,
      };
    }
  } catch (error) {
    console.error('Gagal baca data terakhir:', error.message);
  }
}

function saveLatestReading() {
  ensureDataDir();
  fs.writeFileSync(dataFile, JSON.stringify(latestReading, null, 2), 'utf8');
}

function extractApiKey(req) {
  const headerKey = req.get('x-api-key');
  if (headerKey) {
    return headerKey.trim();
  }

  const auth = req.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  return '';
}

function requireApiKey(req, res, next) {
  const suppliedKey = extractApiKey(req);
  if (!suppliedKey || suppliedKey !== apiKey) {
    return res.status(401).json({
      ok: false,
      message: 'Unauthorized: API key tidak valid',
    });
  }
  next();
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(express.static(__dirname));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'esp32-monitor-api' });
});

app.post('/api/v1/readings', requireApiKey, (req, res) => {
  const body = req.body || {};
  const temperature = Number(body.temperature);
  const humidity = Number(body.humidity);
  const deviceId = String(body.deviceId || 'esp32');

  if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) {
    return res.status(400).json({
      ok: false,
      message: 'Body wajib berisi number: temperature dan humidity',
    });
  }

  latestReading = {
    temperature,
    humidity,
    deviceId,
    receivedAt: new Date().toISOString(),
  };

  try {
    saveLatestReading();
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Gagal menyimpan data terbaru',
    });
  }

  return res.status(201).json({ ok: true, data: latestReading });
});

app.get('/api/v1/latest', (req, res) => {
  if (!latestReading.receivedAt) {
    return res.status(404).json({
      ok: false,
      message: 'Belum ada data sensor masuk',
    });
  }

  return res.json({ ok: true, data: latestReading });
});

app.get('/data', (req, res) => {
  if (!latestReading.receivedAt) {
    return res.status(404).json({
      message: 'Belum ada data sensor masuk',
    });
  }

  return res.json({
    temperature: latestReading.temperature,
    humidity: latestReading.humidity,
    receivedAt: latestReading.receivedAt,
    deviceId: latestReading.deviceId,
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

loadLatestReading();
app.listen(port, () => {
  console.log(`Server jalan di http://0.0.0.0:${port}`);
});
