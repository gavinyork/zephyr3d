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
    // Uses import.meta, which the CommonJS test build cannot compile
    '^\./basis_location$': '<rootDir>/src/stubs/basis_location.ts',
    '^\./draco_location$': '<rootDir>/src/stubs/draco_location.ts',
    // ESM-only entry, see the stub
    '^meshoptimizer/decoder$': '<rootDir>/src/stubs/meshopt_decoder.ts',
    '^meshoptimizer/simplifier$': '<rootDir>/src/stubs/meshopt_simplifier.ts',
    '^@zephyr3d/base$': '<rootDir>/../libs/base/src',
    '^@zephyr3d/device$': '<rootDir>/../libs/device/src',
    '^@zephyr3d/scene$': '<rootDir>/../libs/scene/src',
    '^@zephyr3d/scene/(.*)$': '<rootDir>/../libs/scene/src/$1',
    '^@zephyr3d/modelgen$': '<rootDir>/../libs/modelgen/src',
    '^@zephyr3d/procgen$': '<rootDir>/../libs/procgen/src',
    // Resolve to sources so tests never depend on a built backend
    '^@zephyr3d/backend-null$': '<rootDir>/../libs/backend-null/src'
  }
};
