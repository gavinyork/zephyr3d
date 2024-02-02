import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'dist');
const srcfiles = [];

fs.readdirSync(srcdir).filter((dir) => {
  const fullpath = path.join(srcdir, dir);
  if (fs.statSync(fullpath).isDirectory()) {
    console.log(fullpath);
    const main = path.join(fullpath, 'main.ts');
    const html = path.join(fullpath, 'index.html');
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

function getTargetES6(input, output) {
  console.log(input, ',', output);
  return {
    input: input,
    preserveSymlinks: false,
    output: {
      file: path.join(destdir, output, `${output}.js`),
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      nodeResolve(),
      swc(),
      // terser()
      copy({
        targets: [
          {
            src: [`src/${output}/**/*`, `!src/${output}/**/*.ts`],
            dest: `dist/${output}`
          },
          {
            src: ['src/index.html'],
            dest: 'dist'
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
