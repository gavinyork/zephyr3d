/**
 * Sensitivity check: does the harness still catch regressions?
 *
 * A visual suite can die silently. Not by turning red - by staying green while
 * quietly ceasing to exercise the code it claims to cover. That is not
 * hypothetical here: when the shadow scenes were retuned onto
 * `applyQualityPreset('character-small')` to clear up their acne, the preset
 * began overriding depthBias, and detection of a change to the engine's *default*
 * depthBias went from six scenes to zero. Every baseline was green, every image
 * looked better than before, and a whole dimension of coverage had evaporated
 * with no signal at all.
 *
 * So this script tests the tests. Each entry below is a small, surgical edit to
 * engine source with a known-correct blast radius. The script applies it,
 * rebuilds, runs the suite, and asserts that the scenes which *should* notice
 * actually do. An entry that stops failing is a coverage hole that opened up.
 *
 * Every expectation here was measured, not assumed. Do not add an entry without
 * running it first: an untested expectation is exactly the kind of comfortable
 * fiction this script exists to destroy.
 *
 * Cost: one engine rebuild per entry, so minutes, not seconds. This is not a
 * PR gate. Run it on a schedule, and by hand on any change that touches
 * baselines or shadow/lighting parameters.
 *
 *   node tools/sensitivity.mjs              # all entries
 *   node tools/sensitivity.mjs --list       # just show them
 *   node tools/sensitivity.mjs --only <id>  # one entry
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VISUAL_TEST = path.join(__dirname, '..');
const REPO = path.join(VISUAL_TEST, '..');

/** Project to run. One backend is enough - these mutations are backend-agnostic. */
const PROJECT = 'webgl2-swiftshader';

/**
 * Known regressions and the scenes that must notice them.
 *
 * `expect` is a MINIMUM, not an exact set. Extra failures are reported but not
 * treated as errors: adding a scene that also happens to catch a mutation is
 * good news, and pinning the exact set would make this brittle for no benefit.
 */
const MUTATIONS = [
  {
    id: 'shadow-default-depth-bias',
    description:
      "Nudge the engine's default shadow depthBias by 17%. Only scenes that stay on the engine defaults can see this - everything using a quality preset is immune by construction.",
    file: 'libs/scene/src/shadow/shadowmapper.ts',
    find: 'depthBias: 0.003,',
    replace: 'depthBias: 0.0035,',
    expect: ['shadow-defaults']
  },
  {
    id: 'shadow-mask-texture-unbound',
    description:
      'Stop projecting the screen-space shadow mask onto DrawContext in the LightPass. This is the exact decoupling that RenderGraph phase 3b was deferred over, and the render-graph topology tests cannot see it - they pass 201/201 with this applied.',
    file: 'libs/scene/src/render/rendergraph/forward_plus_builder.ts',
    find:
      '        // Legacy effects still read resolved MRT textures from DrawContext.\n' +
      '        ctx.shadowMaskTexture = shadowMaskHandle ? rgCtx.getTexture<Texture2DArray>(shadowMaskHandle) : null;',
    replace:
      '        // Legacy effects still read resolved MRT textures from DrawContext.\n' +
      '        ctx.shadowMaskTexture = null;',
    expect: ['shadow-pcf', 'shadow-pcss', 'shadow-defaults']
  },
  {
    id: 'bloom-threshold-default',
    description:
      "Shift the camera's default bloom threshold. This entry found a real hole on its first run: post-tonemap-bloom used to set the threshold explicitly to the same value as the default, which made it blind to the default moving. The scene now inherits it.",
    file: 'libs/scene/src/camera/camera.ts',
    find: 'this._bloomThreshold = 0.8;',
    replace: 'this._bloomThreshold = 0.5;',
    expect: ['post-tonemap-bloom']
  },
  {
    id: 'eye-parallax-disabled',
    description:
      'Flatten the iris onto the corneal surface by zeroing the default parallax depth. Only an off-axis view can see this: head-on the refracted ray barely bends, which is why eye-frontal is not in the expected set.',
    file: 'libs/scene/src/material/eye.ts',
    find: 'this._irisDepth = 0.06;',
    replace: 'this._irisDepth = 0;',
    expect: ['eye-angled']
  },
  {
    id: 'taa-jitter-amplitude',
    description:
      'Change the sub-pixel jitter amplitude the camera applies for TAA. Only a scene that steps several frames can see this, since the jitter is indexed by frame counter.',
    file: 'libs/scene/src/camera/camera.ts',
    find: 'this._jitterValue.setXY((halton[0] * 2) / width, (halton[1] * 2) / height);',
    replace: 'this._jitterValue.setXY((halton[0] * 3) / width, (halton[1] * 3) / height);',
    expect: ['taa-multiframe']
  }
];

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

if (args.includes('--list')) {
  for (const m of MUTATIONS) {
    console.log(`${m.id.padEnd(32)} -> ${m.expect.length ? m.expect.join(', ') : '(no expectation set)'}`);
  }
  process.exit(0);
}

const selected = only ? MUTATIONS.filter((m) => m.id === only) : MUTATIONS;
if (!selected.length) {
  console.error(`no mutation matches --only ${only}`);
  process.exit(2);
}

/**
 * Rewrites a multi-line anchor to the line endings the target file actually
 * uses. Engine sources in this repo are checked out CRLF on Windows, so an
 * anchor written with plain `\n` silently matches zero times - which would look
 * exactly like "the code moved" and quietly disable the entry.
 */
function toFileEol(text, fileContent) {
  return fileContent.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n');
}

function sh(cmd, cwd = REPO) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function isTracked(file) {
  return sh(`git status --porcelain -- ${JSON.stringify(file)}`).trim() === '';
}

function restore(file) {
  execFileSync('git', ['checkout', '--', file], { cwd: REPO, stdio: 'ignore' });
}

function rebuild() {
  execSync('node common/scripts/install-run-rush.js build -t @zephyr3d/visual-test', {
    cwd: REPO,
    stdio: 'ignore'
  });
}

/**
 * A mutation that fails to compile is a bad entry, not a harness failure. Left
 * unhandled it aborts the whole run partway through - which also skips the final
 * rebuild and leaves the workspace holding a build of mutated source.
 */
function tryRebuild() {
  try {
    rebuild();
    return true;
  } catch {
    return false;
  }
}

/** Runs the suite and returns the set of scene names that failed. */
function runSuite() {
  const reportPath = path.join(VISUAL_TEST, 'sensitivity-report.json');
  try {
    execSync(`npx playwright test --project=${PROJECT} --reporter=json`, {
      cwd: VISUAL_TEST,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath }
    });
  } catch {
    // Non-zero exit just means tests failed, which is the expected case here.
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  fs.rmSync(reportPath, { force: true });

  const failed = new Set();
  const walk = (suites) => {
    for (const s of suites ?? []) {
      for (const spec of s.specs ?? []) {
        if (spec.ok === false) {
          failed.add(spec.title);
        }
      }
      walk(s.suites);
    }
  };
  walk(report.suites);
  return failed;
}

// --- guards ----------------------------------------------------------------

const targets = [...new Set(selected.map((m) => m.file))];
for (const f of targets) {
  if (!isTracked(f)) {
    console.error(`refusing to run: ${f} has uncommitted changes.`);
    console.error('This script edits engine source in place and restores it with `git checkout --`,');
    console.error('which would destroy that work. Commit or stash it first.');
    process.exit(2);
  }
}

// Restore on interrupt, so Ctrl-C cannot leave engine source mutated.
let inFlight = null;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (inFlight) {
      console.error(`\ninterrupted - restoring ${inFlight}`);
      restore(inFlight);
    }
    process.exit(130);
  });
}

// --- baseline sanity -------------------------------------------------------

console.log('Verifying the suite is green before mutating anything...');
rebuild();
const preexisting = runSuite();
if (preexisting.size) {
  console.error(`refusing to run: ${preexisting.size} scene(s) already failing:`);
  for (const s of preexisting) {
    console.error(`  ${s}`);
  }
  console.error('Sensitivity results would be meaningless. Fix or re-accept those first.');
  process.exit(2);
}
console.log('Suite is green.\n');

// --- run -------------------------------------------------------------------

const results = [];
for (const m of selected) {
  process.stdout.write(`[${m.id}] `);

  const abs = path.join(REPO, m.file);
  const src = fs.readFileSync(abs, 'utf8');
  const find = toFileEol(m.find, src);
  const replace = toFileEol(m.replace, src);
  const hits = src.split(find).length - 1;
  if (hits !== 1) {
    console.log(`SKIP - anchor matched ${hits} times, expected exactly 1 (engine source moved?)`);
    results.push({ ...m, verdict: 'STALE', detail: `anchor matched ${hits} times` });
    continue;
  }

  inFlight = m.file;
  let failed = null;
  try {
    fs.writeFileSync(abs, src.replace(find, replace));
    failed = tryRebuild() ? runSuite() : null;
  } finally {
    restore(m.file);
    inFlight = null;
  }

  if (!failed) {
    console.log('BROKEN - the mutated source does not compile; rewrite this entry');
    results.push({ ...m, verdict: 'BROKEN', detail: 'mutated source failed to build' });
    continue;
  }

  const missed = m.expect.filter((s) => !failed.has(s));
  const extra = [...failed].filter((s) => !m.expect.includes(s));

  if (!m.expect.length) {
    console.log(`OBSERVED - detected by: ${[...failed].join(', ') || '(nothing)'}`);
    results.push({ ...m, verdict: 'OBSERVED', detail: [...failed].join(', ') });
  } else if (missed.length) {
    console.log(`BLIND - expected ${missed.join(', ')} to fail, they did not`);
    results.push({ ...m, verdict: 'BLIND', detail: `missed: ${missed.join(', ')}` });
  } else {
    console.log(`OK - caught by ${m.expect.length} expected${extra.length ? ` (+${extra.length} more)` : ''}`);
    results.push({ ...m, verdict: 'OK', detail: extra.length ? `also: ${extra.join(', ')}` : '' });
  }
}

// Leave the workspace with a build that matches the restored source.
console.log('\nRestoring build...');
rebuild();

// --- report ----------------------------------------------------------------

console.log('\n=== SENSITIVITY ===');
for (const r of results) {
  console.log(`${r.verdict.padEnd(9)} ${r.id.padEnd(32)} ${r.detail}`);
}

const blind = results.filter((r) => r.verdict === 'BLIND');
const stale = results.filter((r) => r.verdict === 'STALE');
const broken = results.filter((r) => r.verdict === 'BROKEN');

if (broken.length) {
  console.log(`\n${broken.length} entr(y/ies) no longer compile when applied. Rewrite them.`);
}
if (stale.length) {
  console.log(`\n${stale.length} entr(y/ies) could not be applied - the engine source they patch has moved.`);
  console.log('Re-anchor them, or delete them if the code they covered is gone.');
}
if (blind.length) {
  console.log(`\n${blind.length} coverage hole(s). The harness no longer notices:`);
  for (const r of blind) {
    console.log(`  ${r.id}: ${r.description}`);
  }
}
if (blind.length || broken.length || stale.length) {
  process.exit(1);
}
console.log('\nAll expectations held: the harness still catches what it is supposed to.');
