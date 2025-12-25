// ============================================================
// CONFIGURATION - READ FROM ENV
// ============================================================

module.exports = {
  // Database
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'darsinurse',
  },

  // Server
  server: {
    port: parseInt(process.env.MONITORING_PORT) || 5000,
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
  },

  // Session
  session: {
    secret: process.env.SESSION_SECRET || 'darsinurse-fallback-secret',
    name: 'monitoring_session',
    ttl: 24 * 60 * 60 * 1000, // 24 hours
  },

  // Cookie
  cookie: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: process.env.COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'lax' : 'lax'),
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  },

  // Proxy
  trustProxy: parseInt(process.env.TRUST_PROXY) || 1,

  // CORS
  cors: {
    origins: process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : [
          'https://gateway.darsinurse.hint-lab.id',
          'https://darsinurse.hint-lab.id',
          'http://localhost:3000',
          'http://localhost:5000'
        ],
  },

  // External Services
  rawajalanUrl: process.env.RAWAT_JALAN_URL || 'http://localhost:4000',
  metabaseUrl: process.env.METABASE_URL || 'https://metabase.darsinurse.hint-lab.id',
  metabaseSecret: process.env.METABASE_SECRET || '',
};