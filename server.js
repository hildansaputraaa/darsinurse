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
        emr_pasien INT PRIMARY KEY,
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
        emr_pasien INT,
        emr_perawat INT,
        tanggal_kunjungan TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        keluhan TEXT,
        status ENUM('aktif','selesai') DEFAULT 'aktif',
        FOREIGN KEY (emr_pasien) REFERENCES pasien(emr_pasien),
        FOREIGN KEY (emr_perawat) REFERENCES perawat(emr_perawat)
      );
    `);

    // Tabel PENGUKURAN dengan id_kunjungan INTEGER
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pengukuran (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_kunjungan INT,
        emr_perawat INT,
        emr_pasien INT,
        tipe_device VARCHAR(50),
        data VARCHAR(255),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_kunjungan) REFERENCES kunjungan(id_kunjungan),
        FOREIGN KEY (emr_perawat) REFERENCES perawat(emr_perawat),
        FOREIGN KEY (emr_pasien) REFERENCES pasien(emr_pasien)
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
        INSERT INTO pasien (emr_pasien, nama, tanggal_lahir, jenis_kelamin, poli, alamat) VALUES
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
        INSERT INTO kunjungan (id_kunjungan, emr_pasien, emr_perawat, keluhan, status) VALUES
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

initDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

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
      'SELECT emr_pasien, nama, tanggal_lahir, jenis_kelamin, poli, alamat, created_at FROM pasien ORDER BY created_at DESC'
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
  const { emr_pasien, nama, tanggal_lahir, jenis_kelamin, poli, alamat } = req.body;
  
  const emrInt = parseInt(emr_pasien);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR Pasien harus berupa angka' });
  }
  
  if (!emrInt || !nama || !tanggal_lahir || !jenis_kelamin || !poli) {
    return res.status(400).json({ error: 'EMR, Nama, Tanggal Lahir, Jenis Kelamin, dan Poli harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO pasien (emr_pasien, nama, tanggal_lahir, jenis_kelamin, poli, alamat) VALUES (?, ?, ?, ?, ?, ?)',
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
      'UPDATE pasien SET nama = ?, tanggal_lahir = ?, jenis_kelamin = ?, poli = ?, alamat = ? WHERE emr_pasien = ?',
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
    
    await conn.query('DELETE FROM pengukuran WHERE emr_pasien = ?', [emrInt]);
    await conn.query('DELETE FROM kunjungan WHERE emr_pasien = ?', [emrInt]);
    await conn.query('DELETE FROM pasien WHERE emr_pasien = ?', [emrInt]);
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
    const [visits] = await conn.query(
      `SELECT k.*, p.nama as nama_perawat
       FROM kunjungan k
       JOIN perawat p ON k.emr_perawat = p.emr_perawat
       WHERE k.emr_pasien = ?
       ORDER BY k.tanggal_kunjungan DESC`,
      [emrInt]
    );
    conn.release();
    
    res.json({ success: true, visits });
  } catch (err) {
    console.error('❌ Get visits error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// CREATE NEW VISIT
app.post('/api/visits', requireLogin, async (req, res) => {
  const { id_kunjungan, emr_pasien, keluhan } = req.body;
  
  const idInt = parseInt(id_kunjungan);
  const emrInt = parseInt(emr_pasien);
  
  if (isNaN(idInt) || isNaN(emrInt)) {
    return res.status(400).json({ error: 'ID Kunjungan dan EMR Pasien harus berupa angka' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO kunjungan (id_kunjungan, emr_pasien, emr_perawat, keluhan, status) VALUES (?, ?, ?, ?, ?)',
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

// ========== PENGUKURAN ROUTES ==========

// SIMPAN DATA PENGUKURAN
app.post('/simpan_data', requireLogin, async (req, res) => {
  const { id_kunjungan, emr_pasien, tipe_device, data } = req.body;
  
  const idInt = parseInt(id_kunjungan);
  const emrInt = parseInt(emr_pasien);
  
  if (isNaN(idInt) || isNaN(emrInt) || !tipe_device || !data) {
    return res.status(400).json({ error: 'Data tidak lengkap atau tidak valid' });
  }

  try {
    const conn = await pool.getConnection();
    const [result] = await conn.query(
      `INSERT INTO pengukuran (id_kunjungan, emr_perawat, emr_pasien, tipe_device, data)
       VALUES (?, ?, ?, ?, ?)`,
      [idInt, req.session.emr_perawat, emrInt, tipe_device, data]
    );
    conn.release();

    console.log('✓ Measurement saved:', result.insertId);
    res.json({
      success: true,
      id: result.insertId,
      message: "Data pengukuran berhasil disimpan"
    });
  } catch (err) {
    console.error('❌ Save measurement error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// RIWAYAT PENGUKURAN BERDASARKAN KUNJUNGAN
app.get('/riwayat/kunjungan/:id_kunjungan', requireLogin, async (req, res) => {
  const idInt = parseInt(req.params.id_kunjungan);
  if (isNaN(idInt)) {
    return res.status(400).json({ error: 'ID Kunjungan tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      `SELECT p.*, pr.nama as nama_perawat
       FROM pengukuran p
       JOIN perawat pr ON p.emr_perawat = pr.emr_perawat
       WHERE p.id_kunjungan = ?
       ORDER BY p.timestamp DESC`,
      [idInt]
    );
    conn.release();

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('❌ Get visit measurements error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// RIWAYAT PENGUKURAN BERDASARKAN PASIEN
app.get('/riwayat/pasien/:emr', requireLogin, async (req, res) => {
  const emrInt = parseInt(req.params.emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      `SELECT p.*, pr.nama as nama_perawat, k.id_kunjungan
       FROM pengukuran p
       JOIN perawat pr ON p.emr_perawat = pr.emr_perawat
       JOIN kunjungan k ON p.id_kunjungan = k.id_kunjungan
       WHERE p.emr_pasien = ?
       ORDER BY p.timestamp DESC 
       LIMIT 100`,
      [emrInt]
    );
    conn.release();

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('❌ Get patient measurements error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// VALIDASI PASIEN
app.get('/validasi_pasien/:emr', requireLogin, async (req, res) => {
  const emrInt = parseInt(req.params.emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ valid: false, error: 'EMR tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      'SELECT * FROM pasien WHERE emr_pasien = ?',
      [emrInt]
    );
    conn.release();

    res.json({ valid: rows.length > 0, pasien: rows[0] || null });
  } catch (err) {
    console.error('❌ Validate patient error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// GET PATIENT MEASUREMENTS HISTORY (for admin)
app.get('/admin/api/patients/:emr/measurements', requireAdmin, async (req, res) => {
  const emrInt = parseInt(req.params.emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    const [measurements] = await conn.query(
      `SELECT 
        p.tipe_device, 
        p.data, 
        p.timestamp,
        p.id_kunjungan,
        pr.nama as nama_perawat
       FROM pengukuran p
       JOIN perawat pr ON p.emr_perawat = pr.emr_perawat
       WHERE p.emr_pasien = ?
       ORDER BY p.timestamp DESC
       LIMIT 100`,
      [emrInt]
    );
    conn.release();
    
    res.json({ success: true, measurements });
  } catch (err) {
    console.error('❌ Get measurements error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
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
http.createServer(app).listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   DARSINURSE GATEWAY - RAWAT JALAN     ║
║   Server running on http://localhost:${PORT}  ║
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

// ============================================================
// 3. ADD ADMIN MONITORING ROUTE (Page Render)
// ============================================================

app.get('/admin/monitoring', requireAdmin, (req, res) => {
  res.render('admin-monitoring', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat,
    role: req.session.role
  });
});

// Route untuk perawat (jika ingin mereka juga bisa lihat monitoring)
app.get('/monitoring', requireLogin, (req, res) => {
  res.render('admin-monitoring', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat,
    role: req.session.role
  });
});


// ============================================================
// 4. ADD API ENDPOINTS FOR RAWAT JALAN DASHBOARD
// ============================================================
// API 1: Statistics Today (FIXED - with role-based filtering)
app.get('/api/statistics/today', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    // Get today's date range (00:00:00 - 23:59:59)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // ✅ PERBAIKAN: Add WHERE clause for perawat
    const whereClause = req.session.role === 'admin' 
      ? '' 
      : `AND emr_perawat = ${req.session.emr_perawat}`;
    
    // Total visits today (filtered by perawat if not admin)
    const [visits] = await conn.query(
      `SELECT COUNT(*) as total FROM kunjungan 
       WHERE tanggal_kunjungan >= ? AND tanggal_kunjungan < ? ${whereClause}`,
      [today, tomorrow]
    );
    
    // Total unique patients today (filtered by perawat if not admin)
    const [patients] = await conn.query(
      `SELECT COUNT(DISTINCT emr_pasien) as total FROM kunjungan 
       WHERE tanggal_kunjungan >= ? AND tanggal_kunjungan < ? ${whereClause}`,
      [today, tomorrow]
    );
    
    // Total measurements today (filtered by perawat if not admin)
    const [measurements] = await conn.query(
      `SELECT COUNT(*) as total FROM pengukuran 
       WHERE timestamp >= ? AND timestamp < ? ${whereClause}`,
      [today, tomorrow]
    );
    
    // Active visits (status = 'aktif') (filtered by perawat if not admin)
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

// API 2: Today's Visits (FIXED - with role-based filtering)
app.get('/api/visits/today', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // ✅ PERBAIKAN: Add WHERE clause for perawat
    const whereClause = req.session.role === 'admin' 
      ? '' 
      : `AND k.emr_perawat = ${req.session.emr_perawat}`;
    
    const [visits] = await conn.query(
      `SELECT 
        k.id_kunjungan,
        k.emr_pasien,
        k.keluhan,
        k.status,
        k.tanggal_kunjungan,
        p.nama as nama_pasien,
        pr.nama as nama_perawat,
        (SELECT COUNT(*) FROM pengukuran WHERE id_kunjungan = k.id_kunjungan) as total_measurements
       FROM kunjungan k
       JOIN pasien p ON k.emr_pasien = p.emr_pasien
       JOIN perawat pr ON k.emr_perawat = pr.emr_perawat
       WHERE k.tanggal_kunjungan >= ? AND k.tanggal_kunjungan < ? ${whereClause}
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

// API 3: Today's Measurements (FIXED - with role-based filtering)
app.get('/api/measurements/today', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // ✅ PERBAIKAN: Add WHERE clause for perawat
    const whereClause = req.session.role === 'admin' 
      ? '' 
      : `AND p.emr_perawat = ${req.session.emr_perawat}`;
    
    const [measurements] = await conn.query(
      `SELECT 
        p.id,
        p.tipe_device,
        p.data,
        p.timestamp,
        pas.nama as nama_pasien,
        pr.nama as nama_perawat
       FROM pengukuran p
       JOIN pasien pas ON p.emr_pasien = pas.emr_pasien
       JOIN perawat pr ON p.emr_perawat = pr.emr_perawat
       WHERE p.timestamp >= ? AND p.timestamp < ? ${whereClause}
       ORDER BY p.timestamp DESC
       LIMIT 100`,
      [today, tomorrow]
    );
    
    conn.release();
    
    res.json({
      success: true,
      measurements: measurements
    });
  } catch (err) {
    console.error('❌ Measurements API error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// API 4: Metabase Embed Token for Rawat Inap Dashboard
app.get('/api/metabase/rawat-inap-token', requireAdminOrPerawat, (req, res) => {
  try {
    // Dashboard ID untuk Rawat Inap - sesuaikan dengan ID di Metabase Anda
    const DASHBOARD_ID = 1; // ⚠️ CHANGE THIS to your actual Metabase dashboard ID
    
    // Generate embed URL with JWT token
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

// ============================================================
// 5. OPTIONAL: Add navigation link in admin-users.ejs
// ============================================================

/*
Add this link to your admin navigation menu:

<a href="/admin/monitoring">
  <i class="fas fa-chart-line"></i> Dashboard Monitoring
</a>

Example placement in header:

<div class="nav-section">
  <a href="/admin/monitoring">
    <i class="fas fa-chart-line"></i> Monitoring
  </a>
  <span>|</span>
  <a href="/admin/manage-users">
    <i class="fas fa-users"></i> Kelola User
  </a>
  <span>|</span>
  <a href="/logout" class="logout-btn">
    <i class="fas fa-sign-out-alt"></i> Logout
  </a>
</div>
*/

// ============================================================
// 6. UPDATE DOCKER COMPOSE (Already done, just verify)
// ============================================================

/*
Ensure these environment variables are set in docker-compose.yml:

services:
  darsinurse-app:
    environment:
      METABASE_URL: "http://darsinurse.hint-lab.id"
      METABASE_SECRET: "bcc00420636e39862522e5c622fd729a8662297b98235591411c279ef10ff0ab"
*/

// ============================================================
// 7. INSTALLATION STEPS
// ============================================================

/*
STEP-BY-STEP INSTALLATION:

1. Install jsonwebtoken package:
   npm install jsonwebtoken

2. Add all the code above to your server.js file
   - Add after existing routes
   - Before the "START HTTP SERVER" section

3. Create/verify admin-monitoring.ejs exists in views folder

4. Setup Metabase (if not already done):
   a. Create a Metabase account at your METABASE_URL
   b. Create a dashboard for "Rawat Inap"
   c. Go to Dashboard → Sharing → Embed this dashboard
   d. Enable embedding and get the dashboard ID
   e. Update DASHBOARD_ID in the code above (line 140)

5. Restart your application:
   docker-compose down
   docker-compose up -d --build

6. Test the integration:
   - Login as admin
   - Go to http://localhost:4000/admin/monitoring
   - Check if statistics load
   - Check if visits table loads
   - Check if measurements table loads
   - Switch to "Rawat Inap" tab and verify Metabase loads

TROUBLESHOOTING:

- If stats show "-": Check if there's data in kunjungan table today
- If tables show "Memuat data...": Check browser console for errors
- If Metabase fails: Verify METABASE_URL and METABASE_SECRET are correct
- If "Gagal memuat dashboard": Check dashboard ID and Metabase embedding is enabled
*/

// ============================================================
// 8. METABASE SETUP GUIDE
// ============================================================

/*
HOW TO SETUP METABASE EMBEDDING:

1. Login to Metabase at http://darsinurse.hint-lab.id

2. Create Dashboard:
   - Click "+" → Dashboard
   - Name it "Dashboard Rawat Inap"
   - Add questions/cards (queries) to show:
     * Total pasien rawat inap aktif
     * Grafik vital signs (heart rate, blood pressure, etc)
     * Bed occupancy rate
     * Alert/emergency notifications
     * Length of stay statistics

3. Enable Embedding:
   - Open the dashboard
   - Click sharing icon (top right)
   - Select "Embed this dashboard"
   - Toggle "Enable embedding"
   - Note the dashboard ID (number in URL)
   - Copy the embedding secret key

4. Configure Environment:
   - Update docker-compose.yml with correct METABASE_SECRET
   - Update DASHBOARD_ID in the code (line 140)

5. Test Embedding:
   - Generate JWT token using the getMetabaseEmbedUrl() function
   - Open the URL in browser to verify it works
   - Should show dashboard without Metabase navigation

METABASE QUERY EXAMPLES:

For "Total Pasien Rawat Inap Aktif":
SELECT COUNT(*) as total 
FROM rawat_inap 
WHERE status = 'aktif'

For "Vital Signs Chart":
SELECT timestamp, pasien_id, heart_rate, blood_pressure
FROM monitoring_vital_signs
WHERE timestamp >= NOW() - INTERVAL 24 HOUR
ORDER BY timestamp DESC
*/

console.log('✓ Admin Monitoring Integration Code Ready');
console.log('ℹ️  Remember to install: npm install jsonwebtoken');
console.log('ℹ️  Remember to update DASHBOARD_ID for Metabase (line 140)');