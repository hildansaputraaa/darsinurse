#include <Adafruit_NeoPixel.h>
#include <Arduino.h>
#include <hp_BH1750.h>
#include "Seeed_Arduino_mmWave.h"

/* ========================= WIFI + MQTT ========================= */
#if defined(ARDUINO_ARCH_ESP32)
  #include <WiFi.h>
  #include <WiFiManager.h> // https://github.com/tzapu/WiFiManager
#elif defined(ARDUINO_ARCH_ESP8266)
  #include <ESP8266WiFi.h>
  #include <WiFiManager.h> // https://github.com/tzapu/WiFiManager
#elif defined(ARDUINO_UNOWIFIR4)
  #include <WiFiS3.h>
#else
  #include <WiFiNINA.h>
#endif
#include <PubSubClient.h>

// WiFiManager akan menangani kredensial WiFi
// Tidak perlu lagi WIFI_SSID dan WIFI_PASS yang di-hardcode

const char* MQTT_HOST = "103.106.72.181";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_USER = "capstone";
const char* MQTT_PASSW = "hint12345";
const char* MQTT_TOPIC = "hitam";

const char* ROOM_ID = "SUITE-5";
const int   NILAI_SENSOR = 0;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
WiFiManager wifiManager;

/* ========================= WIFI AUTO RECOVERY ========================= */
unsigned long lastWifiCheck = 0;

void wifi_connect() {
  // Set hostname untuk identifikasi lebih mudah
  #if defined(ARDUINO_ARCH_ESP32)
    WiFi.setHostname("MR60FDA2-EXEC3");
  #elif defined(ARDUINO_ARCH_ESP8266)
    WiFi.hostname("MR60FDA2-EXEC3");
  #endif

  // WiFiManager akan membuat AP dengan nama "MR60FDA2-AutoConnect"
  // Jika tidak bisa connect ke WiFi tersimpan, akan membuat portal konfigurasi
  wifiManager.setConfigPortalTimeout(180); // Timeout 3 menit untuk portal konfigurasi
  
  // Custom parameters (opsional - untuk konfigurasi tambahan)
  // WiFiManagerParameter custom_mqtt_server("server", "mqtt server", MQTT_HOST, 40);
  // wifiManager.addParameter(&custom_mqtt_server);
  
  if (!wifiManager.autoConnect("MR60FDA2-SUITE5", "12345678")) {
    Serial.println("Failed to connect and hit timeout");
    // Reset dan coba lagi
    delay(3000);
    ESP.restart();
  }
  
  Serial.println("\nWiFi connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}

void ensure_wifi() {
  if (millis() - lastWifiCheck < 5000) return;
  lastWifiCheck = millis();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost, reconnecting...");
    WiFi.disconnect(true);
    delay(500);
    wifi_connect();
  }
}

// Fungsi untuk reset WiFi settings (panggil jika ingin clear kredensial)
void reset_wifi_settings() {
  Serial.println("Resetting WiFi settings...");
  wifiManager.resetSettings();
  delay(1000);
  ESP.restart();
}
/* =============================================================== */

String makeClientId() {
  String cid = "MR60FDA2-";
#if defined(ARDUINO_ARCH_ESP32)
  cid += String((uint32_t)ESP.getEfuseMac(), HEX);
#elif defined(ARDUINO_ARCH_ESP8266)
  cid += String(ESP.getChipId(), HEX);
#else
  cid += String(millis(), HEX);
#endif
  return cid;
}

void mqtt_callback(char* topic, byte* payload, unsigned int length);

void mqtt_reconnect() {
  if (WiFi.status() != WL_CONNECTED) return;

  while (!mqttClient.connected()) {
    if (mqttClient.connect(makeClientId().c_str(), MQTT_USER, MQTT_PASSW)) {
      mqttClient.subscribe(MQTT_TOPIC);
      Serial.println("MQTT connected");
    } else {
      Serial.println("MQTT retry...");
      delay(3000);
    }
  }
}

/* ========================= HARDWARE ========================= */
#ifdef ESP32
#include <HardwareSerial.h>
HardwareSerial mmwaveSerial(0);
#else
#define mmwaveSerial Serial1
#endif

#define LIGHT_GPIO D0

hp_BH1750 BH1750;
SEEED_MR60FDA2 mmWave;
Adafruit_NeoPixel pixels(1, D1, NEO_GRB + NEO_KHZ800);

void relay_init() { pinMode(LIGHT_GPIO, OUTPUT); }
void relay_on()   { digitalWrite(LIGHT_GPIO, HIGH); }
void relay_off()  { digitalWrite(LIGHT_GPIO, LOW); }

/* ========================= SENSOR PARAM ========================= */
uint32_t sensitivity = 10;
float height = 2.8, threshold = 0.8;
const uint8_t dark_lux = 10;

typedef enum { PEOPLE, NO_PEOPLE, PEOPLE_FALL } MMWAVE_STATUS;
MMWAVE_STATUS status = NO_PEOPLE, last_status = NO_PEOPLE;

float lux = 100;

/* ========================= SETUP ========================= */
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\nStarting MR60FDA2 System...");
  
  mmWave.begin(&mmwaveSerial);

  relay_init();

  pixels.begin();
  pixels.setBrightness(50);
  pixels.setPixelColor(0, pixels.Color(125,125,125));
  pixels.show();

  BH1750.begin(BH1750_TO_GROUND);
  BH1750.start(BH1750_QUALITY_HIGH2, 254);

  mmWave.setInstallationHeight(height);
  mmWave.setThreshold(threshold);
  mmWave.setSensitivity(sensitivity);

  // WiFiManager setup
  Serial.println("Connecting to WiFi...");
  Serial.println("If first time, connect to AP: MR60FDA2-AutoConnect");
  Serial.println("Password: 12345678");
  
  wifi_connect();
  
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqtt_callback);
  mqtt_reconnect();
  
  Serial.println("Setup complete!");
}

/* ========================= LOOP ========================= */
void loop() {
  ensure_wifi();

  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) mqtt_reconnect();
    mqttClient.loop();
  }

  if (mmWave.update(100)) {
    bool h, f;
    mmWave.getHuman(h);
    mmWave.getFall(f);
    status = (!h && !f) ? NO_PEOPLE : (f ? PEOPLE_FALL : PEOPLE);
  }

  /* ===== EVENT-BASED MQTT ===== */
  if (status != last_status) {
    pixels.setPixelColor(0,
      status == PEOPLE ? pixels.Color(0,255,0) :
      status == PEOPLE_FALL ? pixels.Color(255,0,0) :
      pixels.Color(0,0,255));
    pixels.show();

    String eventPayload = String("{\"event\":\"status_change\",\"room_id\":\"") + ROOM_ID +
      "\",\"nilai_sensor\":" + NILAI_SENSOR +
      ",\"status\":\"" +
      (status==PEOPLE?"PEOPLE":status==PEOPLE_FALL?"PEOPLE_FALL":"NO_PEOPLE") +
      "\"}";

    mqttClient.publish(MQTT_TOPIC, eventPayload.c_str());
    last_status = status;
  }

  /* ===== LUX UPDATE ===== */
  if (BH1750.hasValue()) {
    lux = BH1750.getLux();
    BH1750.start(BH1750_QUALITY_HIGH2, 254);
  }

  /* ===== TELEMETRY 15 DETIK ===== */
  static unsigned long lastPub = 0;
  if (millis() - lastPub > 15000) {
    lastPub = millis();

    String telemetry = String("{\"telemetry\":true,\"room_id\":\"") + ROOM_ID +
      "\",\"nilai_sensor\":" + NILAI_SENSOR +
      ",\"status\":\"" +
      (status==PEOPLE?"PEOPLE":status==PEOPLE_FALL?"PEOPLE_FALL":"NO_PEOPLE") +
      "\",\"lux\":" + String(lux,1) +
      ",\"rssi\":" + WiFi.RSSI() + "}";

    mqttClient.publish(MQTT_TOPIC, telemetry.c_str());
  }

  /* ===== RELAY CONTROL ===== */
  if ((status == PEOPLE || status == PEOPLE_FALL) && lux < dark_lux) relay_on();
  else relay_off();
}

/* ========================= MQTT CALLBACK ========================= */
void mqtt_callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (uint8_t i = 0; i < length; i++) msg += (char)payload[i];

  if (msg.indexOf("relay_on") != -1) relay_on();
  if (msg.indexOf("relay_off") != -1) relay_off();
  
  // Tambahan: command untuk reset WiFi settings
  if (msg.indexOf("reset_wifi") != -1) {
    reset_wifi_settings(); 
  }
}
