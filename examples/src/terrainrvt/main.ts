import { float2half, Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import type { Texture2D, Texture2DArray } from '@zephyr3d/device';
import { DrawText } from '@zephyr3d/device';
import type { VirtualTextureValidation } from '@zephyr3d/scene';
import {
  Application,
  ClipmapTerrain,
  DirectionalLight,
  FPSCameraController,
  getEngine,
  getInput,
  PerspectiveCamera,
  Scene
} from '@zephyr3d/scene';

/**
 * Visual check of the terrain runtime virtual texture (WebGPU only).
 *
 * A 512 x 512 procedural terrain with 4 procedural detail layers. With the runtime virtual
 * texture on, the layers are blended once per page into a 32768^2 virtual texture and the
 * terrain shades from it; off, they are blended per pixel as before.
 *
 * Controls: WASD/QE and drag fly the camera, R toggles the runtime virtual texture, H toggles hex
 * tiling on every layer, B paints a blob of snow at the ground point under the screen centre (a
 * local invalidation), I invalidates everything, V toggles the page table view, [ and ] pick its
 * level.
 *
 * Expected:
 * - toggling R changes nothing but sharpness: same colors, lighting and relief (the page fill
 *   runs the live path's blend, so any hue or brightness shift is a bug); close up the virtual
 *   texture may look slightly softer while fine pages stream in, never blocky or with seams at
 *   page edges;
 * - flying low and fast, the ground refines coarse to fine within a few frames, no black or
 *   striped areas;
 * - B turns a patch white in both modes; with the virtual texture only that patch refreshes
 *   ("refilled" jumps once), neighbouring pages do not blink;
 * - H (hex tiling, Mikkelsen 2022): looking over a wide stretch of the same layer, the grid of
 *   repeated texture features disappears; up close the texture looks like itself, with soft
 *   seams between the hexagonal tiles; bumps catch the light from the same side on every tile;
 *   with R the virtual texture and the live path look the same;
 * - objects standing on the terrain are absent here, so "loads" should drop to 0 when the
 *   camera stops; "check" counts all stay 0.
 */
const app = new Application({
  canvas: document.querySelector<HTMLCanvasElement>('#canvas')!,
  backend: backendWebGPU
});
await app.ready();
const device = app.device;

const TERRAIN_SIZE = 512;
const HEIGHT_SCALE = 70;

// ---- procedural noise
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x: number, y: number, seed: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** Tileable over `period` cells */
function fbm(x: number, y: number, octaves: number, seed: number, period = 0) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    const p = period * freq;
    const nx = x * freq;
    const ny = y * freq;
    sum += amp * (p > 0 ? tileNoise(nx, ny, p, seed + i) : valueNoise(nx, ny, seed + i));
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}
function tileNoise(x: number, y: number, p: number, seed: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const m = (v: number) => ((v % p) + p) % p;
  const a = hash(m(x0), m(y0), seed);
  const b = hash(m(x0 + 1), m(y0), seed);
  const c = hash(m(x0), m(y0 + 1), seed);
  const d = hash(m(x0 + 1), m(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ---- detail layers: sand, grass, rock, snow
const DETAIL_SIZE = 256;
const layers = [
  { color: [0.76, 0.66, 0.46], contrast: 0.25, freq: 32, bump: 1.5, roughness: 0.9 },
  { color: [0.2, 0.36, 0.1], contrast: 0.5, freq: 24, bump: 2.5, roughness: 0.8 },
  { color: [0.42, 0.4, 0.38], contrast: 0.6, freq: 8, bump: 6, roughness: 0.6 },
  { color: [0.9, 0.92, 0.96], contrast: 0.08, freq: 16, bump: 1, roughness: 0.4 }
];
function createDetailTextures(index: number): [Texture2D, Texture2D] {
  const l = layers[index];
  const h = new Float32Array(DETAIL_SIZE * DETAIL_SIZE);
  for (let y = 0; y < DETAIL_SIZE; y++) {
    for (let x = 0; x < DETAIL_SIZE; x++) {
      h[y * DETAIL_SIZE + x] = fbm(
        (x / DETAIL_SIZE) * l.freq,
        (y / DETAIL_SIZE) * l.freq,
        4,
        100 + index * 10,
        l.freq
      );
    }
  }
  const albedo = new Uint8Array(DETAIL_SIZE * DETAIL_SIZE * 4);
  const normal = new Uint8Array(DETAIL_SIZE * DETAIL_SIZE * 4);
  const at = (x: number, y: number) =>
    h[((y + DETAIL_SIZE) % DETAIL_SIZE) * DETAIL_SIZE + ((x + DETAIL_SIZE) % DETAIL_SIZE)];
  for (let y = 0; y < DETAIL_SIZE; y++) {
    for (let x = 0; x < DETAIL_SIZE; x++) {
      const i = (y * DETAIL_SIZE + x) * 4;
      const v = 1 + (h[y * DETAIL_SIZE + x] - 0.5) * 2 * l.contrast;
      for (let c = 0; c < 3; c++) {
        albedo[i + c] = Math.max(0, Math.min(255, Math.round(l.color[c] * v * 255)));
      }
      albedo[i + 3] = 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * l.bump;
      const dy = (at(x, y + 1) - at(x, y - 1)) * l.bump;
      const len = Math.hypot(dx, dy, 1);
      normal[i] = Math.round((-dx / len) * 127.5 + 127.5);
      normal[i + 1] = Math.round((-dy / len) * 127.5 + 127.5);
      normal[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
      normal[i + 3] = 255;
    }
  }
  const albedoTex = device.createTexture2D('rgba8unorm', DETAIL_SIZE, DETAIL_SIZE)!;
  albedoTex.update(albedo, 0, 0, DETAIL_SIZE, DETAIL_SIZE);
  const normalTex = device.createTexture2D('rgba8unorm', DETAIL_SIZE, DETAIL_SIZE)!;
  normalTex.update(normal, 0, 0, DETAIL_SIZE, DETAIL_SIZE);
  return [albedoTex, normalTex];
}

// ---- scene
const scene = new Scene();
const sun = new DirectionalLight(scene);
sun.sunLight = true;
sun.lookAt(new Vector3(0, 0, 0), new Vector3(-0.6, -0.5, -0.4), Vector3.axisPY());

const terrain = new ClipmapTerrain(scene, TERRAIN_SIZE, TERRAIN_SIZE);
terrain.position.setXYZ(-TERRAIN_SIZE / 2, 0, -TERRAIN_SIZE / 2);
const heights = new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE);
{
  const data = new Uint16Array(TERRAIN_SIZE * TERRAIN_SIZE);
  for (let y = 0; y < TERRAIN_SIZE; y++) {
    for (let x = 0; x < TERRAIN_SIZE; x++) {
      const n = fbm(x / 96, y / 96, 6, 7);
      const ridge = 1 - Math.abs(fbm(x / 160, y / 160, 3, 11) * 2 - 1);
      const hgt = Math.pow(n, 1.6) * HEIGHT_SCALE + ridge * ridge * 25;
      heights[y * TERRAIN_SIZE + x] = hgt;
      data[y * TERRAIN_SIZE + x] = float2half(hgt);
    }
  }
  terrain.heightMap!.update(data, 0, 0, TERRAIN_SIZE, TERRAIN_SIZE);
  terrain.updateBoundingBox();
}
const material = terrain.material!;
terrain.numDetailMaps = layers.length;
layers.forEach((l, i) => {
  const [albedo, normal] = createDetailTextures(i);
  material.setDetailMap(i, albedo);
  material.setDetailNormalMap(i, normal);
  material.setDetailMapUVScale(i, 96);
  material.setDetailMapRoughness(i, l.roughness);
});
// splat: sand low, snow high, rock on steep slopes, grass elsewhere
const splatMap = terrain.splatMap as Texture2DArray;
const SPLAT = splatMap.width;
const splat = new Uint8Array(SPLAT * SPLAT * 4);
{
  const h = (x: number, y: number) =>
    heights[
      Math.min(TERRAIN_SIZE - 1, Math.max(0, y)) * TERRAIN_SIZE + Math.min(TERRAIN_SIZE - 1, Math.max(0, x))
    ];
  for (let y = 0; y < SPLAT; y++) {
    for (let x = 0; x < SPLAT; x++) {
      const tx = Math.round((x / SPLAT) * TERRAIN_SIZE);
      const ty = Math.round((y / SPLAT) * TERRAIN_SIZE);
      const hh = h(tx, ty);
      const slope = Math.hypot(h(tx + 1, ty) - h(tx - 1, ty), h(tx, ty + 1) - h(tx, ty - 1)) * 0.5;
      const jitter = (fbm(x / 20, y / 20, 3, 3) - 0.5) * 12;
      const sand = Math.max(0, Math.min(1, (14 - hh - jitter) / 6));
      const snow = Math.max(0, Math.min(1, (hh + jitter - 62) / 8));
      const rock = Math.max(0, Math.min(1, (slope - 0.7) / 0.5)) * (1 - snow);
      const grass = Math.max(0, 1 - sand - snow - rock);
      const sum = sand + grass + rock + snow;
      const i = (y * SPLAT + x) * 4;
      splat[i] = Math.round((sand / sum) * 255);
      splat[i + 1] = Math.round((grass / sum) * 255);
      splat[i + 2] = Math.round((rock / sum) * 255);
      splat[i + 3] = Math.round((snow / sum) * 255);
    }
  }
  splatMap.update(splat, 0, 0, 0, SPLAT, SPLAT, 1);
}
terrain.runtimeVirtualTexture = true;

const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.2, 3000);
camera.lookAt(new Vector3(-120, 90, 160), new Vector3(0, 30, 0), Vector3.axisPY());
camera.controller = new FPSCameraController({ moveSpeed: 0.6 });
scene.mainCamera = camera;
getInput().use(camera.handleEvent, camera);

// ---- page table overlay
const quadVB = device.createVertexBuffer(
  'position_f32x2',
  new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])
);
const quadLayout = device.createVertexLayout({ vertexBuffers: [{ buffer: quadVB }] });
const overlayProgram = device.buildRenderProgram({
  label: 'TerrainRVTOverlay',
  vertex(pb) {
    this.rect = pb.vec4().uniform(0);
    this.$inputs.pos = pb.vec2().attrib('position');
    this.$outputs.uv = pb.vec2();
    pb.main(function () {
      this.$builtins.position = pb.vec4(pb.add(this.rect.xy, pb.mul(this.$inputs.pos, this.rect.zw)), 0, 1);
      this.$outputs.uv = pb.vec2(this.$inputs.pos.x, pb.sub(1, this.$inputs.pos.y));
    });
  },
  fragment(pb) {
    this.pageTable = pb.tex2D().uniform(0);
    this.$outputs.color = pb.vec4();
    pb.main(function () {
      this.$outputs.color = pb.textureSampleLevel(this.pageTable, this.$inputs.uv, 0);
    });
  }
})!;
const overlayBindGroup = device.createBindGroup(overlayProgram.bindGroupLayouts[0]);
const nearest = device.createSampler({
  addressU: 'clamp',
  addressV: 'clamp',
  magFilter: 'nearest',
  minFilter: 'nearest',
  mipFilter: 'none'
});
const overlayStates = device.createRenderStateSet();
overlayStates.useRasterizerState().setCullMode('none');
overlayStates.useDepthState().enableTest(false).enableWrite(false);

// ---- input
let debugLevel = 0;
let showPageTable = true;
/** Paints snow into the splat map around the ground point under the screen centre */
function paintSnow() {
  // march the view ray against the height field
  const origin = camera.getWorldPosition();
  const dir = camera.worldMatrix.transformVectorAffine(new Vector3(0, 0, -1)).inplaceNormalize();
  for (let t = 0; t < 2000; t += 0.5) {
    const p = Vector3.add(origin, Vector3.scale(dir, t));
    const hx = Math.round(p.x + TERRAIN_SIZE / 2);
    const hz = Math.round(p.z + TERRAIN_SIZE / 2);
    if (hx < 0 || hz < 0 || hx >= TERRAIN_SIZE || hz >= TERRAIN_SIZE) {
      continue;
    }
    if (p.y <= heights[hz * TERRAIN_SIZE + hx]) {
      const radius = 12;
      const sx0 = Math.max(0, Math.floor(((hx - radius) / TERRAIN_SIZE) * SPLAT));
      const sz0 = Math.max(0, Math.floor(((hz - radius) / TERRAIN_SIZE) * SPLAT));
      const sx1 = Math.min(SPLAT, Math.ceil(((hx + radius) / TERRAIN_SIZE) * SPLAT));
      const sz1 = Math.min(SPLAT, Math.ceil(((hz + radius) / TERRAIN_SIZE) * SPLAT));
      const w = sx1 - sx0;
      const h = sz1 - sz0;
      const patch = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = ((sz0 + y) * SPLAT + sx0 + x) * 4;
          const d = Math.hypot(
            ((sx0 + x) / SPLAT) * TERRAIN_SIZE - hx,
            ((sz0 + y) / SPLAT) * TERRAIN_SIZE - hz
          );
          const s = Math.max(0, Math.min(1, (radius - d) / 4));
          for (let c = 0; c < 4; c++) {
            splat[i + c] = Math.round(splat[i + c] * (1 - s) + (c === 3 ? 255 * s : 0));
            patch[(y * w + x) * 4 + c] = splat[i + c];
          }
        }
      }
      splatMap.update(patch, sx0, sz0, 0, w, h, 1);
      const wx = hx - TERRAIN_SIZE / 2;
      const wz = hz - TERRAIN_SIZE / 2;
      terrain.invalidateRuntimeVirtualTexture(wx - radius, wz - radius, wx + radius, wz + radius);
      return;
    }
  }
}
window.addEventListener('keydown', (e) => {
  if (e.key === '[') {
    debugLevel = Math.max(0, debugLevel - 1);
  } else if (e.key === ']') {
    debugLevel = debugLevel + 1;
  } else if (e.key === 'r' || e.key === 'R') {
    terrain.runtimeVirtualTexture = !terrain.runtimeVirtualTexture;
  } else if (e.key === 'h' || e.key === 'H') {
    const enable = !material.getDetailMapHexTiling(0);
    for (let i = 0; i < layers.length; i++) {
      material.setDetailMapHexTiling(i, enable);
    }
  } else if (e.key === 'v' || e.key === 'V') {
    showPageTable = !showPageTable;
  } else if (e.key === 'b' || e.key === 'B') {
    paintSnow();
  } else if (e.key === 'i' || e.key === 'I') {
    terrain.invalidateRuntimeVirtualTexture();
  }
});

// ---- frame
let validation: VirtualTextureValidation | null = null;
let validating = false;
getEngine().setRenderable(() => {
  const width = device.deviceXToScreen(device.getDrawingBufferWidth());
  const height = device.deviceYToScreen(device.getDrawingBufferHeight());
  camera.aspect = width / height;
  camera.render(scene);

  const vt = terrain.runtimeVirtualTextureData;
  const lines = [
    `Device: ${device.type}  FPS: ${device.frameInfo.FPS.toFixed(1)}  GPU: ${device.frameInfo.elapsedTimeGPU.toFixed(2)} ms  runtime virtual texture: ${vt ? 'ON' : 'OFF'}  hex tiling: ${material.getDetailMapHexTiling(0) ? 'ON' : 'OFF'}`,
    'WASD/QE + drag: fly  R: toggle virtual texture  H: toggle hex tiling  B: paint snow  I: invalidate  V: page table  [ ]: level'
  ];
  let bad = false;
  if (vt) {
    const numLevels = vt.levels.length;
    debugLevel = Math.min(debugLevel, numLevels - 1);
    const frame = device.frameInfo.frameCounter;
    if (!validating && frame % 60 === 0) {
      validating = true;
      vt.validate()
        .then((v) => {
          validation = v;
        })
        .finally(() => {
          validating = false;
        });
    }
    if (showPageTable) {
      const debugTexture = vt.renderDebugTexture(debugLevel);
      const aspect = device.getDrawingBufferWidth() / device.getDrawingBufferHeight();
      const size = 0.6;
      device.setViewport(null);
      device.setRenderStates(overlayStates);
      device.setProgram(overlayProgram);
      overlayBindGroup.setValue('rect', new Vector4(1 - size / aspect - 0.02, -0.98, size / aspect, size));
      overlayBindGroup.setTexture('pageTable', debugTexture, nearest);
      device.setBindGroup(0, overlayBindGroup);
      quadLayout.draw('triangle-list', 0, 6);
    }
    const s = vt.stats;
    const l0 = vt.levels[0];
    lines.push(
      `Virtual ${l0.pagesX * vt.pageSize}x${l0.pagesY * vt.pageSize}, ${numLevels} levels, pool ${vt.physicalPageCount} pages, budget ${vt.allocBudget}/update, pinned from level ${vt.pinnedFromLevel}, page table level ${debugLevel}`,
      s
        ? `requested ${s.requested}  loads ${s.loads}  allocated ${s.allocated}  evicted ${s.evicted}  refilled ${s.refilled}  expired ${s.expired}  dropped ${s.dropped}  available ${s.available}  mip bias ${s.mipBias.toFixed(2)}`
        : 'stats pending',
      validation
        ? `check: lost ${validation.lostPages}  duplicate ${validation.duplicatePages}  wrong owner ${validation.wrongOwner}  shared ${validation.sharedPages}  pinned missing ${validation.pinnedMissing}  unmapped ${validation.unmapped}  (all must be 0)`
        : 'check pending'
    );
    bad = !!validation && Object.values(validation).some((v) => v !== 0);
  }
  lines.forEach((line, i) =>
    DrawText.drawText(
      device,
      line,
      i === 3 ? '#ffff80' : i === 4 ? (bad ? '#ff6060' : '#80ff80') : '#ffffff',
      20,
      24 + i * 20
    )
  );
});
app.run();
