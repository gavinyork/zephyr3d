#!/usr/bin/env node
/**
 * Manages the visual-test digest baselines and their external image store.
 * See plans/visual-test-digest-baselines.md.
 *
 *   node tools/baselines.mjs fetch                     download referenced images missing from the cache
 *   node tools/baselines.mjs push                      publish locally accepted images
 *   node tools/baselines.mjs check                     verify every referenced image is in the store
 *   node tools/baselines.mjs gc [--yes]                drop unreferenced images and squash the store
 *   node tools/baselines.mjs accept <scene> [--project <name>] [--append]
 *                                                      accept the last local capture of a scene
 *   node tools/baselines.mjs update-from-ci <run-id> [--include-nondeterministic]
 *                                                      accept the captures of a CI run for its platform
 *
 * The store is a public repository whose `images` branch holds PNGs named by
 * digest. Pass/fail never depends on it - only tolerant comparison and failure
 * diagnostics do - so it can be squashed or garbage-collected at any time.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(ROOT, '..');
const DIGESTS = path.join(ROOT, 'digests');
const CACHE = path.join(ROOT, '.baseline-cache');
const STORE = path.join(CACHE, 'store');
const PENDING = path.join(CACHE, 'pending-upload.txt');
const CAPTURES = process.env.VISUAL_CAPTURES_DIR ?? path.join(CACHE, 'captures');
const REMOTE = process.env.VISUAL_BASELINE_REMOTE ?? 'git@github.com:gavinyork/zephyr3d-visual-baselines.git';
const BRANCH = 'images';
const BASE_URL =
  process.env.VISUAL_BASELINE_URL ??
  'https://raw.githubusercontent.com/gavinyork/zephyr3d-visual-baselines/images';
/** Must match tests/digest_file.ts MAX_ACCEPTED_DIGESTS. */
const MAX_ACCEPTED_DIGESTS = 4;
/** Name of the CI artifact holding the captures; must match .github/workflows/ci.yml. */
const CI_ARTIFACT = 'visual-captures';

/** Must match tests/image_store.ts imageRelativePath. */
const imageRelativePath = (digest) => `${digest.slice(0, 2)}/${digest}.png`;
const cachedImage = (digest) => path.join(CACHE, 'images', imageRelativePath(digest));

/**
 * Asks the store for an image. Only a 404 means it is not there; anything else
 * that is not a success means the store could not be asked, and is reported as
 * such so that a network failure is never taken for a missing image.
 * Mirrors tests/image_store.ts HttpImageSource.
 *
 * @returns {Promise<{ res: Response } | { missing: true } | { error: string }>}
 */
async function requestImage(digest, method = 'GET') {
  let res;
  try {
    res = await fetch(`${BASE_URL}/${imageRelativePath(digest)}`, { method });
  } catch (err) {
    return { error: err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(err) };
  }
  if (res.ok) {
    return { res };
  }
  return res.status === 404 ? { missing: true } : { error: `HTTP ${res.status}` };
}

/** Prints the digests that could not be checked, grouped by reason. */
function reportUnreachable(errors) {
  const byReason = new Map();
  for (const { digest, error } of errors) {
    byReason.set(error, [...(byReason.get(error) ?? []), digest]);
  }
  for (const [reason, digests] of byReason) {
    console.error(`  ${reason}:\n${digests.map((d) => `    ${d}`).join('\n')}`);
  }
}

function run(cmd, args, cwd, opts = {}) {
  // With inherited stdio there is no captured output to return.
  const out = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  return (out ?? '').trim();
}
const git = (args, cwd = STORE, opts = {}) => run('git', args, cwd, opts);

// ---------------------------------------------------------------------------
// Digest files. Mirrors tests/digest_file.ts, which the test runner uses; the
// two must write identical output (sorted keys, two-space indent, final newline).

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])])
    );
  }
  return value;
}

function digestFilePath(project, convention) {
  return path.join(DIGESTS, `${project}.${convention}.json`);
}

function loadDigestFile(file) {
  if (!fs.existsSync(file)) {
    return { format: 1, environments: {}, scenes: {} };
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.format !== 1) {
    throw new Error(`${file}: unsupported digest file format ${data.format}`);
  }
  data.environments ??= {};
  data.scenes ??= {};
  return data;
}

function saveDigestFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sortKeys(data), null, 2) + '\n');
}

/** Same rules as DigestFile.accept. */
function acceptDigest(data, scene, platform, digest, size, mode) {
  const entry = (data.scenes[scene] ??= { size, accepted: {} });
  if (entry.size !== size) {
    entry.size = size;
    entry.accepted = {};
  }
  const list = entry.accepted[platform] ?? [];
  if (mode === 'replace') {
    entry.accepted[platform] = [digest];
  } else if (!list.includes(digest)) {
    if (list.length >= MAX_ACCEPTED_DIGESTS) {
      throw new Error(`${scene} (${platform}) already has ${MAX_ACCEPTED_DIGESTS} accepted digests`);
    }
    entry.accepted[platform] = [...list, digest];
  }
}

function digestsOf(data, into = new Set()) {
  for (const scene of Object.values(data.scenes ?? {})) {
    for (const list of Object.values(scene.accepted ?? {})) {
      list.forEach((d) => into.add(d));
    }
  }
  return into;
}

/** Every digest referenced by the digest files in the working tree. */
function referencedDigests() {
  const out = new Set();
  for (const name of fs.existsSync(DIGESTS) ? fs.readdirSync(DIGESTS) : []) {
    if (name.endsWith('.json')) {
      digestsOf(loadDigestFile(path.join(DIGESTS, name)), out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Images.

function readPending() {
  return fs.existsSync(PENDING) ? fs.readFileSync(PENDING, 'utf8').split('\n').filter(Boolean) : [];
}

function addPending(digest) {
  if (!readPending().includes(digest)) {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.appendFileSync(PENDING, `${digest}\n`);
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** A shallow working copy of the store's `images` branch, created on first use. */
function openStore() {
  if (!fs.existsSync(path.join(STORE, '.git'))) {
    fs.mkdirSync(STORE, { recursive: true });
    git(['init', '-q']);
    git(['remote', 'add', 'origin', REMOTE]);
  }
  if (git(['ls-remote', '--heads', 'origin', BRANCH]) !== '') {
    git(['fetch', '-q', '--depth', '1', 'origin', BRANCH]);
    git(['checkout', '-q', '-f', '-B', BRANCH, `origin/${BRANCH}`]);
  } else if (git(['branch', '--list', BRANCH]) === '') {
    // Empty remote: start the orphan branch locally.
    git(['checkout', '-q', '--orphan', BRANCH]);
  }
}

// ---------------------------------------------------------------------------
// Commands.

async function fetchCmd() {
  const wanted = [...referencedDigests()].filter((d) => !fs.existsSync(cachedImage(d)));
  const missing = [];
  const unreachable = [];
  await pool(wanted, 16, async (digest) => {
    const r = await requestImage(digest);
    if (r.missing) {
      missing.push(digest);
      return;
    }
    if (r.error) {
      unreachable.push({ digest, error: r.error });
      return;
    }
    fs.mkdirSync(path.dirname(cachedImage(digest)), { recursive: true });
    fs.writeFileSync(cachedImage(digest), Buffer.from(await r.res.arrayBuffer()));
  });
  const fetched = wanted.length - missing.length - unreachable.length;
  console.log(
    `fetched ${fetched} image(s); ${missing.length} not in the store; ${unreachable.length} not reachable`
  );
  if (missing.length) {
    console.log(`not in the store (never pushed?):\n${missing.map((d) => `  ${d}`).join('\n')}`);
  }
  if (unreachable.length) {
    console.log('not reachable (network or server error; rerun to retry):');
    reportUnreachable(unreachable);
  }
  if (missing.length || unreachable.length) {
    process.exitCode = 1;
  }
}

function push() {
  const referenced = referencedDigests();
  // Images accepted and then replaced again before publishing are not needed.
  const wanted = [...new Set(readPending())].filter((d) => referenced.has(d));
  if (wanted.length === 0) {
    console.log('nothing to push');
    fs.rmSync(PENDING, { force: true });
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
  fs.rmSync(PENDING, { force: true });
  console.log(`pushed ${added} image(s); ${wanted.length - added} already in the store`);
}

/**
 * Fails when a referenced image is not in the store: someone committed digests
 * without running `push`. Checked over HTTP so CI needs neither git access to
 * the store nor credentials.
 */
async function check() {
  const digests = [...referencedDigests()];
  const missing = [];
  const unreachable = [];
  await pool(digests, 16, async (digest) => {
    const r = await requestImage(digest, 'HEAD');
    if (r.missing) {
      missing.push(digest);
    } else if (r.error) {
      unreachable.push({ digest, error: r.error });
    }
  });
  if (missing.length) {
    console.error(
      `${missing.length} of ${digests.length} referenced image(s) are not in the store. ` +
        'Run "npm run baselines:push" from the machine that accepted them:\n' +
        missing.map((d) => `  ${d}`).join('\n')
    );
  }
  if (unreachable.length) {
    console.error(
      `${unreachable.length} of ${digests.length} referenced image(s) could not be checked: ` +
        'the store did not answer. This says nothing about whether they were pushed; ' +
        'check the network and rerun.'
    );
    reportUnreachable(unreachable);
  }
  if (missing.length || unreachable.length) {
    process.exitCode = 1;
    return;
  }
  console.log(`all ${digests.length} referenced image(s) are in the store`);
}

/**
 * Digests to keep: those referenced on develop, main and every tag, plus the
 * working tree, so an unmerged branch's images survive too.
 */
function retainedDigests() {
  const keep = referencedDigests();
  const refs = run(
    'git',
    ['for-each-ref', '--format=%(refname)', 'refs/heads/develop', 'refs/heads/main', 'refs/tags'],
    REPO_ROOT
  )
    .split('\n')
    .filter(Boolean);
  for (const ref of refs) {
    let files;
    try {
      files = run('git', ['ls-tree', '--name-only', `${ref}:visual-test/digests`], REPO_ROOT, {
        stdio: ['ignore', 'pipe', 'ignore']
      }).split('\n');
    } catch {
      // A ref from before digest baselines existed.
      continue;
    }
    for (const name of files.filter((n) => n.endsWith('.json'))) {
      const text = run('git', ['show', `${ref}:visual-test/digests/${name}`], REPO_ROOT);
      digestsOf(JSON.parse(text), keep);
    }
  }
  return keep;
}

function gc(args) {
  const keep = retainedDigests();
  openStore();
  const files = git(['ls-files']).split('\n').filter(Boolean);
  const drop = files.filter((f) => !keep.has(path.basename(f, '.png')));
  console.log(`store has ${files.length} image(s); ${keep.size} retained digest(s); ${drop.length} to drop`);
  if (!args.includes('--yes')) {
    console.log('dry run; pass --yes to drop them and force-push a single squashed commit');
    return;
  }
  for (const f of drop) {
    git(['rm', '-q', f]);
  }
  // A fresh orphan commit, so dropped images also leave the store's history.
  git(['checkout', '-q', '--orphan', 'gc-squash']);
  git(['commit', '-q', '-m', `reference images (${files.length - drop.length})`]);
  git(['branch', '-q', '-D', BRANCH]);
  git(['branch', '-q', '-m', BRANCH]);
  git(['push', '-q', '--force', 'origin', `${BRANCH}:${BRANCH}`], STORE, { stdio: 'inherit' });
  console.log(`dropped ${drop.length} image(s) and squashed the store`);
}

/** Captures under `dir`, as written by tests/compare.ts recordCapture. */
function readCaptures(dir) {
  const out = [];
  for (const sub of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const full = path.join(dir, sub);
    if (!fs.statSync(full).isDirectory()) {
      continue;
    }
    for (const name of fs.readdirSync(full).filter((n) => n.endsWith('.json'))) {
      const meta = JSON.parse(fs.readFileSync(path.join(full, name), 'utf8'));
      out.push({ ...meta, pngPath: path.join(full, name.replace(/\.json$/, '.png')) });
    }
  }
  return out;
}

/** Accepts captures into the digest files and queues their images for upload. */
function applyCaptures(captures, mode) {
  const files = new Map();
  for (const c of captures) {
    const file = digestFilePath(c.project, c.convention);
    const data = files.get(file) ?? loadDigestFile(file);
    files.set(file, data);
    acceptDigest(data, c.scene, c.platform, c.digest, c.size, mode);
    if (c.environment) {
      data.environments[c.platform] = c.environment;
    }
    fs.mkdirSync(path.dirname(cachedImage(c.digest)), { recursive: true });
    fs.copyFileSync(c.pngPath, cachedImage(c.digest));
    addPending(c.digest);
    console.log(`  ${mode === 'append' ? 'appended' : 'accepted'} ${c.project}/${c.scene} on ${c.platform}`);
  }
  for (const [file, data] of files) {
    saveDigestFile(file, data);
  }
  if (captures.length) {
    console.log('Inspect the images above, then "npm run baselines:push" and commit visual-test/digests.');
  }
}

function accept(args) {
  const scene = args.find((a) => !a.startsWith('--'));
  if (!scene) {
    throw new Error('usage: accept <scene> [--project <name>] [--append]');
  }
  const pi = args.indexOf('--project');
  const project = pi >= 0 ? args[pi + 1] : null;
  const matches = readCaptures(CAPTURES).filter(
    (c) => c.scene === scene && (!project || c.project === project)
  );
  if (matches.length === 0) {
    throw new Error(`no capture of ${scene} under ${CAPTURES}; run the suite first`);
  }
  matches.forEach((c) => console.log(`  image: ${c.pngPath}`));
  applyCaptures(matches, args.includes('--append') ? 'append' : 'replace');
}

/**
 * Accepts what a CI run rendered, for the platform it ran on. This is how a
 * developer who changed rendering on one platform brings the CI platform's
 * digests up to date without a Linux machine.
 */
function updateFromCi(args) {
  const runId = args.find((a) => !a.startsWith('--'));
  if (!runId) {
    throw new Error('usage: update-from-ci <run-id> [--include-nondeterministic]');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zvt-ci-'));
  try {
    run('gh', ['run', 'download', runId, '-n', CI_ARTIFACT, '-D', dir], REPO_ROOT, { stdio: 'inherit' });
    let captures = readCaptures(dir);
    if (!args.includes('--include-nondeterministic')) {
      // A nondeterministic scene's digest changes every run; accepting one
      // would only churn the file.
      captures = captures.filter((c) => c.deterministic !== false);
    }
    console.log(`${captures.length} capture(s) in run ${runId}`);
    applyCaptures(captures, 'replace');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const commands = {
  fetch: fetchCmd,
  push,
  check,
  gc,
  accept,
  'update-from-ci': updateFromCi
};
const [command, ...rest] = process.argv.slice(2);
if (!commands[command]) {
  console.error(`usage: node tools/baselines.mjs <${Object.keys(commands).join('|')}> [args]`);
  process.exit(2);
}
await commands[command](rest);
