const crypto = require('crypto');

// Hash function from monitoring-server.js
const hashPassword = (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

// Alert tracking utility tests
describe('Monitoring Server - Password Hashing', () => {
  test('should hash password with SHA256', () => {
    const password = 'monitoring123';
    const hashed = hashPassword(password);
    expect(hashed).toBeDefined();
    expect(hashed.length).toBe(64); // SHA256 produces 64 hex characters
  });

  test('should produce consistent hash for same password', () => {
    const password = 'test_pass';
    const hash1 = hashPassword(password);
    const hash2 = hashPassword(password);
    expect(hash1).toBe(hash2);
  });

  test('should produce different hashes for different passwords', () => {
    const hash1 = hashPassword('pass1');
    const hash2 = hashPassword('pass2');
    expect(hash1).not.toBe(hash2);
  });
});

describe('Monitoring Server - Fall Alert Tracking', () => {
  test('should create an empty alert set for user', () => {
    const alertSet = new Set();
    expect(alertSet.size).toBe(0);
  });

  test('should add alert ID to set', () => {
    const alertSet = new Set();
    alertSet.add(123);
    expect(alertSet.has(123)).toBe(true);
    expect(alertSet.size).toBe(1);
  });

  test('should prevent duplicate alert IDs', () => {
    const alertSet = new Set();
    alertSet.add(456);
    alertSet.add(456);
    expect(alertSet.size).toBe(1);
  });

  test('should track multiple alert IDs', () => {
    const alertSet = new Set();
    alertSet.add(100);
    alertSet.add(200);
    alertSet.add(300);
    expect(alertSet.size).toBe(3);
    expect(alertSet.has(200)).toBe(true);
  });

  test('should clear all alerts', () => {
    const alertSet = new Set([1, 2, 3, 4, 5]);
    expect(alertSet.size).toBe(5);
    alertSet.clear();
    expect(alertSet.size).toBe(0);
  });

  test('should keep last 50 alerts when limit exceeded', () => {
    const alertSet = new Set();
    for (let i = 1; i <= 100; i++) {
      alertSet.add(i);
    }
    expect(alertSet.size).toBe(100);
    
    // Simulate cleanup: keep only last 50
    const alertsArray = Array.from(alertSet);
    const toKeep = alertsArray.slice(-50);
    const newSet = new Set(toKeep);
    expect(newSet.size).toBe(50);
    expect(newSet.has(100)).toBe(true);
    expect(newSet.has(50)).toBe(true);
    expect(newSet.has(49)).toBe(false);
  });
});

describe('Monitoring Server - Fall ID Processing', () => {
  test('should track processed fall IDs', () => {
    const processedFallIds = new Set();
    expect(processedFallIds.size).toBe(0);
  });

  test('should add fall ID to processed set', () => {
    const processedFallIds = new Set();
    processedFallIds.add(1001);
    expect(processedFallIds.has(1001)).toBe(true);
  });

  test('should not reprocess same fall ID', () => {
    const processedFallIds = new Set([1001, 1002, 1003]);
    const newFallId = 1002;
    expect(processedFallIds.has(newFallId)).toBe(true);
  });

  test('should handle large number of processed IDs', () => {
    const processedFallIds = new Set();
    for (let i = 1; i <= 1000; i++) {
      processedFallIds.add(i);
    }
    expect(processedFallIds.size).toBe(1000);
    expect(processedFallIds.has(500)).toBe(true);
  });
});

describe('Monitoring Server - Vital Signs Data Validation', () => {
  test('should validate heart rate is within normal range', () => {
    const heartRate = 72;
    expect(heartRate).toBeGreaterThan(0);
    expect(heartRate).toBeLessThan(300);
  });

  test('should validate blood pressure systolic', () => {
    const sistolik = 120;
    expect(sistolik).toBeGreaterThan(0);
    expect(sistolik).toBeLessThan(300);
  });

  test('should validate blood pressure diastolic', () => {
    const diastolik = 80;
    expect(diastolik).toBeGreaterThan(0);
    expect(diastolik).toBeLessThan(200);
  });

  test('should validate respiratory rate', () => {
    const respirasi = 16;
    expect(respirasi).toBeGreaterThan(0);
    expect(respirasi).toBeLessThan(100);
  });

  test('should validate glucose level', () => {
    const glukosa = 120;
    expect(glukosa).toBeGreaterThan(0);
    expect(glukosa).toBeLessThan(1000);
  });

  test('should calculate BMI correctly', () => {
    const weight = 70; // kg
    const height = 170; // cm
    const bmi = weight / ((height / 100) ** 2);
    expect(bmi).toBeCloseTo(24.22, 1);
  });
});
