// Jest runs as CommonJS and cannot load meshoptimizer's ESM decoder entry. The
// package's CommonJS twin exports the decoder as module.exports, not by name, so
// it is re-exported here under the name the sources import.

export const MeshoptDecoder = require('meshoptimizer/decoder.cjs');
