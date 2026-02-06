const mqtt = require('./mqtt');
const aggregator = require('./aggregator');
const cleanup = require('./cleanup');
const config = require('./config');
const fs = require('fs');
const buffer = require('./buffer');
const { writeMinuteSummary } = require('./minuteSummary');
const fallAggregator = require('./fallAggregator');

mqtt.start();

// Minute summary
setInterval(() => {
  const snapshot = buffer.snapshot();
  aggregator.absorbMinute(snapshot);
  writeMinuteSummary(snapshot);
  mqtt.publishMinuteSummaryToHA(snapshot);

  buffer.reset();
}, 60 * 1000);

// Regular 15-minute aggregation
setInterval(() => {
  aggregator.flush15m().catch(console.error);
}, 15 * 60 * 1000);

// Fall detection check every minute
setInterval(() => {
  fallAggregator.checkAndInsertFalls().catch(err =>
    console.error('Fall aggregation error:', err)
  );
}, 60 * 1000);

// Cleanup once per day
setInterval(() => {
  cleanup.cleanupTempFiles();
}, 24 * 60 * 60 * 1000);

// Health check
setInterval(() => {
  fs.writeFileSync(
    'health.txt',
    new Date().toISOString()
  );
}, 60 * 1000);

console.log('Vitals ingestor running with fall detection');
