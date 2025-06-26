import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import dts from 'rollup-plugin-dts';

function getTargetDts() {
  return {
    input: './src/index.ts',
    output: [{ file: './dist/index.d.ts', format: 'es' }],
    plugins: [dts()]
  };
}

function getTargetES6() {
  return {
    external: (id) => /@zephyr3d\/base/.test(id) || /@zephyr3d\/device/.test(id),
    input: './src/index.ts',
    preserveSymlinks: true,
    output: {
      dir: 'dist',
      preserveModules: true,
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
      commonjs(),
      swc({
        sourceMaps: true,
        inlineSourcesContent: false
      })
      // terser()
    ]
  };
}

export default (args) => {
  return [getTargetES6(), getTargetDts()];
};
