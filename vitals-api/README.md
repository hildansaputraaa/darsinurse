# Vitals Aggregator

A Node.js service that ingests high-frequency vital-sign data from MQTT, buffers and aggregates it in fixed intervals, and persists immutable, patient-owned vitals into a MySQL database.

This service is designed for environments where **devices are reused across patients**, and **patient assignment can change over time**. Vitals are always attributed to the patient assigned to a room *at the moment of insertion*.

---

## Core Principles

* **Vitals are immutable events** — once written, they are never updated.
* **Devices are transient** — vitals do not belong to devices.
* **Patients own vitals** — ownership is resolved at write time via room assignment.
* **Room-to-patient mapping is the single source of truth**.

---

## Architecture Overview

```
MQTT Broker
   ↓
Vitals Aggregator (Node.js)
   ├─ In-memory buffer (per room)
   ├─ Minute snapshots (every 60 seconds)
   ├─ Daily temp log files (14-day retention)
   └─ 15-minute aggregation job
           ↓
        MySQL Database
```

---

## Features

* MQTT subscription to `rsi/data` and `hitam` topics
* Per-room buffering of raw vitals (HR, RR, distance)
* Filtering of invalid readings (zero values excluded)
* 60-second minute summaries and snapshots
* 15-minute average aggregation
* Fall detection and recording with vital context
* Room → patient resolution via `room_device` table at insert time
* Immutable inserts into `vitals` table
* Per-room daily log files with 14-day retention
* Home Assistant (HA) discovery and state publishing
* Designed to run as a long-lived containerized service

---

## Environment Variables

```bash
# MQTT Configuration
MQTT_URL=mqtt://103.106.72.181:1883
MQTT_USERNAME=MEDLOC
MQTT_PASSWORD=MEDLOC

# Database Configuration
DB_HOST=darsinurse-db
DB_PORT=3306
DB_USER=darsinurse
DB_PASSWORD=darsinurse123
DB_NAME=darsinurse

# Fallback EMR (when room has no assigned patient)
FALLBACK_EMR=UNASSIGNED
```

---

## Running

### Docker (Recommended)

```bash
docker compose up -d darsinurse-vitals
```

### Local Development

```bash
npm install
node index.js
```

---

## Health Check

The service writes a timestamp to `health.txt` every 60 seconds. Docker health checks verify this file is updated regularly.

---

## Data Flow

1. **MQTT Ingestion** — listens on `rsi/data` and `hitam` topics for HR, RR, distance readings
2. **In-Memory Buffer** — stores vitals by room, filters out invalid readings (≤ 0)
3. **Minute Snapshot** — every 60 seconds, captures buffer state and publishes HA state updates
4. **Minute Summary** — writes room-level snapshots to daily per-room log files
5. **15-Minute Aggregation** — computes HR/RR averages, looks up room → EMR mapping, inserts into database
6. **HA Publishing** — publishes device discovery and state to Home Assistant topics
7. **Fall Detection** — every 60 seconds, checks for fall conditions and records with vital context
8. **Cleanup** — daily cleanup of log files older than 14 days

---

## Database Schema (Required Tables)

```sql
CREATE TABLE vitals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emr_no VARCHAR(50) NOT NULL,
  waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  heart_rate INT,
  respirasi INT,
  jarak_kasur_cm INT,
  fall_detected BOOLEAN DEFAULT 0,
  INDEX idx_emr (emr_no),
  INDEX idx_waktu (waktu)
);

CREATE TABLE room_device (
  room_id VARCHAR(50) PRIMARY KEY,
  emr_no VARCHAR(50) NOT NULL,
  device_id VARCHAR(50),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

---

## Troubleshooting

- **MQTT Connection Failed** — verify `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` are correct and broker is reachable
- **Database Connection Failed** — verify `DB_HOST` is reachable, credentials correct, database `darsinurse` exists
- **No Data Being Written** — check MQTT topics receive data (`rsi/data`, `hitam`), verify room→EMR mapping in `room_device` table
- **Zero readings not recorded** — HR and RR values ≤ 0 are filtered out by design
- **Health check failing** — ensure `/app/tmp` directory exists and is writable
- **Missing minute summaries** — check container disk space, verify write permissions on `/app/tmp/summary`
