#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>

// Ganti sesuai WiFi.
const char* WIFI_SSID = "TECNO POVA 7 5G";
const char* WIFI_PASSWORD = "201219[]Mycan";

// Ganti sesuai output start.sh di VPS.
const char* API_URL = "https://silong.iotukri.online/api/v1/readings";
const char* API_KEY = "vdhfehr7387ggjjhjdvdhhfjb00283267562eyghdsxbjhcgd627839483uywfgdvshcjdty12t734i3rwejhdbslkjou987r43uyesdihgctycghvjey3f6y4u3ig4ewgudsyt";

// Pin alat sesuai laporan UAS.
#define SOIL_PIN 34
#define VIBRATION_PIN 27
#define BUZZER_PIN 26

// Sensor suhu opsional. Ubah USE_DHT ke false jika tidak memasang DHT11/DHT22.
#define USE_DHT true
#define DHTPIN 4
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

// Kalibrasi soil capacitive. Sesuaikan dari hasil Serial Monitor.
const int SOIL_DRY_RAW = 3200;
const int SOIL_WET_RAW = 1200;

// Banyak modul SW-420 bernilai HIGH saat getaran aktif.
const int VIBRATION_ACTIVE_STATE = HIGH;
const int VIBRATION_MAX_RAW = 4;

const unsigned long TELEMETRY_INTERVAL_MS = 1000;
const unsigned long MIN_EVENT_SEND_GAP_MS = 250;
const unsigned long VIBRATION_SAMPLE_MS = 160;
const unsigned long VIBRATION_CONFIRM_MS = 3000;
const unsigned long VIBRATION_RESET_GRACE_MS = 450;
const unsigned long BUZZER_HOLD_MS = 6000;
const unsigned long DHT_INTERVAL_MS = 2500;
unsigned long lastSentAt = 0;
unsigned long buzzerHoldUntil = 0;
unsigned long vibrationStartedAt = 0;
unsigned long lastVibrationSeenAt = 0;
unsigned long lastDhtReadMs = 0;
bool lastSentBuzzer = false;
bool lastSentDanger = false;
int lastSentSoilMoisture = -1;
int lastSentVibrationLevel = -1;
float lastTemperature = NAN;
float lastHumidity = NAN;
WiFiClientSecure secureClient;

int clampInt(int value, int minValue, int maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

int soilPercentFromRaw(int raw) {
  if (SOIL_DRY_RAW == SOIL_WET_RAW) {
    return 0;
  }

  int percent = map(raw, SOIL_DRY_RAW, SOIL_WET_RAW, 0, 100);
  return clampInt(percent, 0, 100);
}

int readVibrationRaw(bool* active) {
  unsigned long start = millis();
  int pulses = 0;
  int previousState = digitalRead(VIBRATION_PIN);

  while (millis() - start < VIBRATION_SAMPLE_MS) {
    int state = digitalRead(VIBRATION_PIN);
    if (state == VIBRATION_ACTIVE_STATE && previousState != VIBRATION_ACTIVE_STATE) {
      pulses++;
    }
    previousState = state;
    delay(2);
  }

  *active = pulses > 0 || digitalRead(VIBRATION_PIN) == VIBRATION_ACTIVE_STATE;
  return pulses;
}

int vibrationPercentFromRaw(int raw) {
  if (VIBRATION_MAX_RAW <= 0) {
    return 0;
  }

  int percent = map(raw, 0, VIBRATION_MAX_RAW, 0, 100);
  return clampInt(percent, 0, 100);
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WiFi] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("[WiFi] Connected, IP: ");
  Serial.println(WiFi.localIP());
}

bool postReading(
  int soilRaw,
  int soilMoisture,
  bool vibration,
  int vibrationLevel,
  int vibrationRaw,
  unsigned long vibrationDurationMs,
  bool buzzer,
  float temperature,
  float humidity
) {
  HTTPClient http;
  if (String(API_URL).startsWith("https://")) {
    http.begin(secureClient, API_URL);
  } else {
    http.begin(API_URL);
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);

  String payload = "{";
  payload += "\"deviceId\":\"esp32-longsor-uas\",";
  payload += "\"soilRaw\":" + String(soilRaw) + ",";
  payload += "\"soilMoisture\":" + String(soilMoisture) + ",";
  payload += "\"vibration\":" + String(vibration ? "true" : "false") + ",";
  payload += "\"vibrationRaw\":" + String(vibrationRaw) + ",";
  payload += "\"vibrationLevel\":" + String(vibrationLevel) + ",";
  payload += "\"vibrationDurationMs\":" + String(vibrationDurationMs) + ",";
  payload += "\"buzzer\":" + String(buzzer ? "true" : "false");

  if (!isnan(temperature)) {
    payload += ",\"temperature\":" + String(temperature, 1);
  }
  if (!isnan(humidity)) {
    payload += ",\"humidity\":" + String(humidity, 1);
  }
  payload += "}";

  int code = http.POST(payload);
  String response = http.getString();
  http.end();

  Serial.print("[HTTP] code=");
  Serial.print(code);
  Serial.print(" payload=");
  Serial.println(payload);
  Serial.print("[HTTP] response=");
  Serial.println(response);

  return code >= 200 && code < 300;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(VIBRATION_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  analogReadResolution(12);
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);

  if (USE_DHT) {
    dht.begin();
  }

  secureClient.setInsecure();
  connectWiFi();
}

void loop() {
  connectWiFi();
  unsigned long now = millis();

  int soilRaw = analogRead(SOIL_PIN);
  int soilMoisture = soilPercentFromRaw(soilRaw);

  bool vibration = false;
  int vibrationRaw = readVibrationRaw(&vibration);
  int vibrationLevel = vibrationPercentFromRaw(vibrationRaw);

  if (USE_DHT && (lastDhtReadMs == 0 || now - lastDhtReadMs >= DHT_INTERVAL_MS)) {
    float temperatureRead = dht.readTemperature();
    float humidityRead = dht.readHumidity();
    if (!isnan(temperatureRead)) {
      lastTemperature = temperatureRead;
    }
    if (!isnan(humidityRead)) {
      lastHumidity = humidityRead;
    }
    lastDhtReadMs = now;
  }

  float temperature = lastTemperature;
  float humidity = lastHumidity;
  bool cold = !isnan(temperature) && temperature <= 24.0;
  bool wetSoil = soilMoisture >= 70;
  bool vibrationPresent = vibration || vibrationLevel >= 25;

  if (vibrationPresent) {
    lastVibrationSeenAt = now;
    if (vibrationStartedAt == 0) {
      vibrationStartedAt = now;
    }
  } else if (vibrationStartedAt != 0 && now - lastVibrationSeenAt > VIBRATION_RESET_GRACE_MS) {
    vibrationStartedAt = 0;
  }

  unsigned long vibrationDurationMs = vibrationStartedAt == 0 ? 0 : now - vibrationStartedAt;
  bool vibrationConfirmed = vibrationDurationMs >= VIBRATION_CONFIRM_MS;
  bool danger = vibrationConfirmed;

  if (danger) {
    buzzerHoldUntil = now + BUZZER_HOLD_MS;
  }

  bool buzzer = now < buzzerHoldUntil;
  digitalWrite(BUZZER_PIN, buzzer ? HIGH : LOW);

  bool telemetryDue = now - lastSentAt >= TELEMETRY_INTERVAL_MS;
  bool stateChanged = buzzer != lastSentBuzzer || danger != lastSentDanger;
  bool valueChanged = lastSentSoilMoisture < 0 ||
    abs(soilMoisture - lastSentSoilMoisture) >= 3 ||
    abs(vibrationLevel - lastSentVibrationLevel) >= 8;
  bool eventSendAllowed = now - lastSentAt >= MIN_EVENT_SEND_GAP_MS;
  bool shouldSend = telemetryDue || ((stateChanged || danger || valueChanged) && eventSendAllowed);

  if (!shouldSend) {
    delay(20);
    return;
  }

  bool sent = postReading(soilRaw, soilMoisture, vibration, vibrationLevel, vibrationRaw, vibrationDurationMs, buzzer, temperature, humidity);
  lastSentAt = millis();
  lastSentBuzzer = buzzer;
  lastSentDanger = danger;
  lastSentSoilMoisture = soilMoisture;
  lastSentVibrationLevel = vibrationLevel;
  Serial.println(sent ? "[SEND] ok" : "[SEND] failed");
}
