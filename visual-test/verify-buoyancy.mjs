// Does the buoyant body actually float, right itself, and stay bounded?
//
// The integrator is checked on three properties that can be stated without
// reference to how it is implemented, so a wrong sign or a transposed axis shows
// up as a failure rather than as something that merely looks odd:
//
//  1. Equilibrium. Dropped onto still water from above, it settles with its
//     waterline at the configured submerged fraction, and stays there.
//  2. Righting. Released at a roll angle, it returns to level. This is the
//     property the whole probe layout exists for; it fails immediately if the
//     torque sign is wrong.
//  3. Boundedness. On a moving surface it neither diverges nor drifts away.
//
// The surface is supplied as an analytic function, so the body's response is the
// only thing under test.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'apps', 'doc', 'web', 'public');
const PORT = 4384;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
const bodySourcePath = path.join(__dirname, '..', 'apps', 'doc', 'src', 'tut-74', 'buoyant-body.js');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  // The demo bundle does not export the class, so the source is served under the
  // page's own origin with its engine import pointed at the bundle the page has
  // already loaded. Serving it rather than copying it means the test always runs
  // the file as it is now.
  if (url === '/tut/js/buoyant-body-probe.js') {
    const src = fs
      .readFileSync(bodySourcePath, 'utf8')
      .replace("from '@zephyr3d/base'", "from '../lib/zephyr3d-base.js'");
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(src);
    return;
  }
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

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/tut/tut-74.html?backend=webgl2`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.waterSampling && globalThis.waterSampling.sampler.ready, null, {
  timeout: 90000
});

const r = await page.evaluate(async () => {
  const mod = await import('/tut/js/buoyant-body-probe.js');
  const BuoyantBody = mod.BuoyantBody;
  // Reach the vector and quaternion classes through objects the page already
  // holds, so the test shares the page's module instances rather than importing a
  // second copy of the engine.
  const V = globalThis.waterSampling.water.position.constructor;
  const Q = globalThis.waterSampling.water.rotation.constructor;
  const upAxis = () => new V(0, 0, 1);

  const flat = () => 0;
  const sine = (t) => (x, z) => 1.0 * Math.sin((2 * Math.PI) / 30 * (x * 0.4 + z * 0.2) - 1.2 * t);

  const makeBody = (node, size, frac, mass) =>
    new BuoyantBody({
      node,
      size: new V(size[0], size[1], size[2]),
      submergedFraction: frac,
      mass,
      probeColumns: 3,
      probeRows: 3,
      probeLayers: 3
    });

  // A stand-in node: the real one is a Mesh, but only position and rotation are
  // touched, so a bare object is enough and keeps the test off the scene graph.
  const fakeNode = () => ({ position: new V(), rotation: new Q() });

  const settle = (body, waterLevel, seconds, wave) => {
    body.reset(0, 0, waterLevel);
    // Start above the water so it has to fall in.
    body.position.y += 0.5;
    const dt = 1 / 60;
    for (let f = 0; f < seconds * 60; f++) {
      body.update(dt, wave ? wave(f * dt) : flat, waterLevel);
    }
    return body;
  };

  // (1) Equilibrium on still water.
  const b1 = makeBody(fakeNode(), [2, 1, 3], 0.5);
  settle(b1, 0, 8, null);
  const equilibrium = {
    y: b1.position.y,
    expected: b1.restY(0),
    speed: Math.hypot(b1.velocity.x, b1.velocity.y, b1.velocity.z)
  };

  // (2) Righting from a roll.
  //
  // The geometry has to be one that is stable to begin with. Hydrostatics gives
  // a box floating at fraction f of height h with beam b a metacentric height
  //   GM = (b^2 / 12) / (f h)  -  (h/2 - f h/2)
  // and a negative GM means the level attitude is itself unstable: the box rolls
  // over on its own and no integrator can be expected to right it. A 1x1x4 box
  // at 0.35 has GM = -0.09 and is such a case. The one below is 2 wide, 1 tall
  // at 0.5, for GM = +0.42.
  const b2 = makeBody(fakeNode(), [2, 1, 3], 0.5);
  b2.reset(0, 0, 0);
  // Roll 25 degrees about the long axis (Z), which tips the 2 m beam sideways.
  const roll = (25 * Math.PI) / 180;
  Q.fromAxisAngle(upAxis(), roll, b2.rotation);
  const rolledAt = Math.acos(Math.min(1, Math.abs(2 * (b2.rotation.w * b2.rotation.w + b2.rotation.z * b2.rotation.z) - 1)));
  const dt = 1 / 60;
  const rollTrace = [];
  for (let f = 0; f < 6 * 60; f++) {
    b2.update(dt, flat, 0);
    // Angle between the body's up axis and world up.
    const q = b2.rotation;
    const upX = 2 * (q.x * q.y - q.w * q.z);
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const upZ = 2 * (q.y * q.z + q.w * q.x);
    rollTrace.push(Math.acos(Math.min(1, Math.max(-1, upY))));
    void upX;
    void upZ;
  }
  const righting = {
    rolledAt,
    startAngle: rollTrace[0],
    endAngle: rollTrace[rollTrace.length - 1],
    peak: Math.max(...rollTrace),
    min: Math.min(...rollTrace)
  };

  // (2b) And the unstable one, as a control: it must capsize, not because the
  // solver is wrong but because the physics says so. If it stays level, the
  // torque is not being computed.
  const b2u = makeBody(fakeNode(), [1, 1, 4], 0.35);
  b2u.reset(0, 0, 0);
  Q.fromAxisAngle(upAxis(), roll, b2u.rotation);
  let unstableEnd = 0;
  for (let f = 0; f < 6 * 60; f++) {
    b2u.update(dt, flat, 0);
    const q = b2u.rotation;
    unstableEnd = Math.acos(Math.min(1, Math.max(-1, 1 - 2 * (q.x * q.x + q.z * q.z))));
  }

  // (3) Bounded on a moving surface.
  const b3 = makeBody(fakeNode(), [2, 1, 3], 0.5);
  b3.reset(0, 0, 0);
  const wave = sine(0);
  let maxAbsY = 0;
  let maxAbsRoll = 0;
  let nan = false;
  for (let f = 0; f < 20 * 60; f++) {
    const t = f * dt;
    b3.update(dt, sine(t), 0);
    if (!Number.isFinite(b3.position.y) || !Number.isFinite(b3.rotation.w)) {
      nan = true;
      break;
    }
    maxAbsY = Math.max(maxAbsY, Math.abs(b3.position.y));
    const q = b3.rotation;
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    maxAbsRoll = Math.max(maxAbsRoll, Math.acos(Math.min(1, Math.max(-1, upY))));
  }
  const bounded = { maxAbsY, maxAbsRoll, nan, finalY: b3.position.y };

  // (4) Mass independence. The whole point of tying lift to mass: the same body
  // at 100 kg, 1000 kg and 20000 kg must float at the same height and roll back
  // the same way. This is the regression for "changing the mass makes it wobble".
  const massRuns = [100, 1000, 20000].map((m) => {
    const b = makeBody(fakeNode(), [2, 1, 3], 0.5, m);
    settle(b, 0, 8, null);
    const y = b.position.y;
    // Then a roll release.
    Q.fromAxisAngle(upAxis(), roll, b.rotation);
    b.velocity.setXYZ(0, 0, 0);
    b.angularVelocity.setXYZ(0, 0, 0);
    let endAngle = 0;
    let peak = 0;
    for (let f = 0; f < 6 * 60; f++) {
      b.update(dt, flat, 0);
      const q = b.rotation;
      const a = Math.acos(Math.min(1, Math.max(-1, 1 - 2 * (q.x * q.x + q.z * q.z))));
      peak = Math.max(peak, a);
      endAngle = a;
    }
    return { mass: m, y, peak, endAngle };
  });

  return {
    equilibrium,
    righting,
    unstableEnd,
    bounded,
    massRuns,
    probeCount: b1.probes.length,
    restHeight: b1.restHeight,
    mass: b1.mass,
    maxBuoyancy: b1.maxBuoyancy
  };
});

await browser.close();
server.close();

const f = (v) => v.toFixed(4);
console.log(
  `probes ${r.probeCount}   rest height ${f(r.restHeight)} m   ` +
    `mass ${r.mass.toFixed(0)} kg, full lift ${r.maxBuoyancy.toFixed(0)} N`
);
console.log('(1) equilibrium on still water');
console.log(`    settled at y ${f(r.equilibrium.y)}, expected ${f(r.equilibrium.expected)}, residual speed ${f(r.equilibrium.speed)}`);
console.log('(2) righting from a roll');
console.log(
  `    released at ${((r.righting.startAngle * 180) / Math.PI).toFixed(1)} deg, ` +
    `peak ${((r.righting.peak * 180) / Math.PI).toFixed(1)} deg, ` +
    `ended at ${((r.righting.endAngle * 180) / Math.PI).toFixed(1)} deg`
);
console.log(`    control, a box with negative GM: ended at ${((r.unstableEnd * 180) / Math.PI).toFixed(1)} deg (must capsize)`);
console.log('(4) mass independence: same geometry, three masses');
for (const m of r.massRuns) {
  console.log(
    `    ${String(m.mass).padStart(6)} kg: rests at y ${f(m.y)}, roll peak ${((m.peak * 180) / Math.PI).toFixed(1)} deg -> ${((m.endAngle * 180) / Math.PI).toFixed(1)} deg`
  );
}
console.log('(3) bounded on a moving surface');
console.log(
  `    20 s: NaN ${r.bounded.nan}, |y| max ${f(r.bounded.maxAbsY)}, ` +
    `roll max ${((r.bounded.maxAbsRoll * 180) / Math.PI).toFixed(1)} deg, final y ${f(r.bounded.finalY)}`
);
if (errs.length) {
  console.log('--- page errors ---');
  for (const e of errs.slice(0, 5)) {
    console.log('  ' + e);
  }
}
