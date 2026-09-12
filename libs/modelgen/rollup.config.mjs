import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
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
    // This package is intentionally dependency-free so it can also be used as a
    // worker entry and run under plain node for tests.
    external: () => false,
    // `worker.ts` is a second entry rather than a re-export from `index.ts`:
    // importing it installs an `onmessage` handler, so it must stay opt-in.
    input: ['./src/index.ts', './src/worker.ts'],
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
