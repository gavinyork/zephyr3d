// Bundles the in-page harness into dist/js/harness.js and copies index.html.
// Mirrors apps/depth-viz-demo/rollup.config.mjs - same swc + nodeResolve setup.
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { swc } from 'rollup-plugin-swc3';
import path from 'path';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'dist');

export default () => ({
  input: path.join(srcdir, 'harness.ts'),
  preserveSymlinks: false,
  output: {
    file: path.join(destdir, 'js', 'harness.js'),
    format: 'esm',
    sourcemap: true
  },
  onwarn(warning) {
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
    copy({
      targets: [
        { src: ['index.html'], dest: destdir },
        { src: 'assets/ktx2/*.ktx2', dest: path.join(destdir, 'assets', 'ktx2') },
        { src: 'assets/gltf/duck-draco/*', dest: path.join(destdir, 'assets', 'gltf', 'duck-draco') },
        { src: 'assets/gltf/duck-meshopt/*', dest: path.join(destdir, 'assets', 'gltf', 'duck-meshopt') },
        { src: 'assets/zmsh/*.zmsh', dest: path.join(destdir, 'assets', 'zmsh') },
        // Same story for the Draco decoder, resolved relative to the glTF importer
        {
          src: 'node_modules/@zephyr3d/loaders/dist/gltf/draco/*',
          dest: path.join(destdir, 'js', 'draco')
        },
        // The harness is a single plain-Rollup bundle, which does not emit assets for
        // `new URL(..., import.meta.url)`; the KTX2 loader resolves its transcoder
        // relative to the bundle, so put the shipped copy there
        {
          src: 'node_modules/@zephyr3d/scene/dist/asset/loaders/ktx2/basis/*',
          dest: path.join(destdir, 'js', 'basis')
        }
      ]
    })
  ]
});
