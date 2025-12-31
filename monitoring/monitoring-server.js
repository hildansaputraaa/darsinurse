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
    if (!emr_no) {
      return res.status(400).json({ error: 'EMR Pasien harus diisi' });
    }
    
    const emrInt = parseInt(emr_no);
    if (isNaN(emrInt)) {
      return res.status(400).json({ error: 'EMR Pasien harus berupa angka' });
    }
    
    conn = await pool.getConnection();
    
    const [patient] = await conn.query(
      'SELECT 1 FROM pasien WHERE emr_no = ?',
      [emrInt]
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
      [emrInt, room_id.trim()]
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
    
    const whereClause = req.session.role === 'admin' 
      ? '' 
      : `AND v.emr_perawat = ${req.session.emr_perawat}`;
    
    const [measurements] = await conn.query(
      `SELECT 
        v.id, v.waktu as timestamp,
        v.heart_rate, v.sistolik, v.diastolik,
        v.respirasi, v.glukosa,
        v.berat_badan_kg, v.tinggi_badan_cm, v.bmi,
        v.jarak_kasur_cm, v.fall_detected,
        pas.nama as nama_pasien, pas.emr_no,
        pr.nama as nama_perawat, k.id_kunjungan
       FROM vitals v
       JOIN pasien pas ON v.emr_no = pas.emr_no
       LEFT JOIN perawat pr ON v.emr_perawat = pr.emr_perawat
       LEFT JOIN kunjungan k ON v.id_kunjungan = k.id_kunjungan
       WHERE v.waktu >= ? AND v.waktu < ? ${whereClause}
       ORDER BY v.waktu DESC
       LIMIT 100`,
      [today, tomorrow]
    );
    
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
        nama_perawat: m.nama_perawat || 'System',
        id_kunjungan: m.id_kunjungan,
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
    
    // ✅ FIX: Only get falls from last 30 minutes instead of 24 hours
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    const [falls] = await conn.query(`
      SELECT 
        v.id, v.emr_no, v.waktu, v.fall_detected,
        v.heart_rate, v.sistolik, v.diastolik,
        p.nama as nama_pasien, p.poli,
        rd.room_id, rd.device_id
      FROM vitals v
      LEFT JOIN pasien p ON v.emr_no = p.emr_no
      LEFT JOIN room_device rd ON v.emr_no = rd.emr_no
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
    
    // ✅ FIX: Filter out old alerts even if not displayed
    const now = Date.now();
    const newFalls = falls.filter(fall => {
      if (displayedIds.has(fall.id)) return false;
      
      const fallAge = now - new Date(fall.waktu).getTime();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (fallAge > fiveMinutes) {
        // Auto-mark as displayed if too old
        displayedIds.add(fall.id);
        return false;
      }
      
      return true;
    });
    
    console.log(`📊 API /latest: Total=${falls.length}, New=${newFalls.length}, Session=${sessionId.substring(0, 8)}`);
    
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
  
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
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
    
    // ✅ FIX: Add time window - only check falls from last 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    const [falls] = await conn.query(`
      SELECT 
        v.id, v.emr_no, v.waktu, v.fall_detected,
        v.heart_rate, v.sistolik, v.diastolik,
        p.nama as nama_pasien, p.poli,
        rd.room_id
      FROM vitals v
      LEFT JOIN pasien p ON v.emr_no = p.emr_no
      LEFT JOIN room_device rd ON v.emr_no = rd.emr_no
      WHERE v.fall_detected = 1 
        AND v.id > ?
        AND v.waktu >= ?  -- ✅ NEW: Time filter
      ORDER BY v.id ASC
      LIMIT 20
    `, [lastCheckedVitalId, thirtyMinutesAgo]);
    
    conn.release();
    
    if (falls.length === 0) return;
    
    console.log(`🔍 Found ${falls.length} new fall(s) to process`);
    
    falls.forEach(fall => {
      lastCheckedVitalId = Math.max(lastCheckedVitalId, fall.id);
      
      // ✅ FIX: Check both global and age before broadcasting
      const fallAge = Date.now() - new Date(fall.waktu).getTime();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (processedFallIds.has(fall.id)) {
        console.log(`⏭️ Fall ${fall.id} already processed (global check)`);
        return;
      }
      
      if (fallAge > fiveMinutes) {
        console.log(`⏭️ Fall ${fall.id} too old (${Math.round(fallAge/60000)} mins), skipping`);
        processedFallIds.add(fall.id); // Mark as processed to prevent future checks
        return;
      }
      
      processedFallIds.add(fall.id);
      
      // ✅ Cleanup if too many IDs stored
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
        room_id: fall.room_id || `Room-${fall.emr_no}`,
        poli: fall.poli,
        waktu: fall.waktu.toISOString(),
        heart_rate: fall.heart_rate,
        sistolik: fall.sistolik,
        diastolik: fall.diastolik,
        blood_pressure: fall.sistolik && fall.diastolik 
          ? `${fall.sistolik}/${fall.diastolik}` : 'N/A'
      };
      
      console.log(`📤 Broadcasting fall ${fall.id}: ${fall.nama_pasien}`);
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