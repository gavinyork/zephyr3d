import { PRNG } from '@zephyr3d/base';

/**
 * Procedural iris and sclera generation.
 *
 * These exist because the material has to be tuned before production textures
 * are available, and a crude placeholder is worse than useless for that: an
 * iris that is a flat disc of colour hides exactly the depth and detail cues
 * the material is supposed to produce, so it would be tuned against the wrong
 * image. The output here is intended to be good enough to art-direct against,
 * and good enough to hand to an artist as a starting layer.
 *
 * Everything is driven by a seeded {@link PRNG} rather than Math.random, so a
 * given seed always regenerates the same eye - which matters when comparing two
 * parameter sets, and lets the demo offer a re-roll button that is reproducible.
 */

export interface IrisParams {
  seed: number;
  /** Base hue of the ciliary zone (outer iris). */
  color: [number, number, number];
  /** Colour of the pupillary zone (inner iris); usually warmer/darker. */
  innerColor: [number, number, number];
  /** Number of radial fibres. Real irises run roughly 200-400. */
  fibreCount: number;
  /** How strongly fibres modulate brightness, 0-1. */
  fibreContrast: number;
  /** Radius of the collarette as a fraction of the iris, 0-1. */
  collaretteRadius: number;
  /** Depth of the crypts around the collarette, 0-1. */
  cryptAmount: number;
  /** Pupil radius as a fraction of the iris, 0-1. */
  pupilRadius: number;
  /** Darkening toward the outer edge, 0-1. */
  limbusDarkening: number;
}

export interface ScleraParams {
  seed: number;
  /** Base colour of the sclera; never pure white. */
  color: [number, number, number];
  /** Number of primary vessels. */
  vesselCount: number;
  /** Vessel opacity, 0-1. */
  vesselStrength: number;
  /** Where vessels start, as a fraction of the map radius. Keeps them off the cornea. */
  vesselInnerRadius: number;
}

export const DEFAULT_IRIS: IrisParams = {
  seed: 1337,
  color: [0.32, 0.5, 0.62],
  innerColor: [0.42, 0.38, 0.2],
  fibreCount: 260,
  fibreContrast: 0.55,
  collaretteRadius: 0.42,
  cryptAmount: 0.5,
  pupilRadius: 0.3,
  // Kept mild: the material draws its own limbal ring on top of this, and two
  // heavy darkenings stack into an opaque black annulus that swallows the iris.
  limbusDarkening: 0.3
};

export const DEFAULT_SCLERA: ScleraParams = {
  seed: 91,
  color: [0.93, 0.9, 0.87],
  vesselCount: 14,
  vesselStrength: 0.5,
  vesselInnerRadius: 0.42
};

/** Cheap value noise on a jittered lattice, smoothed and tileable enough for this. */
function makeNoise(rng: PRNG, size: number) {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rng.get();
  }
  return (x: number, y: number) => {
    const fx = x * size;
    const fy = y * size;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    // Smoothstep the interpolants so the lattice does not show as diamonds.
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (ix: number, iy: number) =>
      grid[(((iy % size) + size) % size) * size + (((ix % size) + size) % size)];
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/**
 * Renders an iris into an RGBA buffer, pupil at the centre, iris filling the frame.
 *
 * The structure follows real anatomy closely enough to read as an eye: radial
 * trabecular fibres of varying length and brightness, a collarette ring where
 * the pupillary and ciliary zones meet, dark crypts scattered around it, and a
 * darkened limbus at the rim. Departing from any one of these is what makes a
 * procedural iris look like a texture rather than an eye.
 */
export function generateIris(params: IrisParams, size = 512): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size * size * 4);
  const rng = new PRNG(params.seed);
  const noise = makeNoise(rng, 64);
  const fineNoise = makeNoise(rng, 192);

  // Per-fibre randomness, drawn up front so pixel order cannot affect the result.
  const n = Math.max(1, Math.round(params.fibreCount));
  const fibreLength = new Float32Array(n);
  const fibreBright = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    fibreLength[i] = 0.35 + rng.get() * 0.65;
    fibreBright[i] = 0.4 + rng.get() * 0.6;
  }

  // Crypts: dark irregular pits clustered just outside the collarette.
  const cryptCount = Math.round(18 * params.cryptAmount);
  const crypts: { a: number; r: number; sa: number; sr: number }[] = [];
  for (let i = 0; i < cryptCount; i++) {
    crypts.push({
      a: rng.get() * Math.PI * 2,
      r: params.collaretteRadius + 0.04 + rng.get() * 0.22,
      sa: 0.12 + rng.get() * 0.28,
      sr: 0.03 + rng.get() * 0.07
    });
  }

  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const r = Math.sqrt(dx * dx + dy * dy);
      let angle = Math.atan2(dy, dx);
      if (angle < 0) {
        angle += Math.PI * 2;
      }

      if (r > 1) {
        // Outside the iris disc. Kept opaque black so bilinear taps at the rim
        // never bleed an undefined colour inward.
        data[i] = data[i + 1] = data[i + 2] = 0;
        data[i + 3] = 255;
        continue;
      }

      // Angular jitter so fibres are not perfectly straight spokes.
      const wobble = (noise(angle / (Math.PI * 2), r) - 0.5) * 0.06;
      const fibreIndex = Math.floor(((angle / (Math.PI * 2) + wobble) * n + n) % n);
      const fi = ((fibreIndex % n) + n) % n;

      // A fibre only reaches inward as far as its own length allows.
      const fibreReach = params.collaretteRadius + (1 - params.collaretteRadius) * (1 - fibreLength[fi]);
      const fibreMask = smoothstep(fibreReach - 0.12, fibreReach + 0.05, r);
      const fibre = 1 + (fibreBright[fi] - 0.5) * 2 * params.fibreContrast * fibreMask;

      // Pupillary zone inside the collarette, ciliary zone outside.
      const zone = smoothstep(params.collaretteRadius - 0.08, params.collaretteRadius + 0.08, r);
      let cr = params.innerColor[0] + (params.color[0] - params.innerColor[0]) * zone;
      let cg = params.innerColor[1] + (params.color[1] - params.innerColor[1]) * zone;
      let cb = params.innerColor[2] + (params.color[2] - params.innerColor[2]) * zone;

      // The collarette itself catches light and reads as a raised ridge.
      const ridge = Math.exp(-((r - params.collaretteRadius) ** 2) / 0.0016) * 0.35;

      // Crypts.
      let crypt = 0;
      for (const k of crypts) {
        let da = Math.abs(angle - k.a);
        if (da > Math.PI) {
          da = Math.PI * 2 - da;
        }
        const dr = r - k.r;
        crypt = Math.max(crypt, Math.exp(-(da * da) / (k.sa * k.sa) - (dr * dr) / (k.sr * k.sr)));
      }

      const mottle = 0.85 + 0.3 * fineNoise(dx * 0.5 + 0.5, dy * 0.5 + 0.5);
      const limbus = 1 - params.limbusDarkening * smoothstep(0.72, 1, r);

      let shade = fibre * mottle * limbus * (1 + ridge) * (1 - 0.75 * crypt * params.cryptAmount);
      // Pupil: black, with a soft edge so the boundary does not alias.
      const pupil = smoothstep(params.pupilRadius - 0.02, params.pupilRadius + 0.02, r);
      shade *= pupil;

      cr *= shade;
      cg *= shade;
      cb *= shade;

      data[i] = Math.round(255 * clamp01(cr));
      data[i + 1] = Math.round(255 * clamp01(cg));
      data[i + 2] = Math.round(255 * clamp01(cb));
      data[i + 3] = 255;
    }
  }
  return data;
}

/**
 * Renders a sclera into an RGBA buffer.
 *
 * Vessels are grown as short branching random walks rather than drawn as arcs,
 * because the branching is what the eye recognises; evenly spaced curves read
 * as scratches. They fade out toward the centre so none of them crosses the
 * cornea, where there are no vessels in reality.
 */
export function generateSclera(params: ScleraParams, size = 512): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size * size * 4);
  const rng = new PRNG(params.seed);
  const noise = makeNoise(rng, 48);
  const c = (size - 1) / 2;

  // Base coat first.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const shade = 0.93 + 0.07 * noise(dx * 0.5 + 0.5, dy * 0.5 + 0.5);
      data[i] = Math.round(255 * clamp01(params.color[0] * shade));
      data[i + 1] = Math.round(255 * clamp01(params.color[1] * shade));
      data[i + 2] = Math.round(255 * clamp01(params.color[2] * shade));
      data[i + 3] = 255;
    }
  }

  // Vessels, painted over the base with a soft brush.
  const paint = (px: number, py: number, width: number, strength: number) => {
    const rad = Math.ceil(width);
    for (let oy = -rad; oy <= rad; oy++) {
      for (let ox = -rad; ox <= rad; ox++) {
        const x = Math.round(px) + ox;
        const y = Math.round(py) + oy;
        if (x < 0 || y < 0 || x >= size || y >= size) {
          continue;
        }
        const d = Math.sqrt(ox * ox + oy * oy);
        const a = clamp01(1 - d / (width + 0.001)) * strength;
        if (a <= 0) {
          continue;
        }
        const i = (y * size + x) * 4;
        // Vessels darken green and blue far more than red.
        data[i] = Math.round(data[i] * (1 - a * 0.25) + 190 * a * 0.25);
        data[i + 1] = Math.round(data[i + 1] * (1 - a * 0.8));
        data[i + 2] = Math.round(data[i + 2] * (1 - a * 0.75));
      }
    }
  };

  const walk = (angle: number, radius: number, dir: number, width: number, life: number, depth: number) => {
    let a = angle;
    let rr = radius;
    let w = width;
    for (let step = 0; step < life; step++) {
      const px = c + Math.cos(a) * rr * c;
      const py = c + Math.sin(a) * rr * c;
      // Fade toward the centre so vessels never reach the cornea.
      const fade = smoothstep(params.vesselInnerRadius - 0.12, params.vesselInnerRadius + 0.15, rr);
      paint(px, py, w, params.vesselStrength * fade);
      a += (rng.get() - 0.5) * 0.22;
      rr += dir * (0.004 + rng.get() * 0.006);
      w = Math.max(0.6, w * 0.985);
      if (rr < params.vesselInnerRadius - 0.15 || rr > 1.02) {
        break;
      }
      // Branch occasionally, which is what makes vasculature read as organic.
      if (depth < 2 && rng.get() < 0.03) {
        walk(a + (rng.get() - 0.5) * 1.2, rr, dir, w * 0.65, life - step, depth + 1);
      }
    }
  };

  for (let i = 0; i < params.vesselCount; i++) {
    walk(rng.get() * Math.PI * 2, 1.0, -1, 1.6 + rng.get() * 1.6, 220, 0);
  }
  return data;
}
