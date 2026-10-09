/**
 * Terrain height sampling shared by the editor workers.
 *
 * Heights are world heights on the height map grid, row by row; texel i holds the height at the
 * centre of cell i, at u = (i + 0.5) / width.
 */

/** Bilinear height at normalized terrain coordinates u, v in 0..1 */
export function sampleHeight(heights: Float32Array, w: number, h: number, u: number, v: number) {
  const fx = Math.min(Math.max(u * w - 0.5, 0), w - 1);
  const fz = Math.min(Math.max(v * h - 0.5, 0), h - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, w - 1);
  const z1 = Math.min(z0 + 1, h - 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const a = heights[z0 * w + x0] + (heights[z0 * w + x1] - heights[z0 * w + x0]) * tx;
  const b = heights[z1 * w + x0] + (heights[z1 * w + x1] - heights[z1 * w + x0]) * tx;
  return a + (b - a) * tz;
}

/**
 * Unit normal from central differences one height texel apart, written into `out`
 * @returns The slope in degrees from horizontal
 */
export function sampleNormal(
  heights: Float32Array,
  w: number,
  h: number,
  u: number,
  v: number,
  regionWidth: number,
  regionDepth: number,
  out: [number, number, number]
) {
  const du = 1 / w;
  const dv = 1 / h;
  const nx =
    -(sampleHeight(heights, w, h, u + du, v) - sampleHeight(heights, w, h, u - du, v)) /
    ((2 * regionWidth) / w);
  const nz =
    -(sampleHeight(heights, w, h, u, v + dv) - sampleHeight(heights, w, h, u, v - dv)) /
    ((2 * regionDepth) / h);
  const len = Math.sqrt(nx * nx + 1 + nz * nz);
  out[0] = nx / len;
  out[1] = 1 / len;
  out[2] = nz / len;
  return (Math.acos(Math.min(1, out[1])) * 180) / Math.PI;
}
