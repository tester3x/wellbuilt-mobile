// Focused unit tests for pure service modules (node environment).
// No React Native rendering here — RN/Expo screens are exercised on-device.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
};
