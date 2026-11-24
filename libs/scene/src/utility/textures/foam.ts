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
 * Target grey levels at every sixteenth of the texels in order, darkest to
 * brightest. The default texture is remapped to them rank for rank, which
 * fixes how much of it a given foam density uncovers.
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
 * noise, its grey levels remapped to FOAM_LEVELS. Value in the red channel.
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
    // Rank for rank onto FOAM_LEVELS
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

/**
 * Seconds each of the two samples of a flowing foam pattern slides along the
 * flow before it is set back, half of it apart, faded across so neither jump
 * shows.
 * @internal
 */
export const FOAM_FLOW_PERIOD = 2;
/**
 * Mip level of the foam texture past which the pattern takes the next octave,
 * twice the size. The foam is cut from the texture's grey levels, which fix
 * how much of it a density uncovers (see FOAM_LEVELS); filtering narrows them
 * towards the mean, so a far pattern read at a high mip level would show no
 * foam below a density and solid foam above it. The default texture holds its
 * coverage to within a hundredth through mip 1, between which and mip 0 the
 * nearer octave is read, and loses a third of its sparse foam at mip 2.
 */
const FOAM_OCTAVE_LOD = 0;
/** Last octave of the foam pattern, which bounds its uv however far the pixel's footprint. */
const FOAM_MAX_OCTAVE = 16;

/**
 * The foam texture as read at a point, ready to be cut by a density: up to four
 * samples, each its value and slopes along world x and z per metre, and the
 * weights they blend by, summing to 1. A cut is taken of each sample before
 * the blend (see {@link sampleFoamPattern}). Each a vec4 shader variable, a
 * sample per component.
 * @internal
 */
export interface FoamPattern {
  value: PBShaderExp;
  slopeX: PBShaderExp;
  slopeZ: PBShaderExp;
  weight: PBShaderExp;
}

/**
 * Declares the variables of a {@link FoamPattern} in a scope, as no foam: every weight 0.
 * @internal
 */
export function declareFoamPattern(scope: PBInsideFunctionScope, name: string): FoamPattern {
  const pb = scope.$builder;
  scope.$l[`${name}Value`] = pb.vec4(0);
  scope.$l[`${name}SlopeX`] = pb.vec4(0);
  scope.$l[`${name}SlopeZ`] = pb.vec4(0);
  scope.$l[`${name}Weight`] = pb.vec4(0);
  return {
    value: scope[`${name}Value`],
    slopeX: scope[`${name}SlopeX`],
    slopeZ: scope[`${name}SlopeZ`],
    weight: scope[`${name}Weight`]
  };
}

/**
 * Reads the foam texture at an undisplaced XZ into a {@link FoamPattern}.
 *
 * The cut by a density that reveals the foam is not linear, so samples are
 * blended after it, never before: an average of two samples is narrower than
 * either, and a cut of it uncovers less of the sparse foam and more of the
 * dense. Two blends arise here.
 *
 * Flow: the texture travels at `flow`, which the foam field takes from the
 * water. It drifts at `drift` without end, and is slid on at the rest,
 * `flow - drift`, by two samples each set back every FOAM_FLOW_PERIOD seconds,
 * half of it apart, faded across. Where the flow is the drift the two are one
 * sample (Vlachos, "Water Flow in Portal 2", SIGGRAPH 2010; as Crest carries
 * its foam).
 *
 * Distance: the pattern repeats over 2^k times its size at octave k, chosen so
 * the texture is read near FOAM_OCTAVE_LOD whatever the pixel's footprint, and
 * blended into octave k + 1 over the octave before it takes over (as Crest
 * scales its foam with its LOD cascades). The footprint is the pixel's longer
 * axis, from which the sampler picks its mip level.
 *
 * @param tex - The foam texture, its value in red. A uniform of the program:
 *   every call in one program must pass the same one.
 * @param xz - Undisplaced XZ position.
 * @param xzGrad - Screen derivatives of `xz`, (dpdx, dpdy); the samples are
 *   filtered with them, so this can be called in non-uniform control flow.
 * @param uvScale - uv per metre of the texture at octave 0.
 * @param flow - Velocity the texture travels at, metres per second.
 * @param drift - Velocity it travels at without end, metres per second.
 * @param time - Clock in seconds.
 * @param out - The pattern to write, see {@link declareFoamPattern}.
 * @internal
 */
export function sampleFoamPattern(
  scope: PBInsideFunctionScope,
  tex: PBShaderExp,
  xz: PBShaderExp,
  xzGrad: PBShaderExp,
  uvScale: PBShaderExp,
  flow: PBShaderExp,
  drift: PBShaderExp,
  time: PBShaderExp,
  out: FoamPattern
) {
  const pb = scope.$builder;
  pb.func(
    'zFoamPattern',
    [
      pb.vec2('xz'),
      pb.vec4('xzGrad'),
      pb.float('uvScale'),
      pb.vec2('flow'),
      pb.vec2('drift'),
      pb.float('time'),
      pb.vec4('value').out(),
      pb.vec4('slopeX').out(),
      pb.vec4('slopeZ').out(),
      pb.vec4('weight').out()
    ],
    function () {
      // Octave: the mip level octave 0 would be read at, past FOAM_OCTAVE_LOD
      this.$l.footprint = pb.max(pb.max(pb.length(this.xzGrad.xy), pb.length(this.xzGrad.zw)), 1e-6);
      this.$l.octave = pb.clamp(
        pb.sub(
          pb.log2(pb.mul(this.footprint, this.uvScale, pb.float(pb.textureDimensions(tex, 0).x))),
          FOAM_OCTAVE_LOD
        ),
        0,
        FOAM_MAX_OCTAVE
      );
      this.$l.level = pb.floor(this.octave);
      this.$l.blend = pb.sub(this.octave, this.level);
      this.$l.scaleNear = pb.mul(this.uvScale, pb.exp2(pb.neg(this.level)));
      this.$l.scaleFar = pb.mul(this.scaleNear, 0.5);
      // Flow: the two samples' offsets along the rest of the flow, and their weights
      const half = FOAM_FLOW_PERIOD * 0.5;
      this.$l.offset1 = pb.mod(this.time, FOAM_FLOW_PERIOD);
      this.$l.offset2 = pb.mod(pb.add(this.time, half), FOAM_FLOW_PERIOD);
      this.$l.rest = pb.sub(this.flow, this.drift);
      this.$l.phase = this.$choice(
        pb.equal(this.rest, pb.vec2(0)),
        pb.vec2(1, 0),
        pb.vec2(pb.sub(1, pb.abs(pb.sub(pb.div(this.offset1, half), 1))), 0)
      );
      this.phase.y = pb.sub(1, this.phase.x);
      this.$l.drifted = pb.sub(this.xz, pb.mul(this.drift, this.time));
      this.$l.pos1 = pb.sub(this.drifted, pb.mul(this.rest, this.offset1));
      this.$l.pos2 = pb.sub(this.drifted, pb.mul(this.rest, this.offset2));
      // Samples: (first, second) at the nearer octave, then at the farther;
      // gathered here and written out once
      this.$l.w = pb.vec4(pb.mul(this.phase, pb.sub(1, this.blend)), pb.mul(this.phase, this.blend));
      this.$l.v = pb.vec4(0);
      this.$l.gx = pb.vec4(0);
      this.$l.gz = pb.vec4(0);
      const slots: [string, string, string][] = [
        ['x', 'pos1', 'scaleNear'],
        ['y', 'pos2', 'scaleNear'],
        ['z', 'pos1', 'scaleFar'],
        ['w', 'pos2', 'scaleFar']
      ];
      for (const [c, pos, scale] of slots) {
        this.$if(pb.greaterThan(this.w[c], 0), function () {
          this.$l.s = sampleFoamTexture(this, tex, pb.mul(this[pos], this[scale]), this.xzGrad, this[scale]);
          this.v[c] = this.s.x;
          this.gx[c] = this.s.y;
          this.gz[c] = this.s.z;
        });
      }
      this.value = this.v;
      this.slopeX = this.gx;
      this.slopeZ = this.gz;
      this.weight = this.w;
    }
  );
  scope.zFoamPattern(xz, xzGrad, uvScale, flow, drift, time, out.value, out.slopeX, out.slopeZ, out.weight);
}
