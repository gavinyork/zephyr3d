import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcdir = [path.join(__dirname, 'src'), path.join(__dirname, '../apps/examples/packages')];
const destdir = path.join(__dirname, 'dist');
const srcfiles = [];

for (const d of srcdir) {
  fs.readdirSync(d).filter((dir) => {
    const fullpath = path.join(d, dir);
    if (fs.statSync(fullpath).isDirectory()) {
      console.log(fullpath);
      let main = path.join(fullpath, 'main.ts');
      if (!fs.existsSync(main)) {
        main = path.join(fullpath, 'src/main.ts');
      }
      const html = path.join(fullpath, 'index.html');
      if (
        fs.existsSync(main) &&
        fs.statSync(main).isFile() &&
        fs.existsSync(html) &&
        fs.statSync(html).isFile()
      ) {
        console.log('src files added: ' + main);
        const title = fs.readFileSync(html, 'utf8').match(/<title>(.*?)<\/title>/i)?.[1] || dir;
        const external = path.dirname(main) !== fullpath;
        srcfiles.push({
          input: main,
          output: dir,
          outputFile: external ? 'js/main.js' : `${dir}.js`,
          html,
          external,
          title
        });
      }
    }
  });
}

srcfiles.sort((a, b) => a.output.localeCompare(b.output));

function generateExamplesModule() {
  return {
    name: 'generate-examples-module',
    buildStart() {
      this.addWatchFile(path.join(__dirname, 'src/index.html'));
      for (const example of srcfiles) {
        this.addWatchFile(example.html);
      }
    },
    writeBundle() {
      const examples = srcfiles.map(({ output, title }) => ({ id: output, title }));
      fs.mkdirSync(destdir, { recursive: true });
      fs.copyFileSync(path.join(__dirname, 'src/index.html'), path.join(destdir, 'index.html'));
      fs.writeFileSync(
        path.join(destdir, 'examples.js'),
        `export default ${JSON.stringify(examples, null, 2)};\n`
      );
    }
  };
}

function copyExternalHtml(example) {
  return {
    name: `copy-example-html-${example.output}`,
    buildStart() {
      this.addWatchFile(example.html);
    },
    writeBundle() {
      const outputDir = path.join(destdir, example.output);
      fs.mkdirSync(outputDir, { recursive: true });
      fs.copyFileSync(example.html, path.join(outputDir, 'index.html'));
    }
  };
}

function getTargetES6(example, generateIndex) {
  console.log(example.input, ',', example.output);
  return {
    input: example.input,
    preserveSymlinks: false,
    output: {
      file: path.join(destdir, example.output, example.outputFile),
      format: 'esm',
      sourcemap: true
    },
    onwarn(warning, warn) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') {
        console.error(warning.message);
      } else {
        console.warn(warning.message);
      }
    },
    plugins: [
      nodeResolve({
        rootDir: __dirname,
        dedupe: (importee) => importee.startsWith('@zephyr3d/')
      }),
      swc({
        sourceMaps: true,
        inlineSourcesContent: false
      }),
      ...(example.external
        ? [copyExternalHtml(example)]
        : [
            copy({
              targets: [
                {
                  src: [`src/${example.output}/**/*`, `!src/${example.output}/**/*.ts`],
                  dest: `dist/${example.output}`
                }
              ],
              verbose: true
            })
          ]),
      ...(generateIndex ? [generateExamplesModule()] : [])
    ]
  };
}

export default (args) => {
  const targets = srcfiles.map((example, index) => getTargetES6(example, index === 0));
  console.log(JSON.stringify(targets, null, 2));
  return targets;
};
