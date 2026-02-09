/*
  Medloc MR60BHA2 mmWave Gateway - Bug Fixed Version
  Board: ESP32-C6
  
  FIXES:
  - WDT tidak trigger saat WiFiManager portal
  - Memory corruption dari placement new diperbaiki
  - Buffer overflow protection
  - Race condition di callback diperbaiki
*/

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <Adafruit_NeoPixel.h>
#include "Seeed_Arduino_mmWave.h"
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include "esp_task_wdt.h"

// ---------- NTP Configuration ----------
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 25200;     // WIB = GMT+7
const int daylightOffset_sec = 0;

// ---------- Watchdog Timer ----------
#define WDT_TIMEOUT 30  // 30 seconds
bool wdtInitialized = false;

// ---------- MQTT ----------
const char* mqtt_server = "103.106.72.181";
const int mqtt_port = 1883;
const char* mqtt_user = "MEDLOC";
const char* mqtt_pass = "MEDLOC";
const char* mqtt_topic = "rsi/data";

WiFiClient espClient;
PubSubClient mqttClient(espClient);
WiFiManager wm;
Preferences prefs;

// ---------- Custom Parameters ----------
char device_id[33] = "DEVICE_001";  // +1 untuk null terminator
char room_id[33] = "ROOM_A";        // +1 untuk null terminator

// Temporary buffers untuk WiFiManager (harus tetap valid selama portal aktif)
char temp_device_id[33] = "";
char temp_room_id[33] = "";

// ---------- mmWave ----------
#ifdef ESP32
HardwareSerial mmWaveSerial(0);
#else
#define mmWaveSerial Serial1
#endif
SEEED_MR60BHA2 mmWave;

// NeoPixel Configuration
const int pixelPin = D1;
Adafruit_NeoPixel pixels = Adafruit_NeoPixel(1, pixelPin, NEO_GRB + NEO_KHZ800);

// Person presence tracking
bool personPresent = false;
unsigned long lastPresenceTime = 0;
const unsigned long PRESENCE_TIMEOUT = 5000;

// Publish time
unsigned long lastPublishTime = 0;
const unsigned long PUBLISH_INTERVAL = 1000;

// Latest data
float lastBreath = 0;
float lastHeart = 0;
float lastDistance = 0;
bool lastPresence = false;
int lastRSSI = 0;

// WiFi reconnection tracking
unsigned long wifiReconnectAttemptTime = 0;
const unsigned long WIFI_RECONNECT_TIMEOUT = 30000;
bool wifiReconnecting = false;

// NTP sync tracking
bool ntpSynced = false;
unsigned long lastNTPSync = 0;
const unsigned long NTP_SYNC_INTERVAL = 3600000;

// Initialize Watchdog Timer
void initWatchdog() {
  if (wdtInitialized) return;
  
  Serial.println("[WDT] Initializing Watchdog Timer...");
  
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms = WDT_TIMEOUT * 1000,
    .idle_core_mask = 0,
    .trigger_panic = true
  };
  
  esp_task_wdt_init(&wdt_config);
  esp_task_wdt_add(NULL);
  
  wdtInitialized = true;
  Serial.printf("[WDT] Watchdog enabled with %d seconds timeout\n", WDT_TIMEOUT);
}

// Safe watchdog reset
void resetWatchdog() {
  if (wdtInitialized) {
    esp_task_wdt_reset();
  }
}

// Safe string copy with null termination guarantee
void safeStrCopy(char* dest, const char* src, size_t destSize) {
  if (dest == NULL || src == NULL || destSize == 0) return;
  
  strncpy(dest, src, destSize - 1);
  dest[destSize - 1] = '\0';  // Force null termination
}

// Get current timestamp in ISO 8601 format (WIB)
String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "1970-01-01T00:00:00+07:00";
  }
  
  char buffer[30];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%S+07:00", &timeinfo);
  return String(buffer);
}

// Initialize NTP
void initNTP() {
  Serial.println("[NTP] Configuring time...");
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  
  int retry = 0;
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo) && retry < 10) {
    Serial.print(".");
    delay(1000);
    retry++;
    resetWatchdog();
  }
  
  if (getLocalTime(&timeinfo)) {
    ntpSynced = true;
    lastNTPSync = millis();
    Serial.println("\n[NTP] Time synchronized!");
    Serial.printf("[NTP] Current time (WIB): %s\n", getTimestamp().c_str());
  } else {
    Serial.println("\n[NTP] Failed to sync time");
    ntpSynced = false;
  }
}

// Check if NTP needs resync
void checkNTPSync() {
  if (WiFi.status() == WL_CONNECTED && (millis() - lastNTPSync > NTP_SYNC_INTERVAL)) {
    Serial.println("[NTP] Resyncing time...");
    initNTP();
  }
}

// Update NeoPixel based on presence
void updatePresenceLED() {
  if (personPresent) {
    pixels.setPixelColor(0, pixels.Color(0, 0, 255)); // Blue
  } else {
    pixels.setPixelColor(0, pixels.Color(0, 125, 0)); // Green
  }
  pixels.show();
}

// ---------- MQTT ----------
void mqttCallback(char* topic, byte* msg, unsigned int len) {
  Serial.printf("[MQTT] %s: ", topic);
  for (unsigned int i = 0; i < len; i++) Serial.write(msg[i]);
  Serial.println();
}

void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[MQTT] WiFi not connected, checking WiFi first...");
    checkWiFiConnection();
    return;
  }
  
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] Connecting...");
    String id = "ESP32C6_" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqttClient.connect(id.c_str(), mqtt_user, mqtt_pass)) {
      Serial.println("OK");
    } else { 
      Serial.printf("Fail (%d)\n", mqttClient.state()); 
      delay(5000);
      resetWatchdog();
    }
  }
}

// Check and handle WiFi connection
void checkWiFiConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    if (!wifiReconnecting) {
      Serial.println("[WiFi] Connection lost, attempting to reconnect...");
      wifiReconnecting = true;
      wifiReconnectAttemptTime = millis();
      WiFi.reconnect();
    } else {
      if (millis() - wifiReconnectAttemptTime > WIFI_RECONNECT_TIMEOUT) {
        Serial.println("[WiFi] Reconnection timeout! Restarting ESP32...");
        delay(1000);
        ESP.restart();
      }
    }
  } else {
    if (wifiReconnecting) {
      Serial.println("[WiFi] Reconnected successfully!");
      wifiReconnecting = false;
      initNTP();
    }
  }
}

// Publish sensor data as JSON
void publishSensorData(float breath, float heart, float distance, bool presence, int rssi) {
  if (!mqttClient.connected()) return;
  
  StaticJsonDocument<320> doc;
  
  doc["device_id"] = device_id;
  doc["room_id"] = room_id;
  doc["breath_rate"] = breath;
  doc["heart_rate"] = heart;
  doc["distance"] = distance;
  doc["presence"] = presence ? 1 : 0;
  doc["timestamp"] = getTimestamp();
  doc["rssi"] = rssi;
  
  char jsonBuffer[320];
  serializeJson(doc, jsonBuffer);
  
  mqttClient.publish(mqtt_topic, jsonBuffer);
  Serial.printf("[MQTT] Published: %s\n", jsonBuffer);
}

// Save callback for WiFiManager
void saveConfigCallback() {
  Serial.println("[WiFiManager] Configuration saved!");
  
  // Baca nilai dari temporary buffers yang masih valid
  safeStrCopy(device_id, temp_device_id, sizeof(device_id));
  safeStrCopy(room_id, temp_room_id, sizeof(room_id));
  
  // Validasi input tidak kosong
  if (strlen(device_id) == 0) {
    safeStrCopy(device_id, "DEVICE_001", sizeof(device_id));
    Serial.println("[Config] Device ID empty, using default");
  }
  
  if (strlen(room_id) == 0) {
    safeStrCopy(room_id, "ROOM_A", sizeof(room_id));
    Serial.println("[Config] Room ID empty, using default");
  }
  
  // Save to preferences
  prefs.begin("medloc", false);
  prefs.putString("device_id", device_id);
  prefs.putString("room_id", room_id);
  prefs.end();
  
  Serial.printf("[Config] Device ID: %s\n", device_id);
  Serial.printf("[Config] Room ID: %s\n", room_id);
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);
  delay(200);
  
  Serial.println("\n=== Medloc mmWave Gateway (Bug Fixed) ===");
  Serial.println("[INFO] Watchdog will be initialized AFTER WiFi setup");
  Serial.println("Type 'RESET_WIFI' in Serial Monitor to reset WiFi settings");

  // Load saved configuration
  prefs.begin("medloc", true);
  String saved_device = prefs.getString("device_id", "DEVICE_001");
  String saved_room = prefs.getString("room_id", "ROOM_A");
  prefs.end();
  
  safeStrCopy(device_id, saved_device.c_str(), sizeof(device_id));
  safeStrCopy(room_id, saved_room.c_str(), sizeof(room_id));
  
  Serial.printf("[Config] Loaded - Device ID: %s\n", device_id);
  Serial.printf("[Config] Loaded - Room ID: %s\n", room_id);

  // NeoPixel - Start with green (idle)
  pixels.begin(); 
  pixels.setBrightness(50);
  pixels.setPixelColor(0, pixels.Color(0, 125, 0)); 
  pixels.show();

  // Prepare temporary buffers with current values
  safeStrCopy(temp_device_id, device_id, sizeof(temp_device_id));
  safeStrCopy(temp_room_id, room_id, sizeof(temp_room_id));
  
  // Create WiFiManager parameters (SATU KALI SAJA, tidak di-recreate)
  WiFiManagerParameter custom_device_id("device_id", "Device ID", temp_device_id, 32);
  WiFiManagerParameter custom_room_id("room_id", "Room ID", temp_room_id, 32);
  
  // WiFiManager setup
  wm.addParameter(&custom_device_id);
  wm.addParameter(&custom_room_id);
  wm.setSaveConfigCallback(saveConfigCallback);
  wm.setConfigPortalTimeout(120); // 2 minutes
  
  // Visual indicator: Portal mode = Orange blinking
  Serial.println("[WiFi] Starting WiFi setup...");
  for (int i = 0; i < 3; i++) {
    pixels.setPixelColor(0, pixels.Color(255, 165, 0)); // Orange
    pixels.show();
    delay(300);
    pixels.setPixelColor(0, pixels.Color(0, 0, 0));
    pixels.show();
    delay(300);
  }
  
  // Use Device ID as AP name
  String ap_name = "MMW_" + String(device_id);
  Serial.printf("[WiFi] AP Name: %s\n", ap_name.c_str());
  
  bool res = wm.autoConnect(ap_name.c_str(), "bismillah123");
  
  // Copy final values from WiFiManager parameters to temp buffers
  // Ini penting karena getValue() pointer valid selama objek parameter ada
  if (custom_device_id.getValue() != NULL) {
    safeStrCopy(temp_device_id, custom_device_id.getValue(), sizeof(temp_device_id));
  }
  if (custom_room_id.getValue() != NULL) {
    safeStrCopy(temp_room_id, custom_room_id.getValue(), sizeof(temp_room_id));
  }
  
  // WiFi setup done - NOW initialize watchdog
  Serial.println("[WiFi] Setup completed!");
  initWatchdog();
  
  if (res) {
    Serial.println("[WiFi] Connected!");
    // saveConfigCallback sudah dipanggil otomatis oleh WiFiManager jika ada perubahan
    
    // Copy final values ke global variables
    safeStrCopy(device_id, temp_device_id, sizeof(device_id));
    safeStrCopy(room_id, temp_room_id, sizeof(room_id));
    
    initNTP();
  } else {
    Serial.println("[WiFi] Continue without AP...");
  }
  
  Serial.print("IP: "); Serial.println(WiFi.localIP());

  // MQTT
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);

  // mmWave
  mmWave.begin(&mmWaveSerial);
  Serial.println("[mmWave] Initialized");
  
  Serial.println("[Setup] Complete! System running...\n");
}

void loop() {
  resetWatchdog();
  
  // Check for Serial commands
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();
    
    if (cmd == "RESET_WIFI") {
      Serial.println("\n[CMD] =============================");
      Serial.println("[CMD] WiFi Reset Command Received!");
      Serial.println("[CMD] =============================");
      
      for (int i = 0; i < 5; i++) {
        pixels.setPixelColor(0, pixels.Color(255, 0, 0));
        pixels.show();
        delay(200);
        pixels.setPixelColor(0, pixels.Color(0, 0, 0));
        pixels.show();
        delay(200);
        resetWatchdog();
      }
      
      Serial.println("[CMD] Clearing WiFi settings...");
      wm.resetSettings();
      
      Serial.println("[CMD] Clearing saved preferences...");
      prefs.begin("medloc", false);
      prefs.clear();
      prefs.end();
      
      Serial.println("[CMD] Reset complete! Restarting ESP32...");
      delay(2000);
      ESP.restart();
    }
    else if (cmd == "STATUS") {
      Serial.println("\n[STATUS] =============================");
      Serial.printf("[STATUS] Device ID: %s\n", device_id);
      Serial.printf("[STATUS] Room ID: %s\n", room_id);
      Serial.printf("[STATUS] WiFi: %s\n", WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
      Serial.printf("[STATUS] IP: %s\n", WiFi.localIP().toString().c_str());
      Serial.printf("[STATUS] MQTT: %s\n", mqttClient.connected() ? "Connected" : "Disconnected");
      Serial.printf("[STATUS] Person Present: %s\n", personPresent ? "YES" : "NO");
      Serial.printf("[STATUS] NTP Synced: %s\n", ntpSynced ? "YES" : "NO");
      Serial.printf("[STATUS] Current Time (WIB): %s\n", getTimestamp().c_str());
      Serial.printf("[STATUS] Uptime: %lu seconds\n", millis() / 1000);
      Serial.printf("[STATUS] Watchdog: %s\n", wdtInitialized ? "ACTIVE" : "INACTIVE");
      Serial.println("[STATUS] =============================\n");
    }
    else if (cmd == "TIME") {
      Serial.println("\n[TIME] Current Time Info:");
      Serial.printf("[TIME] ISO 8601: %s\n", getTimestamp().c_str());
      Serial.printf("[TIME] NTP Synced: %s\n", ntpSynced ? "YES" : "NO");
      Serial.println();
    }
    else if (cmd == "HELP") {
      Serial.println("\n[HELP] Available Commands:");
      Serial.println("  RESET_WIFI - Clear WiFi settings and restart");
      Serial.println("  STATUS     - Show current device status");
      Serial.println("  TIME       - Show current time information");
      Serial.println("  HELP       - Show this help message\n");
    }
  }
  
  checkWiFiConnection();
  checkNTPSync();
  
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) connectMQTT();
    mqttClient.loop();
  }

  // mmWave - Read sensor data
  if (mmWave.update(100)) {
    float breath = 0, heart = 0, dist = 0;
    
    mmWave.getBreathRate(breath);
    mmWave.getHeartRate(heart);
    int rssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -999;

    if (mmWave.getDistance(dist)) {
      if (dist > 0 && dist < 300) {
        personPresent = true;
        lastPresenceTime = millis();
      }
    }
    
    lastBreath = breath;
    lastHeart = heart;
    lastDistance = dist;
    lastPresence = personPresent;
    lastRSSI = rssi;
    
    Serial.printf("[mmWave] Breath: %.2f | Heart: %.2f | Dist: %.2f | Presence: %s | RSSI: %d dBm\n",
                  breath, heart, dist, personPresent ? "YES" : "NO", rssi);
  }

  // Check presence timeout
  if (personPresent && (millis() - lastPresenceTime > PRESENCE_TIMEOUT)) {
    personPresent = false;
    lastPresence = false;
    Serial.println("[Presence] Person left");
  }

  updatePresenceLED();

  // Publish to MQTT
  if (millis() - lastPublishTime >= PUBLISH_INTERVAL) {
    lastPublishTime = millis();
    
    if (WiFi.status() == WL_CONNECTED && mqttClient.connected()) {
      publishSensorData(lastBreath, lastHeart, lastDistance, lastPresence, lastRSSI);
    }
  }

  yield();
}
