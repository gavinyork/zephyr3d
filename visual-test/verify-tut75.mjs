// Check for tut-75: the interaction field keeps stepping and the disturbers keep
// injecting after the field is detached from the water and attached again.
//
//   cd visual-test && node verify-tut75.mjs [webgpu|webgl2]
//
// Serves apps/doc/web/public, loads the tutorial, flattens the ambient sea so
// the field is the only thing displacing the surface, and reads the surface
// back through Water.getSurfacePoint - the same evaluation the material draws
// with - along the boat's track after driving it across the water.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'apps', 'doc', 'web', 'public');
const PORT = 4398;
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
// `--real` runs a visible window on the machine's own GPU: a hidden window's
// rAF is throttled to about 1 Hz, which hides anything frame-rate dependent.
const real = process.argv.includes('--real');
const args = [];
if (!real) {
  if (backend === 'webgpu') {
    args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader');
  } else {
    args.push('--use-angle=swiftshader');
  }
} else if (backend === 'webgpu') {
  args.push('--enable-unsafe-webgpu');
}
const browser = await chromium.launch({ channel: 'chromium', args, headless: !real });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

await page.goto(`http://127.0.0.1:${PORT}/tut/tut-75.html?backend=${backend}`, { waitUntil: 'load' });

const started = await page
  .waitForFunction(() => globalThis.waterInteraction && globalThis.waterInteraction.interaction.version > 3, null, {
    timeout: 120000
  })
  .then(() => true)
  .catch(() => false);
if (!started) {
  console.log(`field never stepped on ${backend}`);
  for (const l of logs.slice(0, 40)) console.log(l);
  await browser.close();
  server.close();
  process.exit(1);
}


/**
 * Drive the boat straight along +Z for a while, then read the surface back at
 * points along the track it just left. Returns the largest |height| seen.
 */
async function driveAndMeasure(label) {
  return page.evaluate(async (label) => {
    const { water, interaction, boat } = globalThis.waterInteraction;
    const V = water.position.constructor;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const v0 = interaction.version;
    boat.node.position.setXYZ(0, 0, -6);
    boat.yaw = 0;
    boat.speed = 0;
    // Teleport a step a frame: the demo's own tick would also move it, but this
    // does not depend on keyboard focus.
    for (let i = 0; i < 40; i++) {
      boat.node.position.z += 0.3;
      await sleep(33);
    }
    await sleep(200);
    const stepped = interaction.version - v0;
    const points = [];
    for (let i = 0; i < 12; i++) {
      points.push(new V(0.6, 0, -5 + i));
    }
    const out = points.map(() => new V());
    await water.getSurfacePoint(points, out);
    let maxAbs = 0;
    for (const p of out) {
      maxAbs = Math.max(maxAbs, Math.abs(p.y - water.position.y));
    }
    return { label, stepped, maxAbs, heights: out.map((p) => +(p.y - water.position.y).toFixed(4)) };
  }, label);
}

// Flat ambient sea: the field is then the only displacement.
await page.evaluate(() => {
  const { waves, water } = globalThis.waterInteraction;
  waves.setWaveStrength(0, 0);
  waves.setWaveStrength(1, 0);
  waves.setWaveStrength(2, 0);
  water.foamAmount = 0;
});
await page.waitForTimeout(1500);

const first = await driveAndMeasure('attached');
// Let the wake die down before the next run.
await page.waitForTimeout(3000);
const quiet = await page.evaluate(async () => {
  const { water } = globalThis.waterInteraction;
  const V = water.position.constructor;
  const points = [];
  for (let i = 0; i < 12; i++) points.push(new V(0.6, 0, -5 + i));
  const out = points.map(() => new V());
  await water.getSurfacePoint(points, out);
  return Math.max(...out.map((p) => Math.abs(p.y - water.position.y)));
});

// Detach, wait some frames, reattach.
const waitFrames = (n) =>
  page.evaluate(async (n) => {
    const dev = globalThis.waterInteraction.device;
    const start = dev.frameInfo.frameCounter;
    while (dev.frameInfo.frameCounter < start + n) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }, n);
const probe = () =>
  page.evaluate(() => {
    const { interaction } = globalThis.waterInteraction;
    return {
      disposed: interaction.disposed,
      disturbers: interaction.disturbers.length,
      version: interaction.version,
      origin: [interaction.originX, interaction.originZ],
      frame: globalThis.waterInteraction.device.frameInfo.frameCounter
    };
  });
const beforeDetach = await probe();
await page.evaluate(() => {
  const { water } = globalThis.waterInteraction;
  water.interaction = null;
});
await waitFrames(5);
const detached = await probe();
await page.evaluate(() => {
  const { water, interaction } = globalThis.waterInteraction;
  water.interaction = interaction;
});
await waitFrames(5);
const reattached = await probe();
const second = await driveAndMeasure('reattached');
const afterSecond = await probe();

// The user's own path: the checkbox, a long detach, the keyboard.
const sampleTrack = () =>
  page.evaluate(async () => {
    const { water, buoy } = globalThis.waterInteraction;
    const V = water.position.constructor;
    const points = [];
    for (let i = 0; i < 12; i++) points.push(new V(0.6, 0, -5 + i));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      points.push(new V(buoy.position.x + Math.cos(a) * 1.6, 0, buoy.position.z + Math.sin(a) * 1.6));
    }
    const out = points.map(() => new V());
    await water.getSurfacePoint(points, out);
    const h = out.map((p) => +(p.y - water.position.y).toFixed(4));
    return { track: h.slice(0, 12), buoy: h.slice(12), trackMax: Math.max(...h.slice(0, 12).map(Math.abs)), buoyMax: Math.max(...h.slice(12).map(Math.abs)) };
  });
await page.evaluate(() => {
  const { boat } = globalThis.waterInteraction;
  boat.node.position.setXYZ(0, 0, -6);
  boat.yaw = 0;
  boat.speed = 0;
});
await page.click('#enabled-check');
await page.waitForTimeout(3000);
const uiDetached = await probe();
const uiDetachedTrack = await sampleTrack();
await page.click('#enabled-check');
await page.waitForTimeout(500);
const uiReattached = await probe();
// Click the canvas away from the UI so it has keyboard focus, then drive.
await page.mouse.click(900, 600);
await page.keyboard.down('w');
await page.waitForTimeout(1500);
await page.keyboard.up('w');
await page.waitForTimeout(300);
const uiBoat = await page.evaluate(() => {
  const { boat } = globalThis.waterInteraction;
  return { z: boat.node.position.z, speed: boat.speed };
});
const uiTrack = await sampleTrack();
const uiAfter = await probe();
console.log(
  JSON.stringify({ uiDetached, uiDetachedTrack, uiReattached, uiBoat, uiTrack, uiAfter }, null, 2)
);

console.log(
  JSON.stringify({ backend, first, quiet, beforeDetach, detached, reattached, second, afterSecond }, null, 2)
);
const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errors.length) {
  console.log('--- page errors ---');
  for (const l of errors.slice(0, 20)) console.log(l);
}
const ok =
  first.maxAbs > 0.005 &&
  reattached.version > detached.version &&
  reattached.disturbers === beforeDetach.disturbers &&
  !reattached.disposed &&
  second.maxAbs > 0.005;
console.log(ok ? 'PASS' : 'FAIL');
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
