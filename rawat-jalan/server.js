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


// ============================================================
// 🔧 DEVELOPMENT MODE - SET FALSE UNTUK PRODUCTION
// ============================================================
const ENABLE_DEFAULT_DATA = process.env.ENABLE_DEFAULT_DATA === 'true' || true;
// Ubah menjadi 'false' atau set env variable saat production

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
        emr_no VARCHAR(11) PRIMARY KEY,
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
        emr_no VARCHAR(11),
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
        emr_no VARCHAR(11) NOT NULL,
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

    // Tabel ROOM_DEVICE
    await conn.query(`
      CREATE TABLE IF NOT EXISTS room_device (
        id INT AUTO_INCREMENT PRIMARY KEY,
        emr_no VARCHAR(11),
        room_id VARCHAR(50),
        device_id VARCHAR(50),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (emr_no) REFERENCES pasien(emr_no)
      );
    `);

    // ============================================================
    // 🧪 DEFAULT DATA - HANYA UNTUK DEVELOPMENT/TESTING
    // Set ENABLE_DEFAULT_DATA = false untuk production
    // ============================================================
    if (ENABLE_DEFAULT_DATA) {
      console.log('🧪 Development Mode: Inserting default data...');
      
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
        
        console.log('  ✓ Default users created');
      }

      // Insert default data pasien
      const [pasien] = await conn.query(`SELECT COUNT(*) AS c FROM pasien`);
      
      if (pasien[0].c === 0) {
        await conn.query(`
          INSERT INTO pasien (emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat) VALUES
          ('20251225001','Budi Santoso','1980-05-15','L','Poli Umum','Jl. Merdeka No.10'),
          ('20251225002','Susi Handini','1975-08-22','P','Poli Gigi','Jl. Ahmad Yani No.25'),
          ('20251225003','Rudi Hermawan','1985-12-03','L','Poli Umum','Jl. Pemuda No.30'),
          ('20251225004','Ani Wijaya','1990-03-17','P','Poli Anak','Jl. Diponegoro No.15')
        `);      
        console.log('  ✓ Default patients created');
      }

      // Insert default kunjungan
      const [kunjungan] = await conn.query(`SELECT COUNT(*) AS c FROM kunjungan`);
      
      if (kunjungan[0].c === 0) {
        await conn.query(`
          INSERT INTO kunjungan (id_kunjungan, emr_no, emr_perawat, keluhan, status) VALUES
          (1001, '20251225001', 2, 'Demam dan batuk','selesai'),
          (1002, '20251225002', 3, 'Sakit gigi','aktif')
        `);
        
        console.log('  ✓ Default visits created');
      }
    } else {
      console.log('🚀 Production Mode: Skipping default data insertion');
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

async function migrateAddEmrDokter() {
  const conn = await pool.getConnection();
  
  try {
    console.log('🔧 Checking emr_dokter column...');
    
    // Cek apakah kolom sudah ada
    const [columns] = await conn.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'kunjungan' 
      AND COLUMN_NAME = 'emr_dokter'
    `);
    
    if (columns.length === 0) {
      console.log('➕ Adding emr_dokter column...');
      
      await conn.query(`
        ALTER TABLE kunjungan 
        ADD COLUMN emr_dokter INT DEFAULT NULL
        AFTER emr_perawat
      `);
      
      console.log('✓ emr_dokter column added successfully');
    } else {
      console.log('✓ emr_dokter column already exists');
    }
    
  } catch (err) {
    console.error('❌ Migration error:', err);
  } finally {
    conn.release();
  }
}

async function fixVitalsDataTypes() {
  const conn = await pool.getConnection();
  
  try {
    console.log('🔧 Fixing vitals table data types...');
    
    // Get current column types
    const [columns] = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'vitals' 
      AND COLUMN_NAME IN ('bmi', 'kolesterol', 'asam_urat', 'suhu')
    `);
    
    const columnMap = {};
    columns.forEach(col => {
      columnMap[col.COLUMN_NAME] = col.COLUMN_TYPE;
    });
    
    // Fix BMI
    if (columnMap['bmi'] !== 'decimal(4,1)') {
      console.log('  🔧 Fixing BMI column...');
      await conn.query('ALTER TABLE vitals MODIFY COLUMN bmi DECIMAL(4,1) NULL');
      console.log('  ✓ BMI fixed to DECIMAL(4,1)');
    }
    
    // Fix Kolesterol
    if (columnMap['kolesterol'] !== 'int') {
      console.log('  🔧 Fixing kolesterol column...');
      await conn.query('ALTER TABLE vitals MODIFY COLUMN kolesterol INT NULL');
      console.log('  ✓ Kolesterol fixed to INT');
    }
    
    // Fix Asam Urat
    if (columnMap['asam_urat'] !== 'decimal(4,1)') {
      console.log('  🔧 Fixing asam_urat column...');
      await conn.query('ALTER TABLE vitals MODIFY COLUMN asam_urat DECIMAL(4,1) NULL');
      console.log('  ✓ Asam Urat fixed to DECIMAL(4,1)');
    }
    
    // Fix Suhu (presisi dari 4,2 ke 4,1)
    if (columnMap['suhu'] === 'decimal(4,2)') {
      console.log('  🔧 Fixing suhu column precision...');
      await conn.query('ALTER TABLE vitals MODIFY COLUMN suhu DECIMAL(4,1) NULL');
      console.log('  ✓ Suhu precision fixed to DECIMAL(4,1)');
    }
    
    console.log('✓ Vitals data types fixed successfully');
  } catch (err) {
    console.error('❌ Fix data types error:', err);
  } finally {
    conn.release();
  }
}


async function migratePelayananRSI() {
  const conn = await pool.getConnection();
  
  try {
    console.log('🔧 Checking pelayanan_rsi table...');
    
    const [tables] = await conn.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'pelayanan_rsi'
    `);
    
    if (tables.length === 0) {
      console.log('➕ Creating pelayanan_rsi table...');
      
      // ✅ PERBAIKAN: Pisahkan CREATE TABLE dan ADD CONSTRAINT
      await conn.query(`
        CREATE TABLE pelayanan_rsi (
          id INT AUTO_INCREMENT PRIMARY KEY,
          pelayanan_id INT NOT NULL,
          emr_no VARCHAR(11) NOT NULL,
          nama_pasien VARCHAR(100),
          tanggal_pelayanan DATE,
          unit VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_pelayanan_id (pelayanan_id),
          INDEX idx_emr_no (emr_no),
          INDEX idx_tanggal (tanggal_pelayanan),
          UNIQUE KEY unique_pelayanan_id (pelayanan_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      
      console.log('✓ Table created');
      
      // ✅ Tambah foreign key terpisah
      try {
        await conn.query(`
          ALTER TABLE pelayanan_rsi
          ADD CONSTRAINT pelayanan_rsi_ibfk_1 
          FOREIGN KEY (emr_no) 
          REFERENCES pasien(emr_no) 
          ON DELETE CASCADE
          ON UPDATE CASCADE
        `);
        console.log('✓ Foreign key added');
      } catch (fkErr) {
        console.warn('⚠️ Could not add foreign key:', fkErr.message);
      }
      
    } else {
      console.log('✓ pelayanan_rsi table already exists');
    }
    
  } catch (err) {
    console.error('❌ Migration pelayanan_rsi error:', err);
    // ✅ Jangan throw error, biar server tetap jalan
  } finally {
    conn.release();
  }
}


// Panggil setelah initDatabase()
initDatabase()
  .then(() => migrateAddEmrDokter())  
  .then(() => optimizeDatabase())
  .then(() => fixVitalsDataTypes())
  .then(() => migratePelayananRSI()) 
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
// ============================================================
// API ENDPOINTS - DOCTORS
// ============================================================

app.get('/api/doctors/list', requireAdminOrPerawat, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    
    // ✅ Ambil dari tabel DOKTER, bukan perawat
    const [doctors] = await conn.query(`
      SELECT 
        emr_dokter,
        nama,
        spesialisasi
      FROM dokter
      ORDER BY nama ASC
    `);
    
    conn.release();
    
    res.json({
      success: true,
      doctors: doctors,
      count: doctors.length
    });
  } catch (err) {
    console.error('❌ GET /api/doctors/list error:', err.message);
    if (conn) conn.release();
    res.status(500).json({
      success: false,
      error: err.message
    });
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
  
  // ✅ Format EMR sebagai VARCHAR(11)
  // const emrStr = String(emr_no).padStart(11, '0');

  // if (isNaN(idInt) || !emrStr || !tipe_device || !data) {
  //   return res.status(400).json({ error: 'Data tidak lengkap atau tidak valid' });
  // }
  const emrStr = String(emr_no);
  if (!emrStr || emrStr.trim() === '') {
    return res.status(400).json({ error: 'EMR tidak boleh kosong' });
  }


  let conn;
  try {
    conn = await pool.getConnection();
    
    // ✅ Verifikasi kunjungan exists dengan emr_no sebagai VARCHAR
    const [kunjunganCheck] = await conn.query(
      'SELECT id_kunjungan FROM kunjungan WHERE id_kunjungan = ? AND emr_no = ?',
      [idInt, emrStr]
    );
    
    if (kunjunganCheck.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'Kunjungan tidak ditemukan atau EMR tidak sesuai' });
    }
    
    let vitalsData = {
      emr_no: emrStr,
      id_kunjungan: idInt,
      heart_rate: null,
      respirasi: null,
      jarak_kasur_cm: null,
      glukosa: null,
      berat_badan_kg: null,
      sistolik: null,
      diastolik: null,
      fall_detected: 0,
      tinggi_badan_cm: null,
      bmi: null
      // ✅ TIDAK ADA emr_perawat dan emr_dokter karena tidak ada di tabel vitals
    };

    // Parse data berdasarkan tipe device
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

    // ✅ INSERT tanpa emr_perawat dan emr_dokter
    const [result] = await conn.query(
      `INSERT INTO vitals (
        emr_no,
        waktu,
        heart_rate,
        respirasi,
        jarak_kasur_cm,
        glukosa,
        berat_badan_kg,
        sistolik,
        diastolik,
        fall_detected,
        tinggi_badan_cm,
        bmi
      ) VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vitalsData.emr_no,
        vitalsData.heart_rate,
        vitalsData.respirasi,
        vitalsData.jarak_kasur_cm,
        vitalsData.glukosa,
        vitalsData.berat_badan_kg,
        vitalsData.sistolik,
        vitalsData.diastolik,
        vitalsData.fall_detected,
        vitalsData.tinggi_badan_cm,
        vitalsData.bmi
      ]
    );

    const vitalsId = result.insertId;

    console.log(`✓ Data vitals ID ${vitalsId} berhasil disimpan untuk EMR ${emrStr}`);

    await checkAndBroadcastFall(vitalsId, emrStr);
    
    conn.release();

    res.json({
      success: true,
      id: vitalsId,
      message: "Data berhasil disimpan"
    });
  } catch (err) {
    if (conn) conn.release();
    console.error('❌ ERROR di /simpan_data:', err.message);
    
    res.status(500).json({ 
      success: false,
      error: 'Database error: ' + err.message,
      code: err.code
    });
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
const emrStr = String(req.params.emr).trim();
if (!emrStr) {
  return res.status(400).json({ error: 'EMR tidak boleh kosong' });
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
    
    const params = [emrStr];
    
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
   MCU (MEDICAL CHECK UP) ROUTES
   ============================================================ */

// POST /api/mcu/save - Simpan data MCU lengkap
app.post('/api/mcu/save', requireLogin, async (req, res) => {
  const { 
    pelayanan_id,
    emr_no, 
    nama_pasien,
    tanggal_pelayanan,
    unit,
    waktu, 
    tinggi_badan_cm,
    berat_badan_kg,
    bmi,
    sistolik, 
    diastolik,
    heart_rate,
    respirasi,
    suhu,
    spo2,
    glukosa,
    asam_urat,
    kolesterol
  } = req.body;
  
  const emrStr = String(emr_no).trim();
  
  // ✅ DEBUG LOG
  console.log('=== MCU SAVE REQUEST ===');
  console.log('EMR:', emrStr);
  console.log('Nama:', nama_pasien);
  console.log('Pelayanan ID:', pelayanan_id);
  
  if (!emrStr || !nama_pasien) {
    console.log('❌ Validation failed: EMR or nama_pasien empty');
    return res.status(400).json({ 
      success: false, 
      error: 'EMR dan Nama Pasien harus diisi' 
    });
  }
  
  let conn;
  try {
    conn = await pool.getConnection();
    
    // ✅ STEP 1: Cek apakah pasien sudah ada
    const [existingPatient] = await conn.query(
      'SELECT emr_no, nama FROM pasien WHERE emr_no = ?',
      [emrStr]
    );
    
    let patientRegistered = existingPatient.length > 0;
    let finalNamaPasien = nama_pasien;
    
    // ✅ STEP 2: Handle patient registration
    if (patientRegistered) {
      // Patient exists - use database name
      finalNamaPasien = existingPatient[0].nama;
      console.log(`✓ Patient exists: ${finalNamaPasien} (${emrStr})`);
    } else {
      // New patient - register first
      console.log(`➕ Auto-registering: ${nama_pasien} (${emrStr})`);
      
      try {
        await conn.query(`
          INSERT INTO pasien (emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat)
          VALUES (?, ?, NULL, 'L', 'MCU', '')
        `, [emrStr, nama_pasien]);
        
        patientRegistered = true;
        finalNamaPasien = nama_pasien;
        console.log(`✓ Patient registered: ${nama_pasien}`);
        
      } catch (regErr) {
        if (regErr.code === 'ER_DUP_ENTRY') {
          // Race condition - patient was just registered
          const [recheck] = await conn.query(
            'SELECT nama FROM pasien WHERE emr_no = ?', 
            [emrStr]
          );
          finalNamaPasien = recheck[0].nama;
          patientRegistered = true;
        } else {
          throw regErr;
        }
      }
    }
    
    // ✅ STEP 3: Save pelayanan RSI if provided
    if (pelayanan_id && patientRegistered) {
      try {
        const [existingPelayanan] = await conn.query(
          'SELECT id FROM pelayanan_rsi WHERE pelayanan_id = ?',
          [pelayanan_id]
        );
        
        if (existingPelayanan.length === 0) {
          await conn.query(`
            INSERT INTO pelayanan_rsi (
              pelayanan_id, emr_no, nama_pasien, tanggal_pelayanan, unit
            ) VALUES (?, ?, ?, ?, ?)
          `, [pelayanan_id, emrStr, finalNamaPasien, tanggal_pelayanan, unit]);
          
          console.log(`✓ Pelayanan saved: ID ${pelayanan_id}`);
        }
      } catch (pelayananErr) {
        console.warn('⚠️ Could not save pelayanan:', pelayananErr.message);
      }
    }
    
    // ✅ STEP 4: Save MCU vitals data
    const [result] = await conn.query(`
      INSERT INTO vitals (
        emr_no,
        pelayanan_id,
        waktu,
        tinggi_badan_cm,
        berat_badan_kg,
        bmi,
        sistolik,
        diastolik,
        heart_rate,
        respirasi,
        suhu,
        spo2,
        glukosa,
        asam_urat,
        kolesterol
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      emrStr,
      pelayanan_id ? parseInt(pelayanan_id) : null,
      waktu || new Date(),
      tinggi_badan_cm ? parseInt(tinggi_badan_cm) : null,
      berat_badan_kg ? parseFloat(berat_badan_kg) : null,
      bmi ? parseFloat(bmi) : null,
      sistolik ? parseInt(sistolik) : null,
      diastolik ? parseInt(diastolik) : null,
      heart_rate ? parseInt(heart_rate) : null,
      respirasi ? parseInt(respirasi) : null,
      suhu ? parseFloat(suhu) : null,
      spo2 ? parseInt(spo2) : null,
      glukosa ? parseInt(glukosa) : null,
      asam_urat ? parseFloat(asam_urat) : null,
      kolesterol ? parseInt(kolesterol) : null
    ]);
    
    conn.release();
    
    console.log(`✓ MCU saved: ID ${result.insertId}, EMR ${emrStr}`);
    
    res.json({ 
      success: true, 
      id: result.insertId,
      patient_was_new: !existingPatient.length,
      message: existingPatient.length 
        ? 'Data MCU berhasil disimpan'
        : 'Pasien berhasil didaftarkan dan data MCU tersimpan'
    });
    
  } catch (err) {
    if (conn) conn.release();
    console.error('❌ MCU save error:', err.message);
    
    res.status(500).json({ 
      success: false, 
      error: 'Database error: ' + err.message 
    });
  }
});

// GET /api/mcu/patients - Dapatkan daftar pasien yang memiliki data MCU
app.get('/api/mcu/patients', requireLogin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    
    const [patients] = await conn.query(`
      SELECT DISTINCT p.* 
      FROM pasien p 
      INNER JOIN vitals v ON p.emr_no = v.emr_no
      WHERE v.bmi IS NOT NULL 
        OR v.kolesterol IS NOT NULL 
        OR v.asam_urat IS NOT NULL
      ORDER BY p.nama ASC
    `);
    
    conn.release();
    
    res.json({ 
      success: true, 
      patients: patients 
    });
  } catch (err) {
    if (conn) conn.release();
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

app.get('/api/mcu/detail/:id', requireLogin, async (req, res) => {
  const vitalId = parseInt(req.params.id);
  
  if (isNaN(vitalId)) {
    return res.status(400).json({ 
      success: false, 
      error: 'ID tidak valid' 
    });
  }
  
  let conn;
  try {
    conn = await pool.getConnection();
    const [results] = await conn.query(`
      SELECT v.*, p.nama, p.tanggal_lahir, p.jenis_kelamin, p.alamat
      FROM vitals v
      INNER JOIN pasien p ON v.emr_no = p.emr_no
      WHERE v.id = ?
    `, [vitalId]);
    
    conn.release();
    
    if (results.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Data tidak ditemukan' 
      });
    }
    
    res.json({ 
      success: true, 
      data: results[0] 
    });
  } catch (err) {
    if (conn) conn.release();
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});


// GET /api/mcu/by-patient/:emr - Dapatkan semua data MCU untuk pasien tertentu
app.get('/api/mcu/by-patient/:emr', requireLogin, async (req, res) => {
  const emrStr = String(req.params.emr).trim();
  
  // ✅ Hanya validasi tidak boleh kosong (tidak ada validasi format)
  if (!emrStr) {
    return res.status(400).json({ 
      success: false, 
      error: 'EMR tidak boleh kosong' 
    });
  }
  
  let conn;
  try {
    conn = await pool.getConnection();
    
    const [data] = await conn.query(`
      SELECT * FROM vitals 
      WHERE emr_no = ? 
        AND (bmi IS NOT NULL 
          OR kolesterol IS NOT NULL 
          OR asam_urat IS NOT NULL)
      ORDER BY waktu DESC
    `, [emrStr]);
    
    conn.release();
    
    res.json({ 
      success: true, 
      data: data 
    });
  } catch (err) {
    if (conn) conn.release();
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// ============================================
// ✅ PUBLIC API - GET DATA BY NOMOR LAYANAN
// ============================================
app.post('/api/external/get-layanan', async (req, res) => {
  const { no_layanan, api_key } = req.body;
  
  // Optional: Validasi API Key jika ada
  const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || 'darsinurse-default-key';
  
  if (!no_layanan) {
    return res.status(400).json({
      success: false,
      error: 'Nomor layanan harus diisi',
      timestamp: new Date().toISOString()
    });
  }
  
  // Jika ada API_KEY requirement, uncomment baris di bawah
  // if (api_key !== EXTERNAL_API_KEY) {
  //   return res.status(401).json({
  //     success: false,
  //     error: 'API Key tidak valid'
  //   });
  // }
  
  let conn;
  try {
    conn = await pool.getConnection();
    
    // ✅ Query: Cari kunjungan berdasarkan nomor layanan
    // Nomor layanan disimpan di table kunjungan (kolom nomor_layanan/id_kunjungan)
    const [kunjunganResults] = await conn.query(`
      SELECT 
        k.id_kunjungan,
        k.emr_no,
        k.emr_perawat,
        k.tanggal_kunjungan,
        k.keluhan,
        k.status,
        p.nama AS nama_pasien,
        p.tanggal_lahir,
        p.jenis_kelamin,
        p.poli,
        p.alamat,
        pr.nama AS nama_perawat
      FROM kunjungan k
      LEFT JOIN pasien p ON k.emr_no = p.emr_no
      LEFT JOIN perawat pr ON k.emr_perawat = pr.emr_perawat
      WHERE k.id_kunjungan = ? OR CAST(k.id_kunjungan AS CHAR) = ?
      LIMIT 1
    `, [parseInt(no_layanan) || 0, String(no_layanan)]);
    
    if (kunjunganResults.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Data layanan tidak ditemukan',
        no_layanan: no_layanan,
        timestamp: new Date().toISOString()
      });
    }
    
    const kunjungan = kunjunganResults[0];
    
    // ✅ Query: Ambil semua measurement/vital data untuk kunjungan ini
    const [vitalsResults] = await conn.query(`
      SELECT *
      FROM vitals
      WHERE id_kunjungan = ?
      ORDER BY waktu DESC
    `, [kunjungan.id_kunjungan]);
    
    // ✅ Query: Ambil data measurement lainnya (glukosa, bp, etc)
    const [measurementResults] = await conn.query(`
      SELECT *
      FROM measurement_data
      WHERE id_kunjungan = ?
      ORDER BY waktu DESC
    `, [kunjungan.id_kunjungan]);
    
    conn.release();
    
    // ✅ Format response
    const age = new Date().getFullYear() - new Date(kunjungan.tanggal_lahir).getFullYear();
    const latestVital = vitalsResults.length > 0 ? vitalsResults[0] : null;
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        // Data Layanan/Kunjungan
        layanan: {
          id_kunjungan: kunjungan.id_kunjungan,
          no_layanan: kunjungan.id_kunjungan,
          tanggal_kunjungan: kunjungan.tanggal_kunjungan,
          keluhan: kunjungan.keluhan,
          status: kunjungan.status
        },
        
        // Data Pasien
        pasien: {
          emr_no: kunjungan.emr_no,
          nama: kunjungan.nama_pasien,
          tanggal_lahir: kunjungan.tanggal_lahir,
          umur: age,
          jenis_kelamin: kunjungan.jenis_kelamin,
          poli: kunjungan.poli,
          alamat: kunjungan.alamat
        },
        
        // Data Perawat
        perawat: {
          emr_perawat: kunjungan.emr_perawat,
          nama: kunjungan.nama_perawat
        },
        
        // Data Vital Signs (Latest)
        vital_terbaru: latestVital ? {
          waktu: latestVital.waktu,
          heart_rate: latestVital.heart_rate,
          sistolik: latestVital.sistolik,
          diastolik: latestVital.diastolik,
          respirasi: latestVital.respirasi,
          glukosa: latestVital.glukosa,
          berat_badan_kg: latestVital.berat_badan_kg,
          tinggi_badan_cm: latestVital.tinggi_badan_cm,
          bmi: latestVital.bmi
        } : null,
        
        // Riwayat Vital Signs
        riwayat_vitals: vitalsResults,
        
        // Measurement data lainnya
        measurement_data: measurementResults
      },
      meta: {
        total_vitals: vitalsResults.length,
        total_measurements: measurementResults.length
      }
    });
    
  } catch (err) {
    console.error('❌ External API Error:', err.message);
    
    if (conn) conn.release();
    
    res.status(500).json({
      success: false,
      error: 'Gagal mengambil data: ' + err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// ✅ ALTERNATIVE: GET DATA BY EMR (Nomor Rekam Medis)
// ============================================
app.post('/api/external/get-by-emr', async (req, res) => {
  const { emr_no, api_key } = req.body;
  
  if (!emr_no) {
    return res.status(400).json({
      success: false,
      error: 'EMR (nomor rekam medis) harus diisi',
      timestamp: new Date().toISOString()
    });
  }
  
  let conn;
  try {
    conn = await pool.getConnection();
    
    // ✅ Query: Ambil data pasien
    const [pasienResults] = await conn.query(`
      SELECT * FROM pasien WHERE emr_no = ?
    `, [String(emr_no)]);
    
    if (pasienResults.length === 0) {
      conn.release();
      return res.status(404).json({
        success: false,
        error: 'Pasien tidak ditemukan',
        emr_no: emr_no,
        timestamp: new Date().toISOString()
      });
    }
    
    const pasien = pasienResults[0];
    
    // ✅ Query: Ambil semua kunjungan pasien
    const [kunjunganResults] = await conn.query(`
      SELECT * FROM kunjungan WHERE emr_no = ? ORDER BY tanggal_kunjungan DESC
    `, [String(emr_no)]);
    
    // ✅ Query: Ambil semua vital data pasien
    const [vitalsResults] = await conn.query(`
      SELECT * FROM vitals WHERE emr_no = ? ORDER BY waktu DESC
    `, [String(emr_no)]);
    
    conn.release();
    
    const age = new Date().getFullYear() - new Date(pasien.tanggal_lahir).getFullYear();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        pasien: {
          emr_no: pasien.emr_no,
          nama: pasien.nama,
          tanggal_lahir: pasien.tanggal_lahir,
          umur: age,
          jenis_kelamin: pasien.jenis_kelamin,
          poli: pasien.poli,
          alamat: pasien.alamat,
          created_at: pasien.created_at
        },
        kunjungan: kunjunganResults,
        riwayat_vitals: vitalsResults
      },
      meta: {
        total_kunjungan: kunjunganResults.length,
        total_vitals: vitalsResults.length
      }
    });
    
  } catch (err) {
    console.error('❌ External API Error:', err.message);
    
    if (conn) conn.release();
    
    res.status(500).json({
      success: false,
      error: 'Gagal mengambil data: ' + err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/mcu/print/:id - Generate HTML untuk print MCU
app.get('/api/mcu/print/:id', requireLogin, async (req, res) => {
  const vitalId = parseInt(req.params.id);
  
  if (isNaN(vitalId)) {
    return res.send('ID tidak valid');
  }
  
  let conn;
  try {
    conn = await pool.getConnection();
    
    const [results] = await conn.query(`
      SELECT 
        v.*, 
        p.nama, 
        p.tanggal_lahir, 
        p.jenis_kelamin, 
        p.alamat, 
        p.poli
      FROM vitals v
      INNER JOIN pasien p ON v.emr_no = p.emr_no
      WHERE v.id = ?
    `, [vitalId]);
    
    conn.release();
    
    if (results.length === 0) {
      return res.send('Data tidak ditemukan');
    }
    
    const data = results[0];
    
    // ✅ Generate HTML untuk print
    const html = generateMCUHTML(data);
    res.send(html);
  } catch (err) {
    res.send('Error: ' + err.message);
  }
});

// ✅ Function untuk generate HTML MCU PROFESIONAL
// ✅ Function untuk generate HTML MCU PROFESIONAL - A4 PERFECT
function generateMCUHTML(data) {
  const birthDate = new Date(data.tanggal_lahir);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  const gender = data.jenis_kelamin === 'L' ? 'Laki-laki' : 'Perempuan';
  
  // Format tanggal
  const formatDateShort = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };
  
  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const date = d.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const time = d.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${date}, Pukul ${time} WIB`;
  };
  
  return `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Surat Keterangan Medical Check Up - ${data.nama}</title>
  <style>
    @page {
      size: A4;
      margin: 15mm;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 11pt;
      line-height: 1.4;
      color: #000;
      background: #fff;
      width: 210mm;
      margin: 0 auto;
      padding: 10mm;
    }
    
    .container {
      width: 100%;
      max-width: 190mm;
      margin: 0 auto;
    }
    
    /* Header */
    .header {
      margin-bottom: 15px;
    }

    .header-top {
      display: table;
      width: 100%;
      margin-bottom: 10px;
    }

    .logo-left,
    .header-center,
    .logo-right {
      display: table-cell;
      vertical-align: middle;
    }

    .logo-left,
    .logo-right {
      width: 80px;
      text-align: center;
    }

    .logo-rsi {
      width: 75px;
      height: 75px;
      object-fit: contain;
    }

    .header-center {
      text-align: center;
      padding: 0 15px;
    }

    .header-center h1 {
      font-size: 18pt;
      font-weight: bold;
      color: #00695c;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .header-center .subtitle {
      font-size: 10pt;
      color: #004d40;
      font-weight: 600;
      margin-bottom: 6px;
      font-style: italic;
    }

    .header-center .address {
      font-size: 9pt;
      color: #333;
      margin: 1px 0;
      line-height: 1.3;
    }

    .header-center .contact {
      font-size: 8pt;
      color: #555;
      margin-top: 3px;
    }

    .header-line {
      border-bottom: 2.5px solid #00695c;
      margin-bottom: 3px;
    }

    .header-line-thin {
      border-bottom: 1px solid #00695c;
      margin-bottom: 15px;
    }
    
    /* Judul Dokumen */
    .document-title {
      text-align: center;
      margin: 12px 0;
      padding: 8px;
      background: #00695c;
      color: white;
      border-radius: 3px;
    }

    .document-title h2 {
      font-size: 13pt;
      font-weight: bold;
      letter-spacing: 1.5px;
    }

    /* Pembuka */
    .opening {
      text-align: justify;
      margin: 12px 0;
      text-indent: 40px;
      font-size: 10.5pt;
    }
    
    /* Section */
    .section {
      margin: 10px 0;
    }
    
    .section-title {
      font-size: 11pt;
      font-weight: bold;
      color: #00695c;
      border-bottom: 1.5px solid #00695c;
      padding-bottom: 3px;
      margin-bottom: 6px;
    }
    
    /* Data Pasien Table */
    .patient-info {
      width: 100%;
      margin: 6px 0;
      border-collapse: collapse;
    }
    
    .patient-info td {
      padding: 3px 0;
      font-size: 10pt;
      vertical-align: top;
    }
    
    .patient-info td:first-child {
      width: 140px;
      font-weight: bold;
    }
    
    .patient-info td:nth-child(2) {
      width: 15px;
      text-align: center;
    }
    
    /* Results Table */
    .results-table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0;
      font-size: 9.5pt;
    }
    
    .results-table thead {
      background: #00695c;
      color: white;
    }
    
    .results-table th,
    .results-table td {
      border: 1px solid #333;
      padding: 5px 8px;
      text-align: left;
    }
    
    .results-table th {
      font-weight: bold;
      text-align: center;
      font-size: 9.5pt;
    }
    
    .results-table .reference {
      text-align: center;
      color: #666;
      font-size: 8.5pt;
      font-style: italic;
    }
    
    .results-table tbody tr:nth-child(even) {
      background: #f9f9f9;
    }
    
    .results-table .param-name {
      font-weight: bold;
    }
    
    .results-table .result-value {
      text-align: center;
      font-weight: bold;
      font-size: 10pt;
    }
    
    .results-table .unit {
      text-align: center;
      color: #666;
      font-size: 9pt;
    }
    
    .results-table .category-header {
      background: #e0f2f1 !important;
      font-weight: bold;
      text-align: center;
      color: #00695c;
      font-size: 9.5pt;
    }
    
    /* Penutup */
    .closing {
      margin: 12px 0;
      text-align: justify;
      font-size: 10.5pt;
    }
    
    /* Signature */
    .signature-section {
      margin-top: 25px;
      display: table;
      width: 100%;
    }
    
    .signature-box {
      display: table-cell;
      width: 50%;
      text-align: center;
      vertical-align: top;
      font-size: 10pt;
    }
    
    .signature-line {
      margin-top: 60px;
      border-top: 1px solid #000;
      padding-top: 4px;
      font-weight: bold;
      display: inline-block;
      min-width: 150px;
    }
    
    /* Footer */
    .print-info {
      font-size: 8pt;
      color: #999;
      text-align: center;
      margin-top: 20px;
      border-top: 1px solid #ddd;
      padding-top: 8px;
    }
    
    .print-info p {
      margin: 2px 0;
    }
    
    /* Print Styles */
    @media print {
      body {
        width: 210mm;
        height: 297mm;
        margin: 0;
        padding: 15mm;
      }
      
      .container {
        page-break-inside: avoid;
      }
      
      .results-table {
        page-break-inside: avoid;
      }
      
      .signature-section {
        page-break-inside: avoid;
      }
      
      /* Force exact colors */
      * {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header with Logo -->
    <div class="header">
      <div class="header-top">
        <!-- Logo Kiri -->
        <div class="logo-left">
          <img src="https://rsisurabaya.com/wp-content/uploads/2018/10/logo-web-rsi.png" 
              alt="Logo RSI" 
              class="logo-rsi" 
              onerror="this.style.display='none'">
        </div>
        
        <!-- Info Tengah -->
        <div class="header-center">
          <h1>RS Islam Surabaya A. Yani</h1>
          <div class="subtitle">Kesembuhan datang dari Allah, keselamatan dan kepuasan pasien tanggung jawab kami</div>
          <div class="address">Jl. Achmad Yani No.2-4, Wonokromo</div>
          <div class="contact">
            Telp: 031-8284505-07 | Fax: 031-8284486 | Email: rsiayani@yahoo.co.id
          </div>
        </div>
        
        <!-- Logo Kanan (placeholder untuk simetri) -->
        <div class="logo-right">
          <!-- Kosong atau logo tambahan -->
        </div>
      </div>
      
      <!-- Garis Double -->
      <div class="header-line"></div>
      <div class="header-line-thin"></div>
    </div>
    
    <!-- Judul Dokumen -->
    <div class="document-title">
      <h2>SURAT KETERANGAN MEDICAL CHECK UP</h2>
    </div>
    
    <!-- Pembuka -->
    <div class="opening">
      Yang bertanda tangan di bawah ini, dokter/petugas medis pada Rumah Sakit Islam Surabaya, 
      menerangkan bahwa telah dilakukan pemeriksaan kesehatan (Medical Check Up) terhadap:
    </div>
    
    <!-- Data Pasien -->
    <div class="section">
      <div class="section-title">📋 IDENTITAS PASIEN</div>
      <table class="patient-info">
        <tr>
          <td>Nama Lengkap</td>
          <td>:</td>
          <td>${data.nama || '-'}</td>
        </tr>
        <tr>
          <td>Nomor Rekam Medis</td>
          <td>:</td>
          <td>${data.emr_no || '-'}</td>
        </tr>
        <tr>
          <td>Jenis Kelamin</td>
          <td>:</td>
          <td>${gender}</td>
        </tr>
        <tr>
          <td>Tanggal Pemeriksaan</td>
          <td>:</td>
          <td>${formatDateTime(data.waktu)}</td>
        </tr>
      </table>
    </div>
    
    <!-- Hasil Pemeriksaan -->
    <div class="section">
      <div class="section-title">🔬 HASIL PEMERIKSAAN</div>
      
      <table class="results-table">
        <thead>
          <tr>
            <th style="width: 40%;">Parameter Pemeriksaan</th>
            <th style="width: 20%;">Hasil</th>
            <th style="width: 15%;">Satuan</th>
            <th style="width: 25%;">Nilai Normal/Referensi</th>
          </tr>
        </thead>
        <tbody>
          <!-- Antropometri -->
          <tr>
            <td colspan="4" class="category-header">ANTROPOMETRI</td>
          </tr>
          <tr>
            <td class="param-name">Tinggi Badan</td>
            <td class="result-value">${data.tinggi_badan_cm || '-'}</td>
            <td class="unit">cm</td>
            <td class="reference">-</td>
          </tr>
          <tr>
            <td class="param-name">Berat Badan</td>
            <td class="result-value">${data.berat_badan_kg || '-'}</td>
            <td class="unit">kg</td>
            <td class="reference">-</td>
          </tr>
          <tr>
            <td class="param-name">IMT (indeks massa tubuh)</td>
            <td class="result-value">${data.bmi || '-'}</td>
            <td class="unit">kg/m²</td>
            <td class="reference">18,5 - 24,9</td>
          </tr>
          
          <!-- Vital Signs -->
          <tr>
            <td colspan="4" class="category-header">VITAL SIGNS</td>
          </tr>
          <tr>
            <td class="param-name">Tekanan Darah</td>
            <td class="result-value">${data.sistolik || '-'}/${data.diastolik || '-'}</td>
            <td class="unit">mmHg</td>
            <td class="reference">&lt;120/&lt;80</td>
          </tr>
          <tr>
            <td class="param-name">Heart Rate</td>
            <td class="result-value">${data.heart_rate || '-'}</td>
            <td class="unit">bpm</td>
            <td class="reference">60-100</td>
          </tr>
          <tr>
            <td class="param-name">Respiratory Rate</td>
            <td class="result-value">${data.respirasi || '-'}</td>
            <td class="unit">per menit</td>
            <td class="reference">12-20</td>
          </tr>
          <tr>
            <td class="param-name">Suhu Tubuh</td>
            <td class="result-value">${data.suhu || '-'}</td>
            <td class="unit">°C</td>
            <td class="reference">36,5 - 37,5</td>
          </tr>
          <tr>
            <td class="param-name">Saturasi Oksigen (SpO2)</td>
            <td class="result-value">${data.spo2 || '-'}</td>
            <td class="unit">%</td>
            <td class="reference">95 - 100</td>
          </tr>
          
          <!-- Laboratorium -->
          <tr>
            <td colspan="4" class="category-header">PEMERIKSAAN LABORATORIUM</td>
          </tr>
          <tr>
            <td class="param-name">Glukosa Darah (Puasa)</td>
            <td class="result-value">${data.glukosa || '-'}</td>
            <td class="unit">mg/dL</td>
            <td class="reference">70 - 100</td>
          </tr>
          <tr>
            <td class="param-name">Asam Urat</td>
            <td class="result-value">${data.asam_urat || '-'}</td>
            <td class="unit">mg/dL</td>
            <td class="reference">Pria: 3,5-7,2<br/>Wanita: 2,6-6,0</td>
          </tr>
          <tr>
            <td class="param-name">Kolesterol Total</td>
            <td class="result-value">${data.kolesterol || '-'}</td>
            <td class="unit">mg/dL</td>
            <td class="reference">&lt;200</td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- Penutup -->
    <div class="closing">
      Demikian surat keterangan ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.
    </div>
    
    <!-- Footer -->
    <div class="print-info">
      <p>Dokumen dicetak melalui sistem Darsinurse Gateway</p>
      <p>Dicetak pada: ${new Date().toLocaleString('id-ID')} WIB</p>
      <p>© 2025 RS Islam Surabaya | Powered by Hint-Lab Team</p>
    </div>
  </div>
  
  <script>
    // Auto-print saat load (optional)
    window.onload = function() {
      setTimeout(() => window.print(), 500);
    };
  </script>
</body>
</html>
  `;
}
// Fetch pelayanan data from RSI API
/* ============================================================
   RSI API INTEGRATION
   ============================================================ */
const axios = require('axios');

// Fetch pelayanan data from RSI API
app.post('/api/rsi/get-pelayanan', requireLogin, async (req, res) => {
  const { id_pelayanan } = req.body;
  
  if (!id_pelayanan) {
    return res.status(400).json({
      success: false,
      error: 'ID Pelayanan harus diisi'
    });
  }
  
  try {
    console.log(`🔍 Fetching pelayanan data for ID: ${id_pelayanan}`);
    
    const response = await axios.post(
      'https://api.rsisurabaya.com:8008/registration/get-pelayanan-by-id',
      { id_pelayanan: parseInt(id_pelayanan) },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
        httpsAgent: new (require('https').Agent)({
          rejectUnauthorized: false
        })
      }
    );
    
    console.log('✓ RSI API Response:', response.data);
    
    // ✅ Parse response dari RSI API
    if (response.data && response.data.metadata && response.data.metadata.status) {
      const responseData = response.data.response;
      
      if (Array.isArray(responseData) && responseData.length > 0) {
        const data = responseData[0];
        
        // ✅ Cek apakah pasien sudah ada di database
        let conn = await pool.getConnection();
        const [existingPatient] = await conn.query(
          'SELECT * FROM pasien WHERE emr_no = ?',
          [data.no_rm]
        );
        conn.release();
        
        const patientExists = existingPatient.length > 0;
        
        res.json({
          success: true,
          data: {
            pelayanan_id: data.pelayanan_id,
            no_rm: data.no_rm,
            pasien: data.pasien,
            tgl: data.tgl,
            unit: data.unit
          },
          patient_exists: patientExists,
          patient_info: patientExists ? existingPatient[0] : null,
          message: patientExists 
            ? 'Pasien sudah terdaftar, data siap untuk MCU' 
            : 'Pasien belum terdaftar, akan otomatis didaftarkan saat simpan MCU'
        });
        
      } else {
        res.status(404).json({
          success: false,
          error: 'Data pelayanan tidak ditemukan'
        });
      }
    } else {
      res.status(404).json({
        success: false,
        error: 'Response tidak valid dari RSI API'
      });
    }
  } catch (err) {
    console.error('❌ RSI API Error:', err.message);
    
    if (err.code === 'ECONNABORTED') {
      res.status(408).json({
        success: false,
        error: 'Timeout connecting to RSI API'
      });
    } else if (err.response) {
      res.status(err.response.status).json({
        success: false,
        error: `RSI API Error: ${err.response.statusText}`
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Gagal mengambil data dari RSI API: ' + err.message
      });
    }
  }
});

app.post('/api/mcu/save-with-registration', requireLogin, async (req, res) => {
  const { 
    pelayanan_id,
    emr_no, 
    nama_pasien,
    tanggal_pelayanan,
    unit,
    waktu, 
    tinggi_badan_cm,
    berat_badan_kg,
    bmi,
    sistolik, 
    diastolik,
    heart_rate,
    respirasi,
    suhu,
    spo2,
    glukosa,
    asam_urat,
    kolesterol
  } = req.body;
  
  const emrStr = String(emr_no).trim();
  
  if (!emrStr || !nama_pasien) {
    return res.status(400).json({ 
      success: false, 
      error: 'EMR dan Nama Pasien harus diisi' 
    });
  }
  
  let conn;
  try {
    conn = await pool.getConnection();
    
    // ✅ STEP 1: Cek apakah pasien sudah ada
    const [existingPatient] = await conn.query(
      'SELECT emr_no FROM pasien WHERE emr_no = ?',
      [emrStr]
    );
    
    let patientRegistered = existingPatient.length > 0;
    
    // ✅ STEP 2: Jika belum ada, daftarkan pasien dulu
    if (!patientRegistered) {
      console.log(`➕ Auto-registering patient: ${nama_pasien} (${emrStr})`);
      
      try {
        await conn.query(`
          INSERT INTO pasien (emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat)
          VALUES (?, ?, NULL, 'L', 'MCU', '')
        `, [emrStr, nama_pasien]);
        
        console.log(`✓ Patient auto-registered: ${nama_pasien}`);
        patientRegistered = true;
        
      } catch (regErr) {
        if (regErr.code === 'ER_DUP_ENTRY') {
          console.log('⚠️ Patient already exists (race condition), continuing...');
          patientRegistered = true;
        } else {
          throw regErr;
        }
      }
    }
    
    // ✅ STEP 3: Simpan data pelayanan RSI jika ada
    if (pelayanan_id && patientRegistered) {
      try {
        const [existingPelayanan] = await conn.query(
          'SELECT id FROM pelayanan_rsi WHERE pelayanan_id = ?',
          [pelayanan_id]
        );
        
        if (existingPelayanan.length === 0) {
          await conn.query(`
            INSERT INTO pelayanan_rsi (
              pelayanan_id, emr_no, nama_pasien, tanggal_pelayanan, unit
            ) VALUES (?, ?, ?, ?, ?)
          `, [pelayanan_id, emrStr, nama_pasien, tanggal_pelayanan, unit]);
          
          console.log(`✓ Pelayanan data saved: ID ${pelayanan_id}`);
        }
      } catch (pelayananErr) {
        console.warn('⚠️ Could not save pelayanan data:', pelayananErr.message);
        // Continue anyway, pelayanan is optional
      }
    }
    
    // ✅ STEP 4: Simpan data MCU
    const [result] = await conn.query(`
      INSERT INTO vitals (
        emr_no,
        pelayanan_id,
        waktu,
        tinggi_badan_cm,
        berat_badan_kg,
        bmi,
        sistolik,
        diastolik,
        heart_rate,
        respirasi,
        suhu,
        spo2,
        glukosa,
        asam_urat,
        kolesterol
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      emrStr,
      pelayanan_id ? parseInt(pelayanan_id) : null,
      waktu || new Date(),
      tinggi_badan_cm ? parseInt(tinggi_badan_cm) : null,
      berat_badan_kg ? parseFloat(berat_badan_kg) : null,
      bmi ? parseFloat(bmi) : null,
      sistolik ? parseInt(sistolik) : null,
      diastolik ? parseInt(diastolik) : null,
      heart_rate ? parseInt(heart_rate) : null,
      respirasi ? parseInt(respirasi) : null,
      suhu ? parseFloat(suhu) : null,
      spo2 ? parseInt(spo2) : null,
      glukosa ? parseInt(glukosa) : null,
      asam_urat ? parseFloat(asam_urat) : null,
      kolesterol ? parseInt(kolesterol) : null
    ]);
    
    conn.release();
    
    console.log(`✓ MCU data saved: ID ${result.insertId}, EMR ${emrStr}${pelayanan_id ? `, Pelayanan ${pelayanan_id}` : ''}`);
    
    res.json({ 
      success: true, 
      id: result.insertId,
      patient_registered: !existingPatient.length,
      message: existingPatient.length 
        ? 'Data MCU berhasil disimpan'
        : 'Pasien berhasil didaftarkan dan data MCU tersimpan'
    });
    
  } catch (err) {
    if (conn) conn.release();
    console.error('❌ MCU save error:', err.message);
    
    res.status(500).json({ 
      success: false, 
      error: 'Database error: ' + err.message 
    });
  }
});


app.post('/api/rsi/save-pelayanan-after-registration', requireLogin, async (req, res) => {
  const { pelayanan_id, emr_no, nama_pasien, tanggal_pelayanan, unit } = req.body;
  
  if (!pelayanan_id || !emr_no) {
    return res.status(400).json({
      success: false,
      error: 'pelayanan_id dan emr_no harus diisi'
    });
  }
  
  let conn;
  try {
    conn = await pool.getConnection();
    
    const [pasienCheck] = await conn.query(
      'SELECT emr_no FROM pasien WHERE emr_no = ?',
      [emr_no]
    );
    
    if (pasienCheck.length === 0) {
      conn.release();
      return res.status(404).json({
        success: false,
        error: 'Pasien tidak ditemukan'
      });
    }
    
    const [existingPelayanan] = await conn.query(
      'SELECT id FROM pelayanan_rsi WHERE pelayanan_id = ?',
      [pelayanan_id]
    );
    
    if (existingPelayanan.length === 0) {
      await conn.query(`
        INSERT INTO pelayanan_rsi (
          pelayanan_id, emr_no, nama_pasien, tanggal_pelayanan, unit
        ) VALUES (?, ?, ?, ?, ?)
      `, [pelayanan_id, emr_no, nama_pasien, tanggal_pelayanan, unit]);
      
      console.log(`✓ Pelayanan data saved after registration: ID ${pelayanan_id}`);
    }
    
    conn.release();
    
    res.json({
      success: true,
      message: 'Data pelayanan berhasil disimpan'
    });
    
  } catch (err) {
    if (conn) conn.release();
    console.error('❌ Save pelayanan error:', err);
    res.status(500).json({
      success: false,
      error: 'Database error: ' + err.message
    });
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
      const emrStr = String(data.emr_no);  // ✅ Convert ke STRING

      // Insert to database
      const vitalsData = {
        emr_no: emrStr,
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
      `, [emrStr]);
      
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
// app.get('/validasi_pasien/:emr', requireLogin, async (req, res) => {
//   const emrStr = String(req.params.emr);  // ✅ Langsung STRING, jangan parseInt
  
//   if (!emrStr || emrStr.length !== 11 || !/^\d{11}$/.test(emrStr)) {
//     return res.status(400).json({ 
//       valid: false, 
//       error: 'EMR harus format 11 digit (YYYYMMDDNNN)' 
//     });
//   }
  
//   try {
//     const conn = await pool.getConnection();
//     const [rows] = await conn.query(
//       'SELECT * FROM pasien WHERE emr_no = ?',
//       [emrStr]  // ✅ Query dengan STRING
//     );
//     conn.release();

//     res.json({ valid: rows.length > 0, pasien: rows[0] || null });
//   } catch (err) {
//     res.status(500).json({ error: 'Database error: ' + err.message });
//   }
// });

app.get('/validasi_pasien/:emr', requireLogin, async (req, res) => {
  const emrStr = String(req.params.emr).trim();
  
  // ✅ Hanya validasi EMR tidak boleh kosong
  if (!emrStr) {
    return res.status(400).json({ 
      valid: false, 
      error: 'EMR tidak boleh kosong' 
    });
  }
  
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      'SELECT * FROM pasien WHERE emr_no = ?',
      [emrStr]
    );
    conn.release();

    res.json({ valid: rows.length > 0, pasien: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// app.post('/api/patients/register', requireLogin, async (req, res) => {
//   const { nama, tanggal_lahir, jenis_kelamin, poli, alamat } = req.body;
  
//   if (!nama || !tanggal_lahir || !jenis_kelamin || !poli) {
//     return res.status(400).json({ 
//       success: false,
//       error: 'Nama, Tanggal Lahir, Jenis Kelamin, dan Poli harus diisi' 
//     });
//   }

//   if (!['L', 'P'].includes(jenis_kelamin)) {
//     return res.status(400).json({ 
//       success: false,
//       error: 'Jenis Kelamin harus L atau P' 
//     });
//   }

//   let conn;
//   try {
//     conn = await pool.getConnection();
    
//     // ✅ Generate EMR dengan format YYYYMMDDNNN
//     const today = new Date();
//     const year = today.getFullYear();
//     const month = String(today.getMonth() + 1).padStart(2, '0');
//     const day = String(today.getDate()).padStart(2, '0');
//     const datePrefix = `${year}${month}${day}`;  // Contoh: 20251225
    
//     // Cari EMR terbaru untuk hari ini
//     const [lastEmrToday] = await conn.query(`
//       SELECT emr_no 
//       FROM pasien 
//       WHERE emr_no LIKE ? 
//       ORDER BY emr_no DESC 
//       LIMIT 1
//     `, [`${datePrefix}%`]);
    
//     // Tentukan nomor urut (NNN)
//     let nextNumber = 1;
//     if (lastEmrToday.length > 0) {
//       const lastEmr = lastEmrToday[0].emr_no;
//       const lastNumber = parseInt(lastEmr.substring(8));  // Ambil 3 digit terakhir
//       nextNumber = lastNumber + 1;
//     }
    
//     const numberStr = String(nextNumber).padStart(3, '0');
//     const emrNo = `${datePrefix}${numberStr}`;  // Contoh: 20251225001
    
//     // Insert pasien dengan EMR yang sudah di-generate
//     const [result] = await conn.query(
//       'INSERT INTO pasien (emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat) VALUES (?, ?, ?, ?, ?, ?)',
//       [emrNo, nama, tanggal_lahir, jenis_kelamin, poli, alamat || '']
//     );
    
//     conn.release();
    
//     console.log(`✓ Patient registered: EMR ${emrNo}, Name: ${nama}`);
    
//     res.json({ 
//       success: true, 
//       message: 'Pasien berhasil didaftarkan',
//       emr_no: emrNo
//     });
//   } catch (err) {
//     if (conn) conn.release();
    
//     console.error('❌ Register error:', err.message, err.code);
    
//     if (err.code === 'ER_DUP_ENTRY') {
//       return res.status(400).json({ 
//         success: false,
//         error: 'EMR sudah terdaftar' 
//       });
//     }
    
//     res.status(500).json({ 
//       success: false,
//       error: 'Database error: ' + err.message 
//     });
//   }
// });

// SESUDAH (✅ PERBAIKAN):
app.post('/api/patients/register', requireLogin, async (req, res) => {
  const { emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat } = req.body;
  
  // ✅ EMR wajib diisi dari frontend
  if (!emr_no || !nama || !tanggal_lahir || !jenis_kelamin || !poli) {
    return res.status(400).json({ 
      success: false,
      error: 'EMR, Nama, Tanggal Lahir, Jenis Kelamin, dan Poli harus diisi' 
    });
  }

  const emrStr = String(emr_no).trim();
  
  if (!emrStr) {
    return res.status(400).json({ 
      success: false,
      error: 'EMR tidak boleh kosong' 
    });
  }

  if (!['L', 'P'].includes(jenis_kelamin)) {
    return res.status(400).json({ 
      success: false,
      error: 'Jenis Kelamin harus L atau P' 
    });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    
    // ✅ Langsung insert dengan EMR yang diberikan user
    const [result] = await conn.query(
      'INSERT INTO pasien (emr_no, nama, tanggal_lahir, jenis_kelamin, poli, alamat) VALUES (?, ?, ?, ?, ?, ?)',
      [emrStr, nama, tanggal_lahir, jenis_kelamin, poli, alamat || '']
    );
    
    conn.release();
    
    console.log(`✓ Patient registered: EMR ${emrStr}, Name: ${nama}`);
    res.json({ 
      success: true, 
      message: 'Pasien berhasil didaftarkan',
      emr_no: emrStr
    });
  } catch (err) {
    if (conn) conn.release();
    
    console.error('❌ Register error:', err.message, err.code);
    
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ 
        success: false,
        error: 'EMR sudah terdaftar' 
      });
    }
    
    res.status(500).json({ 
      success: false,
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
const emrStr = String(req.params.emr).trim();
if (!emrStr) {
  return res.status(400).json({ error: 'EMR tidak boleh kosong' });
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
      [emrStr]
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

// GET patient info without poli (for MCU)
app.get('/api/patients/:emr/basic-info', requireLogin, async (req, res) => {
  const emrStr = String(req.params.emr).trim();
  if (!emrStr) {
    return res.status(400).json({ error: 'EMR tidak boleh kosong' });
  }
  
  try {
    const conn = await pool.getConnection();
    
    const [patients] = await conn.query(
      `SELECT 
        emr_no, 
        nama, 
        tanggal_lahir,
        jenis_kelamin, 
        alamat
      FROM pasien 
      WHERE emr_no = ?`,
      [emrStr]
    );
    
    conn.release();
    
    if (patients.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Pasien tidak ditemukan' 
      });
    }
    
    // Calculate age
    const patient = patients[0];
    const birthDate = new Date(patient.tanggal_lahir);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    res.json({ 
      success: true, 
      patient: {
        ...patient,
        age: age
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});


/* ============================================================
   VISIT ROUTES
   ============================================================ */
app.get('/api/patients/:emr/visits', requireLogin, async (req, res) => {
const emrStr = String(req.params.emr).trim();
if (!emrStr) {
  return res.status(400).json({ error: 'EMR tidak boleh kosong' });
}
  
  try {
    const conn = await pool.getConnection();
    
    let query = `
      SELECT k.*, p.nama as nama_perawat
      FROM kunjungan k
      JOIN perawat p ON k.emr_perawat = p.emr_perawat
      WHERE k.emr_no = ?
    `;
    
    const params = [emrStr];
    
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
  const { emr_no, keluhan, emr_dokter } = req.body;
  
  if (!emr_no) {
    return res.status(400).json({ 
      success: false,
      error: 'EMR Pasien harus diisi' 
    });
  }

  // ✅ EMR sudah format YYYYMMDDNNN dari frontend
  const emrStr = String(emr_no);
  const emrDokterInt = emr_dokter ? parseInt(emr_dokter) : null;
  
  let conn;
  try {
    conn = await pool.getConnection();
    
    // Cek pasien exists
    const [pasienCheck] = await conn.query(
      'SELECT emr_no FROM pasien WHERE emr_no = ?',
      [emrStr]
    );
    
    if (pasienCheck.length === 0) {
      conn.release();
      return res.status(404).json({ 
        success: false,
        error: 'Pasien EMR ' + emr_no + ' tidak ditemukan' 
      });
    }
    
    const [result] = await conn.query(
      'INSERT INTO kunjungan (emr_no, emr_perawat, keluhan, status, emr_dokter) VALUES (?, ?, ?, ?, ?)',
      [emrStr, req.session.emr_perawat, keluhan || '', 'aktif', emrDokterInt]
    );

    conn.release();
    
    const newIdKunjungan = result.insertId;
    
    console.log(`✓ Visit created: ID ${newIdKunjungan}, EMR ${emrStr}`);
    
    res.json({ 
      success: true, 
      message: 'Kunjungan berhasil dibuat',
      id_kunjungan: newIdKunjungan
    });
  } catch (err) {
    if (conn) conn.release();
    console.error('❌ Create visit error:', err.message);
    res.status(500).json({ 
      success: false,
      error: 'Database error: ' + err.message 
    });
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
  const emrStr = String(req.params.emr).trim();
if (!emrStr) {
  return res.status(400).json({ error: 'EMR tidak boleh kosong' });
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
    
    const params = [emrStr];
    
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

// ============================================
// GET ALL VISITS (untuk admin/perawat)
// ============================================
app.get('/api/visits/all', requireLogin, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    
    let query = `
      SELECT 
        k.id_kunjungan,
        k.emr_no,
        k.tanggal_kunjungan,
        k.keluhan,
        k.status,
        p.nama as nama_pasien,
        p.poli,
        pr.nama as nama_perawat
      FROM kunjungan k
      INNER JOIN pasien p ON k.emr_no = p.emr_no
      LEFT JOIN perawat pr ON k.emr_perawat = pr.emr_perawat
    `;
    
    const params = [];
    
    // Jika bukan admin, hanya tampilkan kunjungan milik perawat ini
    if (req.session.role !== 'admin') {
      query += ` WHERE k.emr_perawat = ?`;
      params.push(req.session.emr_perawat);
    }
    
    query += `
      ORDER BY 
        CASE WHEN k.status = 'aktif' THEN 0 ELSE 1 END,
        k.tanggal_kunjungan DESC
      LIMIT 100
    `;
    
    const [visits] = await conn.query(query, params);
    conn.release();
    
    res.json({ 
      success: true, 
      visits: visits 
    });
  } catch (err) {
    res.status(500).json({ 
      error: 'Database error: ' + err.message 
    });
  }
});