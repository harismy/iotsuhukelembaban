const DATA_ENDPOINT = '/api/v1/latest';
const EVENTS_ENDPOINT = '/api/v1/events';

const elements = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  realtimeClock: document.getElementById('realtimeClock'),
  riskPanel: document.getElementById('riskPanel'),
  riskLevel: document.getElementById('riskLevel'),
  riskMessage: document.getElementById('riskMessage'),
  buzzerState: document.getElementById('buzzerState'),
  plainSoilSummary: document.getElementById('plainSoilSummary'),
  vibrationDurationValue: document.getElementById('vibrationDurationValue'),
  vibrationThresholdValue: document.getElementById('vibrationThresholdValue'),
  plainActionSummary: document.getElementById('plainActionSummary'),
  soilValue: document.getElementById('soilValue'),
  soilStatus: document.getElementById('soilStatus'),
  soilNote: document.getElementById('soilNote'),
  soilNeedle: document.getElementById('soilNeedle'),
  soilArc: document.getElementById('soilArc'),
  soilRawValue: document.getElementById('soilRawValue'),
  soilCalibratedValue: document.getElementById('soilCalibratedValue'),
  soilCalibrationRange: document.getElementById('soilCalibrationRange'),
  vibrationValue: document.getElementById('vibrationValue'),
  vibrationStatus: document.getElementById('vibrationStatus'),
  vibrationNote: document.getElementById('vibrationNote'),
  vibrationNeedle: document.getElementById('vibrationNeedle'),
  vibrationArc: document.getElementById('vibrationArc'),
  vibrationRawValue: document.getElementById('vibrationRawValue'),
  vibrationCalibratedValue: document.getElementById('vibrationCalibratedValue'),
  vibrationCalibrationRange: document.getElementById('vibrationCalibrationRange'),
  temperatureValue: document.getElementById('temperatureValue'),
  humidityValue: document.getElementById('humidityValue'),
  temperatureStatus: document.getElementById('temperatureStatus'),
  temperatureNote: document.getElementById('temperatureNote'),
  deviceId: document.getElementById('deviceId'),
  sensorLastUpdate: document.getElementById('sensorLastUpdate'),
  refreshBtn: document.getElementById('refreshBtn'),
  sensorChart: document.getElementById('sensorChart'),
};

let isFetching = false;
let autoRefreshInterval = null;
let clockInterval = null;
let animationFrame = null;
let eventSource = null;
const chartSamples = [];
const chartWindowMs = 60000;

const gaugeConfig = {
  soil: {
    min: 0,
    max: 100,
    valueElem: elements.soilValue,
    needleElem: elements.soilNeedle,
    arcElem: elements.soilArc,
  },
  vibration: {
    min: 0,
    max: 100,
    valueElem: elements.vibrationValue,
    needleElem: elements.vibrationNeedle,
    arcElem: elements.vibrationArc,
  },
};

const gaugeState = {
  soil: { current: 0, target: 0, initialized: false },
  vibration: { current: 0, target: 0, initialized: false },
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatOptionalNumber(value, digits = 0) {
  return value === null ? '--' : value.toFixed(digits);
}

function formatDuration(ms) {
  const value = optionalNumber(ms);
  if (value === null) {
    return '--';
  }
  return `${(value / 1000).toFixed(1)} detik`;
}

function getCurrentTimeString(date = new Date()) {
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function updateConnectionUI(isOnline, errorMsg = '') {
  elements.statusDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
  elements.statusText.innerText = isOnline ? 'Tersambung realtime' : errorMsg || 'Gagal terhubung';
}

function updateClock() {
  elements.realtimeClock.innerText = getCurrentTimeString();
}

function renderGauge(name, value) {
  const config = gaugeConfig[name];
  const normalized = clamp((value - config.min) / (config.max - config.min), 0, 1);
  const angle = -120 + normalized * 240;

  config.valueElem.innerText = value.toFixed(0);
  config.needleElem.style.transform = `rotate(${angle.toFixed(2)}deg)`;
  config.arcElem.style.strokeDashoffset = (100 - normalized * 100).toFixed(2);
}

function setGaugeTarget(name, value) {
  const state = gaugeState[name];
  if (!state.initialized) {
    state.current = value;
    state.initialized = true;
  }
  state.target = value;
}

function animationLoop() {
  Object.keys(gaugeState).forEach((key) => {
    const state = gaugeState[key];
    if (!state.initialized) {
      return;
    }

    const diff = state.target - state.current;
    state.current = Math.abs(diff) > 0.01 ? state.current + diff * 0.32 : state.target;
    renderGauge(key, state.current);
  });

  animationFrame = requestAnimationFrame(animationLoop);
}

function getSoilStatus(value) {
  if (value >= 70) {
    return { label: 'Basah', note: 'Tanah sangat lembap, risiko meningkat saat ada getaran.' };
  }
  if (value >= 50) {
    return { label: 'Lembap', note: 'Tanah mulai jenuh air, perlu dipantau.' };
  }
  return { label: 'Normal', note: 'Kelembapan tanah masih rendah.' };
}

function getVibrationStatus(value, active) {
  if (value >= 70) {
    return { label: 'Kuat', note: 'Getaran kuat terdeteksi. Alarm menunggu durasi minimal 3 detik.' };
  }
  if (active || value >= 35) {
    return { label: 'Aktif', note: 'Ada getaran. Jika berlangsung lebih dari 3 detik, buzzer akan aktif.' };
  }
  return { label: 'Tenang', note: 'Tidak ada getaran berarti dari SW-420.' };
}

function getTemperatureStatus(value) {
  if (!Number.isFinite(value)) {
    return { label: 'Opsional', note: 'Sensor suhu belum mengirim data.' };
  }
  if (value <= 24) {
    return { label: 'Dingin', note: 'Suhu dingin memperkuat indikasi saat tanah lembap.' };
  }
  return { label: 'Normal', note: 'Suhu sekitar belum masuk kondisi dingin.' };
}

function applyRiskClass(riskLevel) {
  const normalized = String(riskLevel || '').toLowerCase();
  elements.riskPanel.className = `risk-panel ${normalized}`;
}

function getPlainAction(riskLevel, buzzer, vibrationDurationMs, thresholdMs) {
  if (buzzer || riskLevel === 'BAHAYA') {
    return 'Waspada, cek area lereng';
  }
  if (vibrationDurationMs > 0 && vibrationDurationMs < thresholdMs) {
    return 'Pantau, getaran belum lama';
  }
  if (riskLevel === 'WASPADA') {
    return 'Pantau tanah dan getaran';
  }
  return 'Kondisi normal';
}

function addChartSample(data) {
  const receivedAt = data.receivedAt ? new Date(data.receivedAt).getTime() : Date.now();
  const vibrationDurationMs = optionalNumber(data.vibrationDurationMs) || 0;
  const thresholds = data.thresholds || {};
  const thresholdMs = optionalNumber(thresholds.vibrationDangerDurationMs) || 3000;

  chartSamples.push({
    time: receivedAt,
    soil: optionalNumber(data.soilMoisture) || 0,
    vibration: optionalNumber(data.vibrationLevel) || 0,
    duration: clamp((vibrationDurationMs / thresholdMs) * 100, 0, 100),
  });

  if (chartSamples.length > 1 && chartSamples[chartSamples.length - 2].time === receivedAt) {
    chartSamples.splice(chartSamples.length - 2, 1);
  }

  const minTime = Date.now() - chartWindowMs;
  while (chartSamples.length > 0 && chartSamples[0].time < minTime) {
    chartSamples.shift();
  }

  drawChart();
}

function drawChart() {
  const canvas = elements.sensorChart;
  if (!canvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(220, Math.floor(rect.height));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { left: 42, right: 12, top: 16, bottom: 28 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const now = Date.now();
  const start = now - chartWindowMs;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d8e0e7';
  ctx.lineWidth = 1;
  ctx.font = '12px Segoe UI, sans-serif';
  ctx.fillStyle = '#5d6d7e';

  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4;
    const label = `${100 - i * 25}%`;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(label, 6, y + 4);
  }

  function point(sample, key) {
    const x = pad.left + clamp((sample.time - start) / chartWindowMs, 0, 1) * plotW;
    const y = pad.top + (1 - clamp(sample[key] / 100, 0, 1)) * plotH;
    return { x, y };
  }

  function line(key, color) {
    if (chartSamples.length === 0) {
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    chartSamples.forEach((sample, index) => {
      const p = point(sample, key);
      if (index === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    });
    ctx.stroke();
  }

  line('soil', '#16815c');
  line('vibration', '#d57a1f');
  line('duration', '#c23a2b');

  ctx.fillStyle = '#5d6d7e';
  ctx.fillText('60 detik lalu', pad.left, height - 8);
  ctx.fillText('sekarang', width - pad.right - 52, height - 8);
}

function renderSensorData(data) {
  const soilMoisture = optionalNumber(data.soilMoisture);
  const soilRaw = optionalNumber(data.soilRaw);
  const vibrationLevel = optionalNumber(data.vibrationLevel) || 0;
  const vibrationRaw = optionalNumber(data.vibrationRaw);
  const vibrationDurationMs = optionalNumber(data.vibrationDurationMs) || 0;
  const temperature = optionalNumber(data.temperature);
  const humidity = optionalNumber(data.humidity);
  const thresholds = data.thresholds || {};
  const soilDryRaw = optionalNumber(thresholds.soilDryRaw);
  const soilWetRaw = optionalNumber(thresholds.soilWetRaw);
  const vibrationMaxRaw = optionalNumber(thresholds.vibrationMaxRaw);
  const vibrationDangerDurationMs = optionalNumber(thresholds.vibrationDangerDurationMs) || 3000;

  if (soilMoisture === null) {
    throw new Error('Nilai kelembapan tanah tidak valid');
  }

  setGaugeTarget('soil', clamp(soilMoisture, 0, 100));
  setGaugeTarget('vibration', clamp(vibrationLevel, 0, 100));

  const soilStatus = getSoilStatus(soilMoisture);
  const vibrationStatus = getVibrationStatus(vibrationLevel, Boolean(data.vibration));
  const temperatureStatus = getTemperatureStatus(temperature);

  elements.soilStatus.innerText = soilStatus.label;
  elements.soilNote.innerText = soilStatus.note;
  elements.vibrationStatus.innerText = vibrationStatus.label;
  elements.vibrationNote.innerText = vibrationStatus.note;
  elements.temperatureStatus.innerText = temperatureStatus.label;
  elements.temperatureNote.innerText = temperatureStatus.note;
  elements.soilRawValue.innerText = formatOptionalNumber(soilRaw);
  elements.soilCalibratedValue.innerText = formatOptionalNumber(soilMoisture);
  elements.vibrationRawValue.innerText = formatOptionalNumber(vibrationRaw);
  elements.vibrationCalibratedValue.innerText = formatOptionalNumber(vibrationLevel);
  elements.soilCalibrationRange.innerText = `Kalibrasi: kering ${formatOptionalNumber(soilDryRaw)} ADC, basah ${formatOptionalNumber(soilWetRaw)} ADC`;
  elements.vibrationCalibrationRange.innerText = `Kalibrasi: max ${formatOptionalNumber(vibrationMaxRaw)} pulsa`;
  elements.plainSoilSummary.innerText = `${soilStatus.label} (${soilMoisture.toFixed(0)}%)`;
  elements.vibrationDurationValue.innerText = formatDuration(vibrationDurationMs);
  elements.vibrationThresholdValue.innerText = formatDuration(vibrationDangerDurationMs);
  elements.plainActionSummary.innerText = getPlainAction(data.riskLevel, Boolean(data.buzzer), vibrationDurationMs, vibrationDangerDurationMs);
  elements.temperatureValue.innerText = temperature !== null ? temperature.toFixed(1) : '--';
  elements.humidityValue.innerText = humidity !== null ? humidity.toFixed(1) : '--';

  elements.riskLevel.innerText = data.riskLevel || 'UNKNOWN';
  elements.riskMessage.innerText = data.statusMessage || 'Data sensor diterima.';
  elements.buzzerState.innerText = `Buzzer: ${data.buzzer ? 'NYALA' : 'MATI'}`;
  elements.deviceId.innerText = data.deviceId || 'esp32-longsor';
  applyRiskClass(data.riskLevel);

  if (data.receivedAt) {
    elements.sensorLastUpdate.innerText = getCurrentTimeString(new Date(data.receivedAt));
  } else {
    elements.sensorLastUpdate.innerText = getCurrentTimeString();
  }

  addChartSample(data);
}

async function fetchSensorData() {
  if (isFetching) {
    return;
  }
  isFetching = true;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(DATA_ENDPOINT, {
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Belum ada data sensor masuk');
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    renderSensorData(payload.data || {});
    updateConnectionUI(true);
  } catch (error) {
    let errorMessage = 'Gagal ambil data';
    if (error.name === 'AbortError') {
      errorMessage = 'Timeout: server tidak merespon';
    } else if (String(error.message).includes('Failed to fetch')) {
      errorMessage = 'Tidak dapat terhubung ke server';
    } else if (error.message) {
      errorMessage = error.message;
    }

    updateConnectionUI(false, errorMessage);
    elements.sensorLastUpdate.innerText = `${getCurrentTimeString()} (gagal)`;
    elements.riskLevel.innerText = 'OFFLINE';
    elements.riskMessage.innerText = errorMessage;
    elements.buzzerState.innerText = 'Buzzer: --';
    applyRiskClass('unknown');
  } finally {
    isFetching = false;
  }
}

function manualRefresh() {
  fetchSensorData();
  elements.refreshBtn.style.transform = 'scale(0.96)';
  setTimeout(() => {
    elements.refreshBtn.style.transform = '';
  }, 150);
}

function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  autoRefreshInterval = setInterval(fetchSensorData, 1000);
}

function startRealtimeEvents() {
  if (!window.EventSource) {
    return;
  }

  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(EVENTS_ENDPOINT);
  eventSource.onopen = () => {
    updateConnectionUI(true);
  };
  eventSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      renderSensorData(payload.data || {});
      updateConnectionUI(true);
    } catch (error) {
      updateConnectionUI(false, 'Data realtime tidak valid');
    }
  };
  eventSource.onerror = () => {
    updateConnectionUI(false, 'Realtime reconnecting...');
  };
}

function startClock() {
  updateClock();
  if (clockInterval) {
    clearInterval(clockInterval);
  }
  clockInterval = setInterval(updateClock, 1000);
}

window.addEventListener('DOMContentLoaded', () => {
  startClock();
  animationFrame = requestAnimationFrame(animationLoop);
  startRealtimeEvents();
  fetchSensorData();
  startAutoRefresh();
  elements.refreshBtn.addEventListener('click', manualRefresh);
});

window.addEventListener('beforeunload', () => {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  if (clockInterval) {
    clearInterval(clockInterval);
  }
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }
  if (eventSource) {
    eventSource.close();
  }
});

window.addEventListener('resize', drawChart);
