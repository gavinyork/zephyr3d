import { swc } from 'rollup-plugin-swc3';
import importCss from 'rollup-plugin-import-css';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import sourcemaps from 'rollup-plugin-sourcemaps2';
import path from 'path';
import copy from 'rollup-plugin-copy';
import { fileURLToPath } from 'url';
import commonjs from '@rollup/plugin-commonjs';
import { dir } from 'console';

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
      dir: path.join(destdir, 'js'),
      format: 'esm',
      sourcemap: true
    },
    treeshake: {
      moduleSideEffects: (id, external) => {
        return /[\\\/]zephyr3d[\\\/]libs[\\\/]/.test(id) || /monaco-editor/.test(id);
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
      nodeResolve({
        browser: true
      }),
      sourcemaps(),
      importCss({
        inline: true
      }),
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
          },
          {
            src: 'node_modules/monaco-editor/min/vs/language/**/*Worker.js',
            dest: `${destdir}/js/vs/language/`
          },
          {
            src: 'node_modules/monaco-editor/min/vs/loader.js',
            dest: `${destdir}/js/vs/`
          },
          {
            src: 'node_modules/monaco-editor/min/vs/editor/editor.main.css',
            dest: `${destdir}/js/vs/`
          },
          {
            src: 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js',
            dest: `${destdir}/js/vs/editor/`
          },
          {
            src: 'node_modules/monaco-editor/min/vs/base/worker/workerMain.js',
            dest: `${destdir}/js/vs/base/worker/`
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
