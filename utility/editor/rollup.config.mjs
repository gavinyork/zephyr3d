import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import path from 'path';
import copy from 'rollup-plugin-copy';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const destdir = path.join(__dirname, 'dist');

function getTargetServer() {
  return {
    input: './server/src/main.ts',
    preserveSymlinks: false,
    output: {
      dir: destdir,
      format: 'cjs',
      sourcemap: true
    },
    plugins: [
      json(),
      nodeResolve({
        preferBuiltins: true
      }),
      commonjs(),
      swc()
    ],
    external: [...Object.keys(process.binding('natives'))]
  };
}

function getTargetWeb() {
  return {
    input: './web/src/app.ts',
    preserveSymlinks: false,
    output: {
      file: path.join(destdir, 'static', 'js', `index.js`),
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      swc(),
      copy({
        targets: [
          {
            src: `./web/index.html`,
            dest: path.join(destdir, 'static')
          }
        ],
        verbose: true
      })
    ]
  };
}

export default (args) => {
  return [getTargetServer(), getTargetWeb()];
};
