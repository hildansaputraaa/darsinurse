const crypto = require('crypto');

// Hash function from server.js
const hashPassword = (password) => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

// Gender normalization function from server.js
function normalizeGender(jenis_kelamin) {
  if (!jenis_kelamin) return null;
  const jk = String(jenis_kelamin).trim().toUpperCase();
  const femaleKeys = ['P', 'PEREMPUAN', 'WANITA', 'F', 'FEMALE'];
  const maleKeys = ['L', 'LAKI', 'PRIA', 'M', 'MALE'];

  if (femaleKeys.some(k => jk.includes(k))) return 'P';
  if (maleKeys.some(k => jk.includes(k))) return 'L';
  return null;
}

describe('Rawat Jalan Server - Password Hashing', () => {
  test('should hash password with SHA256', () => {
    const password = 'test123';
    const hashed = hashPassword(password);
    expect(hashed).toBeDefined();
    expect(hashed.length).toBe(64); // SHA256 produces 64 hex characters
  });

  test('should produce consistent hash for same password', () => {
    const password = 'admin123';
    const hash1 = hashPassword(password);
    const hash2 = hashPassword(password);
    expect(hash1).toBe(hash2);
  });

  test('should produce different hashes for different passwords', () => {
    const hash1 = hashPassword('password1');
    const hash2 = hashPassword('password2');
    expect(hash1).not.toBe(hash2);
  });
});

describe('Rawat Jalan Server - Gender Normalization', () => {
  test('should normalize "P" to "P"', () => {
    expect(normalizeGender('P')).toBe('P');
  });

  test('should normalize "PEREMPUAN" to "P"', () => {
    expect(normalizeGender('PEREMPUAN')).toBe('P');
  });

  test('should normalize "WANITA" to "P"', () => {
    expect(normalizeGender('WANITA')).toBe('P');
  });

  test('should normalize "F" to "P"', () => {
    expect(normalizeGender('F')).toBe('P');
  });

  test('should normalize "FEMALE" to "P"', () => {
    expect(normalizeGender('FEMALE')).toBe('P');
  });

  test('should normalize "L" to "L"', () => {
    expect(normalizeGender('L')).toBe('L');
  });

  test('should normalize "LAKI" to "L"', () => {
    expect(normalizeGender('LAKI')).toBe('L');
  });

  test('should normalize "PRIA" to "L"', () => {
    expect(normalizeGender('PRIA')).toBe('L');
  });

  test('should normalize "M" to "L"', () => {
    expect(normalizeGender('M')).toBe('L');
  });

  test('should normalize "MALE" to "L"', () => {
    expect(normalizeGender('MALE')).toBe('L');
  });

  test('should handle case insensitivity', () => {
    expect(normalizeGender('perempuan')).toBe('P');
    expect(normalizeGender('LAKI-LAKI')).toBe('L');
  });

  test('should handle whitespace', () => {
    expect(normalizeGender('  P  ')).toBe('P');
    expect(normalizeGender('  PRIA  ')).toBe('L');
  });

  test('should return null for invalid gender', () => {
    expect(normalizeGender('X')).toBeNull();
    expect(normalizeGender('INVALID')).toBeNull();
  });

  test('should return null for null or undefined', () => {
    expect(normalizeGender(null)).toBeNull();
    expect(normalizeGender(undefined)).toBeNull();
  });
});
