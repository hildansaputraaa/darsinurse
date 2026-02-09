/*
  Medloc MR60BHA2 mmWave Gateway - BLE Only Version
  Board: ESP32-C6
  
  FEATURES:
  - BLE Heart Rate Service (Standard UUID: 0x180D)
  - Heart Rate Measurement Characteristic (Standard UUID: 0x2A37)
  - 1-minute averaged heart rate data
  - Simple and lightweight - BLE only!
*/

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "Seeed_Arduino_mmWave.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ---------- BLE UUIDs (Standard Heart Rate Service) ----------
#define HR_SERVICE_UUID        "0000180D-0000-1000-8000-00805F9B34FB"  // Heart Rate Service
#define HR_MEASUREMENT_UUID    "00002A37-0000-1000-8000-00805F9B34FB"  // Heart Rate Measurement

// Device Configuration
const char* DEVICE_NAME = "MR60_HR_Monitor";

// BLE Objects
BLEServer* pServer = NULL;
BLECharacteristic* pHRCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Heart Rate Averaging (1 minute)
#define HR_BUFFER_SIZE 60  // Store 60 samples (1 per second for 1 minute)
float hrBuffer[HR_BUFFER_SIZE];
int hrBufferIndex = 0;
int hrSampleCount = 0;
unsigned long lastHRSampleTime = 0;
const unsigned long HR_SAMPLE_INTERVAL = 1000;  // 1 second

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

// Latest data
float lastBreath = 0;
float lastHeart = 0;
float lastDistance = 0;

// ---------- BLE Callbacks ----------
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("[BLE] Client connected");
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("[BLE] Client disconnected");
    }
};

// Initialize BLE
void initBLE() {
  Serial.println("[BLE] Initializing BLE...");
  
  // Create BLE Device
  BLEDevice::init(DEVICE_NAME);
  
  // Create BLE Server
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  
  // Create Heart Rate Service
  BLEService *pHRService = pServer->createService(HR_SERVICE_UUID);
  
  // Create Heart Rate Measurement Characteristic
  pHRCharacteristic = pHRService->createCharacteristic(
                        HR_MEASUREMENT_UUID,
                        BLECharacteristic::PROPERTY_READ |
                        BLECharacteristic::PROPERTY_NOTIFY
                      );
  
  // Add Client Characteristic Configuration Descriptor (for notifications)
  pHRCharacteristic->addDescriptor(new BLE2902());
  
  // Start the service
  pHRService->start();
  
  // Start advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(HR_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  
  Serial.printf("[BLE] Advertising as: %s\n", DEVICE_NAME);
  Serial.println("[BLE] Heart Rate Service ready");
}

// Calculate average heart rate from buffer
float getAverageHeartRate() {
  if (hrSampleCount == 0) return 0;
  
  float sum = 0;
  int validSamples = 0;
  
  for (int i = 0; i < hrSampleCount; i++) {
    if (hrBuffer[i] > 0) {  // Only count valid readings
      sum += hrBuffer[i];
      validSamples++;
    }
  }
  
  if (validSamples == 0) return 0;
  return sum / validSamples;
}

// Add heart rate sample to buffer
void addHeartRateSample(float hr) {
  hrBuffer[hrBufferIndex] = hr;
  hrBufferIndex = (hrBufferIndex + 1) % HR_BUFFER_SIZE;
  
  if (hrSampleCount < HR_BUFFER_SIZE) {
    hrSampleCount++;
  }
}

// Send BLE Heart Rate Notification
void sendBLEHeartRate(uint8_t heartRate) {
  if (deviceConnected) {
    // Heart Rate Measurement format:
    // Byte 0: Flags (bit 0 = 0 means HR is uint8)
    // Byte 1: Heart Rate Value (uint8)
    uint8_t hrData[2];
    hrData[0] = 0x00;  // Flags: HR value format is UINT8
    hrData[1] = heartRate;
    
    pHRCharacteristic->setValue(hrData, 2);
    pHRCharacteristic->notify();
    
    Serial.printf("[BLE] Sent HR: %d bpm (1-min avg)\n", heartRate);
  }
}

// Update NeoPixel based on presence and BLE connection
void updatePresenceLED() {
  if (deviceConnected) {
    pixels.setPixelColor(0, pixels.Color(128, 0, 128)); // Purple = BLE connected
  } else if (personPresent) {
    pixels.setPixelColor(0, pixels.Color(0, 0, 255)); // Blue = Person present
  } else {
    pixels.setPixelColor(0, pixels.Color(0, 125, 0)); // Green = Idle
  }
  pixels.show();
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);
  delay(200);
  
  Serial.println("\n=== Medloc MR60BHA2 - BLE Only Version ===");
  Serial.println("[INFO] Simple BLE Heart Rate Monitor");
  Serial.println("Type 'STATUS' for device information\n");

  // Initialize HR buffer
  for (int i = 0; i < HR_BUFFER_SIZE; i++) {
    hrBuffer[i] = 0;
  }

  // NeoPixel - Start with green
  pixels.begin(); 
  pixels.setBrightness(50);
  pixels.setPixelColor(0, pixels.Color(0, 125, 0)); 
  pixels.show();

  // mmWave
  mmWave.begin(&mmWaveSerial);
  Serial.println("[mmWave] Initialized");
  
  // Initialize BLE
  initBLE();
  
  Serial.println("[Setup] Complete! System running...\n");
}

void loop() {
  // Handle BLE connection changes
  if (!deviceConnected && oldDeviceConnected) {
    delay(500); // give the bluetooth stack time to get things ready
    pServer->startAdvertising(); // restart advertising
    Serial.println("[BLE] Restarting advertising");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }
  
  // Check for Serial commands
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();
    
    if (cmd == "STATUS") {
      Serial.println("\n[STATUS] =============================");
      Serial.printf("[STATUS] Device Name: %s\n", DEVICE_NAME);
      Serial.printf("[STATUS] BLE: %s\n", deviceConnected ? "Client Connected" : "Advertising");
      Serial.printf("[STATUS] Person Present: %s\n", personPresent ? "YES" : "NO");
      Serial.printf("[STATUS] Current HR: %.1f bpm\n", lastHeart);
      Serial.printf("[STATUS] HR Samples: %d/60\n", hrSampleCount);
      Serial.printf("[STATUS] Avg HR: %.1f bpm\n", getAverageHeartRate());
      Serial.printf("[STATUS] Breath Rate: %.1f\n", lastBreath);
      Serial.printf("[STATUS] Distance: %.1f cm\n", lastDistance);
      Serial.printf("[STATUS] Uptime: %lu seconds\n", millis() / 1000);
      Serial.println("[STATUS] =============================\n");
    }
    else if (cmd == "HELP") {
      Serial.println("\n[HELP] Available Commands:");
      Serial.println("  STATUS - Show current device status");
      Serial.println("  HELP   - Show this help message\n");
    }
  }
  
  // mmWave - Read sensor data
  if (mmWave.update(100)) {
    float breath = 0, heart = 0, dist = 0;
    
    mmWave.getBreathRate(breath);
    mmWave.getHeartRate(heart);

    if (mmWave.getDistance(dist)) {
      if (dist > 0 && dist < 300) {
        personPresent = true;
        lastPresenceTime = millis();
      }
    }
    
    lastBreath = breath;
    lastHeart = heart;
    lastDistance = dist;
    
    Serial.printf("[mmWave] Breath: %.2f | Heart: %.2f | Dist: %.2f | Presence: %s\n",
                  breath, heart, dist, personPresent ? "YES" : "NO");
  }

  // Sample heart rate every second for averaging
  if (millis() - lastHRSampleTime >= HR_SAMPLE_INTERVAL) {
    lastHRSampleTime = millis();
    
    if (lastHeart > 0) {  // Only add valid readings
      addHeartRateSample(lastHeart);
      
      // Calculate and send averaged heart rate via BLE
      float avgHR = getAverageHeartRate();
      if (avgHR > 0 && avgHR <= 255) {  // Valid range for uint8
        sendBLEHeartRate((uint8_t)avgHR);
      }
      
      Serial.printf("[HR Buffer] Current: %.1f | Avg (1-min): %.1f | Samples: %d/60\n", 
                    lastHeart, avgHR, hrSampleCount);
    }
  }

  // Check presence timeout
  if (personPresent && (millis() - lastPresenceTime > PRESENCE_TIMEOUT)) {
    personPresent = false;
    Serial.println("[Presence] Person left");
  }

  updatePresenceLED();

  yield();
}
