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
      targets: [{ src: ['index.html'], dest: destdir }]
    })
  ]
});
