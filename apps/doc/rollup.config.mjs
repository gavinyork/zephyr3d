import { swc } from 'rollup-plugin-swc3';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import copy from 'rollup-plugin-copy';
import { exampleImportPath, isEngineSpecifier } from './engine-bundles.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcdir = path.join(__dirname, 'src');
const destdir = path.join(__dirname, 'web', 'public', 'tut');
const srcfiles = [];
const cacheFile = path.join(__dirname, '.buildcache.json');
const tmpcacheFile = path.join(__dirname, '.buildcache.tmp.json');
const watchMode = process.env.ROLLUP_WATCH === 'true';

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
    if (fullPath.indexOf('node_modules') >= 0) {
      continue;
    }
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
      console.error(`${fullPath}:${err}`);
    }
  }
  return dict;
}

function hasTutOutput(output) {
  return (
    fs.existsSync(path.join(destdir, 'js', `${output}.js`)) &&
    fs.existsSync(path.join(destdir, `${output}.html`))
  );
}

// Identifies how the outputs were produced. Bumping it discards cache entries
// written by an older scheme, so every example is rebuilt once. Without this, a
// cache from the previous scheme (which inlined the engine) would look valid and
// leave stale bundles in place.
const CACHE_SCHEMA = 'external-engine-1';

let buildCache = {};
try {
  if (fs.existsSync(destdir) && fs.statSync(cacheFile).isFile()) {
    const content = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (content.schema === CACHE_SCHEMA) {
      buildCache = content;
    } else {
      console.log('Build cache was written by a different build scheme; rebuilding all examples');
    }
  }
} catch (err) {
  console.log('Build cache file not exists');
}
buildCache.schema = CACHE_SCHEMA;
if (!watchMode) {
  fs.writeFileSync(tmpcacheFile, JSON.stringify(buildCache, null, 2));
}

let cacheChanged = false;
let codeCompress = !watchMode;
const pattern = process.env.SITE_TUT ? process.env.SITE_TUT.split(';') : null;
console.log(`Build pattern: ${JSON.stringify(pattern, null, 2)}`);
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
      if (watchMode || !deepEqual(cache, dict) || !hasTutOutput(dir)) {
        buildCache[dir] = dict;
        cacheChanged = true;
        srcfiles.push([main, dir]);
      }
    }
  }
});

if (cacheChanged && !watchMode) {
  fs.writeFileSync(tmpcacheFile, JSON.stringify(buildCache, null, 2), 'utf8');
}

function getCacheTarget() {
  return {
    input: 'dummy.js',
    output: {
      file: 'dummy.js',
      format: 'esm'
    },
    plugins: [
      {
        // Rollup runs `buildEnd` hooks in parallel, so the copy and the delete
        // must happen in one hook: as separate plugins they raced and the build
        // failed intermittently with ENOENT on the temp file.
        name: 'commit-build-cache',
        buildEnd: () => {
          if (!fs.existsSync(tmpcacheFile)) {
            return;
          }
          fs.copyFileSync(tmpcacheFile, cacheFile);
          fs.rmSync(tmpcacheFile);
        }
      }
    ]
  };
}

function getTutTarget(input, output) {
  const plugins = [
    nodeResolve(),
    swc({
      sourceMaps: true,
      inlineSourcesContent: false
    }),
    commonjs()
  ];
  if (codeCompress) {
    plugins.push(
      terser({
        compress: true,
        mangle: true,
        module: true,
        toplevel: true,
        output: {
          comments: false
        }
      })
    );
  }
  plugins.push(
    copy({
      targets: [
        {
          src: `src/${output}/index.html`,
          dest: 'web/public/tut',
          rename: `${output}.html`
        },
        {
          src: `src/${output}/main.js`,
          dest: 'web/public/tut',
          rename: `${output}.main.js`
        }
      ],
      verbose: true
    })
  );
  return {
    input: input,
    preserveSymlinks: false,
    // The engine ships as separate bundles in `tut/lib`, so each example only
    // compiles its own code and the browser caches the engine across examples.
    external: isEngineSpecifier,
    output: {
      file: path.join(destdir, 'js', `${output}.js`),
      format: 'esm',
      sourcemap: true,
      paths: exampleImportPath
    },
    plugins
  };
}

export default (args) => {
  console.log(JSON.stringify(srcfiles));
  const tutTargets = srcfiles.map((f) => getTutTarget(f[0], f[1]));
  return watchMode ? tutTargets : [...tutTargets, getCacheTarget()];
};
