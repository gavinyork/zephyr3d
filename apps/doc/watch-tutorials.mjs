import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const docRoot = path.dirname(__filename);
const sourceRoot = path.join(docRoot, 'src');
const libsRoot = path.resolve(docRoot, '..', '..', 'libs');
const outputRoot = path.join(docRoot, 'web', 'public', 'tut');
const rollupBin = path.join(docRoot, 'node_modules', 'rollup', 'dist', 'bin', 'rollup');
const requested = process.env.SITE_TUT
  ? new Set(
      process.env.SITE_TUT.split(';')
        .map((value) => value.trim())
        .filter(Boolean)
    )
  : undefined;

function discoverTargets() {
  const targets = new Map();
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || (requested && !requested.has(entry.name))) {
      continue;
    }
    const directory = path.join(sourceRoot, entry.name);
    const main = ['main.js', 'main.ts'].map((file) => path.join(directory, file)).find(fs.existsSync);
    if (main && fs.existsSync(path.join(directory, 'index.html'))) {
      targets.set(entry.name, main);
    }
  }
  return targets;
}

const targets = discoverTargets();
const pending = new Set();
const watchers = [];
let activeBuild;
let drainTimer;
let stopping = false;
let engineDirty = false;

function hasOutput(target) {
  return (
    fs.existsSync(path.join(outputRoot, 'js', `${target}.js`)) &&
    fs.existsSync(path.join(outputRoot, `${target}.html`))
  );
}

function normalizeEventPath(root, filename) {
  if (!filename) {
    return undefined;
  }
  return path.resolve(root, filename.toString());
}

function queueTargets(names) {
  for (const name of names) {
    if (targets.has(name)) {
      pending.add(name);
    }
  }
  scheduleDrain();
}

function scheduleDrain() {
  if (drainTimer || stopping) {
    return;
  }
  drainTimer = setTimeout(() => {
    drainTimer = undefined;
    void drainQueue();
  }, 120);
}

function runRollup(label, configArgs, extraEnv) {
  return new Promise((resolve) => {
    const env = { ...process.env, SITE_NO_COMPRESS: '1', ...extraEnv };
    delete env.ROLLUP_WATCH;
    if (!env.NODE_OPTIONS) {
      env.NODE_OPTIONS = '--max_old_space_size=8192';
    }

    console.log(`\nBuilding ${label}...`);
    const child = spawn(process.execPath, [rollupBin, ...configArgs, '--silent'], {
      cwd: docRoot,
      env,
      stdio: 'inherit'
    });
    activeBuild = child;
    child.once('error', (error) => {
      console.error(`Failed to build ${label}:`, error);
      activeBuild = undefined;
      resolve();
    });
    child.once('exit', (code, signal) => {
      if (code !== 0 && !stopping) {
        console.error(`Build of ${label} failed (${code ?? signal}).`);
      }
      activeBuild = undefined;
      resolve();
    });
  });
}

function buildEngine() {
  // Only the engine bundles are rebuilt; the examples import them at runtime and
  // do not need to be recompiled when the engine changes.
  return runRollup('engine bundles', ['-c', 'rollup.config.libs.mjs']);
}

function buildTarget(target) {
  return runRollup(`tutorial ${target}`, ['-c'], { SITE_TUT: target });
}

async function drainQueue() {
  if (activeBuild || stopping) {
    return;
  }
  if (engineDirty) {
    engineDirty = false;
    await buildEngine();
    if (!stopping && (pending.size || engineDirty)) {
      scheduleDrain();
    }
    return;
  }
  if (!pending.size) {
    return;
  }
  const target = pending.values().next().value;
  pending.delete(target);
  await buildTarget(target);
  if (pending.size || engineDirty) {
    scheduleDrain();
  }
}

function watchRoot(root, onChange) {
  if (!fs.existsSync(root)) {
    return;
  }
  try {
    const watcher = fs.watch(root, { recursive: true }, (event, filename) => {
      onChange(normalizeEventPath(root, filename), event);
    });
    watchers.push(watcher);
    return;
  } catch (error) {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      throw error;
    }
  }

  // Linux Node versions do not support recursive fs.watch. Watching each
  // existing directory keeps this script dependency-free on those systems.
  const directories = [root];
  for (let index = 0; index < directories.length; index++) {
    const directory = directories[index];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        directories.push(path.join(directory, entry.name));
      }
    }
  }
  for (const directory of directories) {
    const watcher = fs.watch(directory, (event, filename) => {
      onChange(normalizeEventPath(directory, filename), event);
    });
    watchers.push(watcher);
  }
}

function handleSourceChange(file) {
  if (!file) {
    queueTargets(targets.keys());
    return;
  }
  const relative = path.relative(sourceRoot, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return;
  }
  queueTargets([relative.split(path.sep)[0]]);
}

function handleLibraryChange(file) {
  if (file && file.split(path.sep).includes('node_modules')) {
    return;
  }
  engineDirty = true;
  scheduleDrain();
}

function stop(code = 0) {
  if (stopping) {
    return;
  }
  stopping = true;
  if (drainTimer) {
    clearTimeout(drainTimer);
  }
  for (const watcher of watchers) {
    watcher.close();
  }
  activeBuild?.kill('SIGTERM');
  process.exitCode = code;
  if (!activeBuild) {
    process.exit();
  }
}

// The examples import the engine from `tut/lib`, so those bundles must exist
// before any example can run. Rebuilding them is a no-op when already current.
engineDirty = true;
scheduleDrain();

const missing = [...targets.keys()].filter((target) => !hasOutput(target));
if (requested) {
  // An explicit selection is small enough to rebuild once on startup. This
  // also picks up edits made before the watcher was started.
  queueTargets(targets.keys());
} else if (missing.length) {
  console.warn(
    `Tutorial outputs missing for ${missing.length} example(s). Run npm run build:tutorials once or set SITE_TUT before npm run dev.`
  );
}

if (requested) {
  const unknown = [...requested].filter((target) => !targets.has(target));
  if (unknown.length) {
    console.warn(`Unknown tutorial(s) in SITE_TUT: ${unknown.join(', ')}`);
  }
}

watchRoot(sourceRoot, handleSourceChange);
if (fs.existsSync(libsRoot)) {
  for (const entry of fs.readdirSync(libsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    // Only `dist` matters: the engine bundles are built from compiled output, so a
    // `src` edit is picked up once that package's own build has emitted it.
    watchRoot(path.join(libsRoot, entry.name, 'dist'), handleLibraryChange);
  }
}
console.log(
  `Tutorial watcher ready (${requested ? [...targets.keys()].join(', ') || 'no matching targets' : 'lazy mode; all tutorials'}).`
);

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
