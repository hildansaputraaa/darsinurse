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
  database: process.env.DB_NAME || 'darsinurse',
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
    console.log('🔧 Optimizing database indexes...');
    
    // ✅ FIX: Gunakan syntax yang kompatibel dengan MySQL lama
    // Caranya: Cek apakah index sudah ada sebelum create
    
    // Index 1: kunjungan table
    try {
      const [indexCheck1] = await conn.query(`
        SELECT COUNT(*) as cnt FROM information_schema.STATISTICS 
        WHERE TABLE_NAME = 'kunjungan' 
        AND INDEX_NAME = 'idx_kunjungan_emr_perawat'
      `);
      
      if (indexCheck1[0].cnt === 0) {
        await conn.query(`
          CREATE INDEX idx_kunjungan_emr_perawat 
          ON kunjungan(emr_perawat, tanggal_kunjungan)
        `);
        console.log('  ✓ Created idx_kunjungan_emr_perawat');
      } else {
        console.log('  ✓ Index idx_kunjungan_emr_perawat already exists');
      }
    } catch (err) {
      console.warn('  ⚠️ Could not create idx_kunjungan_emr_perawat:', err.message);
    }
    
    // Index 2: kunjungan status
    try {
      const [indexCheck2] = await conn.query(`
        SELECT COUNT(*) as cnt FROM information_schema.STATISTICS 
        WHERE TABLE_NAME = 'kunjungan' 
        AND INDEX_NAME = 'idx_kunjungan_status'
      `);
      
      if (indexCheck2[0].cnt === 0) {
        await conn.query(`
          CREATE INDEX idx_kunjungan_status 
          ON kunjungan(status, tanggal_kunjungan)
        `);
        console.log('  ✓ Created idx_kunjungan_status');
      } else {
        console.log('  ✓ Index idx_kunjungan_status already exists');
      }
    } catch (err) {
      console.warn('  ⚠️ Could not create idx_kunjungan_status:', err.message);
    }
    
    // Index 3: vitals waktu
    try {
      const [indexCheck3] = await conn.query(`
        SELECT COUNT(*) as cnt FROM information_schema.STATISTICS 
        WHERE TABLE_NAME = 'vitals' 
        AND INDEX_NAME = 'idx_vitals_waktu'
      `);
      
      if (indexCheck3[0].cnt === 0) {
        await conn.query(`
          CREATE INDEX idx_vitals_waktu 
          ON vitals(waktu DESC)
        `);
        console.log('  ✓ Created idx_vitals_waktu');
      } else {
        console.log('  ✓ Index idx_vitals_waktu already exists');
      }
    } catch (err) {
      console.warn('  ⚠️ Could not create idx_vitals_waktu:', err.message);
    }
    
    console.log('✓ Database optimization complete');
  } catch (err) {
    console.error('❌ Database optimization error:', err);
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
   ROOM MANAGEMENT ROUTES
   ============================================================ */
app.get('/rooms', requireLogin, async (req, res) => {
  res.render('room-management', {
    nama_perawat: req.session.nama_perawat,
    emr_perawat: req.session.emr_perawat
  });
});

app.get('/api/rooms', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    const [rooms] = await conn.query(`
      SELECT 
        rd.room_id,
        rd.device_id,
        p.emr_no,
        p.nama as nama_pasien,
        p.poli,
        rd.created_at as assigned_at
      FROM room_device rd
      LEFT JOIN pasien p ON rd.emr_no = p.emr_no
      ORDER BY rd.room_id ASC
    `);
    
    conn.release();
    res.json({ success: true, rooms });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.get('/api/rooms/available-patients', requireAdminOrPerawat, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    // Ambil pasien yang belum ada di ruangan
    const [patients] = await conn.query(`
      SELECT DISTINCT 
        p.emr_no,
        p.nama,
        p.poli,
        p.jenis_kelamin
      FROM pasien p
      WHERE p.emr_no NOT IN (SELECT emr_no FROM room_device WHERE emr_no IS NOT NULL)
      ORDER BY p.nama ASC
    `);
    
    conn.release();
    res.json({ success: true, patients });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/api/rooms/add', requireAdminOrPerawat, async (req, res) => {
  const { room_id, device_id, emr_no } = req.body;
  
  if (!room_id || !device_id) {
    return res.status(400).json({ error: 'Room ID dan Device ID harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    
    // Cek apakah room sudah ada
    const [existing] = await conn.query(
      'SELECT * FROM room_device WHERE room_id = ?',
      [room_id]
    );
    
    if (existing.length > 0) {
      conn.release();
      return res.status(400).json({ error: 'Room ID sudah terdaftar' });
    }
    
    // Insert room
    const emrValue = emr_no ? parseInt(emr_no) : null;
    
    await conn.query(
      'INSERT INTO room_device (room_id, device_id, emr_no) VALUES (?, ?, ?)',
      [room_id, device_id, emrValue]
    );
    
    conn.release();
    res.json({ success: true, message: 'Ruangan berhasil ditambahkan' });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.put('/api/rooms/:room_id', requireAdminOrPerawat, async (req, res) => {
  const { room_id } = req.params;
  const { new_room_id, device_id } = req.body;
  
  if (!new_room_id || !device_id) {
    return res.status(400).json({ error: 'Room ID dan Device ID harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    
    await conn.query(
      'UPDATE room_device SET room_id = ?, device_id = ? WHERE room_id = ?',
      [new_room_id, device_id, room_id]
    );
    
    conn.release();
    res.json({ success: true, message: 'Ruangan berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/api/rooms/assign', requireAdminOrPerawat, async (req, res) => {
  const { room_id, emr_no } = req.body;
  
  if (!room_id || !emr_no) {
    return res.status(400).json({ error: 'Room ID dan EMR Pasien harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    
    // Cek apakah pasien ada
    const [patient] = await conn.query(
      'SELECT * FROM pasien WHERE emr_no = ?',
      [emr_no]
    );
    
    if (patient.length === 0) {
      conn.release();
      return res.status(400).json({ error: 'Pasien tidak ditemukan' });
    }
    
    // Update room
    await conn.query(
      'UPDATE room_device SET emr_no = ? WHERE room_id = ?',
      [emr_no, room_id]
    );
    
    conn.release();
    res.json({ success: true, message: 'Pasien berhasil dimasukkan ke ruangan' });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/api/rooms/remove-patient', requireAdminOrPerawat, async (req, res) => {
  const { room_id } = req.body;
  
  if (!room_id) {
    return res.status(400).json({ error: 'Room ID harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    
    await conn.query(
      'UPDATE room_device SET emr_no = NULL WHERE room_id = ?',
      [room_id]
    );
    
    conn.release();
    res.json({ success: true, message: 'Pasien berhasil dikeluarkan dari ruangan' });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.delete('/api/rooms/delete', requireAdminOrPerawat, async (req, res) => {
  const { room_id } = req.body;
  
  if (!room_id) {
    return res.status(400).json({ error: 'Room ID harus diisi' });
  }

  try {
    const conn = await pool.getConnection();
    
    // Cek apakah ruangan kosong
    const [room] = await conn.query(
      'SELECT * FROM room_device WHERE room_id = ?',
      [room_id]
    );
    
    if (room.length === 0) {
      conn.release();
      return res.status(400).json({ error: 'Ruangan tidak ditemukan' });
    }
    
    if (room[0].emr_no !== null) {
      conn.release();
      return res.status(400).json({ error: 'Ruangan harus kosong sebelum dihapus' });
    }
    
    // Delete room
    await conn.query(
      'DELETE FROM room_device WHERE room_id = ?',
      [room_id]
    );
    
    conn.release();
    res.json({ success: true, message: 'Ruangan berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
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

async function checkAndBroadcastFall(vitalsId, emrNo) {
  try {
    const conn = await pool.getConnection();
    
    // ✅ SELECT dari database untuk cek fall_detected
    const [vitals] = await conn.query(`
      SELECT 
        v.id,
        v.emr_no,
        v.fall_detected,
        v.waktu,
        v.heart_rate,
        v.sistolik,
        v.diastolik,
        p.nama as nama_pasien,
        p.poli
      FROM vitals v
      JOIN pasien p ON v.emr_no = p.emr_no
      WHERE v.id = ?
    `, [vitalsId]);
    
    conn.release();
    
    // Jika ada data
    if (vitals.length > 0) {
      const vital = vitals[0];
      
      // ✅ Check apakah fall_detected = 1
      if (vital.fall_detected === 1) {
        console.log('🚨 FALL DETECTED FROM DATABASE!');
        console.log('   Patient:', vital.nama_pasien);
        console.log('   EMR:', vital.emr_no);
        
        // Siapkan alert data
        const fallAlertData = {
          id: vital.id,
          emr_no: vital.emr_no,
          nama_pasien: vital.nama_pasien,
          poli: vital.poli,
          room_id: `EMR-${vital.emr_no}`,
          waktu: vital.waktu.toISOString(),
          heart_rate: vital.heart_rate,
          sistolik: vital.sistolik,
          diastolik: vital.diastolik,
          blood_pressure: vital.sistolik && vital.diastolik 
            ? `${vital.sistolik}/${vital.diastolik}` 
            : null
        };
        
        console.log('✅ Fall alert data ready:', fallAlertData);        
        // ✅ BROADCAST to local clients
        io.emit('new-fall-alert', fallAlertData);
        console.log('📤 Alert broadcasted to', io.engine.clientsCount, 'local clients');
        
        // ✅ SEND to monitoring server if connected
        if (monitoringConnected) {
          console.log('📤 Sending to monitoring server...');
          monitoringSocket.emit('new-fall-alert', fallAlertData);
          console.log('✓ Alert sent to monitoring server');
        } else {
          console.warn('⚠️ Monitoring server not connected');
        }
        
        return true; // Fall detected
      }
    }
    
    return false; // No fall
  } catch (err) {
    console.error('❌ Error checking fall detection:', err);
    return false;
  }
}
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
    const vitalsId = result.insertId;

    conn.release();

    await checkAndBroadcastFall(vitalsId, emrInt);
    
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
   SOCKET.IO & FALL DETECTION - FIXED CONFIGURATION
   ============================================================ */
const server = http.createServer(app);

// ✅ FIX: Improved CORS configuration
const io = socketIo(server, {
  cors: {
    origin: [
      "https://darsinurse.hint-lab.id",
      "https://gateway.darsinurse.hint-lab.id",
      "http://localhost:4000",
      "http://localhost:5000"
    ],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type"]
  },
  // ✅ FIX: Add transports and pingTimeout
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e8,
  // ✅ FIX: Allow HTTP polling for nginx reverse proxy
  allowEIO3: true
});

console.log('✓ Socket.IO server initialized with CORS:', io.opts.cors);

// ✅ FIX: Connect to monitoring server with better error handling
const MONITORING_SERVER = process.env.MONITORING_URL || 'http://darsinurse-monitoring:5000';

console.log(`🔄 Connecting to Monitoring Server: ${MONITORING_SERVER}`);
let monitoringConnected = false;  

const monitoringSocket = ioClient(MONITORING_SERVER, {
  reconnection: true,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 10000,
  reconnectionAttempts: Infinity,
  timeout: 30000,
  transports: ['websocket', 'polling'],  // ✅ Websocket first, polling fallback
  autoConnect: true,
  forceNew: false,
  path: '/socket.io/',
  
  // ✅ TAMBAHAN: Extra connection options untuk reliability
  secure: false,                          // ← Tidak gunakan HTTPS untuk internal
  rejectUnauthorized: false,
  reconnectionDelayMax: 10000,
  reconnectionDelay: 1000
});

// ✅ TAMBAHAN: Connection handlers dengan logging detail
let connectionAttempt = 0;

monitoringSocket.on('connect', () => {
  connectionAttempt = 0;  // Reset counter saat berhasil
  console.log('✅ BERHASIL! Connected to Monitoring Server');
  console.log('   Socket ID:', monitoringSocket.id);
  console.log('   Transport:', monitoringSocket.io.engine.transport.name);
  console.log('   URL:', MONITORING_SERVER);
  monitoringConnected = true;
  
  monitoringSocket.emit('join-monitoring', {
    server: 'rawat-jalan',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

monitoringSocket.on('connect_error', (error) => {
  connectionAttempt++;
  console.error(`❌ Connection attempt #${connectionAttempt} FAILED`);
  console.error('   Error message:', error.message);
  console.error('   Error type:', error.type);
  console.error('   Monitoring Server URL:', MONITORING_SERVER);
  console.error('   Will retry...');
  monitoringConnected = false;
});

monitoringSocket.on('disconnect', (reason) => {
  console.warn('⚠️ DISCONNECTED from Monitoring Server');
  console.log('   Reason:', reason);
  monitoringConnected = false;
  
  if (reason === 'io server disconnect') {
    console.log('   🔄 Server requested disconnect, attempting manual reconnect...');
    setTimeout(() => {
      monitoringSocket.connect();
    }, 2000);
  }
});

monitoringSocket.on('reconnect', (attemptNumber) => {
  console.log('🔄 RECONNECTED to Monitoring Server');
  console.log('   Attempt number:', attemptNumber);
  console.log('   Socket ID:', monitoringSocket.id);
  monitoringConnected = true;
});

monitoringSocket.on('reconnect_attempt', (attemptNumber) => {
  console.log(`🔄 Reconnection attempt #${attemptNumber}...`);
  console.log('   URL:', MONITORING_SERVER);
});

monitoringSocket.on('reconnect_error', (error) => {
  console.error('❌ Reconnection error:', error.message);
});

monitoringSocket.on('reconnect_failed', () => {
  console.error('❌ All reconnection attempts failed');
  console.error('   Please check:');
  console.error('   1. Monitoring server is running (docker ps)');
  console.error('   2. Network connectivity (docker network ls)');
  console.error('   3. Monitoring server logs (docker logs darsinurse-monitoring)');
});

monitoringSocket.on('error', (error) => {
  console.error('❌ Socket.IO error:', error);
});

/* ============================================================
   SOCKET.IO SERVER - CLIENT CONNECTIONS
   ============================================================ */
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  console.log('   Transport:', socket.conn.transport.name);
  console.log('   Total clients:', io.engine.clientsCount);
  
  // ✅ Send connection status to client
  socket.emit('connection-status', {
    connected: true,
    monitoringServerConnected: monitoringConnected,
    monitoringServer: MONITORING_SERVER
  });
  
  // ✅ Handle fall detection from devices
  socket.on('fall-detected', async (data) => {
    console.log('🚨 FALL DETECTED event from device:', data);
    
    try {
      const conn = await pool.getConnection();
      
      // Insert to database
      const vitalsData = {
        emr_no: data.emr_no,
        id_kunjungan: data.id_kunjungan,
        waktu: new Date(),
        fall_detected: 1,
        heart_rate: data.heart_rate,
        sistolik: data.sistolik,
        diastolik: data.diastolik,
        respirasi: data.respirasi,
        jarak_kasur_cm: data.jarak_kasur_cm,
        emr_perawat: data.emr_perawat
      };
      
      const [result] = await conn.query('INSERT INTO vitals SET ?', vitalsData);
      
      // Get patient info
      const [patient] = await conn.query(
        'SELECT p.nama, p.poli, rd.room_id, rd.device_id FROM pasien p LEFT JOIN room_device rd ON p.emr_no = rd.emr_no WHERE p.emr_no = ?',
        [data.emr_no]
      );
      
      conn.release();
      
      const patientInfo = patient[0] || {};
      
      // Create alert data
      const alertData = {
        id: result.insertId,
        emr_no: data.emr_no,
        nama_pasien: patientInfo.nama || 'Unknown',
        room_id: patientInfo.room_id || 'Unknown',
        device_id: patientInfo.device_id,
        poli: patientInfo.poli,
        waktu: vitalsData.waktu,
        heart_rate: data.heart_rate,
        sistolik: data.sistolik,
        diastolik: data.diastolik,
        blood_pressure: data.sistolik && data.diastolik ? `${data.sistolik}/${data.diastolik}` : null,
        respirasi: data.respirasi,
        jarak_kasur_cm: data.jarak_kasur_cm,
        timestamp: new Date().toISOString()
      };
      
      console.log('📤 Broadcasting fall alert:', alertData);
      
      // Broadcast to all local clients
      io.emit('new-fall-alert', alertData);
      
      // Send to monitoring server if connected
      if (monitoringConnected) {
        monitoringSocket.emit('new-fall-alert', alertData);
        console.log('📤 Alert sent to monitoring server');
      } else {
        console.warn('⚠️ Monitoring server not connected, alert not forwarded');
      }
      
    } catch (err) {
      console.error('❌ Error processing fall detection:', err);
    }
  });
  
  // ✅ Handle join monitoring room
  socket.on('join-monitoring', (data) => {
    console.log('👀 Client joined monitoring:', data);
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
    console.log('   Remaining clients:', io.engine.clientsCount);
  });
  
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
  });
});

/* ============================================================
   START SERVER
   ============================================================ */
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════╗
║   DARSINURSE GATEWAY - RAWAT JALAN     ║
║   Server: http://0.0.0.0:${PORT}          ║
║   Socket.IO: ACTIVE                    ║
║   Monitoring: ${MONITORING_SERVER}
╚════════════════════════════════════════╝
`);
  
  // ✅ Log initial status
  setTimeout(() => {
    console.log('📊 Status Check:');
    console.log('   - HTTP Server: ✓ Running');
    console.log('   - Socket.IO Server: ✓ Active');
    console.log(`   - Monitoring Connection: ${monitoringConnected ? '✓ Connected' : '⏳ Connecting...'}`);
    console.log(`   - Connected Clients: ${io.engine.clientsCount}`);
  }, 2000);
});

// ✅ Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, closing server...');
  server.close(() => {
    console.log('✓ Server closed');
    pool.end();
    process.exit(0);
  });
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