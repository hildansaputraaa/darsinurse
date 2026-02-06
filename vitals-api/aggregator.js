const db = require('./db');
const config = require('./config');

let acc = {}; // 15-minute accumulator

function average(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

/**
 * Absorb ONE minute snapshot
 * Called every minute
 */
function absorbMinute(minuteSnapshot) {
  for (const roomId in minuteSnapshot) {
    const data = minuteSnapshot[roomId];

    if (!acc[roomId]) {
      acc[roomId] = {
        hr: [],
        rr: [],
        lastDistance: null
      };
    }

    acc[roomId].hr.push(...data.hr);
    acc[roomId].rr.push(...data.rr);
    acc[roomId].lastDistance = data.lastDistance;
  }
}

/**
 * Flush 15-minute aggregate to DB
 * Called every 15 minutes
 */
async function flush15m() {
  const rooms = Object.keys(acc);
  if (!rooms.length) return;

  for (const roomId of rooms) {
    const avgHr = average(acc[roomId].hr);
    const avgRr = average(acc[roomId].rr);

    if (avgHr === null && avgRr === null) continue;

    let emrNo = await db.getEmrByRoom(roomId);
    if (!emrNo) emrNo = config.fallbackEmr;

    await db.insertVitals(
      emrNo,
      avgHr,
      avgRr,
      acc[roomId].lastDistance
    );
  }

  console.log(
    `[15M FLUSH] ${new Date().toISOString()} rooms=${rooms.length}`
  );

  acc = {}; // reset ONLY here
}

module.exports = { absorbMinute, flush15m };
