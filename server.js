/* ============================================================
   DARSINURSE GATEWAY - Node.js + Express + MySQL
   Medical IoT Gateway using Web Bluetooth API
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
  database: process.env.DB_NAME || 'darsinurse',
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
<<<<<<< HEAD
    // Disable foreign key checks sementara
    await conn.query('SET FOREIGN_KEY_CHECKS=0');

    // Tabel PERAWAT dengan EMR INTEGER
=======
    // Tabel PERAWAT dengan role
>>>>>>> parent of 76fece1 (update)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS perawat (
        id_perawat VARCHAR(10) PRIMARY KEY,
        nama VARCHAR(100),
        password VARCHAR(255),
        role ENUM('admin','perawat') DEFAULT 'perawat',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabel PASIEN
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pasien (
        id_pasien VARCHAR(10) PRIMARY KEY,
        nama VARCHAR(100),
        alamat TEXT,
        tanggal_lahir DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

<<<<<<< HEAD
    // Tabel KUNJUNGAN
    await conn.query(`
      CREATE TABLE IF NOT EXISTS kunjungan (
        id_kunjungan INT PRIMARY KEY,
        emr_pasien INT NOT NULL,
        emr_perawat INT NOT NULL,
        tanggal_kunjungan TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        keluhan TEXT,
        status ENUM('aktif','selesai') DEFAULT 'aktif',
        FOREIGN KEY (emr_pasien) REFERENCES pasien(emr_pasien) ON DELETE CASCADE,
        FOREIGN KEY (emr_perawat) REFERENCES perawat(emr_perawat) ON DELETE CASCADE
      );
    `);

    // Tabel PENGUKURAN dengan id_kunjungan INTEGER
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pengukuran (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_kunjungan INT NOT NULL,
        emr_perawat INT NOT NULL,
        emr_pasien INT NOT NULL,
        tipe_device VARCHAR(50),
        data VARCHAR(255),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_kunjungan) REFERENCES kunjungan(id_kunjungan) ON DELETE CASCADE,
        FOREIGN KEY (emr_perawat) REFERENCES perawat(emr_perawat) ON DELETE CASCADE,
        FOREIGN KEY (emr_pasien) REFERENCES pasien(emr_pasien) ON DELETE CASCADE
=======
    // Tabel PENGUKURAN
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pengukuran (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_perawat VARCHAR(10),
        id_pasien VARCHAR(10),
        tipe_device VARCHAR(50),
        data VARCHAR(255),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_perawat) REFERENCES perawat(id_perawat),
        FOREIGN KEY (id_pasien) REFERENCES pasien(id_pasien)
>>>>>>> parent of 76fece1 (update)
      );
    `);

    // Enable foreign key checks kembali
    await conn.query('SET FOREIGN_KEY_CHECKS=1');

    // Check dan insert dummy data perawat
    const [perawat] = await conn.query(`SELECT COUNT(*) AS c FROM perawat`);
    
    if (perawat[0].c === 0) {
      console.log('🔄 Initializing default users...');
      
      await conn.query(`
        INSERT INTO perawat (id_perawat, nama, password, role) VALUES
        ('ADMIN01', 'Administrator', ?, 'admin'),
        ('P001', 'Siti Nurhaliza', ?, 'perawat'),
        ('P002', 'Ahmad Wijaya', ?, 'perawat'),
        ('P003', 'Dewi Lestari', ?, 'perawat')
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
        INSERT INTO pasien (id_pasien, nama, alamat, tanggal_lahir) VALUES
        ('PAT001','Budi Santoso','Jl. Merdeka No.10','1980-05-15'),
        ('PAT002','Susi Handini','Jl. Ahmad Yani No.25','1975-08-22'),
        ('PAT003','Rudi Hermawan','Jl. Pemuda No.30','1985-12-03'),
        ('PAT004','Ani Wijaya','Jl. Diponegoro No.15','1990-03-17')
      `);
      
      console.log('✓ Default patients created');
    } else {
      console.log(`✓ Found ${pasien[0].c} existing patients`);
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
  secret: 'darsinurse-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false }
}));

/* ============================================================
   AUTH MIDDLEWARE
   ============================================================ */
const requireLogin = (req, res, next) => {
  if (!req.session.id_perawat) return res.redirect('/');
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.id_perawat) return res.redirect('/');
  if (req.session.role !== 'admin') {
    return res.status(403).send('Access Denied: Admin only');
  }
  next();
};

/* ============================================================
   ROUTES
   ============================================================ */

// LOGIN PAGE
app.get('/', (req, res) => {
  if (req.session.id_perawat) {
    if (req.session.role === 'admin') {
      return res.redirect('/admin/manage-users');
    }
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null });
});

// PROSES LOGIN
app.post('/login', async (req, res) => {
  const { id_perawat, password } = req.body;
  
  console.log('🔐 Login attempt:', id_perawat);
  
  const hash = hashPassword(password);
  
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      'SELECT * FROM perawat WHERE id_perawat = ?',
      [id_perawat]
    );
    conn.release();

    if (rows.length === 0) {
      console.log('❌ User not found:', id_perawat);
      return res.render('login', { error: 'ID Perawat tidak ditemukan!' });
    }

    const user = rows[0];
    console.log('👤 User found:', user.id_perawat, '- Role:', user.role);

    if (user.password === hash) {
      req.session.id_perawat = user.id_perawat;
      req.session.nama_perawat = user.nama;
      req.session.role = user.role;
      
      console.log('✓ Login success:', user.nama);
      
      // Redirect berdasarkan role
      if (user.role === 'admin') {
        return res.redirect('/admin/manage-users');
      }
      return res.redirect('/dashboard');
    } else {
      console.log('❌ Wrong password for:', id_perawat);
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
    id_perawat: req.session.id_perawat
  });
});

// ========== ADMIN ROUTES ==========

// MANAGE USERS PAGE (COMBINED dengan PATIENTS)
app.get('/admin/manage-users', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  const [users] = await conn.query(
    'SELECT id_perawat, nama, role, created_at FROM perawat ORDER BY created_at DESC'
  );
  conn.release();

  res.render('admin-users', {
    nama_perawat: req.session.nama_perawat,
    id_perawat: req.session.id_perawat,
    users: users
  });
});

// GET ALL USERS (API)
app.get('/admin/api/users', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  const [users] = await conn.query(
    'SELECT id_perawat, nama, role, created_at FROM perawat ORDER BY created_at DESC'
  );
  conn.release();
  res.json({ success: true, users });
});

// ADD NEW USER
app.post('/admin/api/users', requireAdmin, async (req, res) => {
  const { id_perawat, nama, password, role } = req.body;
  
  if (!id_perawat || !nama || !password || !role) {
    return res.status(400).json({ error: 'Semua field harus diisi' });
  }

  const hash = hashPassword(password);
  
  try {
    const conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO perawat (id_perawat, nama, password, role) VALUES (?, ?, ?, ?)',
      [id_perawat, nama, hash, role]
    );
    conn.release();
    
    console.log('✓ New user created:', id_perawat);
    res.json({ success: true, message: 'User berhasil ditambahkan' });
  } catch (err) {
    console.error('❌ Add user error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'ID Perawat sudah terdaftar' });
    } else {
      res.status(500).json({ error: 'Database error: ' + err.message });
    }
  }
});

// UPDATE USER
app.put('/admin/api/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { nama, password, role } = req.body;
  
  if (!nama || !role) {
    return res.status(400).json({ error: 'Nama dan role harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    
    if (password && password.trim() !== '') {
      const hash = hashPassword(password);
      await conn.query(
        'UPDATE perawat SET nama = ?, password = ?, role = ? WHERE id_perawat = ?',
        [nama, hash, role, id]
      );
    } else {
      await conn.query(
        'UPDATE perawat SET nama = ?, role = ? WHERE id_perawat = ?',
        [nama, role, id]
      );
    }
    
    conn.release();
    console.log('✓ User updated:', id);
    res.json({ success: true, message: 'User berhasil diupdate' });
  } catch (err) {
    console.error('❌ Update user error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// DELETE USER
app.delete('/admin/api/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  if (id === req.session.id_perawat) {
    return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.query('DELETE FROM perawat WHERE id_perawat = ?', [id]);
    conn.release();
    
    console.log('✓ User deleted:', id);
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
      'SELECT id_pasien, nama, alamat, tanggal_lahir, created_at FROM pasien ORDER BY created_at DESC'
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
  const { id_pasien, nama, alamat, tanggal_lahir } = req.body;
  
  if (!id_pasien || !nama || !alamat || !tanggal_lahir) {
    return res.status(400).json({ error: 'Semua field harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO pasien (id_pasien, nama, alamat, tanggal_lahir) VALUES (?, ?, ?, ?)',
      [id_pasien, nama, alamat, tanggal_lahir]
    );
    conn.release();
    
    console.log('✓ New patient created:', id_pasien);
    res.json({ success: true, message: 'Pasien berhasil ditambahkan' });
  } catch (err) {
    console.error('❌ Add patient error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'ID Pasien sudah terdaftar' });
    } else {
      res.status(500).json({ error: 'Database error: ' + err.message });
    }
  }
});

// UPDATE PATIENT
app.put('/admin/api/patients/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { nama, alamat, tanggal_lahir } = req.body;
  
  if (!nama || !alamat || !tanggal_lahir) {
    return res.status(400).json({ error: 'Semua field harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    await conn.query(
      'UPDATE pasien SET nama = ?, alamat = ?, tanggal_lahir = ? WHERE id_pasien = ?',
      [nama, alamat, tanggal_lahir, id]
    );
    conn.release();
    
    console.log('✓ Patient updated:', id);
    res.json({ success: true, message: 'Pasien berhasil diupdate' });
  } catch (err) {
    console.error('❌ Update patient error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// DELETE PATIENT
app.delete('/admin/api/patients/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const conn = await pool.getConnection();
    
    // Hapus data pengukuran terlebih dahulu
    await conn.query('DELETE FROM pengukuran WHERE id_pasien = ?', [id]);
    
    // Hapus pasien
    await conn.query('DELETE FROM pasien WHERE id_pasien = ?', [id]);
    conn.release();
    
    console.log('✓ Patient deleted:', id);
    res.json({ success: true, message: 'Pasien berhasil dihapus' });
  } catch (err) {
    console.error('❌ Delete patient error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// GET PATIENT MEASUREMENTS HISTORY
app.get('/admin/api/patients/:id/measurements', requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    const conn = await pool.getConnection();
    const [measurements] = await conn.query(
      `SELECT 
        p.tipe_device, 
        p.data, 
        p.timestamp,
        pr.nama as nama_perawat
       FROM pengukuran p
       JOIN perawat pr ON p.id_perawat = pr.id_perawat
       WHERE p.id_pasien = ?
       ORDER BY p.timestamp DESC
       LIMIT 100`,
      [id]
    );
    conn.release();
    
    res.json({ success: true, measurements });
  } catch (err) {
    console.error('❌ Get measurements error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ========== PERAWAT ROUTES ==========

// SIMPAN DATA PENGUKURAN
app.post('/simpan_data', requireLogin, async (req, res) => {
  const { id_pasien, tipe_device, data } = req.body;
  if (!id_pasien || !tipe_device || !data)
    return res.status(400).json({ error: 'Data tidak lengkap' });

  const conn = await pool.getConnection();
  const [result] = await conn.query(
    `INSERT INTO pengukuran (id_perawat, id_pasien, tipe_device, data)
     VALUES (?, ?, ?, ?)`,
    [req.session.id_perawat, id_pasien, tipe_device, data]
  );
  conn.release();

  res.json({
    success: true,
    id: result.insertId,
    message: "Data berhasil disimpan"
  });
});

// RIWAYAT PENGUKURAN PASIEN
app.get('/riwayat/:id', requireLogin, async (req, res) => {
  const conn = await pool.getConnection();
  const [rows] = await conn.query(
    `SELECT tipe_device, data, timestamp 
     FROM pengukuran 
     WHERE id_pasien = ?
     ORDER BY timestamp DESC LIMIT 50`,
    [req.params.id]
  );
  conn.release();

  res.json({ success: true, data: rows });
});

// VALIDASI PASIEN
app.get('/validasi_pasien/:id', requireLogin, async (req, res) => {
  const conn = await pool.getConnection();
  const [rows] = await conn.query(
    'SELECT * FROM pasien WHERE id_pasien = ?',
    [req.params.id]
  );
  conn.release();

  res.json({ valid: rows.length > 0, pasien: rows[0] || null });
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
║      DARSINURSE GATEWAY - MySQL        ║
║   Server running on http://localhost:${PORT}  ║
╚════════════════════════════════════════╝
`);
});