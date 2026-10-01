import { nodeResolve } from '@rollup/plugin-node-resolve';
import { swc } from 'rollup-plugin-swc3';
import dts from 'rollup-plugin-dts';
import copy from 'rollup-plugin-copy';

const externals = [/@zephyr3d\/base/, /@zephyr3d\/device/];

function getTargetDts() {
  return {
    external: (id) => {
      for (const m of externals) {
        if (m.test(id)) {
          return true;
        }
      }
    },
    input: './src/index.ts',
    output: [{ file: './dist/index.d.ts', format: 'es' }],
    plugins: [
      dts({
        respectExternal: true,
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@zephyr3d/base': ['../base/dist/index.d.ts'],
            '@zephyr3d/device': ['../device/dist/index.d.ts']
          }
        }
      })
    ]
  };
}

function getTargetES6() {
  return {
    external: (id) => {
      for (const m of externals) {
        if (m.test(id)) {
          return true;
        }
      }
    },
    input: './src/index.ts',
    preserveSymlinks: true,
    output: {
      dir: 'dist',
      preserveModules: true,
      preserveModulesRoot: 'src',
      format: 'esm',
      sourcemap: true
    },
    onwarn(warning, warn) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') {
        console.error(warning.message);
      }
    },
    plugins: [
      nodeResolve(),
      swc({
        sourceMaps: true,
        inlineSourcesContent: false
      }),
      // The Basis transcoder is fetched at runtime relative to the KTX2 loader module
      // (see basis_location.ts), so it must sit beside that module in dist
      copy({
        targets: [{ src: 'src/asset/loaders/ktx2/basis/*', dest: 'dist/asset/loaders/ktx2/basis' }],
        hook: 'writeBundle'
      })
    ]
  };
}

export default (args) => {
  return [getTargetES6(), getTargetDts()];
};
