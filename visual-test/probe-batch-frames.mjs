// How many frames does one sampler batch span? Reads the tut-74 sampler's own
// counter (frames between one accepted batch and the next), which at the
// software rasteriser's ~0.4 fps is dominated by where mapAsync's completion
// task happens to land relative to the next rAF, so treat the figure as a
// coarse regression check, not a latency measurement. What it is good for is
// catching a structural regression: on this setup the readback path went 5 -> 4
// when onNextSubmit stopped waiting for a submit that had already happened, and
// a change that pushes it back up is a change that reintroduced a wait. The
// number that matters is the one the demo's status panel shows on a real GPU.
//
// Usage: node probe-batch-frames.mjs [webgpu|webgl2]   (software adapter only)
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'apps', 'doc', 'web', 'public');
const PORT = 4388;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end('x'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const backend = process.argv[2] ?? 'webgpu';
const args = backend === 'webgpu'
  ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan']
  : ['--use-gl=angle', '--use-angle=swiftshader'];
const browser = await chromium.launch({ channel: 'chromium', args });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/tut/tut-74.html?backend=${backend}`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.waterSampling && globalThis.waterSampling.sampler.readCount >= 4, null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const s = globalThis.waterSampling.sampler;
  return { readCount: s.readCount, batchFrames: s.batchFrames, latency: s.lastLatency };
});
// Sample a few more batches to get a stable figure.
const frames = [r.batchFrames];
for (let i = 0; i < 4; i++) {
  const before = await page.evaluate(() => globalThis.waterSampling.sampler.readCount);
  await page.waitForFunction((b) => globalThis.waterSampling.sampler.readCount > b, before, { timeout: 60000 }).catch(() => {});
  frames.push(await page.evaluate(() => globalThis.waterSampling.sampler.batchFrames));
}
await browser.close(); server.close();
console.log(`[${backend}/swiftshader] frames per batch over ${frames.length} batches: ${frames.join(' ')}   (min ${Math.min(...frames)}, max ${Math.max(...frames)})`);
if (errs.length) console.log('errors: ' + errs.slice(0, 3).join(' | '));
