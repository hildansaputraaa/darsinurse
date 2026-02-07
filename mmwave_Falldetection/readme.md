# 🧠 Smart Room IoT Monitoring – MR60FDA2

> 📡 Sistem IoT untuk deteksi keberadaan manusia, fall detection, dan otomatisasi lampu menggunakan mmWave Radar, sensor cahaya, dan MQTT.

---

## 📌 Overview

Project ini merupakan sistem **IoT Smart Room** berbasis **ESP32/ESP8266** yang menggunakan **Seeed MR60FDA2 mmWave Radar** dan **BH1750 Light Sensor**. Sistem mampu mendeteksi keberadaan manusia, kondisi jatuh (fall detection), serta mengontrol lampu ruangan secara otomatis berdasarkan intensitas cahaya. Data dikirim dan dimonitor melalui **MQTT**.

Project ini terinspirasi dan disusun dengan gaya dokumentasi seperti repository IoT pada umumnya dan cocok untuk **Smart Building**, **Smart Hotel**, maupun **Capstone Project**.

---

## 🧩 System Architecture

```
        ┌───────────────────────────────────────────────┐
        │                Smart Room IoT                 │
        ├───────────────────────────────────────────────┤
        │                                               │
        │  mmWave Radar     BH1750 Light Sensor          │
        │     │                   │                     │
        │     ▼                   ▼                     │
        │  ESP32/ESP8266 ── Logic Control ── Relay Lamp │
        │         │                  │                  │
        │         ▼                  ▼                  │
        │       MQTT Client → MQTT Broker                │
        │                                               │
        │      WiFiManager Auto Config Portal            │
        │                                               │
        └───────────────────────────────────────────────┘
```

---

## 🚀 Features

* 🎯 Human Presence Detection (PEOPLE / NO_PEOPLE)
* 🚨 Fall Detection (PEOPLE_FALL)
* 💡 Automatic Lamp Control using Relay
* 🌗 Light Intensity Detection (Lux)
* 📡 MQTT Publish & Subscribe
* 🔄 Event-based MQTT (on status change)
* ⏱️ Telemetry data every 15 seconds
* 🌐 WiFi Auto Connect & Recovery
* ⚙️ WiFi Configuration Portal (WiFiManager)
* 🎨 NeoPixel LED Status Indicator

---

## 🛠️ Hardware Requirements

* ESP32 / ESP8266
* Seeed Studio MR60FDA2 mmWave Radar
* BH1750 Light Intensity Sensor
* Relay Module
* NeoPixel LED

---

## 📚 Libraries Used

* Adafruit NeoPixel
* hp_BH1750
* Seeed_Arduino_mmWave
* PubSubClient
* WiFiManager

---

## ⚙️ MQTT Configuration

```cpp
const char* MQTT_HOST  = "103.106.72.181";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_USER  = "capstone";
const char* MQTT_PASSW = "hint12345";
const char* MQTT_TOPIC = "hitam";
```

---

## 📡 MQTT Payload Format

### Status Change

```json
{
  "event": "status_change",
  "room_id": "SUITE-5",
  "nilai_sensor": 0,
  "status": "PEOPLE"
}
```

### Telemetry (15 Seconds)

```json
{
  "telemetry": true,
  "room_id": "SUITE-5",
  "nilai_sensor": 0,
  "status": "NO_PEOPLE",
  "lux": 8.7,
  "rssi": -67
}
```

---

## 🧠 System Logic

* Lamp **ON** if:

  * Human detected or fall detected
  * Light intensity < 10 lux

* Lamp **OFF** if:

  * No human detected
  * Light intensity ≥ 10 lux

---

## 🎨 LED Indicator

| Status      | Color    |
| ----------- | -------- |
| PEOPLE      | 🟢 Green |
| PEOPLE_FALL | 🔴 Red   |
| NO_PEOPLE   | 🔵 Blue  |

---

## 🌐 WiFiManager

* **AP Name**: MR60FDA2-SUITE5
* **Password**: 12345678

### MQTT Commands

* `relay_on` → Turn lamp ON
* `relay_off` → Turn lamp OFF
* `reset_wifi` → Reset WiFi credentials

---

## ▶️ How to Use

1. Open project in Arduino IDE
2. Install required libraries
3. Select ESP32 / ESP8266 board
4. Upload code to device
5. Connect to WiFiManager AP if needed

---

## 📂 Project Structure

```
├── main.ino
└── README.md
```

---

## 🎓 Project Purpose

This project is developed as part of an **IoT Capstone / Smart Room Automation System**, focusing on safety monitoring and energy efficiency.

---

## 📜 License

MIT License

---

✨ Built with Arduino, MQTT, and mmWave Radar
