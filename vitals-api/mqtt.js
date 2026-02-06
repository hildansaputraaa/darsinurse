const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const buffer = require('./buffer');
const fallDetection = require('./fallDetection');

const TMP_DIR = path.join(__dirname, 'tmp');

// ---- HA publish control ----
const discoveredDevices = new Set();
let mqttClient = null;
// NOTE:
// roomToDevice is in-memory only.
// After restart, up to 1 minute of HA state may be skipped.
// This is acceptable by design.

const roomToDevice = new Map();

function getTodayFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(TMP_DIR, `vitals-${date}.log`);
}

function getFallLogFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(TMP_DIR, `fall-${date}.log`);
}

function publishHADiscovery(client, deviceId) {
  if (discoveredDevices.has(deviceId)) return;

  discoveredDevices.add(deviceId);

  const baseStateTopic = `rsi/v1/device/${deviceId}/state`;
  const devicePayload = {
    identifiers: [deviceId],
    name: `RSI mmWave ${deviceId}`,
    manufacturer: 'MEDLOC',
    model: 'Vital Sensor'
  };

  const sensors = [
    {
      component: 'sensor',
      objectId: 'breath_rate',
      payload: {
        name: 'Breath Rate',
        unit_of_measurement: 'bpm',
        value_template: '{{ value_json.avg_breath_rate }}'
      }
    },
    {
      component: 'sensor',
      objectId: 'heart_rate',
      payload: {
        name: 'Heart Rate',
        unit_of_measurement: 'bpm',
        value_template: '{{ value_json.avg_heart_rate }}'
      }
    },
    {
      component: 'sensor',
      objectId: 'distance',
      payload: {
        name: 'Distance',
        unit_of_measurement: 'cm',
        value_template: '{{ value_json.distance }}'
      }
    }
  ];

  sensors.forEach(({ component, objectId, payload }) => {
    const topic = `homeassistant/${component}/${deviceId}/${objectId}/config`;

    client.publish(
      topic,
      JSON.stringify({
        ...payload,
        state_topic: baseStateTopic,
        unique_id: `${deviceId}_${objectId}`,
        device: devicePayload
      }),
      { retain: true }
    );
  });
}

function avg(arr) {
  if (!arr || !arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function start() {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR);
  }

  const client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username,
    password: config.mqtt.password
  });
  mqttClient = client;

  client.on('connect', () => {
    // Subscribe to both topics
    config.mqtt.topics.forEach(topic => {
      client.subscribe(topic);
      console.log(`MQTT subscribed to: ${topic}`);
    });
    console.log('MQTT connected');
  });

  client.on('offline', () => {
    console.error('MQTT offline');
  });

  client.on('error', err => {
    console.error('MQTT error', err);
  });

  client.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());

      if (topic === 'rsi/data') {

        // Vital signs data
        buffer.add(
          data.room_id,
          data.heart_rate,
          data.breath_rate,
          data.distance
        );

        buffer.add(
          data.room_id,
          data.heart_rate,
          data.breath_rate,
          data.distance
        );

        fs.appendFileSync(
          getTodayFile(),
          JSON.stringify(data) + '\n'
        );

        roomToDevice.set(data.room_id, data.device_id);
        publishHADiscovery(client, data.device_id);
        
      } 
      else if (topic === 'hitam') {
        // Fall detection data
        fallDetection.updateFallStatus(data.room_id, data.status);
        
        fs.appendFileSync(
          getFallLogFile(),
          JSON.stringify(data) + '\n'
        );
      }

    } catch (err) {
      console.error('Invalid MQTT payload', err);
    }
  });
}

function publishMinuteSummaryToHA(snapshot) {
  if (!mqttClient) return;
  const minute = new Date().toISOString().slice(0, 16);

  for (const roomId in snapshot) {
    const data = snapshot[roomId];

    const deviceId = roomToDevice.get(roomId);
    if (!deviceId) {
      console.warn(`[HA] No device mapping for room ${roomId}, skipping publish`);
      continue;
    }

    const avgHr = avg(data.hr);
    const avgRr = avg(data.rr);

    if (avgHr === null && avgRr === null) continue;

    const topic = `rsi/v1/device/${deviceId}/state`;

    mqttClient.publish(
      topic,
      JSON.stringify({
        device_id: deviceId,
        room_id: roomId,
        avg_heart_rate: avgHr,
        avg_breath_rate: avgRr,
        distance: data.lastDistance,
        timestamp: minute
      }),
      { retain: true }
    );
  }
}
module.exports = { start, publishMinuteSummaryToHA };
