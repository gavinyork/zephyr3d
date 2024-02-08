import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';
import commonjs from '@rollup/plugin-commonjs';
import css from 'rollup-plugin-import-css';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'dist', 'web', 'tut');
const srcfiles = [];

fs.readdirSync(srcdir).filter((dir) => {
  const fullpath = path.join(srcdir, dir);
  if (fs.statSync(fullpath).isDirectory()) {
    const main = path.join(fullpath, 'main.js');
    const html = path.join('src', dir, 'index.html');
    if (
      fs.existsSync(main) &&
      fs.statSync(main).isFile() &&
      fs.existsSync(html) &&
      fs.statSync(html).isFile()
    ) {
      console.log('src files added: ' + main);
      srcfiles.push([main, dir]);
    }
  }
});

function getTutTarget(input, output) {
  console.log(input, ',', output);
  return {
    input: input,
    preserveSymlinks: false,
    output: {
      file: path.join(destdir, 'js', `${output}.js`),
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      swc(),
      terser(),
      copy({
        targets: [
          {
            src: `src/${output}/index.html`,
            dest: 'dist/web/tut',
            rename: `${output}.html`
          }, {
            src: `src/${output}/main.js`,
            dest: 'dist/web/tut',
            rename: `${output}.main.js`
          }
        ],
        verbose: true
      })
    ]
  };
}

export default (args) => {
  const tutTargets = srcfiles.map((f) => getTutTarget(f[0], f[1]));
  return tutTargets;
};
