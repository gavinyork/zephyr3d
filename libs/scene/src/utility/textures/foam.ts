import type { PBInsideFunctionScope, PBShaderExp, Texture2D } from '@zephyr3d/device';
import { getDevice } from '../../app/api';

let foamTexture: Texture2D | null = null;

/** Texels along each side of the default foam texture. */
const FOAM_TEXTURE_SIZE = 256;
/**
 * Bubbles of the default foam texture: cells of a Worley basis across the
 * tile at two scales, the larger the stronger, and the width of their rims
 * in cell spacings.
 */
const FOAM_BUBBLES_COARSE = 12;
const FOAM_BUBBLES_FINE = 27;
const FOAM_RIM_WIDTH = 0.18;
/** Clumps of the default foam texture: value noise cells across the tile, and their share of the value. */
const FOAM_CLUMPS = 4;
const FOAM_CLUMP_WEIGHT = 0.5;
/**
 * Grey levels of Crest's default foam texture (Foam2.png, Wave Harmonic, MIT)
 * at every sixteenth of its texels in order, darkest to brightest. The
 * default texture is remapped to them rank for rank, so a foam density
 * uncovers as much of it as of Crest's.
 */
const FOAM_LEVELS = [
  0.0, 0.455, 0.51, 0.557, 0.596, 0.631, 0.655, 0.675, 0.694, 0.71, 0.722, 0.737, 0.753, 0.769, 0.796, 0.839,
  0.98
];

/** Deterministic hash of integer lattice coordinates to [0, 1). */
function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Worley's cellular basis (Worley, "A Cellular Texture Basis Function",
 * SIGGRAPH 1996) on a lattice of `cells` across a unit tile, wrapping so the
 * tile repeats: the distances F1 and F2 from (u, v) to the nearest and second
 * nearest feature point, one per cell, in cell spacings.
 */
function worley(u: number, v: number, cells: number, seed: number): [number, number] {
  const x = u * cells;
  const y = v * cells;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i;
      const gy = cy + j;
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;
      const dx = gx + hash2(wx, wy, seed) - x;
      const dy = gy + hash2(wx, wy, seed + 1) - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return [f1, f2];
}

/** Smoothly interpolated value noise on a lattice of `cells` across a unit tile, wrapping. */
function tiledValueNoise(u: number, v: number, cells: number, seed: number) {
  const x = u * cells;
  const y = v * cells;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const fx = x - cx;
  const fy = y - cy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number) =>
    hash2((((cx + i) % cells) + cells) % cells, (((cy + j) % cells) + cells) % cells, seed);
  const a = at(0, 0) + (at(1, 0) - at(0, 0)) * sx;
  const b = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
  return a + (b - a) * sy;
}

/** Smoothstep falloff of a value: 1 at 0, 0 from `width` on. */
function rim(d: number, width: number) {
  const t = Math.min(Math.max(d / width, 0), 1);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Default foam texture: a tile of bubbles, cells of Worley's basis at two
 * scales whose walls (where F2 - F1, the distance to the edge between two
 * cells, is small) are bright and whose middles dark, over clumps of value
 * noise, its grey levels those of Crest's default foam texture (see
 * FOAM_LEVELS). Value in the red channel.
 *
 * @internal
 */
export function getDefaultFoamTexture() {
  if (!foamTexture) {
    const n = FOAM_TEXTURE_SIZE;
    const values = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = (x + 0.5) / n;
        const v = (y + 0.5) / n;
        const [c1, c2] = worley(u, v, FOAM_BUBBLES_COARSE, 11);
        const [f1, f2] = worley(u, v, FOAM_BUBBLES_FINE, 23);
        const bubbles = 0.65 * rim(c2 - c1, FOAM_RIM_WIDTH) + 0.35 * rim(f2 - f1, FOAM_RIM_WIDTH);
        const clumps =
          0.65 * tiledValueNoise(u, v, FOAM_CLUMPS, 37) + 0.35 * tiledValueNoise(u, v, FOAM_CLUMPS * 2, 41);
        values[y * n + x] = FOAM_CLUMP_WEIGHT * clumps + (1 - FOAM_CLUMP_WEIGHT) * bubbles;
      }
    }
    // Rank for rank onto Crest's grey levels
    const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b]);
    const data = new Uint8Array(n * n * 4);
    const last = FOAM_LEVELS.length - 1;
    order.forEach((texel, rank) => {
      const t = (rank / (order.length - 1)) * last;
      const k = Math.min(Math.floor(t), last - 1);
      const level = FOAM_LEVELS[k] + (FOAM_LEVELS[k + 1] - FOAM_LEVELS[k]) * (t - k);
      const o = texel * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(level * 255);
      data[o + 3] = 255;
    });
    foamTexture = getDevice().createTexture2D('rgba8unorm', n, n)!;
    foamTexture.name = '@WaterFoam';
    foamTexture.update(data, 0, 0, n, n);
    foamTexture.generateMipmaps();
  }
  return foamTexture;
}

/**
 * Samples a foam texture at `uv`, filtered with the screen gradients of the
 * world XZ it was taken from; its value is the red channel.
 * @param uvScale - uv per metre of world XZ.
 * @param mipScale - Factor on the filter footprint, above 1 to blur.
 * @param withSlope - Also take the slope of the value, by differencing a texel
 *   along u and v.
 * @returns (value, its slope along world x, along world z), slopes per metre,
 *   0 without `withSlope`
 * @internal
 */
export function sampleFoamTexture(
  scope: PBInsideFunctionScope,
  tex: PBShaderExp,
  uv: PBShaderExp,
  xzGrad: PBShaderExp,
  uvScale: number | PBShaderExp,
  mipScale = 1,
  withSlope = true
): PBShaderExp {
  const pb = scope.$builder;
  const dx = pb.mul(xzGrad.xy, uvScale, mipScale);
  const dy = pb.mul(xzGrad.zw, uvScale, mipScale);
  const s0 = pb.textureSampleGrad(tex, uv, dx, dy).r;
  if (!withSlope) {
    return pb.vec3(s0, 0, 0);
  }
  const texel = pb.div(pb.vec2(1), pb.vec2(pb.textureDimensions(tex, 0)));
  const su = pb.textureSampleGrad(tex, pb.add(uv, pb.vec2(texel.x, 0)), dx, dy).r;
  const sv = pb.textureSampleGrad(tex, pb.add(uv, pb.vec2(0, texel.y)), dx, dy).r;
  return pb.vec3(s0, pb.mul(pb.div(pb.vec2(pb.sub(su, s0), pb.sub(sv, s0)), texel), uvScale));
}

/**
 * Metres of world XZ per texel of a foam texture, at `uvScale` uv per metre.
 * @internal
 */
export function foamTexelSize(scope: PBInsideFunctionScope, tex: PBShaderExp, uvScale: PBShaderExp) {
  const pb = scope.$builder;
  return pb.div(1, pb.mul(uvScale, pb.float(pb.textureDimensions(tex, 0).x)));
}
