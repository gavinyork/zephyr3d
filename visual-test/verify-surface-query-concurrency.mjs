// Two overlapping surface queries of different sizes must not corrupt each
// other.
//
// This is the regression for the black flash. Two callers hitting
// `Water.getSurfacePoint` in the same frame - one with a 225-point lattice, one
// with 49 markers - were both admitted through a serialising queue that did not
// actually serialise, and the second rebuilt the shared vertex buffer to 49
// points while the first's 225-point draw was still in the command stream. The
// GPU then rejected the draw ("requires a larger buffer") and the frame went
// black.
//
// The check is behavioural: fire the two together, many times, and require that
// every result is finite and that each caller's answer matches a solo query of
// the same points. A caller whose buffer was clobbered gets garbage or zeros.
//
// WHAT THIS DOES AND DOES NOT PROVE. The corruption is a WebGPU artefact: that
// backend resolves a primitive's vertex buffer when the command buffer is
// flushed, so a second caller swapping the buffer after the first has recorded
// its draw is what breaks the first. WebGL2 binds at draw time and both draws
// are immediate, so on WebGL2 the broken queue produces correct answers. This
// test was run against the pre-fix queue on BOTH webgl2/swiftshader AND
// webgpu/swiftshader and PASSED on both: the software WebGPU adapter does not
// reproduce the race either. It therefore guards the answers' correctness, not
// the queue itself, on any backend available headlessly. The only run that
// exercises the race is `node verify-surface-query-concurrency.mjs webgpu` on a
// machine with a real WebGPU adapter, which is where the error was observed.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'apps', 'doc', 'web', 'public');
const PORT = 4387;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end('x');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// Usage: node verify-surface-query-concurrency.mjs [webgl2|webgpu] [gpu|swiftshader]
//
// The adapter defaults to the real GPU, because that is the run that exercises
// the race and the one a developer's machine can do. `swiftshader` forces the
// software rasteriser and is what the headless setup here has to use; it can
// bring up webgl2 but not webgpu. The flag sets match the projects in
// playwright.config.ts, so a pass here means the same thing as a pass there.
const backend = process.argv[2] ?? 'webgl2';
const adapter = process.argv[3] ?? 'gpu';
if (!['webgl2', 'webgpu'].includes(backend) || !['gpu', 'swiftshader'].includes(adapter)) {
  console.error('usage: node verify-surface-query-concurrency.mjs [webgl2|webgpu] [gpu|swiftshader]');
  process.exit(2);
}
const args =
  adapter === 'swiftshader'
    ? backend === 'webgpu'
      ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan']
      : ['--use-gl=angle', '--use-angle=swiftshader']
    : backend === 'webgpu'
      ? ['--enable-unsafe-webgpu']
      : [];
const browser = await chromium.launch({ channel: 'chromium', args });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/tut/tut-74.html?backend=${backend}`, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => globalThis.waterSampling && globalThis.waterSampling.sampler.ready, null, {
    timeout: 90000
  });
} catch {
  // A bare TimeoutError says nothing about why the page never came up. The
  // console is where the device init failure lands, so surface it.
  console.log(`[${backend}/${adapter}] page never became ready; console said:`);
  if (consoleErrors.length === 0) console.log('  (nothing - the page loaded but the sampler never produced a batch)');
  for (const e of consoleErrors.slice(0, 12)) console.log('  ' + e);
  await browser.close();
  server.close();
  process.exit(1);
}

const r = await page.evaluate(async () => {
  const { water, sampler } = globalThis.waterSampling;
  const V = water.position.constructor;
  // Silence the demo's own sampler so the only queries in flight are ours.
  sampler.update = () => {};
  water.animationSpeed = 0;
  await new Promise((res) => setTimeout(res, 300));

  const big = [];
  for (let j = 0; j < 15; j++) for (let i = 0; i < 15; i++) big.push(new V(i * 6 - 42, 0, j * 6 - 42));
  const small = [];
  for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) small.push(new V(i * 4 - 12, 0, j * 4 - 12));

  // Reference answers, each taken alone.
  const bigRef = big.map(() => new V());
  await water.getSurfacePoint(big, bigRef);
  const smallRef = small.map(() => new V());
  await water.getSurfacePoint(small, smallRef);

  // Now the two together, repeatedly, in both orders.
  let mismatches = 0;
  let nonFinite = 0;
  let worst = 0;
  const ROUNDS = 12;
  for (let round = 0; round < ROUNDS; round++) {
    const bigOut = big.map(() => new V());
    const smallOut = small.map(() => new V());
    const a = water.getSurfacePoint(big, bigOut);
    const b = water.getSurfacePoint(small, smallOut);
    if (round % 2) {
      await Promise.all([b, a]);
    } else {
      await Promise.all([a, b]);
    }
    for (let i = 0; i < big.length; i++) {
      const d = Math.abs(bigOut[i].y - bigRef[i].y);
      if (!Number.isFinite(bigOut[i].y)) nonFinite++;
      else if (d > 1e-4) mismatches++;
      worst = Math.max(worst, Number.isFinite(d) ? d : Infinity);
    }
    for (let i = 0; i < small.length; i++) {
      const d = Math.abs(smallOut[i].y - smallRef[i].y);
      if (!Number.isFinite(smallOut[i].y)) nonFinite++;
      else if (d > 1e-4) mismatches++;
      worst = Math.max(worst, Number.isFinite(d) ? d : Infinity);
    }
  }
  return { rounds: ROUNDS, points: (big.length + small.length) * ROUNDS, mismatches, nonFinite, worst };
});

await browser.close();
server.close();

const bufferErrors = consoleErrors.filter((e) => /larger buffer|Vertex range/i.test(e));
console.log(
  `[${backend}/${adapter}] ${r.rounds} rounds of a 225-point and a 49-point query issued together, ${r.points} answers checked`
);
console.log(`  mismatches vs solo answers: ${r.mismatches}   non-finite: ${r.nonFinite}   worst |delta| ${r.worst.toExponential(2)} m`);
console.log(`  GPU buffer-size errors on the console: ${bufferErrors.length}`);
const pass = r.mismatches === 0 && r.nonFinite === 0 && bufferErrors.length === 0;
console.log(pass ? 'PASS' : 'FAIL');
if (!pass && bufferErrors.length) console.log('  first: ' + bufferErrors[0]);
process.exit(pass ? 0 : 1);
