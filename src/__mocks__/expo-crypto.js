// Manual mock for the `expo-crypto` native module so pure Node/jest unit tests
// can load modules that import it. Auto-applied to all tests; files that need
// specific behavior still override with their own jest.mock('expo-crypto', …).
//
// randomUUID() returns DETERMINISTIC, DISTINCT V4-shaped UUIDs (monotonic
// counter) so identity/uniqueness assertions are stable without real entropy.
let __uuidCounter = 0;

function randomUUID() {
  __uuidCounter += 1;
  // Vary the FIRST segment (like a real UUID) so any substring slice is unique.
  const head = __uuidCounter.toString(16).padStart(8, '0');
  const tail = __uuidCounter.toString(16).padStart(12, '0');
  // RFC4122 v4 shape: version nibble 4, variant nibble 8.
  return `${head}-0000-4000-8000-${tail}`;
}

async function getRandomBytesAsync(byteCount) {
  const out = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i += 1) out[i] = (i * 31 + 7) & 0xff;
  return out;
}

async function digestStringAsync(_algorithm, data) {
  return `sha256:${String(data).length}`;
}

module.exports = {
  __esModule: true,
  randomUUID,
  getRandomBytesAsync,
  digestStringAsync,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256', SHA512: 'SHA-512' },
  CryptoEncoding: { HEX: 'hex', BASE64: 'base64' },
};
