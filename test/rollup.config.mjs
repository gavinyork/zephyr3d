import { nodeResolve } from '@rollup/plugin-node-resolve';
import { swc } from 'rollup-plugin-swc3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'dist');
const srcfiles = [];

const whitelist = ['terrain'];
fs.readdirSync(srcdir).filter((dir) => {
  if (true || whitelist.indexOf(dir) >= 0) {
    const fullpath = path.join(srcdir, dir);
    if (fs.statSync(fullpath).isDirectory()) {
      const main = path.join(fullpath, 'main.ts');
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
  }
});

function getTargetES6(input, output) {
  console.log(input, ',', output);
  return {
    input: input,
    preserveSymlinks: false,
    output: {
      file: path.join(destdir, 'js', `${output}.js`),
      format: 'esm',
      sourcemap: true
    },
    onwarn(warning, warn) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') {
        console.error(warning.message);
      }
    },
    plugins: [
      nodeResolve(),
      swc(),
      // terser()
      copy({
        targets: [
          {
            src: `src/${output}/index.html`,
            dest: 'dist',
            rename: `${output}.html`
          }
        ],
        verbose: true
      })
    ]
  };
}

export default (args) => {
  const targets = srcfiles.map((f) => getTargetES6(f[0], f[1]));
  console.log(JSON.stringify(targets));
  return targets;
};
