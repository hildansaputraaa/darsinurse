// Track fall status per room
const fallStatus = {};

function normalizeRoomId(roomId) {
  // Convert EXECUTIVE-3 to EXECUTIVE_3
  return roomId.replace(/-/g, '_');
}

function updateFallStatus(roomId, status) {
  const normalized = normalizeRoomId(roomId);
  
  if (status === 'PEOPLE_FALL') {
    fallStatus[normalized] = {
      isFalling: true,
      lastDetected: new Date()
    };
  } else if (status === 'NO_PEOPLE' || status === 'PEOPLE') {
    if (fallStatus[normalized]) {
      fallStatus[normalized].isFalling = false;
    }
  }
}

function getRoomFallStatus(roomId) {
  const normalized = normalizeRoomId(roomId);
  return fallStatus[normalized]?.isFalling || false;
}

function getAllFallingRooms() {
  return Object.keys(fallStatus)
    .filter(room => fallStatus[room].isFalling);
}

module.exports = { 
  updateFallStatus, 
  getRoomFallStatus, 
  getAllFallingRooms,
  normalizeRoomId
};
