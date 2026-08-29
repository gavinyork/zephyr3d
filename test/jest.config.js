const { createDefaultPreset } = require('ts-jest');

const preset = createDefaultPreset();
const transform = { ...preset.transform };

for (const [regex, transformer] of Object.entries(transform)) {
  if (transformer === 'ts-jest' || (Array.isArray(transformer) && transformer[0] === 'ts-jest')) {
    transform[regex] = ['ts-jest', { isolatedModules: false }];
  }
}

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: 'node',
  transform,
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFiles: ['<rootDir>/src/setupEnv.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/setup.ts'],
  snapshotResolver: '<rootDir>/snapshotResolver.js',
  moduleNameMapper: {
    '^@zephyr3d/base$': '<rootDir>/../libs/base/src',
    '^@zephyr3d/device$': '<rootDir>/../libs/device/src',
    '^@zephyr3d/scene$': '<rootDir>/../libs/scene/src',
    '^@zephyr3d/scene/(.*)$': '<rootDir>/../libs/scene/src/$1',
    // Resolve to sources so tests never depend on a built backend
    '^@zephyr3d/backend-null$': '<rootDir>/../libs/backend-null/src'
  }
};
