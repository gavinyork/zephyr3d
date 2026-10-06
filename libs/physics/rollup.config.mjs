import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';

function getTargetDts() {
  return {
    input: './src/index.ts',
    output: [{ file: './dist/index.d.ts', format: 'es' }],
    external: (id) => /@zephyr3d\//.test(id),
    plugins: [dts()]
  };
}

function getTargetES6() {
  return {
    external: (id) => /@zephyr3d\//.test(id),
    input: './src/index.ts',
    preserveSymlinks: true,
    output: {
      dir: 'dist',
      preserveModules: true,
      preserveModulesRoot: 'src',
      format: 'esm',
      sourcemap: true,
      hoistTransitiveImports: false
    },
    treeshake: {
      moduleSideEffects: false,
      propertyReadSideEffects: false,
      tryCatchDeoptimization: false
    },
    plugins: [
      nodeResolve(),
      swc({
        sourceMaps: true,
        inlineSourcesContent: false
      })
    ]
  };
}

export default () => {
  return [getTargetES6(), getTargetDts()];
};
