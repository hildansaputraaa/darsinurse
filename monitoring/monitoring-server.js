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
// ============================================================
// SMART SESSION CONFIGURATION (AUTO-DETECT ENVIRONMENT)
// ============================================================

// 1️⃣ Detect environment
const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

console.log('🌍 Environment detected:', {
  NODE_ENV: process.env.NODE_ENV || 'development',
  isDevelopment,
  isProduction
});

// 2️⃣ TRUST PROXY (conditional)
if (isProduction) {
  app.set('trust proxy', 1);
  console.log('✅ Trust proxy ENABLED (production mode)');
} else {
  app.set('trust proxy', false);
  console.log('⚠️  Trust proxy DISABLED (development mode)');
}

// 3️⃣ Middleware to detect HTTPS (works in both environments)
app.use((req, res, next) => {
  // In production: check X-Forwarded-Proto from proxy
  // In development: check req.protocol directly
  const isHttps = isProduction 
    ? (req.get('x-forwarded-proto') === 'https' || req.secure)
    : req.protocol === 'https';
  
  req.isHttps = isHttps;
  
  if (req.path !== '/favicon.ico' && req.path !== '/debug/ping') {
    console.log('🔍 Request:', {
      path: req.path,
      environment: isProduction ? 'PRODUCTION' : 'DEVELOPMENT',
      protocol: req.protocol,
      'x-forwarded-proto': req.get('x-forwarded-proto') || 'none',
      isHttps: isHttps ? '✅ YES' : '❌ NO',
      host: req.get('host')
    });
  }
  
  next();
});

// 4️⃣ BODY PARSER
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 5️⃣ VIEWS & STATIC
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// 6️⃣ SESSION CONFIGURATION (environment-aware)
const sessionConfig = {
  key: 'monitoring_session',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: isProduction, // Only trust proxy in production
  cookie: {
    httpOnly: true,
    secure: isProduction ? 'auto' : false, // ✅ false in dev, auto in prod
    sameSite: isProduction ? 'lax' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/'
  }
};

console.log('🍪 Cookie settings:', {
  secure: sessionConfig.cookie.secure,
  sameSite: sessionConfig.cookie.sameSite,
  proxy: sessionConfig.proxy
});

app.use(session(sessionConfig));

// 7️⃣ SESSION DEBUG MIDDLEWARE
app.use((req, res, next) => {
  if (req.path !== '/favicon.ico' && req.path !== '/debug/ping') {
    console.log(`
📍 ${req.method} ${req.path}
   Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}
   Protocol: ${req.protocol}
   X-Forwarded-Proto: ${req.get('x-forwarded-proto') || 'none'}
   Is HTTPS: ${req.isHttps ? 'YES ✅' : 'NO ❌'}
   Host: ${req.get('host')}
   Session ID: ${req.sessionID?.substring(0, 8)}...
   EMR in session: ${req.session?.emr_perawat || 'none'}
   Cookie received: ${req.get('cookie') ? 'YES ✓' : 'NO ✗'}
   Cookie secure setting: ${sessionConfig.cookie.secure}
    `);
  }
  next();
});

// 8️⃣ CORS (LAST)
const allowedOrigins = [
  'https://gateway.darsinurse.hint-lab.id',
  'https://darsinurse.hint-lab.id',
  'http://localhost:3000',
  'http://localhost:5000'
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
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

// ============================================================
// LOGIN ROUTE (works in both dev & prod)
// ============================================================

app.post('/login', async (req, res) => {
  const { emr_perawat, password } = req.body;
  
  console.log('🔐 Login attempt:', {
    emr: emr_perawat,
    environment: isProduction ? 'PRODUCTION' : 'DEVELOPMENT',
    protocol: req.protocol,
    isHttps: req.isHttps,
    host: req.get('host')
  });
  
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
      console.log('❌ User not found:', emrInt);
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

    console.log('✅ Credentials valid');

    // Destroy old session first
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        console.warn('⚠️ Session destroy warning:', destroyErr);
      }
      
      // Regenerate session
      req.session.regenerate((regenerateErr) => {
        if (regenerateErr) {
          console.error('❌ Session regenerate error:', regenerateErr);
          return res.render('monitoring-login', { 
            error: 'Gagal membuat session!' 
          });
        }

        // Set session data
        req.session.emr_perawat = user.emr_perawat;
        req.session.nama_perawat = user.nama;
        req.session.role = user.role;
        req.session.loginTime = new Date().toISOString();
        
        console.log('📝 Session data set:', {
          sessionID: req.sessionID.substring(0, 8) + '...',
          emr: user.emr_perawat,
          nama: user.nama,
          role: user.role
        });
        
        // EXPLICITLY save session
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('❌ Session save error:', saveErr);
            return res.render('monitoring-login', { 
              error: 'Gagal menyimpan session: ' + saveErr.message 
            });
          }
          
          console.log('✅ Session saved successfully');
          console.log('📤 Cookie settings:', {
            httpOnly: true,
            secure: isProduction ? 'auto (HTTPS)' : 'false (HTTP)',
            sameSite: 'lax',
            maxAge: '24h',
            path: '/'
          });
          
          // Small delay to ensure cookie is set
          setTimeout(() => {
            console.log('↪️  Redirecting to /');
            res.redirect('/');
          }, 100);
        });
      });
    });
    
  } catch (err) {
    console.error('❌ Database error:', err);
    return res.render('monitoring-login', { 
      error: 'Terjadi kesalahan sistem: ' + err.message 
    });
  }
});

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

const requireLogin = (req, res, next) => {
  console.log('🔐 Auth check:', {
    path: req.path,
    sessionID: req.sessionID?.substring(0, 8) + '...',
    hasSession: !!req.session,
    hasSessionData: !!req.session?.emr_perawat,
    emr: req.session?.emr_perawat,
    cookieHeader: req.get('cookie') ? 'present' : 'missing'
  });
  
  if (!req.session || !req.session.emr_perawat) {
    console.log('❌ No valid session → redirect /login');
    return res.redirect('/login');
  }
  
  console.log('✅ Auth OK:', req.session.nama_perawat);
  next();
};

// ============================================================
// DEBUG ENDPOINTS
// ============================================================

app.get('/debug/session', (req, res) => {
  res.json({
    environment: {
      NODE_ENV: process.env.NODE_ENV || 'development',
      isDevelopment,
      isProduction,
      trustProxy: app.get('trust proxy')
    },
    request: {
      protocol: req.protocol,
      secure: req.secure,
      isHttps: req.isHttps,
      hostname: req.hostname,
      host: req.get('host'),
      ip: req.ip
    },
    proxy_headers: {
      'x-forwarded-proto': req.get('x-forwarded-proto'),
      'x-forwarded-host': req.get('x-forwarded-host'),
      'x-forwarded-for': req.get('x-forwarded-for')
    },
    session: {
      id: req.sessionID,
      data: req.session,
      cookie: req.session?.cookie
    },
    cookies: {
      header: req.headers.cookie
    }
  });
});

// Simple ping endpoint
app.get('/debug/ping', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: isProduction ? 'production' : 'development'
  });
});

// Test session persistence
app.get('/debug/test-session', (req, res) => {
  if (!req.session.counter) {
    req.session.counter = 0;
  }
  req.session.counter++;
  
  req.session.save((err) => {
    if (err) {
      return res.json({ 
        error: err.message,
        sessionID: req.sessionID
      });
    }
    
    res.json({
      message: 'Session test - refresh to see counter increment',
      counter: req.session.counter,
      sessionID: req.sessionID.substring(0, 8) + '...',
      environment: isProduction ? 'production' : 'development'
    });
  });
});

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

/* ============================================================
   ROUTES - AUTH
   ============================================================ */

// LOGIN PAGE// PROSES LOGIN - IMPROVED
// ============================================================
// LOGIN ROUTE - HTTPS TUNNEL COMPATIBLE
// ============================================================

app.post('/login', async (req, res) => {
  const { emr_perawat, password } = req.body;
  
  console.log('🔐 Login attempt');
  console.log('   EMR:', emr_perawat);
  console.log('   Protocol:', req.protocol);
  console.log('   Host:', req.get('host'));
  console.log('   X-Forwarded-Proto:', req.get('x-forwarded-proto'));
  console.log('   X-Forwarded-Host:', req.get('x-forwarded-host'));
  
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
      console.log('❌ User not found:', emrInt);
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

    console.log('✅ Credentials valid');

    // ✅ Destroy old session first (prevent session fixation)
    req.session.destroy((err) => {
      if (err) {
        console.error('❌ Session destroy error:', err);
      }
      
      // ✅ Create new session
      req.session.regenerate((regenerateErr) => {
        if (regenerateErr) {
          console.error('❌ Session regenerate error:', regenerateErr);
          return res.render('monitoring-login', { 
            error: 'Terjadi kesalahan sistem!' 
          });
        }

        // Set session data
        req.session.emr_perawat = user.emr_perawat;
        req.session.nama_perawat = user.nama;
        req.session.role = user.role;
        req.session.loginTime = new Date().toISOString();
        
        console.log('📝 New session created:', {
          sessionID: req.sessionID.substring(0, 8) + '...',
          emr: user.emr_perawat,
          nama: user.nama,
          role: user.role
        });
        
        // ✅ Save with explicit callback
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('❌ Session save error:', saveErr);
            return res.render('monitoring-login', { 
              error: 'Gagal menyimpan session!' 
            });
          }
          
          console.log('✅ Session saved successfully');
          console.log('   Cookie will be set as:');
          console.log('   - httpOnly: true');
          console.log('   - secure: true (HTTPS)');
          console.log('   - sameSite: lax');
          console.log('   - domain:', req.hostname);
          
          // ✅ Redirect dengan delay
          setTimeout(() => {
            res.redirect('/');
          }, 200);
        });
      });
    });
    
  } catch (err) {
    console.error('❌ Login error:', err);
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