import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { fileURLToPath } from 'url';
import path from 'path';
import commonjs from '@rollup/plugin-commonjs';
import css from 'rollup-plugin-import-css';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getWebTarget() {
  return {
    input: path.join(__dirname, 'web', 'js', 'showcase.js'),
    preserveSymlinks: false,
    output: {
      file: path.join(__dirname, 'dist', 'web', 'js', `showcase.js`),
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      css(),
      nodeResolve(),
      commonjs(),
      swc({
        sourceMaps: true,
        inlineSourcesContent: false
      })
      // terser(),
    ]
  };
}

export default (args) => {
  return [getWebTarget()];
};
