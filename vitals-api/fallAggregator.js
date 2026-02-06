const buffer = require('./buffer');
const fallDetection = require('./fallDetection');
const db = require('./db');
const config = require('./config');

function average(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

async function checkAndInsertFalls() {
  const fallingRooms = fallDetection.getAllFallingRooms();
  if (!fallingRooms.length) return;

  const currentData = buffer.snapshot();

  for (const roomId of fallingRooms) {
    const data = currentData[roomId];

    const last = buffer.getLastKnown(roomId);

    const avgHr = data?.hr?.length
      ? average(data.hr)
      : last.hr ?? null;

    const avgRr = data?.rr?.length
      ? average(data.rr)
      : last.rr ?? null;

    const lastDistance =
      data?.lastDistance ?? last.lastDistance ?? null;


    let emrNo = await db.getEmrByRoom(roomId);
    if (!emrNo) emrNo = config.fallbackEmr;

    await db.insertFallVitals(
      emrNo,
      avgHr,
      avgRr,
      lastDistance
    );

    console.log(
      `[FALL ALERT] ${new Date().toISOString()} room=${roomId} emr=${emrNo} hr=${avgHr} rr=${avgRr}`
    );
  }
}

module.exports = { checkAndInsertFalls };
