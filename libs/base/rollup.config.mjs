import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';

function getTargetDts() {
  return {
    input: './src/index.ts',
    output: [{ file: './dist/index.d.ts', format: 'es' }],
    plugins: [dts()]
  }
}

function getTargetES6() {
  return {
    input: './src/index.ts',
    preserveSymlinks: true,
    output: {
      dir: 'dist',
      preserveModules: true,
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      swc(),
      // terser()
    ]
  };
}

export default (args) => {
  return [getTargetES6(), getTargetDts()];
};
