/* ============================================================
   DARSINURSE GATEWAY - MONITORING SERVER (SEPARATE)
   Node.js + Express + Socket.IO - Monitoring Dashboard
   © 2025 - Darsinurse System
   Port: 5000 (atau sesuai kebutuhan)
   ============================================================ */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.MONITORING_PORT || 5000;

/* ============================================================
   HASH FUNCTION
   ============================================================ */
const hashPassword = (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

/* ============================================================
   DATABASE CONNECTION (MySQL)
   ============================================================ */

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'darsinurse_rawatjalan',
  waitForConnections: true,
  connectionLimit: 20,              // Increase dari 10 → 20
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 10,                      // Jumlah koneksi idle yang dipertahankan
  idleTimeout: 60000,               // Timeout untuk idle connections
  acquireTimeout: 30000             // Timeout untuk mendapatkan koneksi
});


// Cek koneksi
pool.getConnection()
  .then(conn => {
    console.log('✓ MySQL Connected (Monitoring Server)');
    conn.release();
  })
  .catch(err => {
    console.error('✗ MySQL Connection Failed:', err);
    process.exit(1);
  });

/* ============================================================
   EXPRESS & MIDDLEWARE SETUP
   ============================================================ */
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:4000', 'http://localhost:5000'],
  credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'darsinurse-monitoring-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    httpOnly: true, 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

/* ============================================================
   AUTH MIDDLEWARE
   ============================================================ */
const requireLogin = (req, res, next) => {
  if (!req.session.emr_perawat) {
    return res.redirect('/login');
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.emr_perawat) {
    return res.redirect('/login');
  }
  if (req.session.role !== 'admin') {
    return res.status(403).send('Access Denied: Admin only');
  }
  next();
};

const requireAdminOrPerawat = (req, res, next) => {
  if (!req.session.emr_perawat) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.session.role === 'admin' || req.session.role === 'perawat') {
    return next();
  }
  return res.status(403).json({ error: 'Access denied' });
};

/* ============================================================
   METABASE HELPER
   ============================================================ */
function getMetabaseEmbedUrl(dashboardId, params = {}) {
  const METABASE_URL = process.env.METABASE_URL || 'https://metabase.darsinurse.hint-lab.id';
  const METABASE_SECRET = process.env.METABASE_SECRET || 'a7dd79ccd6a69475c06533ca4d9ac152c443ed3c7550ec7be12ba06dd1b7ce55';
  
  const payload = {
    resource: { dashboard: dashboardId },
    params: params,
    exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
  };
  
  const token = jwt.sign(payload, METABASE_SECRET);
  return `${METABASE_URL}/embed/dashboard/${token}#bordered=true&titled=true`;
}

/* ============================================================
   ROUTES - AUTH
   ============================================================ */

// LOGIN PAGE
app.get('/login', (req, res) => {
  if (req.session.emr_perawat) {
    return res.redirect('/');
  }
  res.render('monitoring-login', { error: null });
});

// PROSES LOGIN
app.post('/login', async (req, res) => {
  const { emr_perawat, password } = req.body;
  
  console.log('🔐 Monitoring Login attempt - EMR:', emr_perawat);
  
  if (!emr_perawat || !password) {
    return res.render('monitoring-login', { error: 'EMR Perawat dan Password harus diisi!' });
  }
  
  const emrInt = parseInt(emr_perawat);
  if (isNaN(emrInt)) {
    return res.render('monitoring-login', { error: 'EMR Perawat harus berupa angka!' });
  }
  
  const hash = hashPassword(password);
  
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      'SELECT * FROM perawat WHERE emr_perawat = ?',
      [emrInt]
    );
    conn.release();

    if (rows.length === 0) {
      console.log('❌ User not found:', emrInt);
      return res.render('monitoring-login', { error: 'EMR Perawat tidak ditemukan!' });
    }

    const user = rows[0];
    console.log('👤 User found:', user.emr_perawat, '- Role:', user.role);

    if (user.password === hash) {
      req.session.emr_perawat = user.emr_perawat;
      req.session.nama_perawat = user.nama;
      req.session.role = user.role;
      
      console.log('✓ Monitoring Login success:', user.nama);
      return res.redirect('/');
    } else {
      console.log('❌ Wrong password for:', emrInt);
      return res.render('monitoring-login', { error: 'Password salah!' });
    }
  } catch (err) {
    console.error('❌ Login error:', err);
    return res.render('monitoring-login', { error: 'Terjadi kesalahan sistem!' });
  }
});

// LOGOUT
app.get('/logout', (req, res) => {
  console.log('👋 Logout:', req.session.nama_perawat);
  req.session.destroy();
  res.redirect('/login');
});

/* ============================================================
   ROUTES - MONITORING DASHBOARD
   ============================================================ */

// MAIN MONITORING PAGE
app.get('/', requireLogin, (req, res) => {
  res.render('monitoring-dashboard', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat,
    role: req.session.role
  });
});

/* ============================================================
   API ENDPOINTS - STATISTICS
   ============================================================ */

// API: Today's Statistics
app.get('/api/statistics/today', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const whereClause = req.session.role === 'admin' 
      ? '' 
      : `AND emr_perawat = ${req.session.emr_perawat}`;
    
    const [visits] = await conn.query(
      `SELECT COUNT(*) as total FROM kunjungan 
       WHERE tanggal_kunjungan >= ? AND tanggal_kunjungan < ? ${whereClause}`,
      [today, tomorrow]
    );
    
    const [patients] = await conn.query(
      `SELECT COUNT(DISTINCT emr_no) as total FROM kunjungan 
       WHERE tanggal_kunjungan >= ? AND tanggal_kunjungan < ? ${whereClause}`,
      [today, tomorrow]
    );
    
    const [measurements] = await conn.query(
      `SELECT COUNT(*) as total FROM vitals 
       WHERE waktu >= ? AND waktu < ? ${whereClause}`,
      [today, tomorrow]
    );
    
    const [active] = await conn.query(
      `SELECT COUNT(*) as total FROM kunjungan 
       WHERE status = 'aktif' AND tanggal_kunjungan >= ? AND tanggal_kunjungan < ? ${whereClause}`,
      [today, tomorrow]
    );
    
    conn.release();
    
    res.json({
      success: true,
      stats: {
        totalVisits: visits[0].total,
        totalPatients: patients[0].total,
        totalMeasurements: measurements[0].total,
        activeVisits: active[0].total
      }
    });
  } catch (err) {
    console.error('❌ Statistics API error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// API: Today's Visits
app.get('/api/visits/today', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const whereClause = req.session.role === 'admin' 
      ? '' 
      : `AND k.emr_perawat = ${req.session.emr_perawat}`;
    
    const [visits] = await conn.query(
      `SELECT 
        k.id_kunjungan,
        k.emr_no as emr_pasien,
        k.keluhan,
        k.tanggal_kunjungan,
        k.status,
        pas.nama as nama_pasien,
        pr.nama as nama_perawat,
        COUNT(v.id) as total_measurements
       FROM kunjungan k
       JOIN pasien pas ON k.emr_no = pas.emr_no
       JOIN perawat pr ON k.emr_perawat = pr.emr_perawat
       LEFT JOIN vitals v ON k.id_kunjungan = v.id_kunjungan
       WHERE k.tanggal_kunjungan >= ? AND k.tanggal_kunjungan < ? ${whereClause}
       GROUP BY k.id_kunjungan
       ORDER BY k.tanggal_kunjungan DESC`,
      [today, tomorrow]
    );
    
    conn.release();
    
    res.json({
      success: true,
      visits: visits
    });
  } catch (err) {
    console.error('❌ Visits API error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// API: Today's Measurements
app.get('/api/measurements/today', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const whereClause = req.session.role === 'admin' 
      ? '' 
      : `AND v.emr_perawat = ${req.session.emr_perawat}`;
    
    const [measurements] = await conn.query(
      `SELECT 
        v.id,
        v.waktu as timestamp,
        v.heart_rate,
        v.sistolik,
        v.diastolik,
        v.respirasi,
        v.glukosa,
        v.berat_badan_kg,
        v.tinggi_badan_cm,
        v.bmi,
        v.jarak_kasur_cm,
        v.fall_detected,
        pas.nama as nama_pasien,
        pas.emr_no,
        pr.nama as nama_perawat,
        k.id_kunjungan
       FROM vitals v
       JOIN pasien pas ON v.emr_no = pas.emr_no
       LEFT JOIN perawat pr ON v.emr_perawat = pr.emr_perawat
       LEFT JOIN kunjungan k ON v.id_kunjungan = k.id_kunjungan
       WHERE v.waktu >= ? AND v.waktu < ? ${whereClause}
       ORDER BY v.waktu DESC
       LIMIT 100`,
      [today, tomorrow]
    );
    
    // Format data
    const formattedMeasurements = measurements.map(m => {
      let tipe_device = [];
      let data = [];
      
      if (m.heart_rate) {
        tipe_device.push('Heart Rate');
        data.push(`${m.heart_rate} bpm`);
      }
      if (m.sistolik && m.diastolik) {
        tipe_device.push('Blood Pressure');
        data.push(`${m.sistolik}/${m.diastolik} mmHg`);
      }
      if (m.glukosa) {
        tipe_device.push('Glukosa');
        data.push(`${m.glukosa} mg/dL`);
      }
      if (m.respirasi) {
        tipe_device.push('Respirasi');
        data.push(`${m.respirasi} /min`);
      }
      if (m.berat_badan_kg) {
        tipe_device.push('Berat Badan');
        data.push(`${m.berat_badan_kg} kg`);
      }
      if (m.tinggi_badan_cm) {
        tipe_device.push('Tinggi Badan');
        data.push(`${m.tinggi_badan_cm} cm`);
      }
      if (m.bmi) {
        tipe_device.push('BMI');
        data.push(m.bmi.toFixed(1));
      }
      if (m.fall_detected) {
        tipe_device.push('🚨 FALL DETECTED');
        data.push('ALERT');
      }
      
      return {
        id: m.id,
        timestamp: m.timestamp,
        nama_pasien: m.nama_pasien,
        emr_no: m.emr_no,
        nama_perawat: m.nama_perawat || 'System',
        id_kunjungan: m.id_kunjungan,
        tipe_device: tipe_device.join(', ') || 'Unknown',
        data: data.join(', ') || 'No data'
      };
    });
    
    conn.release();
    
    res.json({
      success: true,
      measurements: formattedMeasurements
    });
  } catch (err) {
    console.error('❌ Measurements API error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// API: Metabase Embed Token
app.get('/api/metabase/rawat-inap-token', requireAdminOrPerawat, (req, res) => {
  try {
    const DASHBOARD_ID = 6; // Dashboard ID untuk Rawat Inap
    const embedUrl = getMetabaseEmbedUrl(DASHBOARD_ID);
    
    console.log('✓ Metabase embed URL generated for dashboard:', DASHBOARD_ID);
    
    res.json({
      success: true,
      embedUrl: embedUrl
    });
  } catch (err) {
    console.error('❌ Metabase token error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Gagal generate Metabase token: ' + err.message 
    });
  }
});

/* ============================================================
   SOCKET.IO - FALL DETECTION
   ============================================================ */

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
  
  socket.on('new-fall-alert', (alert) => {
    console.log('🚨 FALL ALERT FROM RAWAT-JALAN:', alert);
    io.to('monitoring-room').emit('fall-alert', alert);
  });
  socket.on('join-monitoring', (data) => {
    socket.join('monitoring-room');
    console.log('👀 Client joined monitoring room:', data);
  });
});

// Fall Detection Checker
let lastCheckedId = 0;

async function checkForNewFalls() {
  try {
    const conn = await pool.getConnection();
    
    const [newFalls] = await conn.query(`
      SELECT 
        v.id,
        v.emr_no,
        v.waktu,
        v.fall_detected,
        v.heart_rate,
        v.sistolik,
        v.diastolik,
        p.nama as nama_pasien,
        p.poli,
        rd.room_id,
        rd.device_id
      FROM vitals v
      LEFT JOIN pasien p ON v.emr_no = p.emr_no
      LEFT JOIN room_device rd ON v.emr_no = rd.emr_no
      WHERE v.fall_detected = 1 
      AND v.id > ?
      ORDER BY v.id DESC
      LIMIT 10
    `, [lastCheckedId]);
    
    conn.release();
    
    if (newFalls.length > 0) {
      console.log('🚨 NEW FALL DETECTED:', newFalls.length, 'alert(s)');
      
      newFalls.forEach(fall => {
        const alert = {
          id: fall.id,
          emr_no: fall.emr_no,
          nama_pasien: fall.nama_pasien || `Pasien ${fall.emr_no}`,
          room_id: fall.room_id || 'Unknown Room',
          device_id: fall.device_id || 'Unknown Device',
          waktu: fall.waktu,
          heart_rate: fall.heart_rate,
          blood_pressure: `${fall.sistolik}/${fall.diastolik}`,
          poli: fall.poli || 'N/A',
          timestamp: new Date().toISOString()
        };
        
        io.to('monitoring-room').emit('fall-alert', alert);
        console.log('📢 Fall alert emitted:', alert.nama_pasien, '-', alert.room_id);
      });
      
      lastCheckedId = Math.max(...newFalls.map(f => f.id));
    }
  } catch (err) {
    console.error('❌ Fall detection check error:', err);
  }
}

// Polling setiap 10 detik
setInterval(checkForNewFalls, 10000);

// Initialize fall detection
async function initFallDetection() {
  try {
    const conn = await pool.getConnection();
    const [result] = await conn.query('SELECT MAX(id) as maxId FROM vitals WHERE fall_detected = 1');
    conn.release();
    
    lastCheckedId = result[0].maxId || 0;
    console.log('✓ Fall detection initialized. Last ID:', lastCheckedId);
  } catch (err) {
    console.error('❌ Fall detection init error:', err);
  }
}

initFallDetection();

// Fall Detection API Endpoints
app.get('/api/fall-detection/latest', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [falls] = await conn.query(`
      SELECT 
        v.id,
        v.emr_no,
        v.waktu,
        v.fall_detected,
        v.heart_rate,
        v.sistolik,
        v.diastolik,
        p.nama as nama_pasien,
        p.poli,
        rd.room_id,
        rd.device_id
      FROM vitals v
      LEFT JOIN pasien p ON v.emr_no = p.emr_no
      LEFT JOIN room_device rd ON v.emr_no = rd.emr_no
      WHERE v.fall_detected = 1 
      AND v.waktu >= ?
      ORDER BY v.waktu DESC
      LIMIT 50
    `, [today]);
    
    conn.release();
    res.json({ success: true, falls });
  } catch (err) {
    console.error('❌ Fall detection API error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/api/fall-detection/:id/acknowledge', requireAdminOrPerawat, async (req, res) => {
  try {
    const { id } = req.params;
    const { acknowledged_by } = req.body;
    
    res.json({ 
      success: true, 
      message: 'Fall alert acknowledged',
      acknowledged_by,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('❌ Acknowledge error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   START SERVER
   ============================================================ */

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   DARSINURSE MONITORING SERVER         ║
║   Server: http://localhost:${PORT}        ║
║   Socket.IO Fall Detection: ACTIVE     ║
║   Environment: ${process.env.NODE_ENV || 'development'}              ║
╚════════════════════════════════════════╝
`);
});

module.exports = { app, server, io };