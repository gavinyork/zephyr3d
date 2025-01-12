import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'dist', 'web', 'tut');
const srcfiles = [];
const zephyr3d = path.join(__dirname, 'node_modules', '@zephyr3d');
const cacheFile = path.join(__dirname, '.buildcache.json');
const tmpcacheFile = path.join(__dirname, '.buildcache.tmp.json');

function deepEqual(obj1, obj2) {
  if (obj1 === obj2) {
    return true;
  }
  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
    return false;
  }
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  if (keys1.length !== keys2.length) {
    return false;
  }
  for (let key of keys1) {
    if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
      return false;
    }
  }
  return true;
}

function calculateFileMD5(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('md5');
  hash.update(fileBuffer);
  return hash.digest('hex');
}

function traverseDirectory(dirPath, rootPath, dict) {
  const entries = fs.readdirSync(dirPath);
  dict = dict || {};
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    try {
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        // 如果是目录，则递归遍历
        traverseDirectory(fullPath, rootPath, dict);
      } else {
        // 计算文件的MD5并添加到Map中
        const fileMD5 = calculateFileMD5(fullPath);
        dict[path.relative(rootPath, fullPath)] = fileMD5;
      }
    } catch (err) {
      console.error(err);
    }
  }
  return dict;
}

let buildCache = {};
try {
  if (fs.statSync(cacheFile).isFile()) {
    const content = fs.readFileSync(cacheFile, 'utf8');
    buildCache = JSON.parse(content);
  }
} catch (err) {
  console.log('Build cache file not exists');
}
fs.writeFileSync(tmpcacheFile, JSON.stringify(buildCache, null, ' '));

let cacheChanged = false;
let invalidAll = false;
let codeCompress = true;
const dict = traverseDirectory(zephyr3d, zephyr3d);
const cachedZephr3d = buildCache['@zephyr3d'];
if (!deepEqual(cachedZephr3d, dict)) {
  buildCache['@zephyr3d'] = dict;
  invalidAll = true;
}
const pattern = process.env.SITE_TUT ? process.env.SITE_TUT.split(';') : null;
console.log(`Build pattern: ${JSON.stringify(pattern)}`);
if (process.env.SITE_NO_COMPRESS) {
  codeCompress = false;
}
console.log(`Code compress ${codeCompress ? 'enabled' : 'disabled'}`);

fs.readdirSync(srcdir).filter((dir) => {
  if (pattern && pattern.indexOf(dir) < 0) {
    return;
  }
  const fullpath = path.join(srcdir, dir);
  if (fs.statSync(fullpath).isDirectory()) {
    let main = path.join(fullpath, 'main.js');
    if (!fs.existsSync(main)) {
      main = path.join(fullpath, 'main.ts');
    }
    const html = path.join('src', dir, 'index.html');
    if (
      fs.existsSync(main) &&
      fs.statSync(main).isFile() &&
      fs.existsSync(html) &&
      fs.statSync(html).isFile()
    ) {
      const cache = buildCache[dir];
      const dict = traverseDirectory(fullpath, fullpath);
      if (invalidAll || !deepEqual(cache, dict)) {
        buildCache[dir] = dict;
        cacheChanged = true;
        srcfiles.push([main, dir]);
      }
    }
  }
});

if (cacheChanged) {
  fs.writeFileSync(tmpcacheFile, JSON.stringify(buildCache, null, ' '), 'utf8');
}

function getCacheTarget() {
  return {
    input: 'dummy.js',
    output: {
      file: 'dummy.js',
      format: 'esm'
    },
    plugins: [
      copy({
        targets: [
          {
            src: tmpcacheFile,
            dest: cacheFile
          }
        ],
        hook: 'buildEnd'
      }),
      {
        name: 'copy-cache-file',
        buildEnd: async () => {
          fs.copyFileSync(tmpcacheFile, cacheFile);
        }
      },
      {
        name: 'delete-tmp-cache',
        buildEnd: async () => {
          console.log('Delete tmporal cache file');
          fs.rmSync(tmpcacheFile);
        }
      }
    ]
  };
}

function getTutTarget(input, output) {
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
      commonjs(),
      terser({
        compress: codeCompress,
        mangle: codeCompress,
        module: true,
        toplevel: true,
        output: {
          comments: false
        }
      }),
      copy({
        targets: [
          {
            src: `src/${output}/index.html`,
            dest: 'dist/web/tut',
            rename: `${output}.html`
          },
          {
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
  console.log(JSON.stringify(srcfiles));
  const tutTargets = srcfiles.map((f) => getTutTarget(f[0], f[1]));
  return [...tutTargets, getCacheTarget()];
};
