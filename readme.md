
# 🏥 Darsinurse Gateway - Medical IoT Platform

> Sistem IoT medis terintegrasi dengan Web Bluetooth API untuk monitoring pasien real-time

## 📋 Overview

Darsinurse Gateway adalah platform IoT medis yang terdiri dari dua aplikasi terpisah:

1. **Rawat Jalan** (Port 4000) - Sistem untuk pengelolaan pasien rawat jalan dan pengukuran vital sign menggunakan Web Bluetooth
2. **Monitoring** (Port 5000) - Dashboard monitoring real-time dengan analytics dan fall detection alerts

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│              Docker Compose                     │
├──────────────┬──────────────┬───────────────────┤
│ Rawat Jalan  │  Monitoring  │  Shared Services  │
│  (Port 4000) │ (Port 5000)  │                   │
├──────────────┴──────────────┴───────────────────┤
│         MySQL Database (Port 3306)              │
│         phpMyAdmin (Port 8080)                  │
│         Metabase (Port 3000)                    │
└─────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose installed
- Port 3000, 3306, 4000, 5000, 8080 available

### Installation

```bash
# 1. Clone repository
git clone <your-repo-url>
cd darsinurse-gateway

# 2. Start all services
make up

# Or using docker-compose directly
docker-compose up -d
```

### Access Applications

- **Rawat Jalan**: http://localhost:4000
- **Monitoring**: http://localhost:5000
- **phpMyAdmin**: http://localhost:8080
- **Metabase**: http://localhost:3000

### Default Credentials

| EMR | Password | Role |
|-----|----------|------|
| 1 | admin123 | admin |
| 2 | pass123 | perawat |
| 3 | pass456 | perawat |

## 📂 Project Structure

```
darsinurse-gateway/
├── docker-compose.yml          # Docker orchestration
├── Makefile                    # Helper commands
├── README.md
│
├── rawat-jalan/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js               # Main server
│   └── views/
│       ├── login.ejs
│       ├── dashboard.ejs
│       └── admin-users.ejs
│
└── monitoring/
    ├── Dockerfile
    ├── package.json
    ├── monitoring-server.js    # Monitoring server
    └── views/
        ├── monitoring-login.ejs
        └── monitoring-dashboard.ejs
```

## 🛠️ Available Commands

```bash
make help              # Show all available commands
make build             # Build Docker images
make up                # Start all services
make down              # Stop all services
make restart           # Restart all services
make logs              # Show logs (all)
make logs-app          # Show logs (rawat-jalan)
make logs-monitoring   # Show logs (monitoring)
make status            # Show services status
make health            # Health check all services
make backup            # Backup database
make clean             # Clean everything
```

## 🔧 Development

### Local Development (without Docker)

```bash
# Install dependencies
make install

# Terminal 1 - Rawat Jalan
cd rawat-jalan
npm run dev

# Terminal 2 - Monitoring
cd monitoring
npm run dev
```

## 🚨 Troubleshooting

### Services won't start

```bash
# Check service status
make status

# Check logs
make logs

# Restart services
make restart
```

### Port conflicts

```bash
# Check what's using the ports
lsof -i :4000
lsof -i :5000

# Kill the process or change ports in docker-compose.yml
```

### Database connection issues

```bash
# Check database health
make health

# View database logs
make logs-db

# Restart database
docker-compose restart darsinurse-db
```

## 📊 Monitoring & Maintenance

### View Logs

```bash
# All services
make logs

# Specific service
make logs-app
make logs-monitoring
make logs-db
```

### Database Backup

```bash
# Create backup
make backup

# Restore from backup
make restore FILE=backups/darsinurse_20250101_120000.sql
```

### Health Checks

```bash
# Check all services
make health

# Manual check
curl http://localhost:4000/health
curl http://localhost:5000/health
```

## 🔐 Security Notes

1. **Change Default Passwords**: Update MySQL passwords in `docker-compose.yml`
2. **Environment Variables**: Use `.env` file for sensitive data
3. **Network Isolation**: Services communicate through Docker network
4. **User Permissions**: Containers run as non-root users

## 📝 Features

### Rawat Jalan
- ✅ Patient management (CRUD)
- ✅ Visit management
- ✅ Web Bluetooth device integration
- ✅ Vital signs measurement (Glucose, BP, Heart Rate, Weight)
- ✅ User management (Admin only)

### Monitoring
- ✅ Real-time dashboard
- ✅ Today's statistics
- ✅ Visit tracking
- ✅ Measurement history
- ✅ Fall detection alerts (Socket.IO)
- ✅ Metabase embedded analytics

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License.

## 👥 Team

**Hint-Lab Team** - Medical IoT Research Group

## 📧 Support

For issues and questions:
- Create an issue on GitHub
- Contact: support@hint-lab.id

---

**Last Updated**: December 2025
**Version**: 2.0.0
