/* ============================================================
   DARSINURSE GATEWAY - RAWAT JALAN
   Node.js + Express + MySQL - Medical IoT Gateway
   © 2025 - Darsinurse System
   ============================================================ */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const PORT = process.env.PORT || 4000;

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
  connectionLimit: 10
});

// Cek koneksi
pool.getConnection()
  .then(conn => {
    console.log('✓ MySQL Connected');
    conn.release();
  })
  .catch(err => {
    console.error('✗ MySQL Connection Failed:', err);
    process.exit(1);
  });

/* ============================================================
   AUTO DATABASE INIT
   ============================================================ */
/* ============================================================
   COMPLETE FIX: Database Schema + API Endpoints
   Ganti seluruh bagian initDatabase dan endpoint yang error
   ============================================================ */

// ============================================================
// PART 1: FIX DATABASE SCHEMA
// ============================================================
// Ganti function initDatabase() dengan ini:

async function initDatabase() {
  const conn = await pool.getConnection();
  
  try {
    // Tabel PERAWAT dengan EMR INTEGER
    await conn.query(`
      CREATE TABLE IF NOT EXISTS perawat (
        emr_perawat INT PRIMARY KEY,
        nama VARCHAR(100),
        password VARCHAR(255),
        role ENUM('admin','perawat') DEFAULT 'perawat',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabel PASIEN dengan EMR INTEGER
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pasien (
        emr_no INT PRIMARY KEY,
        nama VARCHAR(100),
        tanggal_lahir DATE,
        jenis_kelamin ENUM('L','P'),
        poli VARCHAR(50),
        alamat TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabel KUNJUNGAN
    await conn.query(`
      CREATE TABLE IF NOT EXISTS kunjungan (
        id_kunjungan INT PRIMARY KEY,
        emr_no INT,
        emr_perawat INT,
        tanggal_kunjungan TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        keluhan TEXT,
        status ENUM('aktif','selesai') DEFAULT 'aktif',
        FOREIGN KEY (emr_no) REFERENCES pasien(emr_no),
        FOREIGN KEY (emr_perawat) REFERENCES perawat(emr_perawat)
      );
    `);

    // ✅ TABEL VITALS BARU - dengan kolom vital signs
    await conn.query(`
      CREATE TABLE IF NOT EXISTS vitals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        emr_no INT NOT NULL,
        id_kunjungan INT,
        emr_perawat INT,
        waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        heart_rate INT,
        sistolik INT,
        diastolik INT,
        respirasi INT,
        glukosa INT,
        berat_badan_kg DECIMAL(5,2),
        tinggi_badan_cm INT,
        bmi DECIMAL(4,2),
        jarak_kasur_cm INT,
        fall_detected TINYINT DEFAULT 0,
        FOREIGN KEY (emr_no) REFERENCES pasien(emr_no),
        FOREIGN KEY (id_kunjungan) REFERENCES kunjungan(id_kunjungan),
        FOREIGN KEY (emr_perawat) REFERENCES perawat(emr_perawat),
        INDEX idx_emr_waktu (emr_no, waktu),
        INDEX idx_kunjungan (id_kunjungan),
        INDEX idx_fall (fall_detected, waktu)
      );
    `);

    // ✅ OPTIONAL: room_device table untuk fall detection
    await conn.query(`
      CREATE TABLE IF NOT EXISTS room_device (
        id INT AUTO_INCREMENT PRIMARY KEY,
        emr_no INT,
        room_id VARCHAR(50),
        device_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (emr_no) REFERENCES pasien(emr_no)
      );
    `);

    // Check dan insert dummy data perawat
    const [perawat] = await conn.query(`SELECT COUNT(*) AS c FROM perawat`);
    
    if (perawat[0].c === 0) {
      console.log('🔄 Initializing default users...');
      
      await conn.query(`
        INSERT INTO perawat (emr_perawat, nama, password, role) VALUES
        (1, 'Administrator', ?, 'admin'),
        (2, 'Siti Nurhaliza', ?, 'perawat'),
        (3, 'Ahmad Wijaya', ?, 'perawat'),
        (4, 'Dewi Lestari', ?, 'perawat')
      `, [
        hashPassword('admin123'),
        hashPassword('pass123'),
        hashPassword('pass456'),
        hashPassword('pass789')
      ]);
      
      console.log('✓ Default users created');
    } else {
      console.log(`✓ Found ${perawat[0].c} existing users`);
    }

    // Check dan insert dummy data pasien
    const [pasien] = await conn.query(`SELECT COUNT(*) AS c FROM pasien`);
    
    if (pasien[0].c === 0) {
      console.log('🔄 Initializing default patients...');
      
      await conn.query(`
        INSERT INTO pasien (emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat) VALUES
        (101,'Budi Santoso','1980-05-15','L','Poli Umum','Jl. Merdeka No.10'),
        (102,'Susi Handini','1975-08-22','P','Poli Gigi','Jl. Ahmad Yani No.25'),
        (103,'Rudi Hermawan','1985-12-03','L','Poli Umum','Jl. Pemuda No.30'),
        (104,'Ani Wijaya','1990-03-17','P','Poli Anak','Jl. Diponegoro No.15')
      `);
      
      console.log('✓ Default patients created');
    } else {
      console.log(`✓ Found ${pasien[0].c} existing patients`);
    }

    // Check dan insert dummy kunjungan
    const [kunjungan] = await conn.query(`SELECT COUNT(*) AS c FROM kunjungan`);
    
    if (kunjungan[0].c === 0) {
      console.log('🔄 Initializing default visits...');
      
      await conn.query(`
        INSERT INTO kunjungan (id_kunjungan, emr_no, emr_perawat, keluhan, status) VALUES
        (1001, 101, 2, 'Demam dan batuk','selesai'),
        (1002, 102, 3, 'Sakit gigi','aktif')
      `);
      
      console.log('✓ Default visits created');
    } else {
      console.log(`✓ Found ${kunjungan[0].c} existing visits`);
    }

  } catch (err) {
    console.error('✗ Database initialization error:', err);
    throw err;
  } finally {
    conn.release();
  }
  
  console.log("✓ Database initialized successfully!");
}

/* ============================================================
   EXPRESS & SESSION SETUP
   ============================================================ */
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'darsinurse-rawatjalan-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false }
}));

/* ============================================================
   AUTH MIDDLEWARE
   ============================================================ */
const requireLogin = (req, res, next) => {
  if (!req.session.emr_perawat) return res.redirect('/');
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.emr_perawat) return res.redirect('/');
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
   ROUTES
   ============================================================ */
// ============================================================
// PART 2: FIX API ENDPOINTS
// ============================================================

// API: Statistics Today (FIXED)
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
    
    // ✅ FIXED: Use 'waktu' not 'timestamp'
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

// API: Today's Measurements (COMPLETELY REWRITTEN)
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
    
    // ✅ FIXED: Use proper column names from vitals table
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
    
    // Format data untuk frontend
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
      if (m.jarak_kasur_cm) {
        tipe_device.push('Jarak Kasur');
        data.push(`${m.jarak_kasur_cm} cm`);
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

// API: Patient Measurements History (FIXED)
app.get('/admin/api/patients/:emr/measurements', requireAdmin, async (req, res) => {
  const emrInt = parseInt(req.params.emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    // ✅ FIXED: Use proper columns
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
        v.id_kunjungan,
        pr.nama as nama_perawat
       FROM vitals v
       LEFT JOIN perawat pr ON v.emr_perawat = pr.emr_perawat
       WHERE v.emr_no = ?
       ORDER BY v.waktu DESC
       LIMIT 100`,
      [emrInt]
    );
    
    // Format untuk display
    const formattedMeasurements = measurements.map(m => {
      let items = [];
      
      if (m.heart_rate) items.push(`HR: ${m.heart_rate} bpm`);
      if (m.sistolik && m.diastolik) items.push(`BP: ${m.sistolik}/${m.diastolik}`);
      if (m.glukosa) items.push(`Glukosa: ${m.glukosa} mg/dL`);
      if (m.respirasi) items.push(`RR: ${m.respirasi}/min`);
      if (m.berat_badan_kg) items.push(`BB: ${m.berat_badan_kg} kg`);
      if (m.tinggi_badan_cm) items.push(`TB: ${m.tinggi_badan_cm} cm`);
      if (m.bmi) items.push(`BMI: ${m.bmi.toFixed(1)}`);
      if (m.fall_detected) items.push('🚨 FALL DETECTED');
      
      return {
        tipe_device: items.length > 0 ? 'Vital Signs' : 'No data',
        data: items.join(' | '),
        timestamp: m.timestamp,
        id_kunjungan: m.id_kunjungan,
        nama_perawat: m.nama_perawat || 'System'
      };
    });
    
    conn.release();
    
    res.json({ success: true, measurements: formattedMeasurements });
  } catch (err) {
    console.error('❌ Get measurements error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

console.log('✓ Database schema and API endpoints fixed');
console.log('✓ All endpoints now use VITALS table with proper columns');

initDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// LOGIN PAGE
app.get('/', (req, res) => {
  if (req.session.emr_perawat) {
    if (req.session.role === 'admin') {
      return res.redirect('/admin/manage-users');
    }
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null });
});

// PROSES LOGIN
app.post('/login', async (req, res) => {
  const { emr_perawat, password } = req.body;
  
  console.log('🔐 Login attempt - EMR:', emr_perawat);
  console.log('📦 Request body:', req.body);
  
  if (!emr_perawat || !password) {
    return res.render('login', { error: 'EMR Perawat dan Password harus diisi!' });
  }
  
  const emrInt = parseInt(emr_perawat);
  if (isNaN(emrInt)) {
    return res.render('login', { error: 'EMR Perawat harus berupa angka!' });
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
      return res.render('login', { error: 'EMR Perawat tidak ditemukan!' });
    }

    const user = rows[0];
    console.log('👤 User found:', user.emr_perawat, '- Role:', user.role);

    if (user.password === hash) {
      req.session.emr_perawat = user.emr_perawat;
      req.session.nama_perawat = user.nama;
      req.session.role = user.role;
      
      console.log('✓ Login success:', user.nama);
      
      if (user.role === 'admin') {
        return res.redirect('/admin/manage-users');
      }
      return res.redirect('/dashboard');
    } else {
      console.log('❌ Wrong password for:', emrInt);
      return res.render('login', { error: 'Password salah!' });
    }
  } catch (err) {
    console.error('❌ Login error:', err);
    return res.render('login', { error: 'Terjadi kesalahan sistem!' });
  }
});

// DASHBOARD (Hanya untuk perawat)
app.get('/dashboard', requireLogin, (req, res) => {
  if (req.session.role === 'admin') {
    return res.redirect('/admin/manage-users');
  }
  res.render('dashboard', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat
  });
});

// ========== ADMIN ROUTES ==========

// MANAGE USERS PAGE
app.get('/admin/manage-users', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  const [users] = await conn.query(
    'SELECT emr_perawat, nama, role, created_at FROM perawat ORDER BY created_at DESC'
  );
  conn.release();

  res.render('admin-users', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat,
    users: users
  });
});

// GET ALL USERS (API)
app.get('/admin/api/users', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  const [users] = await conn.query(
    'SELECT emr_perawat, nama, role, created_at FROM perawat ORDER BY created_at DESC'
  );
  conn.release();
  res.json({ success: true, users });
});

// ADD NEW USER
app.post('/admin/api/users', requireAdmin, async (req, res) => {
  const { emr_perawat, nama, password, role } = req.body;
  
  if (!emr_perawat || !nama || !password || !role) {
    return res.status(400).json({ error: 'Semua field harus diisi' });
  }

  const emrInt = parseInt(emr_perawat);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR Perawat harus berupa angka' });
  }

  const hash = hashPassword(password);
  
  try {
    const conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO perawat (emr_perawat, nama, password, role) VALUES (?, ?, ?, ?)',
      [emrInt, nama, hash, role]
    );
    conn.release();
    
    console.log('✓ New user created:', emrInt);
    res.json({ success: true, message: 'User berhasil ditambahkan' });
  } catch (err) {
    console.error('❌ Add user error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'EMR Perawat sudah terdaftar' });
    } else {
      res.status(500).json({ error: 'Database error: ' + err.message });
    }
  }
});

// UPDATE USER
app.put('/admin/api/users/:emr', requireAdmin, async (req, res) => {
  const { emr } = req.params;
  const { nama, password, role } = req.body;
  
  const emrInt = parseInt(emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  if (!nama || !role) {
    return res.status(400).json({ error: 'Nama dan role harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    
    if (password && password.trim() !== '') {
      const hash = hashPassword(password);
      await conn.query(
        'UPDATE perawat SET nama = ?, password = ?, role = ? WHERE emr_perawat = ?',
        [nama, hash, role, emrInt]
      );
    } else {
      await conn.query(
        'UPDATE perawat SET nama = ?, role = ? WHERE emr_perawat = ?',
        [nama, role, emrInt]
      );
    }
    
    conn.release();
    console.log('✓ User updated:', emrInt);
    res.json({ success: true, message: 'User berhasil diupdate' });
  } catch (err) {
    console.error('❌ Update user error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// DELETE USER
app.delete('/admin/api/users/:emr', requireAdmin, async (req, res) => {
  const { emr } = req.params;
  
  const emrInt = parseInt(emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  if (emrInt === req.session.emr_perawat) {
    return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.query('DELETE FROM perawat WHERE emr_perawat = ?', [emrInt]);
    conn.release();
    
    console.log('✓ User deleted:', emrInt);
    res.json({ success: true, message: 'User berhasil dihapus' });
  } catch (err) {
    console.error('❌ Delete user error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ========== ADMIN PASIEN ROUTES ==========

// GET ALL PATIENTS (API)
app.get('/admin/api/patients', requireAdmin, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [patients] = await conn.query(
      'SELECT emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat, created_at FROM pasien ORDER BY created_at DESC'
    );
    conn.release();
    res.json({ success: true, patients });
  } catch (err) {
    console.error('❌ Get patients error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ADD NEW PATIENT
app.post('/admin/api/patients', requireAdmin, async (req, res) => {
  const { emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat } = req.body;
  
  const emrInt = parseInt(emr_no);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR Pasien harus berupa angka' });
  }
  
  if (!emrInt || !nama || !tanggal_lahir || !jenis_kelamin || !poli) {
    return res.status(400).json({ error: 'EMR, Nama, Tanggal Lahir, Jenis Kelamin, dan Poli harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO pasien (emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat) VALUES (?, ?, ?, ?, ?, ?)',
      [emrInt, nama, tanggal_lahir, jenis_kelamin, poli, alamat || '']
    );
    conn.release();
    
    console.log('✓ New patient created:', emrInt);
    res.json({ success: true, message: 'Pasien berhasil ditambahkan' });
  } catch (err) {
    console.error('❌ Add patient error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'EMR Pasien sudah terdaftar' });
    } else {
      res.status(500).json({ error: 'Database error: ' + err.message });
    }
  }
});

// UPDATE PATIENT
app.put('/admin/api/patients/:emr', requireAdmin, async (req, res) => {
  const { emr } = req.params;
  const { nama, tanggal_lahir, jenis_kelamin, poli, alamat } = req.body;
  
  const emrInt = parseInt(emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  if (!nama || !tanggal_lahir || !jenis_kelamin || !poli) {
    return res.status(400).json({ error: 'Nama, Tanggal Lahir, Jenis Kelamin, dan Poli harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.query(
      'UPDATE pasien SET nama = ?, tanggal_lahir = ?, jenis_kelamin = ?, poli = ?, alamat = ? WHERE emr_no = ?',
      [nama, tanggal_lahir, jenis_kelamin, poli, alamat || '', emrInt]
    );
    conn.release();
    
    console.log('✓ Patient updated:', emrInt);
    res.json({ success: true, message: 'Pasien berhasil diupdate' });
  } catch (err) {
    console.error('❌ Update patient error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// DELETE PATIENT
app.delete('/admin/api/patients/:emr', requireAdmin, async (req, res) => {
  const { emr } = req.params;
  
  const emrInt = parseInt(emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }

  try {
    const conn = await pool.getConnection();
    
    await conn.query('DELETE FROM vitals WHERE emr_no = ?', [emrInt]);
    await conn.query('DELETE FROM kunjungan WHERE emr_no = ?', [emrInt]);
    await conn.query('DELETE FROM pasien WHERE emr_no = ?', [emrInt]);
    conn.release();
    
    console.log('✓ Patient deleted:', emrInt);
    res.json({ success: true, message: 'Pasien berhasil dihapus' });
  } catch (err) {
    console.error('❌ Delete patient error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ========== KUNJUNGAN ROUTES ==========

// GET PATIENT VISITS
app.get('/api/patients/:emr/visits', requireLogin, async (req, res) => {
  const emrInt = parseInt(req.params.emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    // ✅ PERBAIKAN: Filter berdasarkan role
    let query = `
      SELECT k.*, p.nama as nama_perawat
      FROM kunjungan k
      JOIN perawat p ON k.emr_perawat = p.emr_perawat
      WHERE k.emr_no = ?
    `;
    
    const params = [emrInt];
    
    // Jika bukan admin, hanya tampilkan kunjungan yang ditangani perawat ini
    if (req.session.role !== 'admin') {
      query += ` AND k.emr_perawat = ?`;
      params.push(req.session.emr_perawat);
    }
    
    query += ` ORDER BY k.tanggal_kunjungan DESC`;
    
    const [visits] = await conn.query(query, params);
    conn.release();
    
    res.json({ success: true, visits });
  } catch (err) {
    console.error('❌ Get visits error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// CREATE NEW VISIT
app.post('/api/visits', requireLogin, async (req, res) => {
  const { id_kunjungan, emr_no, keluhan } = req.body;
  
  const idInt = parseInt(id_kunjungan);
  const emrInt = parseInt(emr_no);
  
  if (isNaN(idInt) || isNaN(emrInt)) {
    return res.status(400).json({ error: 'ID Kunjungan dan EMR Pasien harus berupa angka' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO kunjungan (id_kunjungan, emr_no, emr_perawat, keluhan, status) VALUES (?, ?, ?, ?, ?)',
      [idInt, emrInt, req.session.emr_perawat, keluhan || '', 'aktif']
    );
    conn.release();
    
    console.log('✓ New visit created:', idInt);
    res.json({ success: true, message: 'Kunjungan berhasil dibuat' });
  } catch (err) {
    console.error('❌ Create visit error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'ID Kunjungan sudah ada' });
    } else {
      res.status(500).json({ error: 'Database error: ' + err.message });
    }
  }
});

// UPDATE VISIT STATUS
app.put('/api/visits/:id_kunjungan/status', requireLogin, async (req, res) => {
  const id_kunjungan = parseInt(req.params.id_kunjungan);
  const { status } = req.body;
  
  if (isNaN(id_kunjungan)) {
    return res.status(400).json({ error: 'ID Kunjungan tidak valid' });
  }
  
  if (!status || !['aktif', 'selesai'].includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.query(
      'UPDATE kunjungan SET status = ? WHERE id_kunjungan = ?',
      [status, id_kunjungan]
    );
    conn.release();
    
    console.log('✓ Visit status updated:', id_kunjungan);
    res.json({ success: true, message: 'Status kunjungan berhasil diupdate' });
  } catch (err) {
    console.error('❌ Update visit status error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ========== vitals ROUTES ==========
/* ============================================================
   DARSINURSE - VITALS INTEGRATION COMPLETE
   Tambahkan kode ini ke server.js Anda
   Letakkan SEBELUM routes "/simpan_data"
   ============================================================ */

// ==== FUNCTION: Save to Vitals Table ====
async function saveToVitals(conn, data) {
  const {
    emr_no,
    id_kunjungan,
    emr_perawat,
    heart_rate,
    respirasi,
    glukosa,
    berat_badan_kg,
    tinggi_badan_cm,
    bmi,
    sistolik,
    diastolik,
    jarak_kasur_cm,
    fall_detected
  } = data;

  const [result] = await conn.query(
    `INSERT INTO vitals (
      emr_no, 
      id_kunjungan,
      emr_perawat,
      waktu,
      heart_rate, 
      sistolik, 
      diastolik,
      respirasi, 
      glukosa, 
      berat_badan_kg, 
      tinggi_badan_cm,
      bmi,
      jarak_kasur_cm,
      fall_detected
    ) VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      emr_no,
      id_kunjungan || null,
      emr_perawat || null,
      heart_rate || null,
      sistolik || null,
      diastolik || null,
      respirasi || null,
      glukosa || null,
      berat_badan_kg || null,
      tinggi_badan_cm || null,
      bmi || null,
      jarak_kasur_cm || null,
      fall_detected || 0
    ]
  );

  return result.insertId;
}

/* ============================================================
   GANTI ENDPOINT /simpan_data yang ADA dengan KODE INI
   ============================================================ */

// SIMPAN DATA vitals (UPDATED - Save to BOTH tables)
app.post('/simpan_data', requireLogin, async (req, res) => {
  const { id_kunjungan, emr_no, tipe_device, data } = req.body;
  
  const idInt = parseInt(id_kunjungan);
  const emrInt = parseInt(emr_no);
  
  if (isNaN(idInt) || isNaN(emrInt) || !tipe_device || !data) {
    return res.status(400).json({ error: 'Data tidak lengkap atau tidak valid' });
  }

  try {
    const conn = await pool.getConnection();
    
    // Prepare vitals data
    let vitalsData = {
      emr_no: emrInt,
      id_kunjungan: idInt,
      emr_perawat: req.session.emr_perawat
    };

    // ✅ Map device type ke kolom vitals
    switch(tipe_device.toLowerCase()) {
      case 'glukosa':
      case 'glucose':
        vitalsData.glukosa = parseInt(data);
        break;
      
      case 'tensimeter':
      case 'blood_pressure':
      case 'bp':
        const bpMatch = data.match(/(\d+)\/(\d+)/);
        if (bpMatch) {
          vitalsData.sistolik = parseInt(bpMatch[1]);
          vitalsData.diastolik = parseInt(bpMatch[2]);
        }
        break;
      
      case 'heart_rate':
      case 'heartrate':
      case 'pulse':
        vitalsData.heart_rate = parseInt(data);
        break;
      
      case 'timbangan':
      case 'weight':
      case 'berat_badan':
        vitalsData.berat_badan_kg = parseFloat(data);
        break;
      
      case 'tinggi':
      case 'height':
      case 'tinggi_badan':
        vitalsData.tinggi_badan_cm = parseInt(data);
        break;
      
      case 'bmi':
        vitalsData.bmi = parseFloat(data);
        break;
      
      case 'respirasi':
      case 'respiration':
      case 'respiratory_rate':
        vitalsData.respirasi = parseInt(data);
        break;
      
      case 'jarak_kasur':
      case 'distance':
      case 'bed_distance':
        vitalsData.jarak_kasur_cm = parseInt(data);
        break;
      
      case 'fall':
      case 'fall_detection':
        vitalsData.fall_detected = 1;
        try {
          const fallData = JSON.parse(data);
          if (fallData.heart_rate) vitalsData.heart_rate = parseInt(fallData.heart_rate);
          if (fallData.sistolik) vitalsData.sistolik = parseInt(fallData.sistolik);
          if (fallData.diastolik) vitalsData.diastolik = parseInt(fallData.diastolik);
        } catch (e) {
          // data bukan JSON
        }
        break;
      
      default:
        console.warn('⚠️ Unknown device type:', tipe_device);
    }

    // ✅ Save to vitals table
    let vitalsId = null;
    if (Object.keys(vitalsData).length > 3) {
      vitalsId = await saveToVitals(conn, vitalsData);
      console.log('✓ Data saved to vitals:', vitalsId, vitalsData);
    }

    // ✅ Save to vitals table (backward compatibility)
    const [vitalsResult] = await conn.query(
      `INSERT INTO vitals (id_kunjungan, emr_perawat, emr_no, tipe_device, data)
       VALUES (?, ?, ?, ?, ?)`,
      [idInt, req.session.emr_perawat, emrInt, tipe_device, data]
    );

    conn.release();

    console.log('✓ Measurement saved - vitals ID:', vitalsResult.insertId, '| Vitals ID:', vitalsId);
    res.json({
      success: true,
      vitals_id: vitalsResult.insertId,
      vitals_id: vitalsId,
      message: "Data berhasil disimpan"
    });
  } catch (err) {
    console.error('❌ Save data error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

/* ============================================================
   TAMBAHKAN API ENDPOINTS BARU (Letakkan sebelum server.listen)
   ============================================================ */

// ==== API: Get Vitals by Visit ====
app.get('/api/vitals/kunjungan/:id_kunjungan', requireLogin, async (req, res) => {
  const idInt = parseInt(req.params.id_kunjungan);
  if (isNaN(idInt)) {
    return res.status(400).json({ error: 'ID Kunjungan tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    if (req.session.role !== 'admin') {
      const [checkAccess] = await conn.query(
        'SELECT id_kunjungan FROM kunjungan WHERE id_kunjungan = ? AND emr_perawat = ?',
        [idInt, req.session.emr_perawat]
      );
      
      if (checkAccess.length === 0) {
        conn.release();
        return res.status(403).json({ 
          error: 'Anda tidak memiliki akses ke kunjungan ini' 
        });
      }
    }
    
    const [vitals] = await conn.query(
      `SELECT 
        v.*,
        pr.nama as nama_perawat,
        p.nama as nama_pasien
       FROM vitals v
       LEFT JOIN perawat pr ON v.emr_perawat = pr.emr_perawat
       LEFT JOIN pasien p ON v.emr_no = p.emr_no
       WHERE v.id_kunjungan = ?
       ORDER BY v.waktu DESC`,
      [idInt]
    );
    
    conn.release();

    res.json({ success: true, vitals });
  } catch (err) {
    console.error('❌ Get vitals error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ==== API: Get Vitals by Patient ====
app.get('/api/vitals/pasien/:emr', requireLogin, async (req, res) => {
  const emrInt = parseInt(req.params.emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    let query = `
      SELECT 
        v.*,
        pr.nama as nama_perawat,
        p.nama as nama_pasien,
        k.keluhan
      FROM vitals v
      LEFT JOIN perawat pr ON v.emr_perawat = pr.emr_perawat
      LEFT JOIN pasien p ON v.emr_no = p.emr_no
      LEFT JOIN kunjungan k ON v.id_kunjungan = k.id_kunjungan
      WHERE v.emr_no = ?
    `;
    
    const params = [emrInt];
    
    if (req.session.role !== 'admin') {
      query += ` AND (k.emr_perawat = ? OR v.emr_perawat = ?)`;
      params.push(req.session.emr_perawat, req.session.emr_perawat);
    }
    
    query += ` ORDER BY v.waktu DESC LIMIT 100`;
    
    const [vitals] = await conn.query(query, params);
    conn.release();

    res.json({ success: true, vitals });
  } catch (err) {
    console.error('❌ Get vitals error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ==== API: Get Latest Vitals Summary ====
app.get('/api/vitals/pasien/:emr/latest', requireLogin, async (req, res) => {
  const emrInt = parseInt(req.params.emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    const [latestVitals] = await conn.query(
      `SELECT 
        (SELECT heart_rate FROM vitals WHERE emr_no = ? AND heart_rate IS NOT NULL ORDER BY waktu DESC LIMIT 1) as heart_rate,
        (SELECT waktu FROM vitals WHERE emr_no = ? AND heart_rate IS NOT NULL ORDER BY waktu DESC LIMIT 1) as last_hr_time,
        
        (SELECT glukosa FROM vitals WHERE emr_no = ? AND glukosa IS NOT NULL ORDER BY waktu DESC LIMIT 1) as glukosa,
        (SELECT waktu FROM vitals WHERE emr_no = ? AND glukosa IS NOT NULL ORDER BY waktu DESC LIMIT 1) as last_glukosa_time,
        
        (SELECT sistolik FROM vitals WHERE emr_no = ? AND sistolik IS NOT NULL ORDER BY waktu DESC LIMIT 1) as sistolik,
        (SELECT diastolik FROM vitals WHERE emr_no = ? AND diastolik IS NOT NULL ORDER BY waktu DESC LIMIT 1) as diastolik,
        (SELECT waktu FROM vitals WHERE emr_no = ? AND sistolik IS NOT NULL ORDER BY waktu DESC LIMIT 1) as last_bp_time,
        
        (SELECT berat_badan_kg FROM vitals WHERE emr_no = ? AND berat_badan_kg IS NOT NULL ORDER BY waktu DESC LIMIT 1) as berat_badan_kg,
        (SELECT waktu FROM vitals WHERE emr_no = ? AND berat_badan_kg IS NOT NULL ORDER BY waktu DESC LIMIT 1) as last_weight_time,
        
        (SELECT tinggi_badan_cm FROM vitals WHERE emr_no = ? AND tinggi_badan_cm IS NOT NULL ORDER BY waktu DESC LIMIT 1) as tinggi_badan_cm,
        (SELECT waktu FROM vitals WHERE emr_no = ? AND tinggi_badan_cm IS NOT NULL ORDER BY waktu DESC LIMIT 1) as last_height_time,
        
        (SELECT bmi FROM vitals WHERE emr_no = ? AND bmi IS NOT NULL ORDER BY waktu DESC LIMIT 1) as bmi,
        (SELECT waktu FROM vitals WHERE emr_no = ? AND bmi IS NOT NULL ORDER BY waktu DESC LIMIT 1) as last_bmi_time,
        
        (SELECT respirasi FROM vitals WHERE emr_no = ? AND respirasi IS NOT NULL ORDER BY waktu DESC LIMIT 1) as respirasi,
        (SELECT waktu FROM vitals WHERE emr_no = ? AND respirasi IS NOT NULL ORDER BY waktu DESC LIMIT 1) as last_respirasi_time,
        
        (SELECT jarak_kasur_cm FROM vitals WHERE emr_no = ? AND jarak_kasur_cm IS NOT NULL ORDER BY waktu DESC LIMIT 1) as jarak_kasur_cm,
        (SELECT waktu FROM vitals WHERE emr_no = ? AND jarak_kasur_cm IS NOT NULL ORDER BY waktu DESC LIMIT 1) as last_jarak_time`,
      [emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt, emrInt]
    );
    
    conn.release();

    res.json({ 
      success: true, 
      latest: latestVitals[0] 
    });
  } catch (err) {
    console.error('❌ Get latest vitals error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ==== API: Get Vitals Statistics ====
app.get('/api/vitals/statistics/today', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const whereClause = req.session.role === 'admin' 
      ? '' 
      : `AND emr_perawat = ${req.session.emr_perawat}`;
    
    const [stats] = await conn.query(
      `SELECT 
        COUNT(*) as total_measurements,
        COUNT(DISTINCT emr_no) as total_patients,
        SUM(CASE WHEN heart_rate IS NOT NULL THEN 1 ELSE 0 END) as heart_rate_count,
        SUM(CASE WHEN glukosa IS NOT NULL THEN 1 ELSE 0 END) as glukosa_count,
        SUM(CASE WHEN sistolik IS NOT NULL THEN 1 ELSE 0 END) as blood_pressure_count,
        SUM(CASE WHEN berat_badan_kg IS NOT NULL THEN 1 ELSE 0 END) as weight_count,
        SUM(CASE WHEN tinggi_badan_cm IS NOT NULL THEN 1 ELSE 0 END) as height_count,
        SUM(CASE WHEN bmi IS NOT NULL THEN 1 ELSE 0 END) as bmi_count,
        SUM(CASE WHEN respirasi IS NOT NULL THEN 1 ELSE 0 END) as respirasi_count,
        SUM(CASE WHEN jarak_kasur_cm IS NOT NULL THEN 1 ELSE 0 END) as distance_count,
        SUM(CASE WHEN fall_detected = 1 THEN 1 ELSE 0 END) as fall_count,
        AVG(heart_rate) as avg_heart_rate,
        AVG(glukosa) as avg_glukosa,
        AVG(sistolik) as avg_sistolik,
        AVG(diastolik) as avg_diastolik,
        AVG(respirasi) as avg_respirasi,
        AVG(berat_badan_kg) as avg_weight,
        AVG(bmi) as avg_bmi
       FROM vitals 
       WHERE waktu >= ? AND waktu < ? ${whereClause}`,
      [today, tomorrow]
    );
    
    conn.release();
    
    res.json({
      success: true,
      stats: stats[0]
    });
  } catch (err) {
    console.error('❌ Vitals statistics error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ==== API: Test Fall Detection (INSERT MANUAL) ====
app.post('/api/test/insert-fall', requireAdmin, async (req, res) => {
  const { emr_no } = req.body;
  
  if (!emr_no) {
    return res.status(400).json({ error: 'EMR pasien harus diisi' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    const [result] = await conn.query(
      `INSERT INTO vitals 
       (emr_no, heart_rate, sistolik, diastolik, respirasi, fall_detected, waktu) 
       VALUES (?, 125, 145, 95, 24, 1, NOW())`,
      [parseInt(emr_no)]
    );
    
    conn.release();
    
    console.log('🚨 TEST FALL inserted for EMR:', emr_no, '- ID:', result.insertId);
    
    res.json({
      success: true,
      message: 'Test fall data inserted',
      vital_id: result.insertId,
      emr_no: emr_no
    });
  } catch (err) {
    console.error('❌ Insert test fall error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==== API: View All Vitals (untuk debugging) ====
app.get('/api/vitals/all', requireAdmin, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const [vitals] = await conn.query(
      `SELECT 
        v.*,
        p.nama as nama_pasien
      FROM vitals v
      LEFT JOIN pasien p ON v.emr_no = p.emr_no
      ORDER BY v.waktu DESC
      LIMIT 50`
    );
    
    conn.release();
    
    res.json({ success: true, vitals });
  } catch (err) {
    console.error('❌ Get all vitals error:', err);
    res.status(500).json({ error: err.message });
  }
});

  console.log('✓ Vitals Integration Loaded');
  console.log('ℹ️  Supported devices: glukosa, tensimeter, heart_rate, timbangan, tinggi, bmi, respirasi, jarak_kasur, fall');

  // VALIDASI PASIEN
  app.get('/validasi_pasien/:emr', requireLogin, async (req, res) => {
    const emrInt = parseInt(req.params.emr);
    if (isNaN(emrInt)) {
      return res.status(400).json({ valid: false, error: 'EMR tidak valid' });
    }
    
    try {
      const conn = await pool.getConnection();
      const [rows] = await conn.query(
        'SELECT * FROM pasien WHERE emr_no = ?',
        [emrInt]
      );
      conn.release();

      res.json({ valid: rows.length > 0, pasien: rows[0] || null });
    } catch (err) {
      console.error('❌ Validate patient error:', err);
      res.status(500).json({ error: 'Database error: ' + err.message });
    }
  });

  // REGISTER NEW PATIENT (dari dashboard perawat)
  app.post('/api/patients/register', requireLogin, async (req, res) => {
    const { emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat } = req.body;
    
    const emrInt = parseInt(emr_no);
    if (isNaN(emrInt)) {
      return res.status(400).json({ error: 'EMR Pasien harus berupa angka' });
    }
    
    if (!emrInt || !nama || !tanggal_lahir || !jenis_kelamin || !poli) {
      return res.status(400).json({ 
        error: 'EMR, Nama, Tanggal Lahir, Jenis Kelamin, dan Poli harus diisi' 
      });
    }

    try {
      const conn = await pool.getConnection();
      
      // Cek apakah EMR sudah ada
      const [existing] = await conn.query(
        'SELECT emr_no FROM pasien WHERE emr_no = ?',
        [emrInt]
      );
      
      if (existing.length > 0) {
        conn.release();
        return res.status(400).json({ 
          error: 'EMR Pasien sudah terdaftar' 
        });
      }
      
      // Insert pasien baru
      await conn.query(
        'INSERT INTO pasien (emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat) VALUES (?, ?, ?, ?, ?, ?)',
        [emrInt, nama, tanggal_lahir, jenis_kelamin, poli, alamat || '']
      );
      
      conn.release();
      
      console.log('✓ New patient registered by nurse:', emrInt, '-', nama);
      // addLog(`Pasien baru didaftarkan: ${nama} (EMR: ${emrInt}) oleh ${req.session.nama_perawat}`, 'success');
      
      res.json({ 
        success: true, 
        message: 'Pasien berhasil didaftarkan',
        emr_no: emrInt
      });
    } catch (err) {
      console.error('❌ Register patient error:', err);
      res.status(500).json({ 
        error: 'Database error: ' + err.message 
      });
    }
  });


// LOGOUT
app.get('/logout', (req, res) => {
  console.log('👋 Logout:', req.session.nama_perawat);
  req.session.destroy();
  res.redirect('/');
});

/* ============================================================
   START HTTP SERVER
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
  
  socket.on('join-monitoring', (data) => {
    socket.join('monitoring-room');
    console.log('👀 Client joined monitoring room:', data);
  });
});
// ============================================================
// FALL DETECTION API
// ============================================================
// ============================================================
// FALL DETECTION CHECKER (Polling setiap 10 detik)
// ============================================================
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

// Initialize on startup
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

// Get latest fall detections
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

// Acknowledge fall alert
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

// Start server
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   DARSINURSE GATEWAY - RAWAT JALAN     ║
║   Server running on http://localhost:${PORT}  ║
║   Socket.IO Fall Detection: ACTIVE     ║
╚════════════════════════════════════════╝
`);
});

/* ============================================================
   DARSINURSE GATEWAY - ADMIN MONITORING INTEGRATION
   Add this code to your server.js
   ============================================================ */

// ============================================================
// 1. INSTALL REQUIRED PACKAGE
// ============================================================
// Run: npm install jsonwebtoken

const jwt = require('jsonwebtoken');

// ============================================================
// 2. ADD METABASE HELPER FUNCTION
// ============================================================

/**
 * Generate Metabase Embed URL with JWT token
 * @param {number} dashboardId - Metabase dashboard ID
 * @param {object} params - Dashboard parameters (optional)
 * @returns {string} Signed embed URL
 */
function getMetabaseEmbedUrl(dashboardId, params = {}) {
  const METABASE_URL = process.env.METABASE_URL || 'https://darsinurse.hint-lab.id';
  const METABASE_SECRET = process.env.METABASE_SECRET || 'a7dd79ccd6a69475c06533ca4d9ac152c443ed3c7550ec7be12ba06dd1b7ce55';
  
  const payload = {
    resource: { dashboard: 2 },
    params: {},
    exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
  };  
  
  const token = jwt.sign(payload, METABASE_SECRET);
  return `${METABASE_URL}/embed/dashboard/${token}#bordered=true&titled=true`;
}

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    server: 'rawat-jalan',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});


console.log('✓ Admin Monitoring Integration Code Ready');
console.log('ℹ️  Remember to install: npm install jsonwebtoken');
console.log('ℹ️  Remember to update DASHBOARD_ID for Metabase (line 140)');