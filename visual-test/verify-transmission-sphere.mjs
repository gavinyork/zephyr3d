// Roughness probe for the light-space thickness pass on curved geometry.
//
//   cd visual-test && npm run build && node verify-transmission-sphere.mjs
//
// The `transmission-thickness-{ladder,scale,slant}` scenes pin the pass's
// *scale*, and they do it exactly. What they cannot see is its *smoothness*:
// every one of them puts a blocker depth across the shadow map that is constant
// or linear, and a zero-mean filter over a linear gradient returns the value at
// its centre however wide it is. Three separate artifacts - texel terracing,
// terminator combing, and a collapse to two flat levels - were plainly visible
// on a character while all three scenes stayed green.
//
// A sphere restores the missing dimension while keeping the answer arithmetic:
// the path through it is exactly `2R|cos(theta)|`, a smooth surface with no
// features of its own. The artifact is therefore separable from the signal by
// frequency alone, and what this script reports is the high-frequency part, in
// 8-bit levels.
//
// It deliberately does not check absolute values. The ladder already does that,
// and reproducing the camera projection here to predict `2R cos(theta)` per
// pixel would add a second thing that can be wrong to a measurement whose whole
// point is to isolate one.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HARNESS_PORT ?? 4401);

const SCENES = [
  { name: 'transmission-thickness-sphere', label: '1024', maxRms: 6.5 },
  { name: 'transmission-thickness-sphere-fine', label: '4096', maxRms: 4.0 }
];

/**
 * Ceilings, in 8-bit levels of the Laplacian's rms.
 *
 * Set a little above what the pass measures today - 5.55 at 1024 and 3.17 at
 * 4096 - so this fails on a regression rather than on noise. They are not a
 * quality target: the residual is dominated by the shadow map's sampling rate,
 * and a sweep of the texel size moved it from 7.5 to 0.9 levels while the pass
 * itself was unchanged. What the ceilings pin is the *algorithm* at a fixed
 * texel, which is where every choice in the pass was settled:
 *
 *   nearest taps, 16-point disc at 1 texel, clamp per tap   5.55 / 3.17
 *   bilinear taps instead of nearest                        7.52 / 4.15
 *   no disc at all                                         21.92 / 12.38
 *   disc widened to 2 texels                                5.96 / 4.22
 *   clamp applied once to the average                       5.94 / 3.46
 *
 * The first row is UE5's formulation exactly, and it wins on every count - each
 * of the others is a deviation that was added here on reasoning that sounded
 * right and measured worse.
 */

/** The sphere's span on a row, as the contiguous run of non-background pixels. */
function findRun(rgba, size, row) {
  let start = -1;
  let end = -1;
  for (let x = 0; x < size; x++) {
    if (rgba[(row * size + x) * 4] > 4) {
      if (start < 0) {
        start = x;
      }
      end = x;
    }
  }
  return start < 0 ? null : { start, end };
}

/**
 * Oscillation over the whole sphere, as the 5-point Laplacian.
 *
 * Two earlier attempts were the wrong instrument, and both failed quietly.
 *
 * A moving-average residual cannot follow curvature, so a steep but perfectly
 * smooth stretch of the ramp registers as a large residual and swamps what is
 * being looked for. The Laplacian is blind to any plane and returns only the
 * curvature times the sample spacing squared, which for this surface is a
 * fraction of a level - so whatever it reports above that is oscillation.
 *
 * A single scanline through the equator missed the artifact entirely, because
 * there the surface faces the *camera* squarely even where it is edge-on to the
 * light. The defect needs both: grazing light gives the shadow map a depth
 * gradient it cannot resolve, and grazing view packs many surface units into one
 * screen pixel so the result aliases on the way out. On a sphere that pairing
 * only happens away from the equator, which is exactly where one row does not
 * look. Sweeping the whole disc removes the need to guess where it lives.
 *
 * `alternationRate` is the discriminator between bent and serrated: smooth
 * curvature keeps the Laplacian's sign over a stretch, a comb flips it every
 * sample.
 */
function stats(rgba, size) {
  const at = (x, y) => rgba[(y * size + x) * 4];
  const inside = (x, y) => x >= 0 && y >= 0 && x < size && y < size && at(x, y) > 4;
  const lap = [];
  let alternations = 0;
  let comparisons = 0;
  let prevRowSign = new Map();
  let count = 0;
  for (let y = 1; y < size - 1; y++) {
    const rowSign = new Map();
    let prevSign = 0;
    for (let x = 1; x < size - 1; x++) {
      if (!inside(x, y) || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
        prevSign = 0;
        continue;
      }
      count++;
      const v = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * at(x, y);
      lap.push(v);
      const sign = Math.sign(v);
      rowSign.set(x, sign);
      if (prevSign !== 0 && sign !== 0) {
        comparisons++;
        if (prevSign !== sign) {
          alternations++;
        }
      }
      const above = prevRowSign.get(x) ?? 0;
      if (above !== 0 && sign !== 0) {
        comparisons++;
        if (above !== sign) {
          alternations++;
        }
      }
      prevSign = sign;
    }
    prevRowSign = rowSign;
  }
  const rms = Math.sqrt(lap.reduce((a, r) => a + r * r, 0) / Math.max(lap.length, 1));
  const peak = lap.reduce((a, r) => Math.max(a, Math.abs(r)), 0);
  const sorted = lap.map(Math.abs).sort((a, b) => a - b);
  const p99 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0;
  return {
    rms,
    peak,
    p99,
    alternationRate: comparisons ? alternations / comparisons : 0,
    pixels: count
  };
}

const server = spawn(process.execPath, [path.join(__dirname, 'tools', 'serve.mjs'), String(PORT)], {
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan']
});
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const results = [];
let failures = 0;
try {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?convention=reverse`, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__zephyrHarnessReady === true, null, { timeout: 60000 });
  const info = await page.evaluate(() => globalThis.__zephyrHarness.init('webgpu'));
  console.log(`adapter: ${info.adapter}\n`);

  for (const scene of SCENES) {
    const res = await page.evaluate((n) => globalThis.__zephyrHarness.runScene(n), scene.name);
    const rgba = Buffer.from(res.rgbaBase64, 'base64');
    const size = res.width;
    const s = stats(rgba, size);
    const failed = s.rms > scene.maxRms;
    if (failed) {
      failures++;
    }
    results.push({ label: scene.label, ...s });
    console.log(
      `${scene.name}\n` +
        `  shadow map          ${scene.label}\n` +
        `  sphere pixels       ${s.pixels}\n` +
        `  laplacian rms       ${s.rms.toFixed(2)} levels\n` +
        `  laplacian p99       ${s.p99} levels\n` +
        `  laplacian peak      ${s.peak} levels\n` +
        `  alternation rate    ${s.alternationRate.toFixed(3)}\n` +
        `  ceiling             ${scene.maxRms}${failed ? '   <-- OVER' : ''}\n`
    );
    // A coarse trace of the equator, so a shape problem is visible without
    // opening the image.
    const row = size >> 1;
    const run = findRun(rgba, size, row);
    if (run) {
      const values = [];
      for (let x = run.start; x <= run.end; x++) {
        values.push(rgba[(row * size + x) * 4]);
      }
      const step = Math.max(1, Math.floor(values.length / 24));
      const trace = [];
      for (let i = 0; i < values.length; i += step) {
        trace.push(values[i]);
      }
      console.log(`  equator  ${trace.join(' ')}\n`);
    }
  }
} finally {
  await browser.close();
  server.kill();
}

if (results.length === 2) {
  const [coarse, fine] = results;
  const ratio = fine.rms > 1e-6 ? coarse.rms / fine.rms : Infinity;
  console.log('--- where the residual comes from ---');
  console.log(`rms ${coarse.label} / rms ${fine.label} = ${ratio.toFixed(2)}  (4x the texel count)`);
  // Measured across a 40x sweep of the texel size, the residual follows roughly
  // its square root: 7.5 levels at the coarsest, 0.9 at the finest, with the
  // pass unchanged throughout. So a 4x resolution step is expected to buy about
  // 2x, and a ratio near that says the remaining error is the shadow map's
  // sampling rate rather than anything the pass can be rewritten to avoid. A
  // ratio near 1 would mean the opposite, and would be worth chasing.
  console.log(
    ratio > 1.5
      ? 'Sampling-rate bound, as expected. The lever is the shadow map resolution or\n' +
          'how tightly its cascade is fitted to the subject, not the filter.'
      : 'Not tracking the texel. Something in the pass is adding error independently\n' +
          'of the shadow map, which is worth chasing.'
  );
}

console.log(failures === 0 ? '\nOK' : `\n${failures} problem(s)`);

if (logs.length) {
  console.log('\n--- page logs ---');
  console.log(logs.slice(0, 20).join('\n'));
}
process.exit(failures === 0 ? 0 : 1);
