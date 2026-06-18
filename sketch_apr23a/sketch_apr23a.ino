#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>

// Ganti sesuai WiFi.
const char* WIFI_SSID = "NAMA_WIFI";
const char* WIFI_PASSWORD = "PASSWORD_WIFI";

// Ganti sesuai output start.sh di VPS.
const char* API_URL = "https://domain-anda.com/api/v1/readings";
const char* API_KEY = "isi_api_key_yang_sama_dengan_env";

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
const int VIBRATION_MAX_RAW = 12;

const unsigned long SEND_INTERVAL_MS = 5000;
const unsigned long VIBRATION_SAMPLE_MS = 800;
unsigned long lastSentAt = 0;
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
    delay(5);
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

  if (millis() - lastSentAt < SEND_INTERVAL_MS) {
    delay(100);
    return;
  }
  lastSentAt = millis();

  int soilRaw = analogRead(SOIL_PIN);
  int soilMoisture = soilPercentFromRaw(soilRaw);

  bool vibration = false;
  int vibrationRaw = readVibrationRaw(&vibration);
  int vibrationLevel = vibrationPercentFromRaw(vibrationRaw);

  float temperature = NAN;
  float humidity = NAN;
  if (USE_DHT) {
    temperature = dht.readTemperature();
    humidity = dht.readHumidity();
  }

  bool cold = !isnan(temperature) && temperature <= 24.0;
  bool wetSoil = soilMoisture >= 70;
  bool strongMovement = vibrationLevel >= 70;
  bool danger = strongMovement || (wetSoil && vibration) || (wetSoil && cold && vibration);

  digitalWrite(BUZZER_PIN, danger ? HIGH : LOW);

  bool sent = postReading(soilRaw, soilMoisture, vibration, vibrationLevel, vibrationRaw, danger, temperature, humidity);
  Serial.println(sent ? "[SEND] ok" : "[SEND] failed");
}
