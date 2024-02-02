import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import copy from 'rollup-plugin-copy';
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
    external: (id) => /@zephyr3d\/base/.test(id) || /@zephyr3d\/device/.test(id),
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
      copy({
        targets: [
          {
            src: './package.json',
            dest: 'dist',
            transform: contents => {
              const config = JSON.parse(contents.toString());
              config.main = './index.js';
              config.module = './index.js';
              config.types = './index.d.ts';
              return JSON.stringify(config, null, '  ');
            }
          },
          {
            src: './src',
            dest: 'dist'
          }
        ]
      })
    ]
  };
}

export default (args) => {
  return [getTargetES6(), getTargetDts()];
};
