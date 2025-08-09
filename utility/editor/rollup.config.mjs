import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import sourcemaps from 'rollup-plugin-sourcemaps2';
import path from 'path';
import copy from 'rollup-plugin-copy';
import { fileURLToPath } from 'url';
import commonjs from '@rollup/plugin-commonjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const destdir = path.join(__dirname, 'dist');

function getTargetWorker() {
  return {
    input: './src/workers/zip.ts',
    preserveSymlinks: false,
    output: {
      file: path.join(destdir, 'js', `zip.worker.js`),
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      sourcemaps(),
      swc({
        sourceMaps: true,
        inlineSourcesContent: false
      })
    ]
  };
}

function getTargetWeb() {
  return {
    input: './src/app.ts',
    preserveSymlinks: false,
    output: {
      file: path.join(destdir, 'js', `index.js`),
      format: 'esm',
      sourcemap: true
    },
    treeshake: {
      moduleSideEffects: (id, external) => {
        if (id.includes('@zephyr3d/')) {
          console.log('Preserving all exports for:', id);
          return true;
        }
        return false;
      },
      propertyReadSideEffects: true,
      unknownGlobalSideEffects: true
    },
    onwarn(warning, warn) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') {
        console.error(warning.message);
      }
    },
    plugins: [
      nodeResolve(),
      sourcemaps(),
      swc({
        sourceMaps: true,
        inlineSourcesContent: false
      }),
      commonjs(),
      copy({
        targets: [
          {
            src: './index.html',
            dest: destdir
          },
          {
            src: './assets',
            dest: destdir
          }
        ],
        verbose: true
      })
    ]
  };
}

export default (args) => {
  return [getTargetWorker(), getTargetWeb()];
};
