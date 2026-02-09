# Medloc MR60BHA2 ESP32-C6 Firmware

This repository contains **two separate firmware implementations** for the **Seeed MR60BHA2 mmWave sensor** running on **ESP32-C6**, each targeting a **different clinical deployment context**.

The firmwares are intentionally split and **must not be merged**.

---

## Firmware Overview

| Firmware | File | Deployment | Connectivity |
|--------|------|-----------|--------------|
| BLE Trend Device | `MR60BHA2_ESP32-C6_BLE.ino` | Outpatient / On-the-way (Pocket Device) | BLE |
| WiFi Room Monitor | `MR60BHA2_ESP32-C6_WiFi.ino` | Selected Patient Rooms | WiFi + MQTT |

---

## 1. BLE Trend Device (Outpatient)

**File:**  
`MR60BHA2_ESP32-C6_BLE.ino`

### Purpose
This firmware is designed as a **portable outpatient monitoring device** used while the patient is **in transit or outside monitored rooms**.

The device provides **trend-level physiological data** and is **non-authoritative**.

### Measurements
- Heart Rate (HR)
- Respiratory Rate (RR)
- Distance (presence detection via mmWave)

### BLE Interface
- **Standard Heart Rate Service (UUID 0x180D)**
  - Heart Rate Measurement (UUID 0x2A37)
  - Transmitted value: **1-minute rolling average HR**
- **Custom BLE Service**
  - Respiratory Rate characteristic (Notify + Read)
  - Value unit: breaths per minute (trend-level)

### Data Characteristics
- HR is averaged over a 60-second rolling window
- RR is measured continuously and transmitted as trend data
- No timestamps
- No persistent storage

### Intended Use
- Pocket / handheld device
- Temporary outpatient monitoring
- BLE connection to:
  - Smartphone
  - BLE hub
  - Local aggregator

### Explicit Limitations
- No WiFi
- No MQTT
- No cloud connectivity
- Data is **not clinically authoritative**

---

## 2. WiFi Room Monitor (Authoritative)

**File:**  
`MR60BHA2_ESP32-C6_WiFi.ino`

### Purpose
This firmware is designed for **fixed installation in selected patient rooms** and acts as the **authoritative monitoring source**.

It provides **continuous data streaming** to a backend system.

### Measurements
- Heart Rate
- Respiratory Rate
- Distance
- Presence detection
- WiFi RSSI

### Connectivity
- WiFi with captive portal configuration (WiFiManager)
- MQTT publishing (QoS 0)
- NTP time synchronization (WIB / GMT+7)

### MQTT Payload
Published at a fixed interval (1 second):

```json
{
  "device_id": "DEVICE_001",
  "room_id": "ROOM_A",
  "breath_rate": 18.4,
  "heart_rate": 72.1,
  "distance": 95.3,
  "presence": 1,
  "timestamp": "2026-02-09T14:21:33+07:00",
  "rssi": -61
}
````

### Reliability Features

* Watchdog Timer (initialized after WiFi setup)
* Automatic WiFi reconnection with timeout reset
* Periodic NTP resynchronization
* Safe string handling and buffer protection
* Persistent configuration via NVS (Preferences)

### Serial Commands

| Command      | Function                           |
| ------------ | ---------------------------------- |
| `STATUS`     | Show device status                 |
| `TIME`       | Show current time                  |
| `RESET_WIFI` | Clear WiFi and config, then reboot |
| `HELP`       | Command list                       |

---

## Authority Model

* **BLE Trend Device**

  * Non-authoritative
  * Trend-only physiological data
  * No long-term storage

* **WiFi Room Monitor**

  * Authoritative
  * Time-stamped data
  * Used for monitoring, logging, and analysis

Data from BLE devices **must not** be treated as equivalent to room monitors.

---

## Hardware Requirements

* ESP32-C6
* Seeed MR60BHA2 mmWave Sensor
* NeoPixel (1 LED)

---

## Design Constraints (Intentional)

* BLE firmware prioritizes simplicity and portability
* WiFi firmware prioritizes reliability and uptime
* Heart rate accuracy is **trend-level**, not diagnostic
* MQTT QoS 0 is used intentionally; data loss is tolerated

---

## Build Environment

* Arduino framework
* ESP32-C6 core
* Required libraries:

  * Seeed_Arduino_mmWave
  * BLE (ESP32)
  * WiFiManager
  * PubSubClient
  * ArduinoJson
  * Preferences
