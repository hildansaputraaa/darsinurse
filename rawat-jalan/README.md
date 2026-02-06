# 🏥 Rawat Jalan - Patient Management & Vital Signs System

A comprehensive patient management system integrated with Web Bluetooth API for real-time vital signs measurement in outpatient clinic settings.

---

## Core Features

* **Patient Management** — Complete CRUD operations for patient records
* **Visit Management** — Track patient visits and consultation history
* **Web Bluetooth Integration** — Direct device connection via browser Web Bluetooth API
* **Vital Signs Measurement** — Capture glucose, blood pressure, heart rate, and weight
* **User Management** — Admin-only controls for staff access
* **Real-Time Dashboard** — Live view of patient data and measurements
* **Session-Based Authentication** — Secure login with role-based access control
* **Socket.IO Integration** — Real-time communication with monitoring system

---

## Environment Variables

```bash
# Server Configuration
PORT=4000
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

# Feature Flags
ENABLE_DEFAULT_DATA=false  # Set to false in production
```

---

## Architecture

```
Web Browser (Client)
    ↓
Express.js Server (Port 4000)
    ├─ EJS Views (UI rendering)
    ├─ Session Management
    └─ Socket.IO (real-time updates)
    ↓
MySQL Database
    ├─ Patients table
    ├─ Visits table
    ├─ Measurements table
    └─ Users table
```

---

## Data Model

### Patients Table
```sql
CREATE TABLE patients (
  emr_no VARCHAR(50) PRIMARY KEY,
  nama VARCHAR(255) NOT NULL,
  tanggal_lahir DATE,
  jenis_kelamin CHAR(1),
  no_telepon VARCHAR(20),
  alamat TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Visits Table
```sql
CREATE TABLE visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emr_no VARCHAR(50) NOT NULL,
  tanggal TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  keluhan TEXT,
  diagnosis TEXT,
  perawat VARCHAR(255),
  FOREIGN KEY (emr_no) REFERENCES patients(emr_no)
);
```

### Measurements Table
```sql
CREATE TABLE vitals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emr_no VARCHAR(50) NOT NULL,
  waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  heart_rate INT,
  respirasi INT,
  jarak_kasur_cm INT,
  fall_detected BOOLEAN DEFAULT 0,
  FOREIGN KEY (emr_no) REFERENCES patients(emr_no),
  INDEX idx_emr (emr_no),
  INDEX idx_waktu (waktu)
);
```

### Users Table
```sql
CREATE TABLE users (
  emr_no VARCHAR(50) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'perawat', 'dokter'),
  nama VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Endpoints

### Authentication
- `POST /login` — Authenticate user
- `GET /logout` — End user session

### Patient Management
- `GET /` — Dashboard (patient list)
- `GET /patients` — List all patients
- `POST /patients` — Create new patient
- `GET /patients/:emr` — Get patient details
- `PUT /patients/:emr` — Update patient
- `DELETE /patients/:emr` — Delete patient

### Visits
- `POST /visits` — Create new visit
- `GET /visits/:emr` — Get patient visits

### Measurements
- `POST /measurements` — Record vital signs
- `GET /measurements/:emr` — Get patient measurements history

### Admin
- `GET /admin/users` — Manage system users
- `POST /admin/users` — Add new user
- `DELETE /admin/users/:emr` — Remove user

### Health
- `GET /health` — Service health status

---

## Web Bluetooth Integration

The system uses the Web Bluetooth API to connect directly to medical devices:

### Supported Devices
- Glucose meters
- Blood pressure monitors
- Pulse oximeters
- Weight scales

### Usage
1. User clicks "Connect Device"
2. Browser prompts device selection
3. Real-time data stream starts
4. Measurements automatically recorded to database
5. Live updates sent to Monitoring system via Socket.IO

### Compatibility
- **Browsers**: Chrome, Edge, Opera (Chromium-based)
- **Platforms**: Linux, macOS, Windows 10+, Android

---

## Running

### Docker (Recommended)

```bash
docker-compose up -d darsinurse-app
```

### Local Development

```bash
npm install
npm run dev
```

Server will start on `http://localhost:4000`

---

## Socket.IO Events

### Publishing
- `measurement` — New vital sign recorded
- `patient_updated` — Patient info changed
- `visit_created` — New visit logged

### Listening
- `fall_detected` — Fall alert from monitoring system
- `alert` — Real-time alerts

---

## Default Users

| EMR | Password | Role |
|-----|----------|------|
| 1 | admin123 | admin |
| 2 | pass123 | perawat |
| 3 | pass456 | perawat |

> ⚠️ Change these credentials immediately in production!

---

## Troubleshooting

- **Web Bluetooth not available** — Use Chromium-based browser, enable experimental features if needed
- **Database connection failed** — Verify `DB_HOST`, `DB_USER`, `DB_PASSWORD`
- **Port 4000 already in use** — Change `PORT` env var or kill process using port
- **Session data lost** — Ensure `SESSION_SECRET` is set and consistent across restarts
- **Measurements not appearing** — Check browser console for Bluetooth errors, verify device is paired

---

## Performance Tuning

- **Connection Pool**: 20 concurrent database connections (configurable)
- **Keep-Alive**: Enabled for persistent connections
- **Idle Timeout**: 60 seconds for unused connections
- **Socket.IO**: Configured for long-polling and WebSocket fallback

---

## Security Notes

1. **Always use HTTPS in production**
2. **Store `SESSION_SECRET` securely** (e.g., AWS Secrets Manager)
3. **Keep `ENABLE_DEFAULT_DATA=false`** in production
4. **Regularly rotate database passwords**
5. **Limit API access with rate limiting** (recommended: add `express-rate-limit`)

---

## License

MIT © Hint-Lab Team
