import { nodeResolve } from '@rollup/plugin-node-resolve';
import { swc } from 'rollup-plugin-swc3';
import path from 'path';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'dist');

function getTargetES6() {
  return {
    input: path.join(srcdir, 'main.ts'),
    preserveSymlinks: false,
    output: {
      file: path.join(destdir, 'js', `main.js`),
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
      // terser()
      copy({
        targets: [
          {
            src: ['index.html'],
            dest: destdir
          }
        ],
        verbose: true
      })
    ]
  };
}

export default () => {
  return getTargetES6();
};
