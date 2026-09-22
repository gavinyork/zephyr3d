// Numeric check for the light-space thickness pass.
//
//   cd visual-test && npm run build && node verify-transmission-thickness.mjs
//
// The two `transmission-thickness-*` scenes are built so that the right answer
// is arithmetic rather than a recorded image (see the scene file for why a
// baseline is the wrong instrument here). This script runs them through the
// harness, reads the raw capture back, and prints measured against predicted for
// every slab.
//
// It locates the slabs from the capture itself rather than from a projection
// formula - they are the runs of lit pixels along the middle scanline. Framing
// arithmetic that was slightly wrong would otherwise present as a shader bug.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HARNESS_PORT ?? 4399);

/** Optical depth ceiling and the additive bias, mirrored from the pass. */
const MAX_OPTICAL_DEPTH = 5;
const CLAMP_FLOOR = 0.15;
const BIAS = 0.25;
/** Normal shrink, in millimetres: the default profile's normalScale * 0.5, in cm. */
const SHRINK_MM = 0.4;

/** What the debug channel should show for a measured light-ray path, in mm. */
function expectedDebug(pathMm) {
  const od = Math.min(Math.max(Math.abs(pathMm), CLAMP_FLOOR), MAX_OPTICAL_DEPTH) + BIAS;
  // dbg = 1 - encoded, encoded = 1 - od / MAX. Clipped by the 8-bit target.
  return Math.min(od / MAX_OPTICAL_DEPTH, 1);
}

// The scenes switch the tonemapper off (see the scene file), and the capture
// target is plain rgba8unorm, so the debug value reaches the buffer linearly:
// measured, the ladder lands within one 8-bit level of the arithmetic at every
// rung. No transfer inversion is needed or wanted - inverting one that is not
// there would be the easiest way to turn a correct pass into a failing test.

const SCENES = [
  {
    name: 'transmission-thickness-ladder',
    // Zero depth slope across a texel, so this is the exact case: the tolerance
    // is one 8-bit level plus rounding.
    tol: 0.01,
    // Slabs perpendicular to the light, so the path is the thickness itself.
    // Left to right, in millimetres.
    labels: ['0.5mm', '1mm', '2mm', '3mm', '4mm', '5mm'],
    paths: [0.5, 1, 2, 3, 4, 5]
  },
  {
    name: 'transmission-thickness-scale',
    // 4x geometry with worldUnitScale 4. Identical expectations to the ladder by
    // construction: the pass must measure in the profile's millimetres, so the
    // asset's own scale must divide back out.
    tol: 0.01,
    labels: ['0.5mm', '1mm', '2mm', '3mm', '4mm', '5mm'],
    paths: [0.5, 1, 2, 3, 4, 5]
  },
  {
    // Tilt puts a depth gradient across the texel the blocker is sampled from,
    // and the view incidence that comes with it (tilt plus the camera's own
    // off-axis angle) degrades the receiver position the depth prepass
    // reconstructs. Measured at 4096: exact at 20 degrees, 0.08 mm thin at 35,
    // 0.35 mm thin at 50 - where the total view incidence is already 67 degrees.
    // So the absolute tolerance is loose, and `slopeFloor` carries the real
    // assertion instead.
    tol: 0.08,
    // Fraction of the predicted rise that must actually materialise. This is the
    // property the scene exists for: the pass must report the path *along the
    // light ray*, which grows as 1/cos(theta). Anything that converts it back
    // into the perpendicular thickness - multiplying the optical depth by NoL,
    // as the first transcription did - makes the rise vanish entirely, so the
    // measured fractions of 1.03 / 0.83 / 0.72 sit nowhere near the floor.
    slopeFloor: 0.5,
    name: 'transmission-thickness-slant',
    // 2 mm slabs tilted off the light. The path is t / cos(theta), and the
    // shrink's contribution along the light ray is only shrink * cos(theta),
    // while the bias that compensates it is unconditional - hence the
    // + shrink * (1 - cos(theta)) residue.
    labels: ['0deg', '20deg', '35deg', '50deg'],
    paths: [0, 20, 35, 50].map((deg) => {
      const c = Math.cos((deg * Math.PI) / 180);
      return 2 / c + SHRINK_MM * (1 - c);
    })
  }
];

/**
 * Contiguous runs of lit pixels along a scanline, with their pixel stats.
 *
 * The background reads as pure black: the debug channel's own "no light wrote
 * this" marker is blue, but it only reaches pixels the SkinSSS effect runs on,
 * and the background has no skin mask - so empty space stays at the clear
 * colour. That is a cleaner separator than the blue marker would have been.
 *
 * The reported `value` is the median of the run's central half, not the value at
 * its midpoint. The edge pixels of every slab read much thicker than its body
 * (a silhouette artefact of the pass, tracked separately), and a single-pixel
 * sample that happens to land in that fringe would be read as a scale error.
 * `lo`/`hi` keep the fringe visible instead of hiding it.
 */
function findRuns(rgba, size, row) {
  const runs = [];
  let start = -1;
  for (let x = 0; x <= size; x++) {
    const solid = x < size && rgba[(row * size + x) * 4] > 4;
    if (solid && start < 0) {
      start = x;
    } else if (!solid && start >= 0) {
      const end = x - 1;
      if (end - start + 1 >= 8) {
        const vals = [];
        for (let k = start; k <= end; k++) {
          vals.push(rgba[(row * size + k) * 4]);
        }
        const quarter = Math.floor(vals.length / 4);
        const core = vals.slice(quarter, vals.length - quarter).sort((a, b) => a - b);
        runs.push({
          start,
          end,
          value: core[core.length >> 1],
          lo: Math.min(...vals),
          hi: Math.max(...vals)
        });
      }
      start = -1;
    }
  }
  return runs;
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
    const runs = findRuns(rgba, size, size >> 1);
    console.log(`${scene.name}  (${runs.length} slabs found, expected ${scene.paths.length})`);
    if (runs.length !== scene.paths.length) {
      console.log(
        `  !! slab count mismatch - framing or the scene itself is wrong, values below are unaligned`
      );
      failures++;
    }
    console.log('  slab      path(mm)  expect  measured  delta   rise    fringe');
    const measured = runs.map((r) => r.value / 255);
    runs.forEach((run, i) => {
      const pathMm = scene.paths[i];
      const label = scene.labels[i] ?? `run${i}`;
      const expect = pathMm === undefined ? NaN : expectedDebug(pathMm);
      const delta = measured[i] - expect;
      // Fraction of the predicted rise over the first slab that materialised.
      const wantRise = expect - expectedDebug(scene.paths[0]);
      const gotRise = measured[i] - measured[0];
      const rise = wantRise > 1e-6 ? gotRise / wantRise : NaN;
      const bad =
        Math.abs(delta) > scene.tol ||
        (scene.slopeFloor !== undefined && wantRise > 1e-6 && rise < scene.slopeFloor);
      console.log(
        `  ${label.padEnd(8)}  ${(pathMm ?? NaN).toFixed(3).padStart(7)}  ${expect.toFixed(3)}   ` +
          `${measured[i].toFixed(3)}    ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}  ` +
          `${Number.isNaN(rise) ? '  -  ' : rise.toFixed(2).padStart(5)}   ` +
          `${run.lo}..${run.hi}${bad ? '  <-- OFF' : ''}`
      );
      if (bad) {
        failures++;
      }
    });
    // Monotonicity is the transfer-curve-independent half of the check: whatever
    // the blit does to the values, thicker must not read thinner.
    const vals = runs.map((r) => r.value);
    const monotone = vals.every((v, i) => i === 0 || v >= vals[i - 1] - 1);
    console.log(`  monotone increasing: ${monotone ? 'yes' : 'NO'}`);
    if (!monotone) {
      failures++;
    }
    console.log('');
  }
} finally {
  await browser.close();
  server.kill();
}

if (logs.length) {
  console.log('--- page logs ---');
  console.log(logs.slice(0, 40).join('\n'));
}
console.log(failures === 0 ? 'OK' : `${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
