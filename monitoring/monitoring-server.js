/* ============================================================
   DARSINURSE GATEWAY - MONITORING SERVER (FULLY FIXED)
   ============================================================ */

const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { io: io_client } = require('socket.io-client');
const mqtt = require('mqtt');

const app = express();
const PORT = process.env.MONITORING_PORT || 5000;

// ✅ Global variables
const processedFallIds = new Set();
let lastCheckedVitalId = 0;
const FALL_CHECK_INTERVAL = 10000; // 10 seconds
const PROCESSED_IDS_LIMIT = 1000;

/* ============================================================
   SESSION-BASED FALL ALERT TRACKING
   ============================================================ */
const userDisplayedAlerts = new Map();
const SESSION_CLEANUP_INTERVAL = 300000; // 1 hour

setInterval(() => {
  let cleanedCount = 0;
  let totalCleaned = 0;
  
  userDisplayedAlerts.forEach((alertSet, sessionId) => {
    // Clean sessions with too many tracked alerts
    if (alertSet.size > 100) {
      // Keep only last 50
      const alertsArray = Array.from(alertSet);
      const toKeep = alertsArray.slice(-50);
      userDisplayedAlerts.set(sessionId, new Set(toKeep));
      totalCleaned += (alertSet.size - 50);
      cleanedCount++;
    }
  });
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned ${totalCleaned} alerts from ${cleanedCount} session(s)`);
  }
}, SESSION_CLEANUP_INTERVAL);

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
  database: process.env.DB_NAME || 'darsinurse',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// Session Store Configuration
const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 86400000,
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
}, pool);

pool.on('error', (err) => {
  console.error('❌ MySQL Pool Error:', err);
});

pool.on('connection', (connection) => {
  console.log('✓ New pool connection established');
});

const mqttClient = mqtt.connect('mqtt://103.106.72.181:1883', {
  username: 'MEDLOC',
  password: 'MEDLOC',
  clientId: `darsinurse-gateway-${Math.random().toString(16).substr(2, 8)}`,
  reconnectPeriod: 5000,
  connectTimeout: 10000
});

let mqttConnected = false;

mqttClient.on('connect', () => {
  console.log('✅ MQTT Connected to 103.106.72.181:1883');
  mqttConnected = true;
  
  // Subscribe ke semua device
  mqttClient.subscribe('rsi/v1/device/+/state', (err) => {
    if (err) {
      console.error('❌ MQTT Subscribe error:', err);
    } else {
      console.log('✓ Subscribed to: rsi/v1/device/+/state');
    }
  });
});

mqttClient.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    
    console.log('📊 MQTT Message:', {
      topic: topic,
      device_id: payload.device_id,
      room_id: payload.room_id,
      heart_rate: payload.avg_heart_rate,
      breath_rate: payload.avg_breath_rate,
      distance: payload.distance,
      timestamp: payload.timestamp
    });
    
    // ✅ FIXED: Broadcast dengan room_id yang jelas
    io.emit('mqtt-vital-update', {
      device_id: payload.device_id,
      room_id: payload.room_id, // ✅ PENTING: Ini digunakan untuk filtering
      vitals: {
        heart_rate: payload.avg_heart_rate,
        respirasi: payload.avg_breath_rate,
        jarak_kasur_cm: payload.distance,
        fall_detected: payload.distance === 0 ? 1 : 0
      },
      waktu: payload.timestamp,
      source: 'mqtt'
    });
    
  } catch (err) {
    console.error('❌ MQTT Parse error:', err);
  }
});

mqttClient.on('error', (err) => {
  console.error('❌ MQTT Error:', err);
  mqttConnected = false;
});

mqttClient.on('disconnect', () => {
  console.warn('⚠️ MQTT Disconnected');
  mqttConnected = false;
});

mqttClient.on('reconnect', () => {
  console.log('🔄 MQTT Reconnecting...');
});



/* ============================================================
   EXPRESS CONFIGURATION (CORRECT ORDER!)
   ============================================================ */

// 1. Trust proxy
app.set('trust proxy', 1);

// 2. Body parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 3. Views & Static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// 4. Session (ONLY ONCE!)
app.use(session({
  key: 'monitoring_session',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: 'auto',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/'
  }
}));

// 5. CORS
const allowedOrigins = [
  'https://gateway.darsinurse.hint-lab.id',
  'https://darsinurse.hint-lab.id',
  'http://localhost:3000',
  'http://localhost:5000'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('❌ CORS blocked:', origin);
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

/* ============================================================
   ✅ AUTH MIDDLEWARE (DEFINE BEFORE ROUTES!)
   ============================================================ */
const requireLogin = (req, res, next) => {
  if (!req.session || !req.session.emr_perawat) {
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
   HELPER FUNCTIONS
   ============================================================ */
function getMetabaseEmbedUrl(dashboardId, params = {}) {
  const METABASE_URL = process.env.METABASE_URL || 'https://metabase.darsinurse.hint-lab.id';
  
  const publicDashboards = {
    7: '18889b1d-d9fd-4ddd-8f32-0f56a0a8da6c',
  };
  
  const uuid = publicDashboards[dashboardId];
  if (!uuid) {
    throw new Error(`Dashboard ${dashboardId} tidak tersedia`);
  }
  
  return `${METABASE_URL}/public/dashboard/${uuid}`;
}

/* ============================================================
   AUTHENTICATION ROUTES
   ============================================================ */

app.get('/login', (req, res) => {
  if (req.session && req.session.emr_perawat) {
    return res.redirect('/');
  }
  res.render('monitoring-login', { error: null });
});

app.post('/login', async (req, res) => {
  const { emr_perawat, password } = req.body;
  
  console.log('🔐 Login attempt for EMR:', emr_perawat);
  
  if (!emr_perawat || !password) {
    return res.render('monitoring-login', { 
      error: 'EMR Perawat dan Password harus diisi!' 
    });
  }
  
  const emrInt = parseInt(emr_perawat);
  if (isNaN(emrInt)) {
    return res.render('monitoring-login', { 
      error: 'EMR Perawat harus berupa angka!' 
    });
  }
  
  const hash = hashPassword(password);
  
  try {
    const [rows] = await pool.query(
      'SELECT * FROM perawat WHERE emr_perawat = ?',
      [emrInt]
    );

    if (rows.length === 0) {
      return res.render('monitoring-login', { 
        error: 'EMR Perawat tidak ditemukan!' 
      });
    }

    const user = rows[0];
    
    if (user.password !== hash) {
      return res.render('monitoring-login', { 
        error: 'Password salah!' 
      });
    }

    req.session.emr_perawat = user.emr_perawat;
    req.session.nama_perawat = user.nama;
    req.session.role = user.role;
    req.session.loginTime = new Date().toISOString();
    
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('❌ Save error:', saveErr);
        return res.render('monitoring-login', { 
          error: 'Gagal menyimpan session!' 
        });
      }
      
      console.log('✅ Session saved for:', user.nama);
      res.redirect('/');
    });
    
  } catch (err) {
    console.error('❌ Database error:', err);
    return res.render('monitoring-login', { 
      error: 'Terjadi kesalahan sistem: ' + err.message 
    });
  }
});

app.get('/logout', (req, res) => {
  console.log('👋 Logout:', req.session.nama_perawat);
  req.session.destroy((err) => {
    if (err) console.error('❌ Logout error:', err);
    res.clearCookie('monitoring_session');
    res.redirect('/login');
  });
});

/* ============================================================
   DASHBOARD ROUTES
   ============================================================ */

app.get('/', requireLogin, (req, res) => {
  res.render('monitoring-dashboard', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat,
    role: req.session.role
  });
});
app.get('/monitoring-rawat-inap', requireLogin, (req, res) => {
  res.render('monitoring-rawat-inap', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat,
    role: req.session.role
  });
});
app.get('/rooms', requireLogin, (req, res) => {
  res.render('room-management', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat
  });
});
app.get('/api/rooms', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    
    // ✅ FIX: Specify table alias untuk kolom yang ambiguous
    const [rooms] = await conn.query(`
      SELECT 
        rd.room_id,
        rd.device_id,
        rd.emr_no,
        p.nama as nama_pasien,
        p.poli,
        rd.assigned_at
      FROM room_device rd
      LEFT JOIN pasien p ON rd.emr_no = p.emr_no
      ORDER BY rd.room_id ASC
    `);
    
    const roomsList = Array.isArray(rooms) ? rooms : [];
    
    res.json({ 
      success: true, 
      rooms: roomsList,
      count: roomsList.length
    });
  } catch (err) {
    console.error('❌ GET /api/rooms error:', err.message);
    res.status(500).json({ 
      success: false,
      error: 'Database error: ' + err.message
    });
  } finally {
    if (conn) conn.release();
  }
});

// ✅ JUGA PERBAIKI endpoint lain yang pakai created_at:

app.get('/api/rooms/available-patients', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    
    const [patients] = await conn.query(`
      SELECT 
        p.emr_no,
        p.nama,
        p.poli,
        p.jenis_kelamin
      FROM pasien p
      WHERE p.emr_no NOT IN (
        SELECT DISTINCT emr_no FROM room_device WHERE emr_no IS NOT NULL
      )
      ORDER BY p.nama ASC
    `);
    
    const patientsList = Array.isArray(patients) ? patients : [];
    
    res.json({ 
      success: true, 
      patients: patientsList,
      count: patientsList.length
    });
  } catch (err) {
    console.error('❌ GET /api/rooms/available-patients error:', err.message);
    res.status(500).json({ 
      success: false,
      error: 'Database error: ' + err.message 
    });
  } finally {
    if (conn) conn.release();
  }
});

app.post('/api/rooms/add', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { room_id, device_id, emr_no } = req.body;
    
    if (!room_id || !room_id.trim()) {
      return res.status(400).json({ error: 'Room ID harus diisi' });
    }
    if (!device_id || !device_id.trim()) {
      return res.status(400).json({ error: 'Device ID harus diisi' });
    }
    
    conn = await pool.getConnection();
    
    const [existing] = await conn.query(
      'SELECT 1 FROM room_device WHERE room_id = ?',
      [room_id.trim()]
    );
    
    if (existing.length > 0) {
      conn.release();
      return res.status(400).json({ error: 'Room ID sudah terdaftar' });
    }
    
    const emrValue = emr_no && emr_no.trim() ? parseInt(emr_no) : null;
    
    if (emrValue !== null) {
      const [patientCheck] = await conn.query(
        'SELECT 1 FROM pasien WHERE emr_no = ?',
        [emrValue]
      );
      
      if (patientCheck.length === 0) {
        conn.release();
        return res.status(400).json({ error: 'Pasien tidak ditemukan' });
      }
    }
    
    // ✅ INSERT tanpa created_at, gunakan assigned_at jika diperlukan
    await conn.query(
      'INSERT INTO room_device (room_id, device_id, emr_no) VALUES (?, ?, ?)',
      [room_id.trim(), device_id.trim(), emrValue]
    );
    
    conn.release();
    res.json({ success: true, message: 'Ruangan berhasil ditambahkan' });
  } catch (err) {
    console.error('❌ POST /api/rooms/add error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.put('/api/rooms/:room_id', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { room_id } = req.params;
    const { new_room_id, device_id } = req.body;
    
    if (!new_room_id || !new_room_id.trim()) {
      return res.status(400).json({ error: 'Room ID harus diisi' });
    }
    if (!device_id || !device_id.trim()) {
      return res.status(400).json({ error: 'Device ID harus diisi' });
    }
    
    conn = await pool.getConnection();
    
    const [roomCheck] = await conn.query(
      'SELECT 1 FROM room_device WHERE room_id = ?',
      [room_id]
    );
    
    if (roomCheck.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
    }
    
    if (new_room_id.trim() !== room_id) {
      const [duplicate] = await conn.query(
        'SELECT 1 FROM room_device WHERE room_id = ?',
        [new_room_id.trim()]
      );
      
      if (duplicate.length > 0) {
        conn.release();
        return res.status(400).json({ error: 'Room ID baru sudah digunakan' });
      }
    }
    
    await conn.query(
      'UPDATE room_device SET room_id = ?, device_id = ? WHERE room_id = ?',
      [new_room_id.trim(), device_id.trim(), room_id]
    );
    
    conn.release();
    res.json({ success: true, message: 'Ruangan berhasil diupdate' });
  } catch (err) {
    console.error('❌ PUT /api/rooms/:room_id error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/api/rooms/assign', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { room_id, emr_no } = req.body;
    
    if (!room_id || !room_id.trim()) {
      return res.status(400).json({ error: 'Room ID harus diisi' });
    }
    if (!emr_no && emr_no !== 0) {
      return res.status(400).json({ error: 'EMR Pasien harus diisi' });
    }
    
    // Validate emr_no is numeric
    if (!/^\d+$/.test(emr_no.toString())) {
      return res.status(400).json({ error: 'EMR Pasien harus berupa angka' });
    }
    
    const emrStr = String(emr_no).padStart(11, '0');
    
    conn = await pool.getConnection();
    
    const [patient] = await conn.query(
      'SELECT 1 FROM pasien WHERE emr_no = ?',
      [emrStr]
    );
    
    if (patient.length === 0) {
      conn.release();
      return res.status(400).json({ error: 'Pasien tidak ditemukan' });
    }
    
    const [room] = await conn.query(
      'SELECT 1 FROM room_device WHERE room_id = ?',
      [room_id.trim()]
    );
    
    if (room.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
    }
    
    await conn.query(
      'UPDATE room_device SET emr_no = ? WHERE room_id = ?',
      [emrStr, room_id.trim()]
    );
    
    conn.release();
    res.json({ success: true, message: 'Pasien berhasil dimasukkan ke ruangan' });
  } catch (err) {
    console.error('❌ POST /api/rooms/assign error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/api/rooms/remove-patient', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { room_id } = req.body;
    
    if (!room_id || !room_id.trim()) {
      return res.status(400).json({ error: 'Room ID harus diisi' });
    }
    
    conn = await pool.getConnection();
    
    const [room] = await conn.query(
      'SELECT 1 FROM room_device WHERE room_id = ?',
      [room_id.trim()]
    );
    
    if (room.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
    }
    
    await conn.query(
      'UPDATE room_device SET emr_no = NULL WHERE room_id = ?',
      [room_id.trim()]
    );
    
    conn.release();
    res.json({ success: true, message: 'Pasien berhasil dikeluarkan dari ruangan' });
  } catch (err) {
    console.error('❌ POST /api/rooms/remove-patient error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.delete('/api/rooms/delete', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { room_id } = req.body;
    
    if (!room_id || !room_id.trim()) {
      return res.status(400).json({ error: 'Room ID harus diisi' });
    }
    
    conn = await pool.getConnection();
    
    const [room] = await conn.query(
      'SELECT emr_no FROM room_device WHERE room_id = ?',
      [room_id.trim()]
    );
    
    if (room.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
    }
    
    if (room[0].emr_no !== null) {
      conn.release();
      return res.status(400).json({ error: 'Ruangan harus kosong sebelum dihapus' });
    }
    
    await conn.query(
      'DELETE FROM room_device WHERE room_id = ?',
      [room_id.trim()]
    );
    
    conn.release();
    res.json({ success: true, message: 'Ruangan berhasil dihapus' });
  } catch (err) {
    console.error('❌ DELETE /api/rooms/delete error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

/* ============================================================
   API ENDPOINTS - STATISTICS
   ============================================================ */

app.get('/api/statistics/today', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // ✅ FIX: Gunakan parameterized query yang benar
    let visitQuery = `SELECT COUNT(*) as total FROM kunjungan 
                       WHERE tanggal_kunjungan >= ? AND tanggal_kunjungan < ?`;
    let visitParams = [today, tomorrow];
    
    // Jika bukan admin, tambahkan filter perawat
    if (req.session.role !== 'admin') {
      visitQuery += ` AND emr_perawat = ?`;
      visitParams.push(req.session.emr_perawat);
    }
    
    const [visits] = await conn.query(visitQuery, visitParams);
    
    // ===== VISITS UNIK =====
    let patientQuery = `SELECT COUNT(DISTINCT emr_no) as total FROM kunjungan 
                        WHERE tanggal_kunjungan >= ? AND tanggal_kunjungan < ?`;
    let patientParams = [today, tomorrow];
    
    if (req.session.role !== 'admin') {
      patientQuery += ` AND emr_perawat = ?`;
      patientParams.push(req.session.emr_perawat);
    }
    
    const [patients] = await conn.query(patientQuery, patientParams);
    
    // ===== MEASUREMENTS =====
    let measurementQuery = `SELECT COUNT(*) as total FROM vitals v
                            WHERE v.waktu >= ? AND v.waktu < ?`;
    let measurementParams = [today, tomorrow];

    if (req.session.role !== 'admin') {
      // ✅ FIX: Gunakan subquery untuk filter berdasarkan perawat
      measurementQuery += ` AND v.emr_no IN (
        SELECT DISTINCT emr_no FROM kunjungan WHERE emr_perawat = ?
      )`;
      measurementParams.push(req.session.emr_perawat);
    }

    const [measurements] = await conn.query(measurementQuery, measurementParams);
    
    // ===== ACTIVE VISITS =====
    let activeQuery = `SELECT COUNT(*) as total FROM kunjungan 
                       WHERE status = 'aktif' AND tanggal_kunjungan >= ? AND tanggal_kunjungan < ?`;
    let activeParams = [today, tomorrow];
    
    if (req.session.role !== 'admin') {
      activeQuery += ` AND emr_perawat = ?`;
      activeParams.push(req.session.emr_perawat);
    }
    
    const [active] = await conn.query(activeQuery, activeParams);
    
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

app.get('/api/visits/today', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    let visitQuery = `
      SELECT 
        k.id_kunjungan,
        k.emr_no as emr_pasien,
        k.keluhan,
        k.tanggal_kunjungan,
        k.status,
        pas.nama as nama_pasien,
        pr.nama as nama_perawat,
        dokter.nama as nama_dokter,
        COALESCE(COUNT(v.id), 0) as total_measurements
      FROM kunjungan k
      JOIN pasien pas ON k.emr_no = pas.emr_no
      JOIN perawat pr ON k.emr_perawat = pr.emr_perawat
      LEFT JOIN dokter ON k.emr_dokter = dokter.emr_dokter
      LEFT JOIN vitals v ON v.emr_no = k.emr_no 
        AND DATE(v.waktu) = DATE(k.tanggal_kunjungan)
      WHERE k.tanggal_kunjungan >= ? AND k.tanggal_kunjungan < ?
    `;
    
    let params = [today, tomorrow];
    
    if (req.session.role !== 'admin') {
      visitQuery += ` AND k.emr_perawat = ?`;
      params.push(req.session.emr_perawat);
    }
    
    visitQuery += ` GROUP BY k.id_kunjungan, k.emr_no, k.keluhan, k.tanggal_kunjungan, k.status, pas.nama, pr.nama, dokter.nama
                    ORDER BY k.tanggal_kunjungan DESC`;
    
    const [visits] = await conn.query(visitQuery, params);
    
    conn.release();
    res.json({ success: true, visits });
  } catch (err) {
    console.error('❌ Visits API error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.get('/api/measurements/today', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    let measurementQuery = `
      SELECT 
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
        v.emr_no,
        pas.nama as nama_pasien,
        latest_k.emr_perawat,
        pr.nama as nama_perawat
      FROM vitals v
      JOIN pasien pas ON v.emr_no = pas.emr_no
      LEFT JOIN (
        SELECT k1.*
        FROM kunjungan k1
        INNER JOIN (
          SELECT emr_no, MAX(tanggal_kunjungan) as max_date
          FROM kunjungan
          WHERE status = 'aktif'
          GROUP BY emr_no
        ) k2 ON k1.emr_no = k2.emr_no AND k1.tanggal_kunjungan = k2.max_date
        WHERE k1.status = 'aktif'
      ) latest_k ON v.emr_no = latest_k.emr_no
      LEFT JOIN perawat pr ON latest_k.emr_perawat = pr.emr_perawat
      WHERE v.waktu >= ? AND v.waktu < ?
    `;    
    let params = [today, tomorrow];
    
    if (req.session.role !== 'admin') {
      measurementQuery += ` AND latest_k.emr_perawat = ?`;
      params.push(req.session.emr_perawat);
    }
    
    measurementQuery += ` ORDER BY v.waktu DESC LIMIT 100`;
    
    const [measurements] = await conn.query(measurementQuery, params);
    
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
      if (m.fall_detected) {
        tipe_device.push('🚨 FALL DETECTED');
        data.push('ALERT');
      }
      
      return {
        id: m.id,
        timestamp: m.timestamp,
        nama_pasien: m.nama_pasien,
        emr_no: m.emr_no,
        nama_perawat: m.nama_perawat || 'System',  // ✅ DARI KUNJUNGAN (PENANGGUNG JAWAB)
        tipe_device: tipe_device.join(', ') || 'Unknown',
        data: data.join(', ') || 'No data'
      };
    });
    
    conn.release();
    res.json({ success: true, measurements: formattedMeasurements });
  } catch (err) {
    console.error('❌ Measurements API error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

/* ============================================================
   FALL DETECTION API
   ============================================================ */

app.get('/api/fall-detection/latest', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    const [falls] = await conn.query(`
      SELECT 
        v.id, v.emr_no, v.waktu, v.fall_detected,
        v.heart_rate, 
        v.respirasi,
        v.sistolik, v.diastolik,
        p.nama as nama_pasien, p.poli,
        rd.room_id, rd.device_id,
        k.id_kunjungan,
        k.emr_perawat,
        k.emr_dokter,
        pr.nama as nama_perawat,
        dok.nama as nama_dokter
      FROM vitals v
      LEFT JOIN pasien p ON v.emr_no = p.emr_no
      LEFT JOIN room_device rd ON v.emr_no = rd.emr_no
      LEFT JOIN kunjungan k ON v.emr_no = k.emr_no 
        AND k.status = 'aktif'
      LEFT JOIN perawat pr ON k.emr_perawat = pr.emr_perawat
      LEFT JOIN dokter dok ON k.emr_dokter = dok.emr_dokter
      WHERE v.fall_detected = 1 AND v.waktu >= ?
      ORDER BY v.waktu DESC
      LIMIT 50
    `, [thirtyMinutesAgo]);
    
    conn.release();
    
    const sessionId = req.sessionID;
    
    if (!userDisplayedAlerts.has(sessionId)) {
      userDisplayedAlerts.set(sessionId, new Set());
    }
    
    const displayedIds = userDisplayedAlerts.get(sessionId);
    
    const now = Date.now();
    const newFalls = falls.filter(fall => {
      if (displayedIds.has(fall.id)) return false;
      
      const fallAge = now - new Date(fall.waktu).getTime();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (fallAge > fiveMinutes) {
        displayedIds.add(fall.id);
        return false;
      }
      
      return true;
    });
    
    console.log(`📊 API /latest: Total=${falls.length}, New=${newFalls.length}`);
    
    res.json({ 
      success: true, 
      falls: newFalls,
      count: newFalls.length,
      totalRecent: falls.length,
      displayedCount: displayedIds.size
    });
  } catch (err) {
    console.error('❌ Fall detection API error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/api/fall-detection/mark-displayed', requireAdminOrPerawat, (req, res) => {
  try {
    const { fallIds } = req.body;
    
    if (!Array.isArray(fallIds) || fallIds.length === 0) {
      return res.status(400).json({ error: 'fallIds must be a non-empty array' });
    }
    
    const sessionId = req.sessionID;
    
    if (!userDisplayedAlerts.has(sessionId)) {
      userDisplayedAlerts.set(sessionId, new Set());
    }
    
    const displayedIds = userDisplayedAlerts.get(sessionId);
    fallIds.forEach(id => displayedIds.add(parseInt(id)));
    
    res.json({ success: true, message: `${fallIds.length} fall(s) marked` });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/metabase/rawat-inap-token', requireAdminOrPerawat, (req, res) => {
  try {
    const embedUrl = getMetabaseEmbedUrl(7);
    res.json({ success: true, embedUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* ============================================================
   FIX API ENDPOINTS - PATIENT MONITORING (SIMPLIFIED)
   Replace these routes in your monitoring-server.js
   ============================================================ */

// GET: List all inpatients with basic info
app.get('/api/patients/inpatient/list', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    
    const [patients] = await conn.query(`
      SELECT 
        p.emr_no,
        p.nama,
        p.alamat,
        p.tanggal_lahir,
        p.jenis_kelamin,
        rd.room_id,
        p.poli,
        latest_k.id_kunjungan,
        latest_k.emr_perawat,
        latest_k.emr_dokter,
        latest_k.status as status_kunjungan,
        latest_v.respirasi,
        latest_v.heart_rate,
        latest_v.jarak_kasur_cm,
        latest_v.fall_detected,
        latest_v.waktu as waktu_vital
      FROM room_device rd
      INNER JOIN pasien p ON rd.emr_no = p.emr_no
      
      -- Get active visit dengan emr_perawat & emr_dokter dari kunjungan
      LEFT JOIN (
        SELECT k1.*
        FROM kunjungan k1
        INNER JOIN (
          SELECT emr_no, MAX(tanggal_kunjungan) as max_date
          FROM kunjungan
          WHERE status = 'aktif'
          GROUP BY emr_no
        ) k2 ON k1.emr_no = k2.emr_no AND k1.tanggal_kunjungan = k2.max_date
        WHERE k1.status = 'aktif'
      ) latest_k ON p.emr_no = latest_k.emr_no
      
      -- Get latest vitals
      LEFT JOIN (
        SELECT v1.*
        FROM vitals v1
        INNER JOIN (
          SELECT emr_no, MAX(waktu) as max_waktu
          FROM vitals
          GROUP BY emr_no
        ) v2 ON v1.emr_no = v2.emr_no AND v1.waktu = v2.max_waktu
      ) latest_v ON p.emr_no = latest_v.emr_no
      
      WHERE rd.emr_no IS NOT NULL
      ORDER BY rd.room_id, p.emr_no
    `);
    
    const formattedPatients = [];
    for (const p of patients) {
      let namaperawat = 'Belum ditugaskan';
      let namadokter = 'Belum ditentukan';
      
      // ✅ FIXED: Get perawat dari kunjungan.emr_perawat
      if (p.emr_perawat) {
        const [perawat] = await conn.query(
          'SELECT nama FROM perawat WHERE emr_perawat = ?',
          [p.emr_perawat]
        );
        namaperawat = perawat[0]?.nama || 'Belum ditugaskan';
      }
      
      // ✅ FIXED: Get dokter dari kunjungan.emr_dokter
      // Asumsi: emr_dokter juga referensi ke tabel perawat
      if (p.emr_dokter) {
        const [dokter] = await conn.query(
          'SELECT nama FROM dokter WHERE emr_dokter = ?',
          [p.emr_dokter]
        );
        namadokter = dokter[0]?.nama || 'Belum ditentukan';
      }      

      let status_fall = 'Tidak Ada Data';
      if (p.fall_detected === 1) {
        status_fall = 'Terdeteksi Fall';
      } else if (p.fall_detected === 0) {
        status_fall = 'Tidak Ada Fall';
      }
      
      formattedPatients.push({
        emr_no: p.emr_no,
        nama: p.nama,
        alamat: p.alamat,
        tanggal_lahir: p.tanggal_lahir,
        jenis_kelamin: p.jenis_kelamin,
        room_id: p.room_id,
        poli: p.poli,
        id_kunjungan: p.id_kunjungan,
        respirasi: p.respirasi || '-',
        heart_rate: p.heart_rate || '-',
        jarak_kasur_cm: p.jarak_kasur_cm || '-',
        status_fall: status_fall,
        waktu: p.waktu_vital,
        nama_perawat: namaperawat,
        nama_dokter: namadokter
      });
    }
    
    conn.release();
    
    console.log(`✅ Loaded ${formattedPatients.length} unique inpatients`);
    
    res.json({ 
      success: true, 
      patients: formattedPatients, 
      count: formattedPatients.length 
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Patient detail with real-time vitals
app.get('/api/patients/inpatient/:emr_no', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { emr_no } = req.params;
    const emrStr = String(emr_no).padStart(11, '0');
    
    if (!/^\d{1,11}$/.test(String(emr_no))) {
      return res.status(400).json({ error: 'Invalid EMR format' });
    }
    
    conn = await pool.getConnection();
    
    // ✅ FIXED: Ambil emr_dokter & emr_perawat dari kunjungan
    const [patient] = await conn.query(`
      SELECT 
        p.emr_no,
        p.nama,
        p.tanggal_lahir,
        p.alamat,
        p.jenis_kelamin,
        p.poli,
        rd.room_id,
        k.id_kunjungan,
        k.status as status_kunjungan,
        k.keluhan,
        k.emr_perawat,
        k.emr_dokter
      FROM pasien p
      LEFT JOIN room_device rd ON p.emr_no = rd.emr_no
      LEFT JOIN kunjungan k ON p.emr_no = k.emr_no AND k.status = 'aktif'
      WHERE p.emr_no = ?
      ORDER BY k.tanggal_kunjungan DESC
      LIMIT 1
    `, [emrStr]);
    
    if (patient.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Patient not found' });
    }
    
    const patientData = patient[0];
    
    // Get latest vitals
    const [latestVital] = await conn.query(`
      SELECT 
        heart_rate, respirasi, fall_detected, waktu,
        sistolik, diastolik, glukosa
      FROM vitals
      WHERE emr_no = ?
      ORDER BY waktu DESC
      LIMIT 1
    `, [emrStr]);
    
    let vitalData = {
      heart_rate: 0,
      respirasi: 0,
      status_fall: 'NORMAL',
      sistolik: 0,
      diastolik: 0,
      glukosa: 0,
      waktu: null
    };
    
    if (latestVital.length > 0) {
      const vital = latestVital[0];
      vitalData = {
        heart_rate: vital.heart_rate || 0,
        respirasi: vital.respirasi || 0,
        status_fall: vital.fall_detected === 1 ? 'DETECTED' : 'NORMAL',
        sistolik: vital.sistolik || 0,
        diastolik: vital.diastolik || 0,
        glukosa: vital.glukosa || 0,
        waktu: vital.waktu
      };
    }
    
    // ✅ FIXED: Get perawat dari emr_perawat di kunjungan
    let namaperawat = 'Belum ditugaskan';
    let namadokter = 'Belum ditentukan';
    
    if (patientData.emr_perawat) {
      const [perawat] = await conn.query(
        'SELECT nama FROM perawat WHERE emr_perawat = ?',
        [patientData.emr_perawat]
      );
      namaperawat = perawat[0]?.nama || 'Belum ditugaskan';
    }
    
    // ✅ FIXED: Get dokter dari emr_dokter di kunjungan
    if (patientData.emr_dokter) {
      const [dokter] = await conn.query(
        'SELECT nama FROM dokter WHERE emr_dokter = ?',
        [patientData.emr_dokter]
      );
      namadokter = dokter[0]?.nama || 'Belum ditentukan';
    }

    
    conn.release();
    
    res.json({
      success: true,
      patient: {
        emr_no: patientData.emr_no,
        nama: patientData.nama,
        tanggal_lahir: patientData.tanggal_lahir,
        alamat: patientData.alamat,
        jenis_kelamin: patientData.jenis_kelamin,
        poli: patientData.poli,
        room_id: patientData.room_id,
        id_kunjungan: patientData.id_kunjungan,
        nama_perawat: namaperawat,
        nama_dokter: namadokter,
        status_kunjungan: patientData.status_kunjungan || 'aktif',
        keluhan: patientData.keluhan
      },
      vitals: vitalData
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Patient examination history
app.get('/api/patients/inpatient/:emr_no/examinations', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { emr_no } = req.params;
    const emrStr = String(emr_no).padStart(11, '0');
    
    // ✅ Optional: Validate format only if needed
    if (!/^\d{1,11}$/.test(String(emr_no))) {
      return res.status(400).json({ error: 'Invalid EMR format' });
    }

    
    conn = await pool.getConnection();

    const [examinations] = await conn.query(`
      SELECT 
        v.id,
        v.emr_no,
        v.waktu,
        v.heart_rate,
        v.respirasi,
        v.jarak_kasur_cm,
        v.glukosa,
        v.berat_badan_kg,
        v.sistolik,
        v.diastolik,
        v.fall_detected,
        v.tinggi_badan_cm,
        v.bmi,
        latest_k.emr_perawat,
        latest_k.emr_dokter,
        pr.nama as nama_perawat
      FROM vitals v
      LEFT JOIN (
        SELECT k1.*
        FROM kunjungan k1
        INNER JOIN (
          SELECT emr_no, MAX(tanggal_kunjungan) as max_date
          FROM kunjungan
          WHERE status = 'aktif'
          GROUP BY emr_no
        ) k2 ON k1.emr_no = k2.emr_no AND k1.tanggal_kunjungan = k2.max_date
        WHERE k1.status = 'aktif'
      ) latest_k ON v.emr_no = latest_k.emr_no
      LEFT JOIN perawat pr ON latest_k.emr_perawat = pr.emr_perawat
      WHERE v.emr_no = ?
      ORDER BY v.waktu DESC
      LIMIT 100
    `, [emrStr]);

    conn.release();
    res.json({ 
      success: true, 
      examinations: examinations, 
      count: examinations.length 
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Patient vitals for charts (last 24 hours)
app.get('/api/patients/inpatient/:emr_no/vitals/chart', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { emr_no } = req.params;
    const emrStr = String(emr_no).padStart(11, '0');
    
    if (!/^\d{1,11}$/.test(String(emr_no))) {
      return res.status(400).json({ error: 'Invalid EMR format' });
    }
    
    conn = await pool.getConnection();
    
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const [vitals] = await conn.query(`
      SELECT 
        waktu,
        heart_rate,
        respirasi,
        glukosa,
        fall_detected,
        tinggi_badan_cm,
        berat_badan_kg,
        sistolik,
        diastolik
      FROM vitals
      WHERE emr_no = ? AND waktu >= ?
      ORDER BY waktu ASC
    `, [emrStr, last24Hours]);
    
    conn.release();
    
    res.json({
      success: true,
      vitals: vitals,
      count: vitals.length
    });
  } catch (err) {
    console.error('❌ GET /api/patients/inpatient/:emr_no/vitals/chart error:', err.message);
    console.error('Stack:', err.stack);
    if (conn) conn.release();
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// GET visit detail
app.get('/api/visits/:visitId', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { visitId } = req.params;
    conn = await pool.getConnection();
    
    const [visit] = await conn.query(
      'SELECT * FROM kunjungan WHERE id_kunjungan = ?',
      [visitId]
    );
    
    if (visit.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Visit not found' });
    }
    
    const v = visit[0];
    
    const [patient] = await conn.query(
      'SELECT * FROM pasien WHERE emr_no = ?',
      [v.emr_no]
    );
    
    const [perawat] = await conn.query(
      'SELECT nama FROM perawat WHERE emr_perawat = ?',
      [v.emr_perawat]
    );
    
    const [dokter] = await conn.query(
      'SELECT nama FROM dokter WHERE emr_dokter = ?',
      [v.emr_dokter]
    );
    
    const [vitals] = await conn.query(
      'SELECT * FROM vitals WHERE emr_no = ? ORDER BY waktu DESC LIMIT 1',
      [v.emr_no]
    );
    
    conn.release();
    
    res.json({
      success: true,
      visit: v,
      patient: patient[0],
      perawat: perawat[0],
      dokter: dokter[0],
      vitals: vitals[0] || {}
    });
  } catch (err) {
    if (conn) conn.release();
    res.status(500).json({ error: err.message });
  }
});

// GET outpatient measurements
app.get('/api/patients/outpatient/:emrNo/measurements', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { emrNo } = req.params;
    const emrStr = String(emrNo).padStart(11, '0');
    
    conn = await pool.getConnection();
    
    const [measurements] = await conn.query(
      `SELECT * FROM vitals WHERE emr_no = ? 
       ORDER BY waktu DESC LIMIT 100`,
      [emrStr]
    );
    
    conn.release();
    res.json({ success: true, measurements });
  } catch (err) {
    if (conn) conn.release();
    res.status(500).json({ error: err.message });
  }
});

// GET outpatient vitals chart
app.get('/api/patients/outpatient/:emrNo/vitals/chart', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { emrNo } = req.params;
    const emrStr = String(emrNo).padStart(11, '0');
    
    conn = await pool.getConnection();
    
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const [vitals] = await conn.query(
      `SELECT * FROM vitals WHERE emr_no = ? AND waktu >= ?
       ORDER BY waktu ASC`,
      [emrStr, last24Hours]
    );
    
    conn.release();
    res.json({ success: true, vitals });
  } catch (err) {
    if (conn) conn.release();
    res.status(500).json({ error: err.message });
  }
});


/* ============================================================
   RAWAT JALAN MONITORING API
   ============================================================ */

// GET: Visit detail by id_kunjungan
app.get('/api/visits/:visitId', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { visitId } = req.params;
    
    conn = await pool.getConnection();
    
    // Get visit info
    const [visit] = await conn.query(
      'SELECT * FROM kunjungan WHERE id_kunjungan = ?',
      [visitId]
    );
    
    if (visit.length === 0) {
      conn.release();
      return res.status(404).json({ 
        success: false,
        error: 'Visit not found' 
      });
    }
    
    const visitData = visit[0];
    
    // Get patient info
    const [patient] = await conn.query(
      'SELECT * FROM pasien WHERE emr_no = ?',
      [visitData.emr_no]
    );
    
    // Get perawat info
    const [perawat] = await conn.query(
      'SELECT nama FROM perawat WHERE emr_perawat = ?',
      [visitData.emr_perawat]
    );
    
    // Get dokter info
    const [dokter] = await conn.query(
      'SELECT nama FROM dokter WHERE emr_dokter = ?',
      [visitData.emr_dokter]
    );
    
    // Get latest vitals for this visit (same day)
    const [vitals] = await conn.query(
      `SELECT * FROM vitals 
       WHERE emr_no = ? 
         AND DATE(waktu) = DATE(?)
       ORDER BY waktu DESC 
       LIMIT 1`,
      [visitData.emr_no, visitData.tanggal_kunjungan]
    );
    
    conn.release();
    
    res.json({
      success: true,
      visit: visitData,
      patient: patient[0] || null,
      perawat: perawat[0] || null,
      dokter: dokter[0] || null,
      vitals: vitals[0] || {}
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// GET: All measurements for a patient (Rawat Jalan)
app.get('/api/patients/outpatient/:emrNo/measurements', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { emrNo } = req.params;
    const emrStr = String(emrNo).padStart(11, '0');
    
    conn = await pool.getConnection();
    
    // Get all measurements for this patient, ordered by time
    const [measurements] = await conn.query(
      `SELECT * FROM vitals 
       WHERE emr_no = ? 
       ORDER BY waktu DESC 
       LIMIT 100`,
      [emrStr]
    );
    
    conn.release();
    
    res.json({ 
      success: true, 
      measurements: measurements,
      count: measurements.length
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// GET: Vitals chart data for outpatient (last 24 hours)
// GET: Vitals chart data for outpatient (ALL DATA)
app.get('/api/patients/outpatient/:emrNo/vitals/chart', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    const { emrNo } = req.params;
    const emrStr = String(emrNo).padStart(11, '0');
    
    conn = await pool.getConnection();
    
    // ✅ Get ALL vitals for this patient (no time limit)
    const [vitals] = await conn.query(
      `SELECT * FROM vitals 
       WHERE emr_no = ?
       ORDER BY waktu ASC
       LIMIT 1000`, // ✅ Optional: limit to prevent too much data
      [emrStr]
    );
    
    conn.release();
    
    res.json({ 
      success: true, 
      vitals: vitals,
      count: vitals.length
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (conn) conn.release();
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});
/* ============================================================
   SOCKET.IO SETUP
   ============================================================ */

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const RAWAT_JALAN_URL = process.env.RAWAT_JALAN_URL || 'http://darsinurse-app:4000';

const rawajalanSocket = io_client(RAWAT_JALAN_URL, {
  reconnection: true,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 10000,
  reconnectionAttempts: 10,
  timeout: 10000,
  transports: ['websocket', 'polling'],
  autoConnect: true,
  forceNew: true
});

rawajalanSocket.on('connect', () => {
  console.log('✅ Connected to Rawat Jalan Server');
  io.emit('rawat-jalan-connected', {
    message: 'Fall detection system is active',
    timestamp: new Date()
  });
});

rawajalanSocket.on('disconnect', (reason) => {
  console.warn('⚠️ Disconnected from Rawat Jalan:', reason);
});

rawajalanSocket.on('new-fall-alert', (alert) => {
  if (!alert || !alert.nama_pasien) return;
  
  if (processedFallIds.has(alert.id)) {
    return;
  }
  
  processedFallIds.add(alert.id);
  
  if (processedFallIds.size > PROCESSED_IDS_LIMIT) {
    const idsToRemove = Array.from(processedFallIds).slice(0, 100);
    idsToRemove.forEach(id => processedFallIds.delete(id));
  }
  
  console.log(`🚨 Broadcasting fall: ${alert.nama_pasien}`);
  io.to('monitoring-room').emit('fall-alert', alert);
});

io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  socket.join('monitoring-room');
  
  socket.emit('connection-status', {
    rawajalanConnected: rawajalanSocket.connected
  });
  
  socket.on('acknowledge-fall', (data) => {
    rawajalanSocket.emit('fall-acknowledged', {
      alertId: data.alertId,
      acknowledgedBy: data.acknowledgedBy,
      timestamp: new Date().toISOString()
    });
  });

  socket.emit('mqtt-status', {
    connected: mqttConnected,
    broker: '103.106.72.181:1883'
  });
  
  // Handle join room untuk patient detail
  socket.on('join-patient-room', (data) => {
    const room = `room-${data.room_id}`;
    socket.join(room);
    console.log(`✓ Client joined room: ${room}`);
  });
  
  socket.on('leave-patient-room', (data) => {
    const room = `room-${data.room_id}`;
    socket.leave(room);
    console.log(`✓ Client left room: ${room}`);
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

/* ============================================================
   ADD AFTER SOCKET.IO SETUP (around line 800)
   ============================================================ */

// ✅ NEW: Real-time vital signs broadcasting
let lastCheckedVitalTimestamp = new Date(Date.now() - 60000); // Start from 1 minute ago

async function broadcastVitalUpdates() {
  let conn;
  try {
    conn = await pool.getConnection();
    const [newVitals] = await conn.query(`
      SELECT 
        v.id, v.emr_no, v.waktu,
        v.heart_rate, 
        v.respirasi,
        v.glukosa,
        v.sistolik, v.diastolik,
        v.jarak_kasur_cm, v.fall_detected,
        v.berat_badan_kg, v.tinggi_badan_cm, v.bmi,
        p.nama as nama_pasien,
        rd.room_id,
        latest_k.emr_perawat,
        pr.nama as nama_perawat
      FROM vitals v
      LEFT JOIN pasien p ON v.emr_no = p.emr_no
      LEFT JOIN room_device rd ON v.emr_no = rd.emr_no
      LEFT JOIN (
        SELECT k1.*
        FROM kunjungan k1
        INNER JOIN (
          SELECT emr_no, MAX(tanggal_kunjungan) as max_date
          FROM kunjungan
          WHERE status = 'aktif'
          GROUP BY emr_no
        ) k2 ON k1.emr_no = k2.emr_no AND k1.tanggal_kunjungan = k2.max_date
        WHERE k1.status = 'aktif'
      ) latest_k ON v.emr_no = latest_k.emr_no
      LEFT JOIN perawat pr ON latest_k.emr_perawat = pr.emr_perawat
      WHERE v.waktu > ?
      ORDER BY v.waktu ASC
      LIMIT 50
    `, [lastCheckedVitalTimestamp]);    
    conn.release();
    
    if (newVitals.length === 0) {
      return;
    }
    
    lastCheckedVitalTimestamp = new Date(newVitals[newVitals.length - 1].waktu);
    
    console.log(`📊 [VITAL-POLL] Broadcasting ${newVitals.length} new vital(s)`);
    
    newVitals.forEach(vital => {
      const vitalData = {
        id: vital.id,
        emr_no: vital.emr_no,
        nama_pasien: vital.nama_pasien,
        nama_perawat: vital.nama_perawat || 'System',
        room_id: vital.room_id,
        waktu: vital.waktu,
        vitals: {
          heart_rate: vital.heart_rate,
          respirasi: vital.respirasi,
          glukosa: vital.glukosa,
          sistolik: vital.sistolik,
          diastolik: vital.diastolik,
          jarak_kasur_cm: vital.jarak_kasur_cm,
          fall_detected: vital.fall_detected,
          berat_badan_kg: vital.berat_badan_kg,
          tinggi_badan_cm: vital.tinggi_badan_cm,
          bmi: vital.bmi
        }
      };
      
      console.log(`📤 [VITAL] EMR ${vital.emr_no}: HR=${vital.heart_rate}, RR=${vital.respirasi}, Perawat=${vital.nama_perawat}`);
      
      io.to('monitoring-room').emit('vital-update', vitalData);
      io.to(`patient-${vital.emr_no}`).emit('vital-update-detail', vitalData);
      
      // ✅ Broadcast fall alert DENGAN HR DAN RR TERAKHIR
      if (vital.fall_detected === 1) {
      const fallAlert = {
        id: vital.id,                          // ✅ FIXED: pakai vital.id
        emr_no: vital.emr_no,                  // ✅ FIXED
        nama_pasien: vital.nama_pasien,        // ✅ FIXED
        nama_perawat: vital.nama_perawat || 'System',
        room_id: vital.room_id,
        waktu: vital.waktu.toISOString(),
        heart_rate: vital.heart_rate,          // ✅ KEEP
        respirasi: vital.respirasi             // ✅ KEEP
      };

      io.to('monitoring-room').emit('fall-alert', fallAlert);
      console.log(`🚨 [FALL] Alert broadcasted for EMR ${vital.emr_no} - HR: ${vital.heart_rate}, RR: ${vital.respirasi} - Perawat: ${vital.nama_perawat}`);
      }
    });
    
  } catch (err) {
    console.error('⚠️ [VITAL-POLL] Error:', err.message);
    if (conn) conn.release();
  }
}

// ✅ Start polling every 2 seconds
const VITAL_CHECK_INTERVAL = 2000; // 2 seconds
const vitalCheckIntervalId = setInterval(broadcastVitalUpdates, VITAL_CHECK_INTERVAL);

console.log('✅ Real-time vital monitoring started (polling every 2s)');

/* ============================================================
   UPDATE SOCKET.IO CONNECTION HANDLER
   ============================================================ */

io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  socket.join('monitoring-room');
  
  socket.emit('connection-status', {
    rawajalanConnected: rawajalanSocket.connected
  });
  
  // ✅ NEW: Join patient-specific room when viewing detail
  socket.on('join-patient-room', (data) => {
    if (data.emr_no) {
      socket.join(`patient-${data.emr_no}`);
      console.log(`📍 Socket ${socket.id} joined patient-${data.emr_no}`);
    }
  });
  
  // ✅ NEW: Leave patient room
  socket.on('leave-patient-room', (data) => {
    if (data.emr_no) {
      socket.leave(`patient-${data.emr_no}`);
      console.log(`📤 Socket ${socket.id} left patient-${data.emr_no}`);
    }
  });
  
  socket.on('acknowledge-fall', (data) => {
    rawajalanSocket.emit('fall-acknowledged', {
      alertId: data.alertId,
      acknowledgedBy: data.acknowledgedBy,
      timestamp: new Date().toISOString()
    });
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

/* ============================================================
   UPDATE SIGTERM HANDLER (ADD VITAL CLEANUP)
   ============================================================ */

process.on('SIGTERM', () => {
  clearInterval(fallCheckIntervalId);
  clearInterval(vitalCheckIntervalId); // ✅ NEW
  rawajalanSocket.disconnect();
  server.close(() => process.exit(0));
});

/* ============================================================
   AUTO-POLLING FALL DETECTION
   ============================================================ */

(async () => {
  try {
    const conn = await pool.getConnection();
    const [result] = await conn.query(
      'SELECT MAX(id) as max_id FROM vitals WHERE fall_detected = 1'
    );
    lastCheckedVitalId = result[0].max_id || 0;
    conn.release();
    console.log(`✓ Fall watcher initialized (last ID: ${lastCheckedVitalId})`);
  } catch (err) {
    console.error('❌ Initialize error:', err.message);
  }
})();

async function checkFallDetectionFromDatabase() {
  try {
    const conn = await pool.getConnection();
    
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const [falls] = await conn.query(`
      SELECT 
        v.id, v.emr_no, v.waktu, v.fall_detected,
        v.heart_rate,
        v.respirasi,
        v.sistolik, v.diastolik,
        p.nama as nama_pasien, p.poli,
        rd.room_id, 
        rd.device_id,
        latest_k.emr_perawat,
        pr.nama as nama_perawat
      FROM vitals v
      LEFT JOIN pasien p ON v.emr_no = p.emr_no
      LEFT JOIN room_device rd ON v.emr_no = rd.emr_no
      LEFT JOIN (
        SELECT k1.*
        FROM kunjungan k1
        INNER JOIN (
          SELECT emr_no, MAX(tanggal_kunjungan) as max_date
          FROM kunjungan
          WHERE status = 'aktif'
          GROUP BY emr_no
        ) k2 ON k1.emr_no = k2.emr_no AND k1.tanggal_kunjungan = k2.max_date
        WHERE k1.status = 'aktif'
      ) latest_k ON v.emr_no = latest_k.emr_no
      LEFT JOIN perawat pr ON latest_k.emr_perawat = pr.emr_perawat
      WHERE v.fall_detected = 1 
        AND v.id > ?
        AND v.waktu >= ?
      ORDER BY v.id ASC
      LIMIT 20
    `, [lastCheckedVitalId, thirtyMinutesAgo]);

    conn.release();
    
    if (falls.length === 0) return;
    
    console.log(`🔍 Found ${falls.length} new fall(s) to process`);
    
    falls.forEach(fall => {
      lastCheckedVitalId = Math.max(lastCheckedVitalId, fall.id);
      
      const fallAge = Date.now() - new Date(fall.waktu).getTime();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (processedFallIds.has(fall.id)) {
        console.log(`⏭️ Fall ${fall.id} already processed (global check)`);
        return;
      }
      
      if (fallAge > fiveMinutes) {
        console.log(`⏭️ Fall ${fall.id} too old (${Math.round(fallAge/60000)} mins), skipping`);
        processedFallIds.add(fall.id);
        return;
      }
      
      processedFallIds.add(fall.id);
      
      if (processedFallIds.size > PROCESSED_IDS_LIMIT) {
        const idsArray = Array.from(processedFallIds);
        const idsToRemove = idsArray.slice(0, 100);
        idsToRemove.forEach(id => processedFallIds.delete(id));
        console.log(`🧹 Cleaned ${idsToRemove.length} old processed IDs`);
      }

      const alertData = {
        id: fall.id,
        emr_no: fall.emr_no,
        nama_pasien: fall.nama_pasien,
        nama_perawat: fall.nama_perawat || 'System',
        room_id: fall.room_id,
        device_id: fall.device_id,
        poli: fall.poli,
        waktu: fall.waktu.toISOString(),
        heart_rate: fall.heart_rate,
        respirasi: fall.respirasi,           // ✅ KEEP
        jarak_kasur_cm: fall.jarak_kasur_cm
      };

      console.log(`📤 Broadcasting fall ${fall.id}: ${fall.nama_pasien} - HR: ${fall.heart_rate}, RR: ${fall.respirasi} - Perawat: ${fall.nama_perawat}`);
      io.to('monitoring-room').emit('fall-alert', alertData);
    });
    
  } catch (err) {
    console.error('⚠️ Poll error:', err.message);
  }
}

const fallCheckIntervalId = setInterval(checkFallDetectionFromDatabase, FALL_CHECK_INTERVAL);

/* ============================================================
   START SERVER
   ============================================================ */

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   DARSINURSE MONITORING SERVER         ║
║   Server: http://localhost:${PORT}     ║
║   Socket.IO: ACTIVE                    ║
║   Session: MySQL Persistent            ║
╚════════════════════════════════════════╝
`);
});

process.on('SIGTERM', () => {
  clearInterval(fallCheckIntervalId);
  rawajalanSocket.disconnect();
  server.close(() => process.exit(0));
});

module.exports = { app, server, io };