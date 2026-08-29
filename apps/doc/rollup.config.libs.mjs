import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bundleName,
  digestEnginePackage,
  discoverEnginePackages,
  engineBundleDir,
  enginePackageRoot,
  isEngineSpecifier,
  siblingImportPath
} from './engine-bundles.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Each @zephyr3d package becomes one ES module under `web/public/tut/lib`, so the
// examples can import the engine at runtime instead of inlining a private copy of
// it. Sibling engine packages stay external so a page that loads several of them
// still shares a single instance of `@zephyr3d/base` and `@zephyr3d/device`.
const cacheFile = path.join(__dirname, '.libcache.json');
const watchMode = process.env.ROLLUP_WATCH === 'true';

// Bump when the bundling scheme changes so existing outputs are considered stale.
const CACHE_SCHEMA = 1;

const codeCompress = !watchMode && !process.env.SITE_NO_COMPRESS;

// Both modes write the same files, so switching between a minified (production)
// and a readable (watch/dev) build has to re-emit every bundle.
function readCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cache.schema !== CACHE_SCHEMA) {
      return null;
    }
    if (cache.compress !== codeCompress) {
      console.log(
        `Engine bundles were built with compression ${cache.compress ? 'enabled' : 'disabled'}; re-emitting all of them`
      );
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

// Rollup rejects an empty config array, so an up-to-date build still needs one
// target. `dummy.js` is the same placeholder the tutorial config uses.
function getNoopTarget() {
  return {
    input: 'dummy.js',
    output: { file: 'dummy.js', format: 'esm' }
  };
}

function getLibTarget(packageName, onWritten) {
  const plugins = [nodeResolve(), commonjs()];
  if (codeCompress) {
    plugins.push(
      terser({
        compress: true,
        mangle: true,
        module: true,
        toplevel: true,
        output: { comments: false }
      })
    );
  }
  plugins.push({
    name: 'record-engine-digest',
    writeBundle: () => onWritten(packageName)
  });
  return {
    input: path.join(enginePackageRoot, packageName, 'dist', 'index.js'),
    preserveSymlinks: false,
    external: isEngineSpecifier,
    output: {
      file: path.join(engineBundleDir, bundleName(packageName)),
      format: 'esm',
      sourcemap: true,
      paths: siblingImportPath
    },
    onwarn(warning, warn) {
      // The engine has known cycles between its own modules; the per-package build
      // in `libs/*` already reports them.
      if (warning.code === 'CIRCULAR_DEPENDENCY') {
        return;
      }
      warn(warning);
    },
    plugins
  };
}

export default () => {
  const packages = discoverEnginePackages();
  const cache = readCache();
  const digests = { ...(cache?.digests ?? {}) };
  const stale = packages.filter(
    (name) =>
      watchMode ||
      !fs.existsSync(path.join(engineBundleDir, bundleName(name))) ||
      cache?.digests?.[name] !== digestEnginePackage(name)
  );

  if (!stale.length) {
    console.log('Engine bundles are up to date');
    return [getNoopTarget()];
  }
  console.log(`Building engine bundles: ${stale.join(', ')}`);

  // Written after every successful package rather than once at the end, so a
  // failure in one package does not discard the digests of the ones that
  // succeeded. Only packages that actually emitted a bundle are recorded.
  const onWritten = (name) => {
    digests[name] = digestEnginePackage(name);
    if (!watchMode) {
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({ schema: CACHE_SCHEMA, compress: codeCompress, digests }, null, 2),
        'utf8'
      );
    }
  };

  return stale.map((name) => getLibTarget(name, onWritten));
};
