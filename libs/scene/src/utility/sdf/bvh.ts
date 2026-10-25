/** Most triangles a leaf holds. */
const LEAF_SIZE = 4;
/** Split candidates per axis for the surface area heuristic. */
const SAH_BINS = 12;

/**
 * Bounding volume hierarchy over a triangle soup, for closest-point and ray
 * queries on the CPU. Built once, immutable, safe to use from a worker.
 *
 * Nodes are flattened depth first: an interior node's left child follows it
 * directly, `right` holds the index of the other. A leaf has `count > 0` and
 * covers triangles `[first, first + count)` of {@link TriangleBVH.order}.
 *
 * @public
 */
export class TriangleBVH {
  /** Vertex positions, xyz per vertex. */
  readonly positions: Float32Array;
  /** Three vertex indices per triangle. */
  readonly indices: Uint32Array;
  /** Triangle indices in leaf order. */
  readonly order: Uint32Array;
  /** Node bounds, minX minY minZ maxX maxY maxZ per node. */
  readonly bounds: Float32Array;
  /** Per node: right child for an interior node, first triangle for a leaf. */
  readonly offset: Uint32Array;
  /** Per node: triangles in a leaf, 0 for an interior node. */
  readonly count: Uint32Array;
  private _numNodes: number;

  constructor(positions: Float32Array, indices: Uint32Array) {
    this.positions = positions;
    this.indices = indices;
    const numTris = Math.floor(indices.length / 3);
    this.order = new Uint32Array(numTris);
    const maxNodes = Math.max(1, 2 * numTris);
    this.bounds = new Float32Array(maxNodes * 6);
    this.offset = new Uint32Array(maxNodes);
    this.count = new Uint32Array(maxNodes);
    this._numNodes = 0;
    const centroids = new Float32Array(numTris * 3);
    const triBounds = new Float32Array(numTris * 6);
    for (let t = 0; t < numTris; t++) {
      this.order[t] = t;
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = indices[t * 3 + k] * 3;
        const x = positions[v];
        const y = positions[v + 1];
        const z = positions[v + 2];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
      }
      triBounds.set([minX, minY, minZ, maxX, maxY, maxZ], t * 6);
      centroids[t * 3] = (minX + maxX) * 0.5;
      centroids[t * 3 + 1] = (minY + maxY) * 0.5;
      centroids[t * 3 + 2] = (minZ + maxZ) * 0.5;
    }
    if (numTris > 0) {
      this._build(0, numTris, centroids, triBounds);
    } else {
      this._numNodes = 1;
      this.bounds.set([0, 0, 0, 0, 0, 0]);
    }
  }
  /** Nodes in the tree. */
  get numNodes() {
    return this._numNodes;
  }
  /** Triangles in the tree. */
  get numTriangles() {
    return this.order.length;
  }
  /**
   * Squared distance from a point to the nearest triangle, or `maxDistSq` when
   * none is nearer than that.
   * @param out - Receives the closest point when one is found nearer than `maxDistSq`.
   */
  closestDistanceSq(px: number, py: number, pz: number, maxDistSq = Infinity, out?: Float32Array) {
    if (this.order.length === 0) {
      return maxDistSq;
    }
    let best = maxDistSq;
    const stack = this._stack;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      if (boxDistSq(this.bounds, node, px, py, pz) >= best) {
        continue;
      }
      const count = this.count[node];
      if (count > 0) {
        const first = this.offset[node];
        for (let i = first; i < first + count; i++) {
          const d = this._triangleDistSq(this.order[i], px, py, pz);
          if (d < best) {
            best = d;
            if (out) {
              out[0] = this._closest[0];
              out[1] = this._closest[1];
              out[2] = this._closest[2];
            }
          }
        }
      } else {
        // Nearer child last, so it is popped first and tightens `best` early
        const left = node + 1;
        const right = this.offset[node];
        const dl = boxDistSq(this.bounds, left, px, py, pz);
        const dr = boxDistSq(this.bounds, right, px, py, pz);
        if (dl < dr) {
          stack[sp++] = right;
          stack[sp++] = left;
        } else {
          stack[sp++] = left;
          stack[sp++] = right;
        }
      }
    }
    return best;
  }
  /**
   * Every ray parameter `t > 0` at which a ray crosses a triangle, unsorted.
   * @param dir - Ray direction; need not be unit length, `t` is in its units.
   * @returns Number of hits written to `hits`, at most its length.
   */
  rayHits(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hits: Float32Array) {
    if (this.order.length === 0) {
      return 0;
    }
    const ix = 1 / dx;
    const iy = 1 / dy;
    const iz = 1 / dz;
    const stack = this._stack;
    let sp = 0;
    let n = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      if (!rayHitsBox(this.bounds, node, ox, oy, oz, ix, iy, iz)) {
        continue;
      }
      const count = this.count[node];
      if (count > 0) {
        const first = this.offset[node];
        for (let i = first; i < first + count && n < hits.length; i++) {
          const t = this._rayTriangle(this.order[i], ox, oy, oz, dx, dy, dz);
          if (t > 0) {
            hits[n++] = t;
          }
        }
      } else {
        stack[sp++] = node + 1;
        stack[sp++] = this.offset[node];
      }
    }
    return n;
  }
  /**
   * The nearest triangle a ray crosses within `tMax`.
   * @param dir - Unit ray direction.
   * @returns The ray parameter of the hit, negated when the triangle faces
   * away from the ray (its winding normal points along `dir`); 0 when the ray
   * crosses nothing within `tMax`.
   */
  rayNearestHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number) {
    if (this.order.length === 0) {
      return 0;
    }
    const ix = 1 / dx;
    const iy = 1 / dy;
    const iz = 1 / dz;
    const stack = this._stack;
    let sp = 0;
    let best = tMax;
    let back = false;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      if (rayBoxEntry(this.bounds, node, ox, oy, oz, ix, iy, iz) > best) {
        continue;
      }
      const count = this.count[node];
      if (count > 0) {
        const first = this.offset[node];
        for (let i = first; i < first + count; i++) {
          const t = this._rayTriangle(this.order[i], ox, oy, oz, dx, dy, dz);
          if (t > 0 && t <= best) {
            best = t;
            back = this._lastHitBack;
          }
        }
      } else {
        stack[sp++] = node + 1;
        stack[sp++] = this.offset[node];
      }
    }
    return best < tMax ? (back ? -best : best) : 0;
  }
  private readonly _stack = new Uint32Array(256);
  private readonly _closest = new Float32Array(3);
  /** Whether the last triangle `_rayTriangle` hit faced away from the ray. */
  private _lastHitBack = false;
  /** @internal */
  private _build(first: number, count: number, centroids: Float32Array, triBounds: Float32Array): number {
    const node = this._numNodes++;
    const b = this.bounds;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let cMinX = Infinity;
    let cMinY = Infinity;
    let cMinZ = Infinity;
    let cMaxX = -Infinity;
    let cMaxY = -Infinity;
    let cMaxZ = -Infinity;
    for (let i = first; i < first + count; i++) {
      const t = this.order[i];
      minX = Math.min(minX, triBounds[t * 6]);
      minY = Math.min(minY, triBounds[t * 6 + 1]);
      minZ = Math.min(minZ, triBounds[t * 6 + 2]);
      maxX = Math.max(maxX, triBounds[t * 6 + 3]);
      maxY = Math.max(maxY, triBounds[t * 6 + 4]);
      maxZ = Math.max(maxZ, triBounds[t * 6 + 5]);
      cMinX = Math.min(cMinX, centroids[t * 3]);
      cMinY = Math.min(cMinY, centroids[t * 3 + 1]);
      cMinZ = Math.min(cMinZ, centroids[t * 3 + 2]);
      cMaxX = Math.max(cMaxX, centroids[t * 3]);
      cMaxY = Math.max(cMaxY, centroids[t * 3 + 1]);
      cMaxZ = Math.max(cMaxZ, centroids[t * 3 + 2]);
    }
    b[node * 6] = minX;
    b[node * 6 + 1] = minY;
    b[node * 6 + 2] = minZ;
    b[node * 6 + 3] = maxX;
    b[node * 6 + 4] = maxY;
    b[node * 6 + 5] = maxZ;
    const extents = [cMaxX - cMinX, cMaxY - cMinY, cMaxZ - cMinZ];
    const cMin = [cMinX, cMinY, cMinZ];
    const split =
      count > LEAF_SIZE
        ? this._findSplit(first, count, centroids, triBounds, cMin, extents, [
            minX,
            minY,
            minZ,
            maxX,
            maxY,
            maxZ
          ])
        : null;
    if (!split) {
      this.offset[node] = first;
      this.count[node] = count;
      return node;
    }
    // Partition in place around the chosen bin boundary
    const { axis, pos } = split;
    let i = first;
    let j = first + count - 1;
    while (i <= j) {
      if (centroids[this.order[i] * 3 + axis] < pos) {
        i++;
      } else {
        const tmp = this.order[i];
        this.order[i] = this.order[j];
        this.order[j] = tmp;
        j--;
      }
    }
    let leftCount = i - first;
    if (leftCount === 0 || leftCount === count) {
      leftCount = count >> 1;
    }
    this.count[node] = 0;
    this._build(first, leftCount, centroids, triBounds);
    this.offset[node] = this._build(first + leftCount, count - leftCount, centroids, triBounds);
    return node;
  }
  /** Binned SAH; null when no split beats a leaf. @internal */
  private _findSplit(
    first: number,
    count: number,
    centroids: Float32Array,
    triBounds: Float32Array,
    cMin: number[],
    extents: number[],
    nodeBounds: number[]
  ) {
    let bestCost = count;
    let bestAxis = -1;
    let bestPos = 0;
    const binCount = new Uint32Array(SAH_BINS);
    const binBounds = new Float32Array(SAH_BINS * 6);
    const rightArea = new Float32Array(SAH_BINS);
    for (let axis = 0; axis < 3; axis++) {
      if (extents[axis] <= 1e-12) {
        continue;
      }
      binCount.fill(0);
      for (let k = 0; k < SAH_BINS; k++) {
        binBounds.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], k * 6);
      }
      const scale = SAH_BINS / extents[axis];
      for (let i = first; i < first + count; i++) {
        const t = this.order[i];
        const k = Math.min(SAH_BINS - 1, Math.floor((centroids[t * 3 + axis] - cMin[axis]) * scale));
        binCount[k]++;
        for (let c = 0; c < 3; c++) {
          binBounds[k * 6 + c] = Math.min(binBounds[k * 6 + c], triBounds[t * 6 + c]);
          binBounds[k * 6 + 3 + c] = Math.max(binBounds[k * 6 + 3 + c], triBounds[t * 6 + 3 + c]);
        }
      }
      // Sweep from the right for the area of everything past each boundary
      const acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      let accCount = 0;
      const rightCount = new Uint32Array(SAH_BINS);
      for (let k = SAH_BINS - 1; k > 0; k--) {
        grow(acc, binBounds, k);
        accCount += binCount[k];
        rightArea[k] = area(acc);
        rightCount[k] = accCount;
      }
      const left = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      let leftCount = 0;
      const parentArea = Math.max(area(nodeBounds), 1e-12);
      for (let k = 1; k < SAH_BINS; k++) {
        grow(left, binBounds, k - 1);
        leftCount += binCount[k - 1];
        if (leftCount === 0 || rightCount[k] === 0) {
          continue;
        }
        const cost = 0.125 + (area(left) * leftCount + rightArea[k] * rightCount[k]) / parentArea;
        if (cost < bestCost) {
          bestCost = cost;
          bestAxis = axis;
          bestPos = cMin[axis] + (k * extents[axis]) / SAH_BINS;
        }
      }
    }
    return bestAxis < 0 ? null : { axis: bestAxis, pos: bestPos };
  }
  /** @internal */
  private _triangleDistSq(t: number, px: number, py: number, pz: number) {
    const p = this.positions;
    const ia = this.indices[t * 3] * 3;
    const ib = this.indices[t * 3 + 1] * 3;
    const ic = this.indices[t * 3 + 2] * 3;
    closestPointOnTriangle(
      px,
      py,
      pz,
      p[ia],
      p[ia + 1],
      p[ia + 2],
      p[ib],
      p[ib + 1],
      p[ib + 2],
      p[ic],
      p[ic + 1],
      p[ic + 2],
      this._closest
    );
    const dx = this._closest[0] - px;
    const dy = this._closest[1] - py;
    const dz = this._closest[2] - pz;
    return dx * dx + dy * dy + dz * dz;
  }
  /** Möller-Trumbore, both faces; 0 for a miss. @internal */
  private _rayTriangle(t: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
    const p = this.positions;
    const ia = this.indices[t * 3] * 3;
    const ib = this.indices[t * 3 + 1] * 3;
    const ic = this.indices[t * 3 + 2] * 3;
    const ax = p[ia];
    const ay = p[ia + 1];
    const az = p[ia + 2];
    const e1x = p[ib] - ax;
    const e1y = p[ib + 1] - ay;
    const e1z = p[ib + 2] - az;
    const e2x = p[ic] - ax;
    const e2y = p[ic + 1] - ay;
    const e2z = p[ic + 2] - az;
    const qx = dy * e2z - dz * e2y;
    const qy = dz * e2x - dx * e2z;
    const qz = dx * e2y - dy * e2x;
    const det = e1x * qx + e1y * qy + e1z * qz;
    if (Math.abs(det) < 1e-20) {
      return 0;
    }
    // det = -dir . (e1 x e2): negative when the ray runs along the winding normal
    this._lastHitBack = det < 0;
    const inv = 1 / det;
    const sx = ox - ax;
    const sy = oy - ay;
    const sz = oz - az;
    const u = (sx * qx + sy * qy + sz * qz) * inv;
    if (u < 0 || u > 1) {
      return 0;
    }
    const rx = sy * e1z - sz * e1y;
    const ry = sz * e1x - sx * e1z;
    const rz = sx * e1y - sy * e1x;
    const v = (dx * rx + dy * ry + dz * rz) * inv;
    if (v < 0 || u + v > 1) {
      return 0;
    }
    const tt = (e2x * rx + e2y * ry + e2z * rz) * inv;
    return tt > 0 ? tt : 0;
  }
}

function nanTo(v: number, fallback: number) {
  return v !== v ? fallback : v;
}

function grow(acc: number[], b: Float32Array, k: number) {
  if (b[k * 6] > b[k * 6 + 3]) {
    return;
  }
  for (let c = 0; c < 3; c++) {
    acc[c] = Math.min(acc[c], b[k * 6 + c]);
    acc[3 + c] = Math.max(acc[3 + c], b[k * 6 + 3 + c]);
  }
}

function area(b: number[]) {
  const x = b[3] - b[0];
  const y = b[4] - b[1];
  const z = b[5] - b[2];
  return x < 0 || y < 0 || z < 0 ? 0 : 2 * (x * y + y * z + z * x);
}

function boxDistSq(b: Float32Array, node: number, px: number, py: number, pz: number) {
  const o = node * 6;
  const dx = Math.max(b[o] - px, 0, px - b[o + 3]);
  const dy = Math.max(b[o + 1] - py, 0, py - b[o + 4]);
  const dz = Math.max(b[o + 2] - pz, 0, pz - b[o + 5]);
  return dx * dx + dy * dy + dz * dz;
}

/** Ray parameter at which a ray enters node bounds, Infinity when it misses them. */
function rayBoxEntry(
  b: Float32Array,
  node: number,
  ox: number,
  oy: number,
  oz: number,
  ix: number,
  iy: number,
  iz: number
) {
  const o = node * 6;
  let t0x = (b[o] - ox) * ix;
  let t1x = (b[o + 3] - ox) * ix;
  if (t0x > t1x) {
    const t = t0x;
    t0x = t1x;
    t1x = t;
  }
  let t0y = (b[o + 1] - oy) * iy;
  let t1y = (b[o + 4] - oy) * iy;
  if (t0y > t1y) {
    const t = t0y;
    t0y = t1y;
    t1y = t;
  }
  let t0z = (b[o + 2] - oz) * iz;
  let t1z = (b[o + 5] - oz) * iz;
  if (t0z > t1z) {
    const t = t0z;
    t0z = t1z;
    t1z = t;
  }
  const tNear = Math.max(nanTo(t0x, -Infinity), nanTo(t0y, -Infinity), nanTo(t0z, -Infinity), 0);
  const tFar = Math.min(nanTo(t1x, Infinity), nanTo(t1y, Infinity), nanTo(t1z, Infinity));
  return tNear <= tFar ? tNear : Infinity;
}

function rayHitsBox(
  b: Float32Array,
  node: number,
  ox: number,
  oy: number,
  oz: number,
  ix: number,
  iy: number,
  iz: number
) {
  const o = node * 6;
  let t0x = (b[o] - ox) * ix;
  let t1x = (b[o + 3] - ox) * ix;
  if (t0x > t1x) {
    const t = t0x;
    t0x = t1x;
    t1x = t;
  }
  let t0y = (b[o + 1] - oy) * iy;
  let t1y = (b[o + 4] - oy) * iy;
  if (t0y > t1y) {
    const t = t0y;
    t0y = t1y;
    t1y = t;
  }
  let t0z = (b[o + 2] - oz) * iz;
  let t1z = (b[o + 5] - oz) * iz;
  if (t0z > t1z) {
    const t = t0z;
    t0z = t1z;
    t1z = t;
  }
  // NaN from 0 * Infinity (origin on a slab face of an axis-parallel ray) is no constraint
  const tNear = Math.max(nanTo(t0x, -Infinity), nanTo(t0y, -Infinity), nanTo(t0z, -Infinity), 0);
  const tFar = Math.min(nanTo(t1x, Infinity), nanTo(t1y, Infinity), nanTo(t1z, Infinity));
  return tNear <= tFar;
}

/**
 * Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5).
 * @internal
 */
export function closestPointOnTriangle(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  out: Float32Array
) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out[0] = ax;
    out[1] = ay;
    out[2] = az;
    return;
  }
  const bpx = px - bx;
  const bpy = py - by;
  const bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out[0] = bx;
    out[1] = by;
    out[2] = bz;
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + v * abx;
    out[1] = ay + v * aby;
    out[2] = az + v * abz;
    return;
  }
  const cpx = px - cx;
  const cpy = py - cy;
  const cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out[0] = cx;
    out[1] = cy;
    out[2] = cz;
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + w * acx;
    out[1] = ay + w * acy;
    out[2] = az + w * acz;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out[0] = bx + w * (cx - bx);
    out[1] = by + w * (cy - by);
    out[2] = bz + w * (cz - bz);
    return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}
