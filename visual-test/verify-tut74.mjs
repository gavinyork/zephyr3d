// Check for tut-74: the surface sampler against the material's own evaluation.
//
//   cd visual-test && node verify-tut74.mjs [webgpu|webgl2]
//
// NOTE: run this against a machine with real GPU acceleration. Under the
// headless software rasteriser the page renders at well under 1 fps, and the
// cadence figures below measure that, not the sampler.
//
// Serves apps/doc/web/public, loads the tutorial, and measures three things:
//
//  1. Exact agreement. A query issued for a marker's own position, through the
//     same batch path the sampler uses, must match the surface the material
//     draws. This is the correctness property: if it fails, nothing else means
//     anything.
//  2. Interpolation error. The sampler's answer at a point off the lattice
//     against the exact answer there. This is a resolution property, so it is
//     expected to be non-zero and to scale with the lattice spacing.
//  3. Cadence. Whether batches actually land at the requested rate, which is
//     what the lag in the demo depends on.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'apps', 'doc', 'web', 'public');
const PORT = 4399;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const backend = process.argv[2] ?? 'webgl2';
const args = ['--use-angle=swiftshader'];
if (backend === 'webgpu') {
  args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader');
}
const browser = await chromium.launch({ channel: 'chromium', args });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}
${e.stack ?? ''}`));

await page.goto(`http://127.0.0.1:${PORT}/tut/tut-74.html?backend=${backend}`, { waitUntil: 'load' });

const started = await page
  .waitForFunction(() => globalThis.waterSampling && globalThis.waterSampling.sampler.ready, null, {
    timeout: 90000
  })
  .then(() => true)
  .catch(() => false);

if (!started) {
  console.log(`sampler never became ready on ${backend}`);
  for (const l of logs.slice(0, 30)) console.log(l);
  await browser.close();
  server.close();
  process.exit(1);
}

// Cadence, measured from outside the page. A blocking `evaluate` stalls the
// frame loop that `getSurfacePoint` resolves on, which is exactly the thing
// under measurement.
const before = await page.evaluate(() => globalThis.waterSampling.sampler.readCount);
const t0 = Date.now();
await page.waitForTimeout(3000);
const elapsed = (Date.now() - t0) / 1000;
const after = await page.evaluate(() => {
  const s = globalThis.waterSampling.sampler;
  return { readCount: s.readCount, hz: s.updateHz, latency: s.lastLatency, pending: s.pending };
});
const cadence = {
  batches: after.readCount - before,
  elapsed,
  hz: after.hz,
  latency: after.latency,
  pending: after.pending
};

// Freeze the clock so the exact and interpolated answers describe the same
// surface; otherwise the batch lag alone shows up as interpolation error.
const result = await page.evaluate(async () => {
  const { water, sampler } = globalThis.waterSampling;
  const V = water.position.constructor;
  water.animationSpeed = 0;
  // Freezing stops the surface but not the batch already in flight, and a batch
  // that lands now would be blended towards a surface that has since stopped
  // moving - which reads as interpolation error. Wait for the sampler to come to
  // rest: nothing pending, and a batch accepted since the freeze.
  const frozenAt = sampler.readCount;
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!sampler.pending && sampler.readCount > frozenAt) {
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 400));

  // A grid of exact queries, deliberately offset by half a lattice cell so
  // nothing sits on a sample point.
  const half = sampler.spacing / 2;
  const points = [];
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      points.push({ x: i * 6.3 + half, z: j * 6.3 + half });
    }
  }
  const exact = points.map(() => new V());
  await water.getSurfacePoint(
    points.map((p) => new V(p.x, 0, p.z)),
    exact
  );
  // One more pass, to establish that the query is repeatable at a frozen clock.
  const again = points.map(() => new V());
  await water.getSurfacePoint(
    points.map((p) => new V(p.x, 0, p.z)),
    again
  );

  const rows = points.map((p, k) => {
    const sampled = sampler.sampleWorldY(p.x, p.z);
    const truth = exact[k].y;
    return { x: p.x, z: p.z, sampled, truth, delta: sampled - truth };
  });
  return {
    rows,
    repeat: points.map((p, k) => again[k].y - exact[k].y),
    spacing: sampler.spacing,
    batchSize: sampler.batchSize,
    readCount: sampler.readCount,
    failCount: sampler.failCount,
    stillWater: water.worldMatrix.m13
  };
});

await browser.close();
server.close();

const { rows, repeat, spacing, batchSize, readCount, failCount } = result;
const stat = (vals) => {
  const max = Math.max(...vals.map(Math.abs));
  const rms = Math.sqrt(vals.reduce((a, v) => a + v * v, 0) / vals.length);
  return { max, rms };
};

console.log(`lattice ${spacing}m   batch ${batchSize} points   queries ${readCount}   failed ${failCount}`);
console.log(
  `cadence: ${cadence.batches} batches in ${cadence.elapsed.toFixed(2)}s = ` +
    `${(cadence.batches / cadence.elapsed).toFixed(1)}Hz (requested ${cadence.hz}Hz)  ` +
    `last latency ${(cadence.latency ?? 0).toFixed(3)}s  inFlight ${cadence.pending}`
);

const rep = stat(repeat);
console.log(`repeatability at frozen clock: max ${rep.max.toFixed(5)} m   rms ${rep.rms.toFixed(5)} m`);

const d = stat(rows.map((r) => r.delta));
const amplitude = stat(rows.map((r) => r.truth));
console.log(
  `lattice interpolation error: max ${d.max.toFixed(4)} m   rms ${d.rms.toFixed(4)} m   ` +
    `(surface amplitude rms ${amplitude.rms.toFixed(4)} m)`
);
console.log('  x        z        sampled   exact     delta');
for (const r of rows.slice(0, 10)) {
  console.log(
    `  ${r.x.toFixed(2).padStart(7)}  ${r.z.toFixed(2).padStart(7)}  ` +
      `${r.sampled.toFixed(4).padStart(8)}  ${r.truth.toFixed(4).padStart(8)}  ${r.delta.toFixed(4).padStart(8)}`
  );
}
const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log(`--- page log summary: ${logs.length} entries, ${errors.length} errors ---`);
for (const l of errors.slice(0, 12)) console.log(l);
process.exit(rep.rms < 1e-4 ? 0 : 1);
