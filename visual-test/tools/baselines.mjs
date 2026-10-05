#!/usr/bin/env node
/**
 * Manages the external reference-image store of the visual-test digest
 * baselines. See plans/visual-test-digest-baselines.md.
 *
 *   node tools/baselines.mjs push    publish locally accepted images
 *
 * The store is a public repository whose `images` branch holds PNGs named by
 * digest. Pass/fail never depends on it - only tolerant comparison and failure
 * diagnostics do - so it can be squashed or garbage-collected at any time.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.baseline-cache');
const STORE = path.join(CACHE, 'store');
const PENDING = path.join(CACHE, 'pending-upload.txt');
const REMOTE = process.env.VISUAL_BASELINE_REMOTE ?? 'git@github.com:gavinyork/zephyr3d-visual-baselines.git';
const BRANCH = 'images';

/** Must match tests/image_store.ts imageRelativePath. */
const imageRelativePath = (digest) => `${digest.slice(0, 2)}/${digest}.png`;
const cachedImage = (digest) => path.join(CACHE, 'images', imageRelativePath(digest));

function git(args, cwd = STORE, opts = {}) {
  // With inherited stdio there is no captured output to return.
  const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  return (out ?? '').trim();
}

/** Every digest referenced by the committed digest files. */
function referencedDigests() {
  const dir = path.join(ROOT, 'digests');
  const out = new Set();
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    for (const scene of Object.values(data.scenes ?? {})) {
      for (const list of Object.values(scene.accepted ?? {})) {
        list.forEach((d) => out.add(d));
      }
    }
  }
  return out;
}

/** A shallow working copy of the store's `images` branch, created on first use. */
function openStore() {
  if (!fs.existsSync(path.join(STORE, '.git'))) {
    fs.mkdirSync(STORE, { recursive: true });
    git(['init', '-q']);
    git(['remote', 'add', 'origin', REMOTE]);
  }
  const remoteHasBranch = git(['ls-remote', '--heads', 'origin', BRANCH]) !== '';
  if (remoteHasBranch) {
    git(['fetch', '-q', '--depth', '1', 'origin', BRANCH]);
    git(['checkout', '-q', '-B', BRANCH, `origin/${BRANCH}`]);
  } else if (git(['branch', '--list', BRANCH]) === '') {
    // Empty remote: start the orphan branch locally.
    git(['checkout', '-q', '--orphan', BRANCH]);
  }
}

function push() {
  const referenced = referencedDigests();
  const pending = fs.existsSync(PENDING) ? fs.readFileSync(PENDING, 'utf8').split('\n').filter(Boolean) : [];
  // Images accepted and then replaced again before publishing are not needed.
  const wanted = [...new Set(pending)].filter((d) => referenced.has(d));
  if (wanted.length === 0) {
    console.log('nothing to push');
    return;
  }
  openStore();
  let added = 0;
  for (const digest of wanted) {
    const target = path.join(STORE, imageRelativePath(digest));
    if (fs.existsSync(target)) {
      continue;
    }
    const source = cachedImage(digest);
    if (!fs.existsSync(source)) {
      throw new Error(`pending image ${digest} is missing from ${source}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    added++;
  }
  if (added > 0) {
    git(['add', '-A']);
    git(['commit', '-q', '-m', `add ${added} reference image(s)`]);
    git(['push', '-q', 'origin', `${BRANCH}:${BRANCH}`], STORE, { stdio: 'inherit' });
  }
  fs.writeFileSync(PENDING, '');
  console.log(`pushed ${added} image(s); ${wanted.length - added} already in the store`);
}

const commands = { push };
const command = process.argv[2];
if (!commands[command]) {
  console.error(`usage: node tools/baselines.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
commands[command]();
