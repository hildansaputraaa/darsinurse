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
   ├─ Daily temp log files (3-day retention)
   └─ 15-minute aggregation job
           ↓
        MySQL Database
```

---

## Features

* MQTT subscription (`rsi/data`, `hitam`)
* Per-room buffering of raw vitals
* Filtering of invalid readings (e.g. HR = 0)
* 15-minute average aggregation
* Fall detection and recording
* Room → patient resolution at insert time
* Immutable inserts into `vitals` table
* Daily raw-data temp files with 14-day retention
* Designed to run as a long-lived containerized service

---

## Environment Variables

```bash
# MQTT Configuration
MQTT_URL=mqtt://broker:1883
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

1. **MQTT Ingestion** — listens on `rsi/data` and `hitam` topics
2. **In-Memory Buffer** — stores vitals by room
3. **Minute Snapshot** — every 60 seconds, creates a snapshot
4. **15-Minute Aggregation** — computes averages and inserts into database
5. **HA Publishing** — publishes to Home Assistant discovery topics
6. **Fall Detection** — records detected falls with vital context

---

## Database Schema (Required Tables)

```sql
CREATE TABLE vitals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emr_no VARCHAR(50),
  waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  heart_rate INT,
  respirasi INT,
  jarak_kasur_cm INT,
  fall_detected BOOLEAN DEFAULT 0
);

CREATE TABLE room_device (
  room_id VARCHAR(50) PRIMARY KEY,
  emr_no VARCHAR(50),
  device_id VARCHAR(50)
);
```

---

## Troubleshooting

- **MQTT Connection Failed** — verify broker URL, username, password
- **Database Connection Failed** — verify DB_HOST is reachable, credentials correct
- **No Data Being Written** — check MQTT topics, verify room has EMR assignment
