import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const docRoot = path.dirname(__filename);

/** Where the pnpm/rush workspace links the engine packages. */
export const enginePackageRoot = path.join(docRoot, 'node_modules', '@zephyr3d');

/** Directory holding one pre-bundled ES module per engine package. */
export const engineBundleDir = path.join(docRoot, 'web', 'public', 'tut', 'lib');

/** Directory holding the compiled example entry points. */
export const exampleBundleDir = path.join(docRoot, 'web', 'public', 'tut', 'js');

const SCOPE = '@zephyr3d/';

/** File name of the bundle for one engine package. */
export function bundleName(packageName) {
  return `zephyr3d-${packageName}.js`;
}

/** True for bare specifiers that resolve to a pre-bundled engine package. */
export function isEngineSpecifier(id) {
  return id === '@zephyr3d' || id.startsWith(SCOPE);
}

/** Package name (`scene`) for an engine specifier (`@zephyr3d/scene`). */
export function packageNameOf(id) {
  return id.slice(SCOPE.length);
}

/** Specifier an engine bundle uses to import a sibling engine bundle. */
export function siblingImportPath(id) {
  return `./${bundleName(packageNameOf(id))}`;
}

/** Specifier an example in `tut/js` uses to import an engine bundle in `tut/lib`. */
export function exampleImportPath(id) {
  return `../lib/${bundleName(packageNameOf(id))}`;
}

/** Engine packages that are installed and built. */
export function discoverEnginePackages() {
  if (!fs.existsSync(enginePackageRoot)) {
    return [];
  }
  return fs
    .readdirSync(enginePackageRoot)
    .filter((name) => fs.existsSync(path.join(enginePackageRoot, name, 'dist', 'index.js')))
    .sort();
}

/**
 * Content hash over a package's compiled JavaScript. Source maps and type
 * declarations are ignored because they do not change the emitted bundle.
 */
export function digestEnginePackage(packageName) {
  const dist = path.join(enginePackageRoot, packageName, 'dist');
  const hash = crypto.createHash('md5');
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        hash.update(path.relative(dist, full).split(path.sep).join('/'));
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(dist);
  return hash.digest('hex');
}

/** True when every engine package has an up-to-date bundle on disk. */
export function engineBundlesUpToDate(digests) {
  if (!digests) {
    return false;
  }
  return discoverEnginePackages().every(
    (name) =>
      fs.existsSync(path.join(engineBundleDir, bundleName(name))) &&
      digests[name] === digestEnginePackage(name)
  );
}
