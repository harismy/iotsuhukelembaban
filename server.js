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
const sseClients = new Set();

const thresholds = {
  soilWetPercent: Number(process.env.SOIL_WET_PERCENT || 70),
  soilDampPercent: Number(process.env.SOIL_DAMP_PERCENT || 50),
  coldTemperature: Number(process.env.COLD_TEMPERATURE || 24),
  vibrationStrong: Number(process.env.VIBRATION_STRONG || 70),
  vibrationMedium: Number(process.env.VIBRATION_MEDIUM || 35),
  vibrationMaxRaw: Number(process.env.VIBRATION_MAX_RAW || 12),
  soilDryRaw: Number(process.env.SOIL_DRY_RAW || 3200),
  soilWetRaw: Number(process.env.SOIL_WET_RAW || 1200),
};

if (!apiKey) {
  console.error('API_KEY belum diset di .env');
  process.exit(1);
}

let latestReading = {
  soilMoisture: null,
  soilRaw: null,
  soilMoistureDevice: null,
  temperature: null,
  humidity: null,
  vibration: false,
  vibrationRaw: null,
  vibrationLevel: 0,
  vibrationLevelDevice: null,
  buzzer: false,
  riskLevel: 'UNKNOWN',
  statusMessage: 'Belum ada data sensor masuk',
  deviceId: 'unknown',
  receivedAt: null,
};

function ensureDataDir() {
  const dataDir = path.dirname(dataFile);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'active', 'aktif', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function rawToSoilPercent(raw) {
  const dry = thresholds.soilDryRaw;
  const wet = thresholds.soilWetRaw;

  if (dry === wet) {
    return null;
  }

  const percent = ((dry - raw) / (dry - wet)) * 100;
  return clamp(percent, 0, 100);
}

function rawToVibrationPercent(raw) {
  if (thresholds.vibrationMaxRaw <= 0) {
    return null;
  }

  return clamp((raw / thresholds.vibrationMaxRaw) * 100, 0, 100);
}

function pickFirstNumber(body, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const value = toFiniteNumber(body[key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function normalizeReading(body) {
  const soilRaw = pickFirstNumber(body, ['soilRaw', 'soil_raw', 'soilAnalog', 'soil_analog']);
  const soilMoistureDevice = pickFirstNumber(body, [
    'soilMoisture',
    'soil_moisture',
    'soilMoisturePercent',
    'soil_moisture_percent',
    'soil',
  ]);
  let soilMoisture = soilRaw !== null ? rawToSoilPercent(soilRaw) : soilMoistureDevice;

  if (soilMoisture !== null) {
    soilMoisture = clamp(soilMoisture, 0, 100);
  }

  const temperature = pickFirstNumber(body, ['temperature', 'tempC', 'temp_c', 'suhu']);
  const humidity = pickFirstNumber(body, ['humidity', 'airHumidity', 'air_humidity', 'kelembabanUdara']);
  const vibrationRaw = pickFirstNumber(body, [
    'vibrationRaw',
    'vibration_raw',
    'vibrationCount',
    'vibration_count',
    'vibrationPulses',
    'vibration_pulses',
  ]);
  const vibrationLevelDevice = pickFirstNumber(body, ['vibrationLevel', 'vibration_level']);
  const vibration = toBoolean(body.vibration ?? body.vibrationDetected ?? body.vibration_detected ?? vibrationRaw);
  const vibrationLevelFromRaw = vibrationRaw !== null ? rawToVibrationPercent(vibrationRaw) : null;
  const vibrationLevel = clamp(vibrationLevelFromRaw ?? vibrationLevelDevice ?? (vibration ? 100 : 0), 0, 100);

  return {
    soilMoisture,
    soilRaw,
    soilMoistureDevice,
    temperature,
    humidity,
    vibration,
    vibrationRaw,
    vibrationLevel,
    vibrationLevelDevice,
    deviceId: String(body.deviceId || body.device || 'esp32-longsor'),
  };
}

function evaluateRisk(reading) {
  const soilWet = reading.soilMoisture !== null && reading.soilMoisture >= thresholds.soilWetPercent;
  const soilDamp = reading.soilMoisture !== null && reading.soilMoisture >= thresholds.soilDampPercent;
  const cold = reading.temperature !== null && reading.temperature <= thresholds.coldTemperature;
  const strongMovement = reading.vibrationLevel >= thresholds.vibrationStrong;
  const mediumMovement = reading.vibrationLevel >= thresholds.vibrationMedium || reading.vibration;

  if (strongMovement) {
    return {
      buzzer: true,
      riskLevel: 'BAHAYA',
      statusMessage: 'Getaran/pergeseran tanah kuat terdeteksi. Buzzer aktif.',
    };
  }

  if (soilWet && cold && mediumMovement) {
    return {
      buzzer: true,
      riskLevel: 'BAHAYA',
      statusMessage: 'Tanah lembap, suhu dingin, dan ada pergeseran. Potensi longsor tinggi.',
    };
  }

  if (soilWet && mediumMovement) {
    return {
      buzzer: true,
      riskLevel: 'BAHAYA',
      statusMessage: 'Tanah basah dan getaran aktif. Potensi longsor tinggi.',
    };
  }

  if (soilWet || (soilDamp && cold) || (soilDamp && mediumMovement)) {
    return {
      buzzer: false,
      riskLevel: 'WASPADA',
      statusMessage: 'Kondisi tanah mulai rawan. Pantau kelembapan dan pergeseran.',
    };
  }

  return {
    buzzer: false,
    riskLevel: 'AMAN',
    statusMessage: 'Kondisi sensor masih dalam batas aman.',
  };
}

function loadLatestReading() {
  ensureDataDir();
  if (!fs.existsSync(dataFile)) {
    return;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      let loadedSoilMoisture = toFiniteNumber(parsed.soilMoisture);
      const loadedSoilRaw = toFiniteNumber(parsed.soilRaw);

      if (loadedSoilMoisture === null && loadedSoilRaw === null) {
        return;
      }

      if (loadedSoilRaw !== null) {
        loadedSoilMoisture = rawToSoilPercent(loadedSoilRaw);
      }

      const loadedVibrationRaw = toFiniteNumber(parsed.vibrationRaw);
      const loadedVibrationLevel = loadedVibrationRaw !== null
        ? rawToVibrationPercent(loadedVibrationRaw)
        : toFiniteNumber(parsed.vibrationLevel, 0);

      latestReading = {
        ...latestReading,
        ...parsed,
        soilMoisture: loadedSoilMoisture,
        soilRaw: loadedSoilRaw,
        soilMoistureDevice: toFiniteNumber(parsed.soilMoistureDevice),
        temperature: toFiniteNumber(parsed.temperature),
        humidity: toFiniteNumber(parsed.humidity),
        vibration: Boolean(parsed.vibration),
        vibrationRaw: loadedVibrationRaw,
        vibrationLevel: loadedVibrationLevel,
        vibrationLevelDevice: toFiniteNumber(parsed.vibrationLevelDevice),
        buzzer: Boolean(parsed.buzzer),
        riskLevel: parsed.riskLevel || 'UNKNOWN',
        statusMessage: parsed.statusMessage || 'Belum ada data sensor masuk',
        deviceId: parsed.deviceId || 'unknown',
        receivedAt: parsed.receivedAt || null,
      };
      latestReading = {
        ...latestReading,
        ...evaluateRisk(latestReading),
        thresholds,
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

function broadcastLatestReading() {
  if (!latestReading.receivedAt) {
    return;
  }

  const payload = `data: ${JSON.stringify({ ok: true, data: latestReading })}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
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
  res.json({ ok: true, service: 'esp32-landslide-monitor-api' });
});

app.post('/api/v1/readings', requireApiKey, (req, res) => {
  const reading = normalizeReading(req.body || {});

  if (reading.soilMoisture === null) {
    return res.status(400).json({
      ok: false,
      message: 'Body wajib berisi soilMoisture/soilMoisturePercent atau soilRaw/soil_raw',
    });
  }

  const risk = evaluateRisk(reading);
  latestReading = {
    ...reading,
    ...risk,
    thresholds,
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

  broadcastLatestReading();
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

app.get('/api/v1/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(': connected\n\n');

  if (latestReading.receivedAt) {
    res.write(`data: ${JSON.stringify({ ok: true, data: latestReading })}\n\n`);
  }

  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

app.get('/data', (req, res) => {
  if (!latestReading.receivedAt) {
    return res.status(404).json({
      message: 'Belum ada data sensor masuk',
    });
  }

  return res.json(latestReading);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

loadLatestReading();
app.listen(port, () => {
  console.log(`Server jalan di http://0.0.0.0:${port}`);
});
