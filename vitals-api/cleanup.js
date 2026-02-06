const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, 'tmp', 'summary');
const RETENTION_DAYS = 14;

function cleanupTempFiles() {
  if (!fs.existsSync(BASE_DIR)) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  for (const roomId of fs.readdirSync(BASE_DIR)) {
    const roomDir = path.join(BASE_DIR, roomId);
    if (!fs.statSync(roomDir).isDirectory()) continue;

    for (const file of fs.readdirSync(roomDir)) {
      if (!file.endsWith('.log')) continue;

      const dateStr = file.replace('.log', '');
      const fileDate = new Date(dateStr);

      if (isNaN(fileDate)) continue;

      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(roomDir, file));
        console.log(`[CLEANUP] deleted ${roomId}/${file}`);
      }
    }

    // remove empty room directory
    if (fs.readdirSync(roomDir).length === 0) {
      fs.rmdirSync(roomDir);
    }
  }
}

module.exports = { cleanupTempFiles };
