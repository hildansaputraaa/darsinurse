const fs = require('fs');
const path = require('path');

function avg(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function writeMinuteSummary(snapshot) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);       // YYYY-MM-DD
  const minute = now.toISOString().slice(0, 16);   // YYYY-MM-DDTHH:MM

  for (const roomId in snapshot) {
    const data = snapshot[roomId];

    const line = JSON.stringify({
      t: minute,
      avg_hr: avg(data.hr),
      avg_rr: avg(data.rr),
      last_d: data.lastDistance,
      samples: Math.max(data.hr.length, data.rr.length)
    });

    const dir = path.join('tmp', 'summary', roomId);
    fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, `${day}.log`);
    fs.appendFileSync(file, line + '\n');
  }
}

module.exports = { writeMinuteSummary };
