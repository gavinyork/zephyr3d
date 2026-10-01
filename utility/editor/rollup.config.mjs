import { nodeResolve } from '@rollup/plugin-node-resolve';
import sourcemaps from 'rollup-plugin-sourcemaps2';
import path from 'path';
import { fileURLToPath } from 'url';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const destdir = path.join(__dirname, 'dist');

// Decoders fetched at runtime relative to their package module (new URL('./basis/',
// import.meta.url) and './draco/'). Bundling a package into one module file moves
// that module, so its decoder directory has to move beside it.
const runtimeDecoders = {
  scene: 'asset/loaders/ktx2/basis',
  loaders: 'gltf/draco'
};

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
      commonjs(),
      ...(runtimeDecoders[name]
        ? [
            copy({
              targets: [
                {
                  src: `./node_modules/@zephyr3d/${name}/dist/${runtimeDecoders[name]}/*`,
                  dest: path.join(destdir, 'modules', path.basename(runtimeDecoders[name]))
                }
              ],
              hook: 'writeBundle'
            })
          ]
        : [])
    ]
  };
}

export default (args) => {
  return ['base', 'device', 'scene', 'loaders', 'imgui', 'backend-webgl', 'backend-webgpu'].map((name) =>
    getTargetWeb(name)
  );
};
