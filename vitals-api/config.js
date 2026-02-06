module.exports = {
  mqtt: {
    url: process.env.MQTT_URL || 'mqtt://103.106.72.181:1883',
    topics: ['rsi/data', 'hitam'], // Add new topic
    username: process.env.MQTT_USERNAME || 'MEDLOC',
    password: process.env.MQTT_PASSWORD || 'MEDLOC'
  },
  db: {
    host: process.env.DB_HOST || 'darsinurse-db',
    user: process.env.DB_USER || 'darsinurse',
    password: process.env.DB_PASSWORD || 'darsinurse123',
    database: process.env.DB_NAME || 'darsinurse'
  },
  fallbackEmr: process.env.FALLBACK_EMR || 'UNASSIGNED'
};
