const DATA_ENDPOINT = '/api/v1/latest';

const tempElem = document.getElementById('temperatureValue');
const humElem = document.getElementById('humidityValue');
const tempNeedle = document.getElementById('tempNeedle');
const humNeedle = document.getElementById('humNeedle');
const tempArc = document.getElementById('tempArc');
const humArc = document.getElementById('humArc');

const lastUpdateElem = document.getElementById('sensorLastUpdate');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const refreshBtn = document.getElementById('refreshBtn');
const realtimeClock = document.getElementById('realtimeClock');

let isFetching = false;
let autoRefreshInterval = null;
let clockInterval = null;
let animationFrame = null;

const gaugeConfig = {
  temperature: { min: 0, max: 50, valueElem: tempElem, needleElem: tempNeedle, arcElem: tempArc },
  humidity: { min: 0, max: 100, valueElem: humElem, needleElem: humNeedle, arcElem: humArc },
};

const gaugeState = {
  temperature: { current: 0, target: 0, initialized: false },
  humidity: { current: 0, target: 0, initialized: false },
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getCurrentTimeString(date = new Date()) {
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function updateConnectionUI(isOnline, errorMsg = '') {
  if (isOnline) {
    statusDot.className = 'status-dot online';
    statusText.innerText = 'Tersambung (realtime)';
    return;
  }

  statusDot.className = 'status-dot offline';
  statusText.innerText = errorMsg || 'Gagal terhubung';
}

function updateClock() {
  realtimeClock.innerText = getCurrentTimeString();
}

function renderGauge(name, value) {
  const config = gaugeConfig[name];
  const normalized = clamp((value - config.min) / (config.max - config.min), 0, 1);
  const angle = -120 + normalized * 240;

  config.valueElem.innerText = value.toFixed(1);
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
  for (const key of Object.keys(gaugeState)) {
    const state = gaugeState[key];
    if (!state.initialized) {
      continue;
    }

    const diff = state.target - state.current;
    if (Math.abs(diff) > 0.01) {
      state.current += diff * 0.08;
    } else {
      state.current = state.target;
    }

    renderGauge(key, state.current);
  }

  animationFrame = requestAnimationFrame(animationLoop);
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
    const data = payload.data || {};
    const temperature = Number(data.temperature);
    const humidity = Number(data.humidity);

    if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) {
      throw new Error('Nilai sensor tidak valid');
    }

    setGaugeTarget('temperature', temperature);
    setGaugeTarget('humidity', humidity);

    if (data.receivedAt) {
      const receivedDate = new Date(data.receivedAt);
      lastUpdateElem.innerText = getCurrentTimeString(receivedDate);
    } else {
      lastUpdateElem.innerText = getCurrentTimeString();
    }

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
    lastUpdateElem.innerText = `${getCurrentTimeString()} (gagal)`;
  } finally {
    isFetching = false;
  }
}

function manualRefresh() {
  fetchSensorData();
  refreshBtn.style.transform = 'scale(0.96)';
  setTimeout(() => {
    refreshBtn.style.transform = '';
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
  refreshBtn.addEventListener('click', manualRefresh);
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
