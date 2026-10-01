import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';
import copy from 'rollup-plugin-copy';

function getTargetDts() {
  return {
    input: './src/index.ts',
    output: [{ file: './dist/index.d.ts', format: 'es' }],
    plugins: [dts()]
  };
}

function getTargetES6() {
  return {
    external: (id) =>
      /@zephyr3d\/base/.test(id) || /@zephyr3d\/device/.test(id) || /@zephyr3d\/scene/.test(id),
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
      }),
      // The Draco decoder is fetched at runtime relative to the glTF importer module
      // (see draco_location.ts), so it must sit beside that module in dist
      copy({
        targets: [{ src: 'src/gltf/draco/*', dest: 'dist/gltf/draco' }],
        hook: 'writeBundle'
      })
      // terser()
    ]
  };
}

export default (args) => {
  return [getTargetES6(), getTargetDts()];
};
