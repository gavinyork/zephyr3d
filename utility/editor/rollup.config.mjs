import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import path from 'path';
import copy from 'rollup-plugin-copy';
import { fileURLToPath } from 'url';

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
    plugins: [nodeResolve(), swc()]
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
    plugins: [
      nodeResolve(),
      swc(),
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
