/* ============================================================
   DARSINURSE GATEWAY - MONITORING SERVER (FIXED)
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
  checkExpirationInterval: 900000, // 15 minutes
  expiration: 86400000, // 1 day
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

// Check pool connection
pool.on('error', (err) => {
  console.error('❌ MySQL Pool Error:', err);
});

pool.on('connection', (connection) => {
  console.log('✓ New pool connection established');
});

/* ============================================================
   MIDDLEWARE SETUP - CORRECT ORDER!
   ============================================================ */

// 1️⃣ TRUST PROXY (for production behind nginx)
/* ============================================================
   MINIMAL FIX - SESSION CONFIGURATION
   ============================================================ */

// 1️⃣ TRUST PROXY (for production behind nginx/tunnel)
app.set('trust proxy', 1);

// 2️⃣ BODY PARSER (FIRST)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 3️⃣ VIEWS & STATIC
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// 4️⃣ SESSION (WITH MYSQL STORE - BEFORE ROUTES)
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
// 5️⃣ SESSION DEBUG MIDDLEWARE
app.use((req, res, next) => {
  if (req.path !== '/favicon.ico') {
    console.log(`
📍 ${req.method} ${req.path}
   Protocol: ${req.protocol}
   Secure: ${req.secure}
   X-Forwarded-Proto: ${req.get('x-forwarded-proto')}
   Host: ${req.get('host')}
   Session ID: ${req.sessionID?.substring(0, 8)}...
   EMR in session: ${req.session?.emr_perawat || 'none'}
   Cookie: ${req.get('cookie') ? 'present' : 'missing'}
    `);
  }
  next();
});

// 6️⃣ CORS (LAST)
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
   AUTH MIDDLEWARE (IMPROVED)
   ============================================================ */
const requireLogin = (req, res, next) => {
  console.log('🔐 Auth check:');
  console.log('   Path:', req.path);
  console.log('   Session ID:', req.sessionID?.substring(0, 8) + '...');
  console.log('   EMR in session:', req.session.emr_perawat);
  console.log('   Session object:', JSON.stringify(req.session, null, 2));
  
  if (!req.session || !req.session.emr_perawat) {
    console.log('❌ No valid session, redirecting to login');
    return res.redirect('/login');
  }
  
  console.log('✅ Session valid for:', req.session.nama_perawat);
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
  
  const publicDashboards = {
    7: '18889b1d-d9fd-4ddd-8f32-0f56a0a8da6c',
  };
  
  const uuid = publicDashboards[dashboardId];
  if (!uuid) {
    throw new Error(`Dashboard ${dashboardId} tidak tersedia`);
  }
  
  return `${METABASE_URL}/public/dashboard/${uuid}`;
}

// LOGIN PAGE (GET)
app.get('/login', (req, res) => {
  // Kalau sudah login, redirect ke dashboard
  if (req.session && req.session.emr_perawat) {
    return res.redirect('/');
  }
  res.render('monitoring-login', { error: null });
});

// PROSES LOGIN (POST) - SIMPLE & WORKING
app.post('/login', async (req, res) => {
  const { emr_perawat, password } = req.body;
  
  console.log('🔐 Login attempt for EMR:', emr_perawat);
  
  // Validasi input
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
    // Query database
    const [rows] = await pool.query(
      'SELECT * FROM perawat WHERE emr_perawat = ?',
      [emrInt]
    );

    if (rows.length === 0) {
      console.log('❌ User not found');
      return res.render('monitoring-login', { 
        error: 'EMR Perawat tidak ditemukan!' 
      });
    }

    const user = rows[0];
    
    if (user.password !== hash) {
      console.log('❌ Wrong password');
      return res.render('monitoring-login', { 
        error: 'Password salah!' 
      });
    }

    console.log('✅ Credentials valid for:', user.nama);

    // Set session data LANGSUNG (no destroy, no regenerate)
    req.session.emr_perawat = user.emr_perawat;
    req.session.nama_perawat = user.nama;
    req.session.role = user.role;
    req.session.loginTime = new Date().toISOString();
    
    console.log('📝 Session set:', {
      sessionID: req.sessionID.substring(0, 8) + '...',
      emr: user.emr_perawat,
      nama: user.nama
    });
    
    // Save session
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('❌ Save error:', saveErr);
        return res.render('monitoring-login', { 
          error: 'Gagal menyimpan session!' 
        });
      }
      
      console.log('✅ Session saved, redirecting to /');
      res.redirect('/');
    });
    
  } catch (err) {
    console.error('❌ Database error:', err);
    return res.render('monitoring-login', { 
      error: 'Terjadi kesalahan sistem: ' + err.message 
    });
  }
});

// LOGOUT
app.get('/logout', (req, res) => {
  console.log('👋 Logout:', req.session.nama_perawat);
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Logout error:', err);
    }
    res.clearCookie('monitoring_session');
    res.redirect('/login');
  });
});

/* ============================================================
   ROUTES - MONITORING DASHBOARD
   ============================================================ */

// MAIN MONITORING PAGE
app.get('/', requireLogin, (req, res) => {
  console.log('📊 Rendering dashboard for:', req.session.nama_perawat);
  
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
    
    let query = `SELECT COUNT(*) as total FROM kunjungan 
             WHERE tanggal_kunjungan >= ? AND tanggal_kunjungan < ? ${whereClause}`;
    let params = [today, tomorrow];

    const [visits] = await conn.query(query, params);
    
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
    const DASHBOARD_ID = 7;
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

/* ============================================================
   SOCKET.IO CLIENT - CONNECT TO RAWAT JALAN SERVER
   ============================================================ */

const RAWAT_JALAN_URL = process.env.RAWAT_JALAN_URL || 'http://darsinurse-app:4000';

if (!RAWAT_JALAN_URL) {
  console.error('❌ RAWAT_JALAN_URL tidak dikonfigurasi!');
  process.exit(1);
}

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
  console.warn('⚠️ Disconnected from Rawat Jalan Server:', reason);
  io.emit('rawat-jalan-disconnected', {
    message: 'Fall detection system is offline',
    timestamp: new Date()
  });
});

rawajalanSocket.on('connect_error', (error) => {
  console.error('❌ Connection error to Rawat Jalan:', error.message);
  
  io.emit('rawat-jalan-disconnected', {
    message: 'Fall detection system is offline',
    error: error.message,
    timestamp: new Date()
  });
});

rawajalanSocket.on('reconnect', (attemptNumber) => {
  console.log(`✅ Reconnected to Rawat Jalan (attempt ${attemptNumber})`);
  io.emit('rawat-jalan-connected', {
    message: 'Fall detection system is active',
    timestamp: new Date()
  });
});

rawajalanSocket.on('new-fall-alert', (alert) => {
  console.log('🚨 FALL ALERT RECEIVED');
  
  if (!alert || !alert.nama_pasien) {
    console.error('❌ Invalid alert data');
    return;
  }
  
  const validatedAlert = {
    id: alert.id || crypto.randomUUID(),
    nama_pasien: alert.nama_pasien,
    emr_no: alert.emr_no,
    room_id: alert.room_id,
    heart_rate: alert.heart_rate,
    blood_pressure: alert.blood_pressure,
    waktu: alert.waktu || new Date().toISOString(),
    fall_confidence: alert.fall_confidence || 0.95
  };
  
  io.to('monitoring-room').emit('fall-alert', validatedAlert);
  
  console.log(`✓ Alert sent to ${io.engine.clientsCount} connected clients`);
});

rawajalanSocket.on('fall-acknowledged', (data) => {
  console.log('✅ Fall acknowledged notification received:', data);
  io.emit('fall-acknowledged-broadcast', data);
});

/* ============================================================
   SOCKET.IO SERVER - FOR MONITORING CLIENTS
   ============================================================ */

io.on('connection', (socket) => {
  console.log('🔌 Monitoring Client connected:', socket.id);
  console.log('   Total clients:', io.engine.clientsCount);
  
  socket.join('monitoring-room');
  
  socket.emit('connection-status', {
    rawajalanConnected: rawajalanSocket.connected,
    rawajalanServer: RAWAT_JALAN_URL
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Monitoring Client disconnected:', socket.id);
    console.log('   Remaining clients:', io.engine.clientsCount);
  });
  
  socket.on('join-monitoring', (data) => {
    console.log('👀 Monitoring dashboard joined:', data);
  });
  
  socket.on('acknowledge-fall', (data) => {
    console.log('✓ Client acknowledged fall:', data.alertId);
    
    rawajalanSocket.emit('fall-acknowledged', {
      alertId: data.alertId,
      acknowledgedBy: data.acknowledgedBy || 'Unknown',
      timestamp: new Date().toISOString()
    });
  });
  
  socket.on('check-connection', () => {
    socket.emit('connection-status', {
      rawajalanConnected: rawajalanSocket.connected,
      rawajalanServer: RAWAT_JALAN_URL
    });
  });
});

/* ============================================================
   AUTO-POLLING FALL DETECTION FROM DATABASE
   ============================================================ */

let lastFallCheckTime = new Date(0);
const FALL_CHECK_INTERVAL = 5000;

async function checkFallDetectionFromDatabase() {
  try {
    const conn = await pool.getConnection();
    
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
        rd.room_id
      FROM vitals v
      LEFT JOIN pasien p ON v.emr_no = p.emr_no
      LEFT JOIN room_device rd ON v.emr_no = rd.emr_no
      WHERE v.fall_detected = 1 
      AND v.waktu > ?
      ORDER BY v.waktu DESC
      LIMIT 50
    `, [lastFallCheckTime]);
    
    conn.release();
    
    if (falls.length > 0) {
      console.log(`📊 [AUTO-POLL] Found ${falls.length} new fall(s) in database`);
      
      lastFallCheckTime = new Date();
      
      falls.forEach(fall => {
        const alertData = {
          id: fall.id,
          emr_no: fall.emr_no,
          nama_pasien: fall.nama_pasien,
          room_id: fall.room_id || `EMR-${fall.emr_no}`,
          poli: fall.poli,
          waktu: fall.waktu.toISOString(),
          heart_rate: fall.heart_rate,
          sistolik: fall.sistolik,
          diastolik: fall.diastolik,
          blood_pressure: fall.sistolik && fall.diastolik 
            ? `${fall.sistolik}/${fall.diastolik}` 
            : 'N/A'
        };
        
        console.log(`🚨 [AUTO-POLL] Broadcasting fall: ${fall.nama_pasien}`);
        io.to('monitoring-room').emit('fall-alert', alertData);
      });
    }
    
  } catch (err) {
    console.error('⚠️ [AUTO-POLL] Error checking database:', err.message);
  }
}

let fallCheckInterval = setInterval(checkFallDetectionFromDatabase, FALL_CHECK_INTERVAL);

console.log(`✓ Fall detection auto-polling started (${FALL_CHECK_INTERVAL}ms interval)`);

process.on('SIGTERM', () => {
  clearInterval(fallCheckInterval);
});

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

app.get('/debug/session', (req, res) => {
  res.json({
    sessionID: req.sessionID,
    session: req.session,
    cookies: req.headers.cookie,
    secure: req.secure,
    protocol: req.protocol,
    hostname: req.hostname,
    headers: {
      'x-forwarded-proto': req.get('x-forwarded-proto'),
      'x-forwarded-host': req.get('x-forwarded-host'),
      'x-forwarded-for': req.get('x-forwarded-for')
    }
  });
});

app.get('/debug/force-login', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM perawat LIMIT 1');
    if (rows.length === 0) {
      return res.send('No users in database');
    }
    
    const user = rows[0];
    
    req.session.regenerate((err) => {
      if (err) {
        return res.send('Regenerate error: ' + err.message);
      }
      
      req.session.emr_perawat = user.emr_perawat;
      req.session.nama_perawat = user.nama;
      req.session.role = user.role;
      
      req.session.save((saveErr) => {
        if (saveErr) {
          return res.send('Save error: ' + saveErr.message);
        }
        res.redirect('/');
      });
    });
  } catch (err) {
    res.send('Database error: ' + err.message);
  }
});
/* ============================================================
   START SERVER
   ============================================================ */

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   DARSINURSE MONITORING SERVER         ║
║   Server: http://localhost:${PORT}     ║
║   Socket.IO Fall Detection: ACTIVE     ║
║   Session Store: MySQL (Persistent)    ║
║Environment:                            ║
║${process.env.NODE_ENV || 'development'}║ 
║                                        ║
╚════════════════════════════════════════╝
`);
});

module.exports = { app, server, io };