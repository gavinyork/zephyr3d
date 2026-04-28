import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import path from 'path';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'dist');

function getTargetES6() {
  return {
    input: path.join(srcdir, 'index.ts'),
    preserveSymlinks: false,
    external: (id) => id.startsWith('@zephyr3d/'),
    output: {
      file: path.join(destdir, 'index.js'),
      format: 'esm',
      sourcemap: true
    },
    onwarn(warning) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') {
        console.error(warning.message);
      }
    },
    plugins: [
      nodeResolve({
        browser: true,
        preferBuiltins: false
      }),
      commonjs(),
      typescript({
        tsconfig: path.join(__dirname, 'tsconfig.json'),
        useTsconfigDeclarationDir: false,
        clean: true,
        tsconfigOverride: {
          compilerOptions: {
            sourceMap: true,
            declaration: false,
            declarationMap: false
          }
        }
      }),
      // terser()
      copy({
        targets: [
          {
            src: ['plugin.json'],
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
