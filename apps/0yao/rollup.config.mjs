import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'dist');

function rawPlugin() {
  return {
    name: 'raw',
    resolveId(id, importer) {
      if (id.endsWith('?raw')) {
        const filePath = id.slice(0, -4); // 去掉 ?raw
        const resolved = path.resolve(path.dirname(importer), filePath);
        return resolved + '?raw'; // 保留标记
      }
      return null;
    },
    load(id) {
      if (id.endsWith('?raw')) {
        const filePath = id.slice(0, -4);
        const content = fs.readFileSync(filePath, 'utf-8');
        return `export default ${JSON.stringify(content)};`;
      }
      return null;
    }
  };
}

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
      rawPlugin(),
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
