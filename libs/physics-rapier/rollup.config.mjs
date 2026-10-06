import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';
import copy from 'rollup-plugin-copy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rapierDir = path.dirname(require.resolve('@dimforge/rapier3d-simd/package.json'));
const rapierBundle = path.join(__dirname, 'dist', 'rapier', 'rapier.js');

/**
 * Rapier's `raw.js` imports `./rapier_wasm3d`, which imports the .wasm file as
 * an ES module - something only a bundler with a wasm plugin can satisfy. Point
 * that import at the wasm-bindgen glue instead; the module itself is fetched and
 * instantiated at runtime by rapier_loader.ts.
 */
function rapierWasmShim() {
  return {
    name: 'rapier-wasm-shim',
    resolveId(source, importer) {
      // Matched by path suffix: with preserveSymlinks the importer is the
      // node_modules link, not the resolved package directory.
      if (
        importer &&
        source === './rapier_wasm3d' &&
        /[\\/]@dimforge[\\/]rapier3d-simd[\\/]raw\.js$/.test(importer)
      ) {
        return path.join(path.dirname(importer), 'rapier_wasm3d_bg.js');
      }
      return null;
    }
  };
}

/**
 * In the main build, src/rapier_bundle.ts is not compiled but replaced by the
 * single-file Rapier bundle built from it below; `output.paths` maps the id to
 * that file. Only rapier_loader.ts, at the root of src, imports it.
 */
const RAPIER_BUNDLE_ID = 'zephyr3d-rapier-bundle';
function rapierBundleExternal() {
  return {
    name: 'rapier-bundle-external',
    resolveId(source) {
      return source === './rapier_bundle' ? { id: RAPIER_BUNDLE_ID, external: true } : null;
    }
  };
}

function getTargetDts() {
  return {
    input: './src/index.ts',
    output: [{ file: './dist/index.d.ts', format: 'es' }],
    external: (id) => /@zephyr3d\//.test(id) || /@dimforge\//.test(id),
    plugins: [dts()]
  };
}

/**
 * Rapier as one file. Its sources import each other in cycles; kept as separate
 * modules they would make every consumer's bundler warn about them.
 */
function getTargetRapier() {
  return {
    input: './src/rapier_bundle.ts',
    preserveSymlinks: true,
    output: {
      file: rapierBundle,
      format: 'esm',
      sourcemap: false
    },
    onwarn(warning, warn) {
      // Rapier's own cycles, resolved by bundling them into this one file.
      if (warning.code === 'CIRCULAR_DEPENDENCY' && /@dimforge/.test(warning.message)) {
        return;
      }
      warn(warning);
    },
    plugins: [
      rapierWasmShim(),
      nodeResolve(),
      swc({
        sourceMaps: false
      }),
      // The Rapier module is fetched at runtime relative to rapier_location.ts,
      // so it must sit beside the package's modules in dist, with its license.
      copy({
        targets: [
          { src: path.join(rapierDir, 'rapier_wasm3d_bg.wasm').replace(/\\/g, '/'), dest: 'dist/rapier' },
          { src: path.join(rapierDir, 'LICENSE').replace(/\\/g, '/'), dest: 'dist/rapier' }
        ],
        hook: 'writeBundle'
      })
    ]
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
      hoistTransitiveImports: false,
      paths: { [RAPIER_BUNDLE_ID]: './rapier/rapier.js' }
    },
    treeshake: {
      moduleSideEffects: false,
      propertyReadSideEffects: false,
      tryCatchDeoptimization: false
    },
    plugins: [
      rapierBundleExternal(),
      nodeResolve(),
      swc({
        sourceMaps: true,
        inlineSourcesContent: false
      })
    ]
  };
}

export default () => {
  return [getTargetES6(), getTargetRapier(), getTargetDts()];
};
