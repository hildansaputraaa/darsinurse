// ============================================
// DARSINURSE GATEWAY - Express.js + MariaDB
// Medis IoT dengan Web Bluetooth API
// ============================================

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;

// ============ MARIADB CONNECTION POOL ============
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'darsinurse',
  waitForConnections: true,
  connectionLimit: 10
});

// Cek koneksi
pool.getConnection()
  .then(conn => {
    console.log('✓ MariaDB Connected');
    conn.release();
  })
  .catch(err => {
    console.error('✗ MariaDB Connection Failed:', err);
    process.exit(1);
  });

// ============ DB INIT (CREATE TABLE IF NOT EXISTS) ============
async function initDatabase() {
  const conn = await pool.getConnection();

  await conn.query(`
    CREATE TABLE IF NOT EXISTS perawat (
      id_perawat VARCHAR(10) PRIMARY KEY,
      nama VARCHAR(100),
      password VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS pasien (
      id_pasien VARCHAR(10) PRIMARY KEY,
      nama VARCHAR(100),
      alamat TEXT,
      tanggal_lahir DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

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
    );
  `);

  // Dummy Data Perawat
  const [countPerawat] = await conn.query(`SELECT COUNT(*) AS c FROM perawat`);
  if (countPerawat[0].c === 0) {
    const hash = p => crypto.createHash('sha256').update(p).digest('hex');
    await conn.query(`
      INSERT INTO perawat (id_perawat, nama, password) VALUES
      ('P001','Siti Nurhaliza','${hash('pass123')}'),
      ('P002','Ahmad Wijaya','${hash('pass456')}'),
      ('P003','Dewi Lestari','${hash('pass789')}')
    `);
  }

  // Dummy Data Pasien
  const [countPasien] = await conn.query(`SELECT COUNT(*) AS c FROM pasien`);
  if (countPasien[0].c === 0) {
    await conn.query(`
      INSERT INTO pasien (id_pasien, nama, alamat, tanggal_lahir) VALUES
      ('PAT001','Budi Santoso','Jl. Merdeka No.10','1980-05-15'),
      ('PAT002','Susi Handini','Jl. Ahmad Yani No.25','1975-08-22'),
      ('PAT003','Rudi Hermawan','Jl. Pemuda No.30','1985-12-03'),
      ('PAT004','Ani Wijaya','Jl. Diponegoro No.15','1990-03-17')
    `);
  }

  conn.release();
  console.log("✓ Database initialized!");
}
initDatabase();

// ============ MIDDLEWARE SETUP ============
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  secret: 'darsinurse-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: true }
}));

// ============ AUTH MIDDLEWARE ============
const requireLogin = (req, res, next) => {
  if (!req.session.id_perawat) return res.redirect('/');
  next();
};

// ============ ROUTES ============

// LOGIN PAGE
app.get('/', (req, res) => {
  if (req.session.id_perawat) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

// PROSES LOGIN
app.post('/login', async (req, res) => {
  const { id_perawat, password } = req.body;
  const hash = crypto.createHash('sha256').update(password).digest('hex');

  const conn = await pool.getConnection();
  const [rows] = await conn.query(
    'SELECT * FROM perawat WHERE id_perawat = ?',
    [id_perawat]
  );
  conn.release();

  if (rows.length && rows[0].password === hash) {
    req.session.id_perawat = rows[0].id_perawat;
    req.session.nama_perawat = rows[0].nama;
    return res.redirect('/dashboard');
  }

  res.render('login', { error: 'ID Perawat atau Password salah!' });
});

// DASHBOARD
app.get('/dashboard', requireLogin, (req, res) => {
  res.render('dashboard', {
    nama_perawat: req.session.nama_perawat,
    id_perawat: req.session.id_perawat
  });
});

// API SIMPAN DATA
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

// API RIWAYAT PASIEN
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

// API VALIDASI PASIEN
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
  req.session.destroy();
  res.redirect('/');
});

// ============ HTTPS SERVER ============
const http = require('http');

http.createServer(app).listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   DARSINURSE GATEWAY (MariaDB + HTTPS) ║
║   http://localhost:${PORT}             ║
╚════════════════════════════════════════╝
`);
});
