const buffer = {};
let lastKnown = {};

function add(roomId, hr, rr, distance) {
  if (!buffer[roomId]) {
    buffer[roomId] = { hr: [], rr: [], lastDistance: null };
  }

  if (!lastKnown[roomId]) {
    lastKnown[roomId] = { hr: null, rr: null, lastDistance: null };
  }

  if (hr > 0) {
    buffer[roomId].hr.push(hr);
    lastKnown[roomId].hr = hr;
  }

  if (rr > 0) {
    buffer[roomId].rr.push(rr);
    lastKnown[roomId].rr = rr;
  }

  if (typeof distance === 'number') {
    buffer[roomId].lastDistance = Math.round(distance);
    lastKnown[roomId].lastDistance = Math.round(distance);
  }
}

function snapshot() {
  // deep-ish copy
  const copy = {};
  for (const roomId in buffer) {
    copy[roomId] = {
      hr: [...buffer[roomId].hr],
      rr: [...buffer[roomId].rr],
      lastDistance: buffer[roomId].lastDistance
    };
  }
  return copy;
}

function reset() {
  for (const k in buffer) delete buffer[k];
}
function getLastKnown(roomId) {
  return lastKnown[roomId] || {};
}

module.exports = { add, snapshot, reset, getLastKnown };
