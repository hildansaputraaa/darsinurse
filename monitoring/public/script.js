// socket-client.js
const socket = io({
  transports: ['websocket', 'polling']
});

// LISTEN untuk fall alert
socket.on('fall-alert-broadcast', (alert) => {
  console.log('🚨 Fall Alert Received!', alert);
  
  // Show visual notification
  showFallAlert(alert);
  
  // Play sound
  playAlertSound();
  
  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('⚠️ FALL DETECTION!', {
      body: `Pasien EMR ${alert.emr_no} terdeteksi jatuh`,
      tag: 'fall-alert',
      requireInteraction: true
    });
  }
});

socket.on('fall-acknowledged-broadcast', (data) => {
  console.log('✓ Fall acknowledged');
  removeFallAlert(data.id);
});

function showFallAlert(alert) {
  // Tampilkan modal/toast/alert di layar
  const alertHtml = `
    <div class="fall-alert-notification" id="fall-${alert.id}">
      <div class="alert-content">
        <h3>🚨 FALL DETECTION</h3>
        <p>EMR: ${alert.emr_no}</p>
        <p>Perawat: ${alert.nama_perawat}</p>
        <button onclick="acknowledgeFall(${alert.id})">Acknowledge</button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', alertHtml);
}

function acknowledgeFall(id) {
  fetch(`/api/fall-detection/${id}/acknowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledged_by: 'USER' })
  });
}