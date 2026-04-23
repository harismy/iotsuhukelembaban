#include <WiFi.h>
#include <HTTPClient.h>
#include "DHT.h"

#define DHTPIN 4
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);

const char* ssid = "GANTI_WIFI";
const char* password = "GANTI_PASSWORD_WIFI";

// Ganti 2 value di bawah sesuai output start.sh
const char* API_URL = "http://domain-anda.com/api/v1/readings";
const char* API_KEY = "ISI_DENGAN_API_KEY_DARI_ENV";

unsigned long lastSentAt = 0;
const unsigned long sendIntervalMs = 5000;

void setup() {
  Serial.begin(115200);
  delay(1000);
  dht.begin();

  Serial.print("Menghubungkan WiFi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    Serial.print('.');
    delay(500);
  }

  Serial.println();
  Serial.println("WiFi terhubung");
  Serial.print("IP ESP32: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi putus, reconnect...");
    WiFi.reconnect();
    delay(1000);
    return;
  }

  if (millis() - lastSentAt < sendIntervalMs) {
    delay(100);
    return;
  }

  float suhu = dht.readTemperature();
  float kelembaban = dht.readHumidity();

  if (isnan(suhu) || isnan(kelembaban)) {
    Serial.println("Gagal membaca DHT11");
    delay(1000);
    return;
  }

  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);

  String payload = "{";
  payload += "\"temperature\":" + String(suhu, 1) + ",";
  payload += "\"humidity\":" + String(kelembaban, 1) + ",";
  payload += "\"deviceId\":\"esp32-dht11\"";
  payload += "}";

  int code = http.POST(payload);
  String response = http.getString();

  Serial.print("POST code: ");
  Serial.println(code);
  Serial.print("Response : ");
  Serial.println(response);

  http.end();
  lastSentAt = millis();
}
