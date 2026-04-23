const DATA_ENDPOINT = '/api/v1/latest';

const tempElem = document.getElementById('temperatureValue');
const humElem = document.getElementById('humidityValue');
const lastUpdateElem = document.getElementById('sensorLastUpdate');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const refreshBtn = document.getElementById('refreshBtn');
const realtimeClock = document.getElementById('realtimeClock');

let isFetching = false;
let autoRefreshInterval = null;
let clockInterval = null;

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

    tempElem.innerText = temperature.toFixed(1);
    humElem.innerText = humidity.toFixed(1);

    if (data.receivedAt) {
      const receivedDate = new Date(data.receivedAt);
      lastUpdateElem.innerText = getCurrentTimeString(receivedDate);
    } else {
      lastUpdateElem.innerText = getCurrentTimeString();
    }

    updateConnectionUI(true);

    tempElem.style.transform = 'scale(1.02)';
    humElem.style.transform = 'scale(1.02)';
    setTimeout(() => {
      tempElem.style.transform = '';
      humElem.style.transform = '';
    }, 150);
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
});
