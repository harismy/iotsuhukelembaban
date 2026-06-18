const DATA_ENDPOINT = '/api/v1/latest';

const elements = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  realtimeClock: document.getElementById('realtimeClock'),
  riskPanel: document.getElementById('riskPanel'),
  riskLevel: document.getElementById('riskLevel'),
  riskMessage: document.getElementById('riskMessage'),
  buzzerState: document.getElementById('buzzerState'),
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
};

let isFetching = false;
let autoRefreshInterval = null;
let clockInterval = null;
let animationFrame = null;

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
    state.current = Math.abs(diff) > 0.01 ? state.current + diff * 0.08 : state.target;
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
    return { label: 'Kuat', note: 'Pergeseran kuat terdeteksi. Buzzer harus aktif.' };
  }
  if (active || value >= 35) {
    return { label: 'Aktif', note: 'Ada getaran atau pergeseran tanah.' };
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

function renderSensorData(data) {
  const soilMoisture = optionalNumber(data.soilMoisture);
  const soilRaw = optionalNumber(data.soilRaw);
  const vibrationLevel = optionalNumber(data.vibrationLevel) || 0;
  const vibrationRaw = optionalNumber(data.vibrationRaw);
  const temperature = optionalNumber(data.temperature);
  const humidity = optionalNumber(data.humidity);
  const thresholds = data.thresholds || {};
  const soilDryRaw = optionalNumber(thresholds.soilDryRaw);
  const soilWetRaw = optionalNumber(thresholds.soilWetRaw);
  const vibrationMaxRaw = optionalNumber(thresholds.vibrationMaxRaw);

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
  autoRefreshInterval = setInterval(fetchSensorData, 3000);
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
});
