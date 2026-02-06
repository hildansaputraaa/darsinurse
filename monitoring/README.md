# 📊 Monitoring - Real-Time Patient Monitoring Dashboard

Real-time monitoring dashboard with analytics, fall detection alerts, and embedded business intelligence powered by Metabase.

---

## Core Features

* **Real-Time Dashboard** — Live patient vitals display with WebSocket updates
* **Fall Detection Alerts** — Instant notifications when falls are detected
* **Analytics & Reporting** — Embedded Metabase for advanced data visualization
* **Visit Tracking** — Monitor all patient visits and consultations
* **Measurement History** — Full audit trail of vital signs recordings
* **Session-Based Authentication** — Secure multi-user access with role-based controls
* **Socket.IO Integration** — Bi-directional communication with Rawat Jalan system
* **MQTT Integration** — Real-time data ingestion from Vitals API

---

## Environment Variables

```bash
# Server Configuration
MONITORING_PORT=5000
NODE_ENV=production

# Database Configuration
DB_HOST=darsinurse-db
DB_PORT=3306
DB_USER=darsinurse
DB_PASSWORD=darsinurse123
DB_NAME=darsinurse

# Session Security
SESSION_SECRET=your_secure_session_secret_here

# Cross-Origin Configuration
ALLOWED_ORIGINS=http://localhost:4000,http://localhost:5000
COOKIE_SECURE=true          # Set to false for http dev, true for https
COOKIE_SAME_SITE=lax

# Inter-Service Communication
RAWAT_JALAN_URL=http://darsinurse-app:4000

# Metabase Integration
METABASE_URL=http://metabase:3000
METABASE_SECRET=your_metabase_secret_key
```

---

## Architecture

```
Web Browser (Client)
    ↓
Express.js Server (Port 5000)
    ├─ EJS Views (Dashboard UI)
    ├─ Session Management (MySQL Store)
    ├─ Socket.IO Server
    └─ Embedded Metabase
    ↓
MySQL Database
    ├─ Vitals data (real-time)
    ├─ Patients info
    ├─ Visits tracking
    └─ User sessions
    
    Socket.IO ←→ Rawat Jalan (4000)
    MQTT    ←→ Vitals API (6000)
```

---

## Dashboard Features

### Real-Time Monitoring
- **Patient List** — Current status of all monitored patients
- **Vital Signs Display** — Real-time HR, RR, distance metrics
- **Alert Queue** — Fall detection and abnormal reading alerts
- **Quick Stats** — Today's measurements, active visits

### Fall Detection Alerts
- Triggered when distance drops below threshold
- Real-time notification to all connected users
- Alert history and trend analysis
- Acknowledgment tracking per user

### Analytics Dashboard
- Patient admission trends
- Vital signs distribution
- Fall incident analysis
- Visit frequency patterns
- Custom date range filtering

---

## API Endpoints

### Authentication
- `GET /login` — Login page
- `POST /login` — Authenticate user
- `GET /logout` — End session

### Dashboard
- `GET /` — Main monitoring dashboard
- `GET /dashboard` — Dashboard data
- `GET /today-stats` — Today's statistics
- `GET /vitals-chart/:emr` — Patient vitals chart data

### Visit Management
- `GET /visits` — List all visits
- `GET /visits/:emr` — Get patient visits

### Alerts
- `GET /alerts` — Get fall detection alerts
- `POST /alerts/:id/acknowledge` — Mark alert as acknowledged
- `GET /alerts/feed` — Alert stream (SSE or WebSocket)

### Raw Data
- `GET /raw-data` — Paginated raw measurement data
- `GET /raw-data/export` — Export data (CSV/JSON)

### Admin
- `GET /admin/users` — User management
- `POST /admin/users` — Create user
- `DELETE /admin/users/:emr` — Remove user

### Health
- `GET /health` — Service health status

---

## Socket.IO Events

### Listening (from Rawat Jalan)
- `measurement` — New vital sign recorded
  ```javascript
  { emr_no, heart_rate, respirasi, jarak_kasur_cm, waktu }
  ```
- `patient_updated` — Patient info changed
- `visit_created` — New visit recorded

### Publishing (to Rawat Jalan)
- `alert_acknowledged` — User acknowledged fall alert
- `dashboard_online` — Monitoring dashboard connected

### Fall Detection
- `fall_detected` — Alert when fall condition met
- `fall_alert` — Broadcast to all connected clients

---

## Fall Detection Logic

The system monitors distance from bed surface (via mmWave sensor):

```javascript
Fall Detection Triggers:
- Distance suddenly increases (patient fell out of bed)
- Distance drops below threshold (collision/fall)
- Rapid distance changes
- Abnormal vital sign combinations

Alert Payload:
{
  emr_no: "patient_id",
  distance: 45.2,
  heart_rate: 92,
  respirasi: 28,
  detected_at: "2025-02-07T10:30:00Z",
  severity: "high"
}
```

---

## Metabase Integration

### Embedded Dashboards
- Patient monitoring analytics
- Fall incident trends
- Vital signs heatmaps
- System performance metrics

### Configuration
1. Metabase runs on `http://localhost:3000`
2. Create charts/dashboards in Metabase UI
3. Generate JWT tokens for embedding
4. Embed in monitoring views using Metabase SDK

### Setup Steps
```bash
# 1. Access Metabase at http://localhost:3000
# 2. Connect to MySQL darsinurse database
# 3. Create visualizations and dashboards
# 4. Generate embedding keys in Admin Panel
# 5. Update METABASE_SECRET in .env
```

---

## Data Models

### Fall Alerts Table
```sql
CREATE TABLE fall_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emr_no VARCHAR(50) NOT NULL,
  detected_at TIMESTAMP,
  heart_rate INT,
  respirasi INT,
  distance FLOAT,
  acknowledged BOOLEAN DEFAULT 0,
  acknowledged_by VARCHAR(50),
  acknowledged_at TIMESTAMP,
  FOREIGN KEY (emr_no) REFERENCES patients(emr_no),
  INDEX idx_emr (emr_no),
  INDEX idx_detected (detected_at)
);

CREATE TABLE alert_acknowledgments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  alert_id INT,
  acknowledged_by VARCHAR(50),
  acknowledged_at TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (alert_id) REFERENCES fall_alerts(id),
  FOREIGN KEY (acknowledged_by) REFERENCES users(emr_no)
);
```

---

## Running

### Docker (Recommended)

```bash
docker-compose up -d darsinurse-monitoring
```

### Local Development

```bash
npm install
npm run dev
```

Server will start on `http://localhost:5000`

---

## Performance Optimization

- **Connection Pooling** — 20 concurrent database connections
- **Caching** — Dashboard stats cached for 30 seconds
- **Socket.IO Broadcast** — Efficient room-based messaging
- **Database Indexes** — Optimized queries on `emr_no`, `waktu`
- **Pagination** — Large result sets paginated (50 records/page)

---

## Alert Management

### Alert Lifecycle
1. **Detection** — Fall condition detected by Vitals API
2. **Broadcasting** — Alert sent to all monitoring sessions
3. **User Notification** — Toast/sound alert on dashboard
4. **Display** — Added to alert queue
5. **Acknowledgment** — User clicks "Acknowledge" button
6. **Logging** — Recorded with timestamp and user info

### Alert Retention
- Active alerts: Displayed for 24 hours
- Historical alerts: Archived in database indefinitely
- Cleanup: Automatic removal of alerts >30 days old (configurable)

---

## Security Notes

1. **HTTPS Required** — Set `COOKIE_SECURE=true` in production
2. **Session Store** — Uses MySQL for persistent sessions
3. **CORS Configuration** — Limit `ALLOWED_ORIGINS` to trusted domains
4. **JWT Authentication** — Tokens generated for Metabase embedding
5. **Rate Limiting** — Recommended to add on alert endpoints

---

## Troubleshooting

- **WebSocket connection failed** — Check `RAWAT_JALAN_URL`, verify Rawat Jalan is running
- **Database connection failed** — Verify credentials and network connectivity
- **No fall alerts appearing** — Check Vitals API is running and sending data
- **Metabase not embedding** — Verify `METABASE_SECRET`, check Metabase is accessible
- **Port 5000 already in use** — Change `MONITORING_PORT` or kill process using port
- **Session lost on refresh** — Verify MySQL session store is working, check `SESSION_SECRET`

---

## Default Users

| EMR | Password | Role |
|-----|----------|------|
| 1 | admin123 | admin |
| 2 | pass123 | perawat |
| 3 | pass456 | perawat |

> ⚠️ Change these credentials immediately in production!

---

## License

MIT © Hint-Lab Team
