/* ============================================================
   DARSINURSE GATEWAY - RAWAT JALAN (CLEANED VERSION)
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
const ioClient = require('socket.io-client'); 
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
  connectionLimit: 20,              // Increase dari 10 → 20
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 10,                      // Jumlah koneksi idle yang dipertahankan
  idleTimeout: 60000,               // Timeout untuk idle connections
  acquireTimeout: 30000             // Timeout untuk mendapatkan koneksi
});


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
   DATABASE INITIALIZATION
   ============================================================ */
async function initDatabase() {
  const conn = await pool.getConnection();
  
  try {
    // Tabel PERAWAT
    await conn.query(`
      CREATE TABLE IF NOT EXISTS perawat (
        emr_perawat INT AUTO_INCREMENT PRIMARY KEY,
        nama VARCHAR(100),
        password VARCHAR(255),
        role ENUM('admin','perawat') DEFAULT 'perawat',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tabel PASIEN
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pasien (
        emr_no INT AUTO_INCREMENT PRIMARY KEY,
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
        id_kunjungan INT AUTO_INCREMENT PRIMARY KEY,
        emr_no INT,
        emr_perawat INT,
        tanggal_kunjungan TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        keluhan TEXT,
        status ENUM('aktif','selesai') DEFAULT 'aktif',
        FOREIGN KEY (emr_no) REFERENCES pasien(emr_no),
        FOREIGN KEY (emr_perawat) REFERENCES perawat(emr_perawat)
      );
    `);

    // Tabel VITALS
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

    // Tabel ROOM_DEVICE (untuk fall detection)
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

    // Insert default data perawat
    const [perawat] = await conn.query(`SELECT COUNT(*) AS c FROM perawat`);
    
    if (perawat[0].c === 0) {
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
    }

    // Insert default data pasien
    const [pasien] = await conn.query(`SELECT COUNT(*) AS c FROM pasien`);
    
    if (pasien[0].c === 0) {
      await conn.query(`
        INSERT INTO pasien (emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat) VALUES
        (101,'Budi Santoso','1980-05-15','L','Poli Umum','Jl. Merdeka No.10'),
        (102,'Susi Handini','1975-08-22','P','Poli Gigi','Jl. Ahmad Yani No.25'),
        (103,'Rudi Hermawan','1985-12-03','L','Poli Umum','Jl. Pemuda No.30'),
        (104,'Ani Wijaya','1990-03-17','P','Poli Anak','Jl. Diponegoro No.15')
      `);
      
      console.log('✓ Default patients created');
    }

    // Insert default kunjungan
    const [kunjungan] = await conn.query(`SELECT COUNT(*) AS c FROM kunjungan`);
    
    if (kunjungan[0].c === 0) {
      await conn.query(`
        INSERT INTO kunjungan (id_kunjungan, emr_no, emr_perawat, keluhan, status) VALUES
        (1001, 101, 2, 'Demam dan batuk','selesai'),
        (1002, 102, 3, 'Sakit gigi','aktif')
      `);
      
      console.log('✓ Default visits created');
    }

  } catch (err) {
    console.error('✗ Database initialization error:', err);
    throw err;
  } finally {
    conn.release();
  }
  
  console.log("✓ Database initialized successfully!");
}

async function optimizeDatabase() {
  const conn = await pool.getConnection();
  
  try {
    // Index untuk query yang sering dipanggil
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_kunjungan_emr_perawat 
      ON kunjungan(emr_perawat, tanggal_kunjungan);
    `);
    
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_kunjungan_status 
      ON kunjungan(status, tanggal_kunjungan);
    `);
    
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_vitals_waktu 
      ON vitals(waktu DESC);
    `);
    
    console.log('✓ Database indexes optimized');
  } catch (err) {
    console.error('Index creation error:', err);
  } finally {
    conn.release();
  }
}

// Panggil setelah initDatabase()
initDatabase()
  .then(() => optimizeDatabase())
  .catch(err => {
    console.error('Failed to initialize:', err);
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
   AUTHENTICATION ROUTES
   ============================================================ */
app.get('/', (req, res) => {
  if (req.session.emr_perawat) {
    if (req.session.role === 'admin') {
      return res.redirect('/admin/manage-users');
    }
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { emr_perawat, password } = req.body;
  
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
      return res.render('login', { error: 'EMR Perawat tidak ditemukan!' });
    }

    const user = rows[0];

    if (user.password === hash) {
      req.session.emr_perawat = user.emr_perawat;
      req.session.nama_perawat = user.nama;
      req.session.role = user.role;
      
      if (user.role === 'admin') {
        return res.redirect('/admin/manage-users');
      }
      return res.redirect('/dashboard');
    } else {
      return res.render('login', { error: 'Password salah!' });
    }
  } catch (err) {
    console.error('❌ Login error:', err);
    return res.render('login', { error: 'Terjadi kesalahan sistem!' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

/* ============================================================
   DASHBOARD ROUTES
   ============================================================ */
app.get('/dashboard', requireLogin, (req, res) => {
  if (req.session.role === 'admin') {
    return res.redirect('/admin/manage-users');
  }
  res.render('dashboard', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat
  });
});

/* ============================================================
   ADMIN ROUTES - USER MANAGEMENT
   ============================================================ */
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

app.get('/admin/api/users', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  const [users] = await conn.query(
    'SELECT emr_perawat, nama, role, created_at FROM perawat ORDER BY created_at DESC'
  );
  conn.release();
  res.json({ success: true, users });
});

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
    
    res.json({ success: true, message: 'User berhasil ditambahkan' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'EMR Perawat sudah terdaftar' });
    } else {
      res.status(500).json({ error: 'Database error: ' + err.message });
    }
  }
});

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
    res.json({ success: true, message: 'User berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

/* ============================================================
   VITALS & MEASUREMENTS ROUTES
   ============================================================ */
app.post('/simpan_data', requireLogin, async (req, res) => {
  const { id_kunjungan, emr_no, tipe_device, data } = req.body;
  
  const idInt = parseInt(id_kunjungan);
  const emrInt = parseInt(emr_no);
  
  if (isNaN(idInt) || isNaN(emrInt) || !tipe_device || !data) {
    return res.status(400).json({ error: 'Data tidak lengkap atau tidak valid' });
  }

  try {
    const conn = await pool.getConnection();
    
    let vitalsData = {
      emr_no: emrInt,
      id_kunjungan: idInt,
      emr_perawat: req.session.emr_perawat,
      heart_rate: null,
      sistolik: null,
      diastolik: null,
      respirasi: null,
      glukosa: null,
      berat_badan_kg: null,
      tinggi_badan_cm: null,
      bmi: null,
      jarak_kasur_cm: null,
      fall_detected: 0
    };

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
        } catch (e) {}
        break;
    }

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
        vitalsData.emr_no,
        vitalsData.id_kunjungan,
        vitalsData.emr_perawat,
        vitalsData.heart_rate,
        vitalsData.sistolik,
        vitalsData.diastolik,
        vitalsData.respirasi,
        vitalsData.glukosa,
        vitalsData.berat_badan_kg,
        vitalsData.tinggi_badan_cm,
        vitalsData.bmi,
        vitalsData.jarak_kasur_cm,
        vitalsData.fall_detected
      ]
    );

    conn.release();

    const vitalsId = result.insertId;
    
    res.json({
      success: true,
      id: vitalsId,
      message: "Data berhasil disimpan"
    });
  } catch (err) {
    console.error('❌ Save data error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

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
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

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
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

/* ============================================================
   FALL DETECTION ROUTES
   ============================================================ */
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
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   HEALTH CHECK
   ============================================================ */
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    server: 'rawat-jalan',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/* ============================================================
   SOCKET.IO & FALL DETECTION MONITORING
   ============================================================ */
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const MONITORING_SERVER = process.env.MONITORING_URL || 'https://darsinurse.hint-lab.id';

const monitoringSocket = ioClient(MONITORING_SERVER, {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10,
  reconnectionDelayMax: 5000
});

monitoringSocket.on('connect', () => {
  console.log('✓ Connected to Monitoring Server at', MONITORING_SERVER);
  // Join monitoring room setelah connect
  monitoringSocket.emit('join-monitoring', {
    server: 'rawat-jalan',
    port: PORT
  });
});

monitoringSocket.on('disconnect', () => {
  console.warn('⚠ Disconnected from Monitoring Server');
});

monitoringSocket.on('connect_error', (error) => {
  console.error('❌ Socket connection error:', error);
});

/* ============================================================
   DARSINURSE - ROOM MANAGEMENT API ENDPOINTS
   Tambahkan kode ini ke server.js Anda
   Letakkan SEBELUM "server.listen(PORT, ...)"
   ============================================================ */

// ============================================================
// ROOM MANAGEMENT API ENDPOINTS
// ============================================================

// GET ALL ROOMS
app.get('/api/rooms', requireLogin, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const [rooms] = await conn.query(`
      SELECT 
        rd.room_id,
        rd.device_id,
        rd.emr_no,
        rd.assigned_at,
        p.nama as nama_pasien,
        p.poli,
        p.jenis_kelamin
      FROM room_device rd
      LEFT JOIN pasien p ON rd.emr_no = p.emr_no
      ORDER BY rd.room_id ASC
    `);
    
    conn.release();
    
    res.json({ success: true, rooms });
  } catch (err) {
    console.error('❌ Get rooms error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ADD NEW ROOM
app.post('/api/rooms/add', requireLogin, async (req, res) => {
  const { room_id, device_id, emr_no } = req.body;
  
  if (!room_id || !device_id) {
    return res.status(400).json({ error: 'Room ID dan Device ID harus diisi' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    // Check if room_id or device_id already exists
    const [existing] = await conn.query(
      'SELECT room_id, device_id FROM room_device WHERE room_id = ? OR device_id = ?',
      [room_id, device_id]
    );
    
    if (existing.length > 0) {
      conn.release();
      return res.status(400).json({ 
        error: 'Room ID atau Device ID sudah terdaftar' 
      });
    }
    
    // If emr_no provided, validate patient exists
    if (emr_no) {
      const emrInt = parseInt(emr_no);
      const [patient] = await conn.query(
        'SELECT emr_no FROM pasien WHERE emr_no = ?',
        [emrInt]
      );
      
      if (patient.length === 0) {
        conn.release();
        return res.status(400).json({ error: 'Pasien tidak ditemukan' });
      }
      
      // Check if patient already assigned to another room
      const [assignedRoom] = await conn.query(
        'SELECT room_id FROM room_device WHERE emr_no = ?',
        [emrInt]
      );
      
      if (assignedRoom.length > 0) {
        conn.release();
        return res.status(400).json({ 
          error: `Pasien sudah berada di ruangan ${assignedRoom[0].room_id}` 
        });
      }
    }
    
    // Insert new room
    await conn.query(
      'INSERT INTO room_device (room_id, device_id, emr_no, assigned_at) VALUES (?, ?, ?, NOW())',
      [room_id, device_id, emr_no || null]
    );
    
    conn.release();
    
    console.log('✓ New room added:', room_id);
    res.json({ 
      success: true, 
      message: `Ruangan ${room_id} berhasil ditambahkan` 
    });
  } catch (err) {
    console.error('❌ Add room error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ASSIGN PATIENT TO ROOM (Masukkan Pasien)
app.post('/api/rooms/assign', requireLogin, async (req, res) => {
  const { room_id, emr_no } = req.body;
  
  if (!room_id || !emr_no) {
    return res.status(400).json({ error: 'Room ID dan EMR Pasien harus diisi' });
  }
  
  const emrInt = parseInt(emr_no);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR Pasien tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    // Check if room exists
    const [room] = await conn.query(
      'SELECT room_id, emr_no FROM room_device WHERE room_id = ?',
      [room_id]
    );
    
    if (room.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
    }
    
    if (room[0].emr_no) {
      conn.release();
      return res.status(400).json({ error: 'Ruangan sudah terisi' });
    }
    
    // Check if patient exists
    const [patient] = await conn.query(
      'SELECT emr_no, nama FROM pasien WHERE emr_no = ?',
      [emrInt]
    );
    
    if (patient.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Pasien tidak ditemukan' });
    }
    
    // Check if patient already in another room
    const [assignedRoom] = await conn.query(
      'SELECT room_id FROM room_device WHERE emr_no = ?',
      [emrInt]
    );
    
    if (assignedRoom.length > 0) {
      conn.release();
      return res.status(400).json({ 
        error: `Pasien sudah berada di ruangan ${assignedRoom[0].room_id}` 
      });
    }
    
    // Assign patient to room
    await conn.query(
      'UPDATE room_device SET emr_no = ?, assigned_at = NOW() WHERE room_id = ?',
      [emrInt, room_id]
    );
    
    conn.release();
    
    console.log(`✓ Patient ${emrInt} assigned to room ${room_id}`);
    res.json({ 
      success: true, 
      message: `Pasien ${patient[0].nama} berhasil dimasukkan ke ruangan ${room_id}` 
    });
  } catch (err) {
    console.error('❌ Assign patient error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// REMOVE PATIENT FROM ROOM (Keluarkan Pasien)
app.post('/api/rooms/remove-patient', requireLogin, async (req, res) => {
  const { room_id } = req.body;
  
  if (!room_id) {
    return res.status(400).json({ error: 'Room ID harus diisi' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    // Check if room exists and has patient
    const [room] = await conn.query(
      'SELECT room_id, emr_no FROM room_device WHERE room_id = ?',
      [room_id]
    );
    
    if (room.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
    }
    
    if (!room[0].emr_no) {
      conn.release();
      return res.status(400).json({ error: 'Ruangan sudah kosong' });
    }
    
    // Remove patient from room
    await conn.query(
      'UPDATE room_device SET emr_no = NULL, assigned_at = NOW() WHERE room_id = ?',
      [room_id]
    );
    
    conn.release();
    
    console.log(`✓ Patient removed from room ${room_id}`);
    res.json({ 
      success: true, 
      message: `Pasien berhasil dikeluarkan dari ruangan ${room_id}` 
    });
  } catch (err) {
    console.error('❌ Remove patient error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// UPDATE ROOM (Edit Room Info)
app.put('/api/rooms/:room_id', requireLogin, async (req, res) => {
  const { room_id } = req.params;
  const { new_room_id, device_id } = req.body;
  
  if (!new_room_id || !device_id) {
    return res.status(400).json({ error: 'Room ID dan Device ID harus diisi' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    // Check if room exists
    const [room] = await conn.query(
      'SELECT room_id FROM room_device WHERE room_id = ?',
      [room_id]
    );
    
    if (room.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
    }
    
    // If changing room_id, check if new room_id already exists
    if (new_room_id !== room_id) {
      const [existing] = await conn.query(
        'SELECT room_id FROM room_device WHERE room_id = ?',
        [new_room_id]
      );
      
      if (existing.length > 0) {
        conn.release();
        return res.status(400).json({ error: 'Room ID baru sudah terdaftar' });
      }
    }
    
    // Check if device_id already used by another room
    const [existingDevice] = await conn.query(
      'SELECT room_id FROM room_device WHERE device_id = ? AND room_id != ?',
      [device_id, room_id]
    );
    
    if (existingDevice.length > 0) {
      conn.release();
      return res.status(400).json({ error: 'Device ID sudah digunakan ruangan lain' });
    }
    
    // Update room
    await conn.query(
      'UPDATE room_device SET room_id = ?, device_id = ? WHERE room_id = ?',
      [new_room_id, device_id, room_id]
    );
    
    conn.release();
    
    console.log(`✓ Room updated: ${room_id} -> ${new_room_id}`);
    res.json({ 
      success: true, 
      message: 'Ruangan berhasil diupdate' 
    });
  } catch (err) {
    console.error('❌ Update room error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// DELETE ROOM
app.delete('/api/rooms/delete', requireLogin, async (req, res) => {
  const { room_id } = req.body;
  
  if (!room_id) {
    return res.status(400).json({ error: 'Room ID harus diisi' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    // Check if room exists
    const [room] = await conn.query(
      'SELECT room_id, emr_no FROM room_device WHERE room_id = ?',
      [room_id]
    );
    
    if (room.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
    }
    
    // Check if room has patient
    if (room[0].emr_no) {
      conn.release();
      return res.status(400).json({ 
        error: 'Tidak bisa menghapus ruangan yang masih terisi. Keluarkan pasien terlebih dahulu.' 
      });
    }
    
    // Delete room
    await conn.query('DELETE FROM room_device WHERE room_id = ?', [room_id]);
    
    conn.release();
    
    console.log(`✓ Room deleted: ${room_id}`);
    res.json({ 
      success: true, 
      message: `Ruangan ${room_id} berhasil dihapus` 
    });
  } catch (err) {
    console.error('❌ Delete room error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// GET AVAILABLE PATIENTS (yang belum ada di ruangan)
app.get('/api/rooms/available-patients', requireLogin, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const [patients] = await conn.query(`
      SELECT 
        p.emr_no,
        p.nama,
        p.poli,
        p.jenis_kelamin
      FROM pasien p
      WHERE p.emr_no NOT IN (
        SELECT emr_no FROM room_device WHERE emr_no IS NOT NULL
      )
      ORDER BY p.nama ASC
    `);
    
    conn.release();
    
    res.json({ success: true, patients });
  } catch (err) {
    console.error('❌ Get available patients error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ROUTE: Room Management Page
app.get('/rooms', requireLogin, (req, res) => {
  res.render('room-management', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat,
    role: req.session.role
  });
});

console.log('✓ Room Management API endpoints loaded');
console.log('  - GET    /api/rooms');
console.log('  - POST   /api/rooms/add');
console.log('  - POST   /api/rooms/assign');
console.log('  - POST   /api/rooms/remove-patient');
console.log('  - PUT    /api/rooms/:room_id');
console.log('  - DELETE /api/rooms/delete');
console.log('  - GET    /api/rooms/available-patients');
console.log('  - GET    /rooms (UI page)');

initFallDetection();



/* ============================================================
   START SERVER
   ============================================================ */
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   DARSINURSE GATEWAY - RAWAT JALAN     ║
║   Server: http://localhost:${PORT}        ║
║   Socket.IO Fall Detection: ACTIVE     ║
╚════════════════════════════════════════╝
`);
});

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
    
    res.json({ success: true, message: 'User berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

/* ============================================================
   PATIENT ROUTES
   ============================================================ */
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
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/api/patients/register', requireLogin, async (req, res) => {
  const { nama, tanggal_lahir, jenis_kelamin, poli, alamat } = req.body;
  
  if (!nama || !tanggal_lahir || !jenis_kelamin || !poli) {
    return res.status(400).json({ 
      error: 'Nama, Tanggal Lahir, Jenis Kelamin, dan Poli harus diisi' 
    });
  }

  try {
    const conn = await pool.getConnection();
    
    const [result] = await conn.query(
      'INSERT INTO pasien (nama, tanggal_lahir, jenis_kelamin, poli, alamat) VALUES (?, ?, ?, ?, ?)',
      [nama, tanggal_lahir, jenis_kelamin, poli, alamat || '']
    );
    
    conn.release();
    
    const newEmrNo = result.insertId;
    
    res.json({ 
      success: true, 
      message: 'Pasien berhasil didaftarkan',
      emr_no: newEmrNo
    });
  } catch (err) {
    res.status(500).json({ 
      error: 'Database error: ' + err.message 
    });
  }
});

app.get('/api/patients/active', requireLogin, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    let query = `
      SELECT DISTINCT 
        p.emr_no, 
        p.nama, 
        p.poli,
        p.jenis_kelamin
      FROM pasien p
    `;
    
    if (req.session.role !== 'admin') {
      query += `
        LEFT JOIN kunjungan k ON p.emr_no = k.emr_no
        WHERE k.emr_perawat = ?
      `;
    }
    
    query += ` ORDER BY p.nama ASC`;
    
    const params = req.session.role === 'admin' ? [] : [req.session.emr_perawat];
    const [patients] = await conn.query(query, params);
    
    conn.release();
    
    res.json({ 
      success: true, 
      patients: patients 
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.get('/api/patients/:emr/info', requireLogin, async (req, res) => {
  const emrInt = parseInt(req.params.emr);
  
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    const [patients] = await conn.query(
      `SELECT 
        emr_no, 
        nama, 
        tanggal_lahir,
        jenis_kelamin, 
        poli,
        alamat
      FROM pasien 
      WHERE emr_no = ?`,
      [emrInt]
    );
    
    conn.release();
    
    if (patients.length === 0) {
      return res.status(404).json({ error: 'Pasien tidak ditemukan' });
    }
    
    res.json({ 
      success: true, 
      patient: patients[0] 
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

/* ============================================================
   VISIT ROUTES
   ============================================================ */
app.get('/api/patients/:emr/visits', requireLogin, async (req, res) => {
  const emrInt = parseInt(req.params.emr);
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    let query = `
      SELECT k.*, p.nama as nama_perawat
      FROM kunjungan k
      JOIN perawat p ON k.emr_perawat = p.emr_perawat
      WHERE k.emr_no = ?
    `;
    
    const params = [emrInt];
    
    if (req.session.role !== 'admin') {
      query += ` AND k.emr_perawat = ?`;
      params.push(req.session.emr_perawat);
    }
    
    query += ` ORDER BY k.tanggal_kunjungan DESC`;
    
    const [visits] = await conn.query(query, params);
    conn.release();
    
    res.json({ success: true, visits });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/api/visits', requireLogin, async (req, res) => {
  const { emr_no, keluhan } = req.body;
  
  const emrInt = parseInt(emr_no);
  
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR Pasien harus berupa angka' });
  }

  try {
    const conn = await pool.getConnection();
    
    const [result] = await conn.query(
      'INSERT INTO kunjungan (emr_no, emr_perawat, keluhan, status) VALUES (?, ?, ?, ?)',
      [emrInt, req.session.emr_perawat, keluhan || '', 'aktif']
    );
    
    conn.release();
    
    const newIdKunjungan = result.insertId;
    
    res.json({ 
      success: true, 
      message: 'Kunjungan berhasil dibuat',
      id_kunjungan: newIdKunjungan
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

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
    
    res.json({ success: true, message: 'Status kunjungan berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.get('/api/visits/by-patient/:emr', requireLogin, async (req, res) => {
  const emrInt = parseInt(req.params.emr);
  
  if (isNaN(emrInt)) {
    return res.status(400).json({ error: 'EMR tidak valid' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    let query = `
      SELECT 
        k.id_kunjungan,
        k.tanggal_kunjungan,
        k.keluhan,
        k.status,
        pr.nama as nama_perawat
      FROM kunjungan k
      LEFT JOIN perawat pr ON k.emr_perawat = pr.emr_perawat
      WHERE k.emr_no = ?
    `;
    
    const params = [emrInt];
    
    if (req.session.role !== 'admin') {
      query += ` AND k.emr_perawat = ?`;
      params.push(req.session.emr_perawat);
    }
    
    query += `
      ORDER BY 
        CASE WHEN k.status = 'aktif' THEN 0 ELSE 1 END,
        k.tanggal_kunjungan DESC
      LIMIT 10
    `;
    
    const [visits] = await conn.query(query, params);
    
    conn.release();
    
    res.json({ 
      success: true, 
      visits: visits 
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});