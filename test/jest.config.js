const { createDefaultPreset } = require('ts-jest');

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: 'node',
  transform: {
    ...tsJestTransformCfg
  },
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFilesAfterEnv: ['<rootDir>/src/setup.ts'],
  moduleNameMapper: {
    '^@zephyr3d/base$': '<rootDir>/../libs/base/src',
    '^@zephyr3d/scene$': '<rootDir>/../libs/scene/src',
    '^@zephyr3d/device$': '<rootDir>/../libs/device/src'
  }
};
