import { nodeResolve } from '@rollup/plugin-node-resolve';
import sourcemaps from 'rollup-plugin-sourcemaps2';
import path from 'path';
import { fileURLToPath } from 'url';
import commonjs from '@rollup/plugin-commonjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const destdir = path.join(__dirname, 'dist');

function getTargetWeb(name) {
  return {
    input: `./node_modules/@zephyr3d/${name}/dist/index.js`,
    preserveSymlinks: false,
    output: {
      file: path.join(destdir, `modules/zephyr3d_${name}.js`),
      format: 'esm',
      sourcemap: true
    },
    external: (id) => {
      return id.startsWith('@zephyr3d/') && !id.startsWith(`@zephyr3d/${name}`);
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
      commonjs()
    ]
  };
}

export default (args) => {
  return ['base', 'device', 'scene', 'imgui', 'backend-webgl', 'backend-webgpu'].map((name) =>
    getTargetWeb(name)
  );
};
