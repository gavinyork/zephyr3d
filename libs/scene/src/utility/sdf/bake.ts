import { closestPointOnTriangle, TriangleBVH } from './bvh';

/**
 * Options of {@link bakeMeshSDF}.
 * @public
 */
export interface MeshSDFBakeOptions {
  /**
   * Scale on the voxel density: voxels along the longest side of the mesh are
   * `64 * resolutionScale`, before the padding and the clamp. Default 1.
   */
  resolutionScale?: number;
  /**
   * Treat the mesh as a thin open surface (a leaf, a sail, a terrain skirt):
   * no inside, the distance is unsigned less half a voxel so the surface still
   * has a negative shell. Default false.
   */
  twoSided?: boolean;
  /** Voxels of empty space around the mesh bounds on every side. Default 2. */
  padding?: number;
  /** Voxels per axis, at most. Default 128. */
  maxResolution?: number;
  /** Voxels per axis, at least. Default 8. */
  minResolution?: number;
}

/**
 * A signed distance field over a mesh, in the mesh's local space: negative
 * inside, positive outside, in local units.
 *
 * Samples sit at voxel centres: sample `(i, j, k)` is at
 * `boxMin + (i + 0.5, j + 0.5, k + 0.5) * voxelSize`, stored x fastest, then y,
 * then z. Voxels are cubes.
 *
 * @public
 */
export interface MeshSDFData {
  /** Lower corner of the volume, the mesh bounds less the padding. */
  boxMin: [number, number, number];
  /** Upper corner of the volume, `boxMin + resolution * voxelSize`. */
  boxMax: [number, number, number];
  /** Voxels per axis. */
  resolution: [number, number, number];
  /** Edge of a voxel in local units. */
  voxelSize: number;
  /** Bounds of the mesh itself, inside the volume. */
  meshBoxMin: [number, number, number];
  meshBoxMax: [number, number, number];
  twoSided: boolean;
  /** Smallest and largest distance in the volume. */
  minDistance: number;
  maxDistance: number;
  /** One distance per voxel. */
  distances: Float32Array;
}

/** Most crossings recorded along one sign ray. */
const MAX_RAY_HITS = 2048;
/** Voxels around a triangle's bounds seeded with its exact distance. */
const SEED_MARGIN = 1;

/**
 * Unsigned distance per voxel by closest-triangle propagation: every voxel near
 * a triangle gets its exact distance to it, then fast sweeps in the eight
 * diagonal orders pass each voxel's nearest triangle on to its neighbours,
 * which keep it if it is nearer than theirs. Each voxel ends up measured
 * against the triangle nearest to it (up to rare cases where the nearest
 * triangle of a voxel is nearest to none of its neighbours, off by a small
 * fraction of a voxel). A few triangle distances per voxel, against a BVH
 * query per voxel that degrades to every triangle near a medial axis.
 */
function computeUnsignedDistances(
  positions: Float32Array,
  indices: Uint32Array,
  boxMin: [number, number, number],
  resolution: [number, number, number],
  h: number
) {
  const [nx, ny, nz] = resolution;
  const count = nx * ny * nz;
  const dist = new Float32Array(count).fill(Infinity);
  const tri = new Int32Array(count).fill(-1);
  const numTris = Math.floor(indices.length / 3);
  const tmp = new Float32Array(3);
  const triDist = (t: number, x: number, y: number, z: number) => {
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;
    closestPointOnTriangle(
      x,
      y,
      z,
      positions[ia],
      positions[ia + 1],
      positions[ia + 2],
      positions[ib],
      positions[ib + 1],
      positions[ib + 2],
      positions[ic],
      positions[ic + 1],
      positions[ic + 2],
      tmp
    );
    const dx = tmp[0] - x;
    const dy = tmp[1] - y;
    const dz = tmp[2] - z;
    return dx * dx + dy * dy + dz * dz;
  };
  // Seed: exact squared distance in each triangle's own neighbourhood
  for (let t = 0; t < numTris; t++) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k] * 3;
      for (let c = 0; c < 3; c++) {
        lo[c] = Math.min(lo[c], positions[v + c]);
        hi[c] = Math.max(hi[c], positions[v + c]);
      }
    }
    const i0 = Math.max(0, Math.floor((lo[0] - boxMin[0]) / h - 0.5) - SEED_MARGIN + 1);
    const j0 = Math.max(0, Math.floor((lo[1] - boxMin[1]) / h - 0.5) - SEED_MARGIN + 1);
    const k0 = Math.max(0, Math.floor((lo[2] - boxMin[2]) / h - 0.5) - SEED_MARGIN + 1);
    const i1 = Math.min(nx - 1, Math.ceil((hi[0] - boxMin[0]) / h - 0.5) + SEED_MARGIN - 1);
    const j1 = Math.min(ny - 1, Math.ceil((hi[1] - boxMin[1]) / h - 0.5) + SEED_MARGIN - 1);
    const k1 = Math.min(nz - 1, Math.ceil((hi[2] - boxMin[2]) / h - 0.5) + SEED_MARGIN - 1);
    for (let k = k0; k <= k1; k++) {
      const z = boxMin[2] + (k + 0.5) * h;
      for (let j = j0; j <= j1; j++) {
        const y = boxMin[1] + (j + 0.5) * h;
        let o = (k * ny + j) * nx + i0;
        for (let i = i0; i <= i1; i++, o++) {
          const d = triDist(t, boxMin[0] + (i + 0.5) * h, y, z);
          if (d < dist[o]) {
            dist[o] = d;
            tri[o] = t;
          }
        }
      }
    }
  }
  // Sweeps: in each of the eight diagonal orders, a voxel tries the nearest
  // triangles of its three predecessors along the order. One round of eight
  // measured as accurate as two.
  const strides = [1, nx, nx * ny];
  for (let order = 0; order < 8; order++) {
    const sx = order & 1 ? -1 : 1;
    const sy = order & 2 ? -1 : 1;
    const sz = order & 4 ? -1 : 1;
    for (let kk = 0; kk < nz; kk++) {
      const k = sz > 0 ? kk : nz - 1 - kk;
      const z = boxMin[2] + (k + 0.5) * h;
      for (let jj = 0; jj < ny; jj++) {
        const j = sy > 0 ? jj : ny - 1 - jj;
        const y = boxMin[1] + (j + 0.5) * h;
        for (let ii = 0; ii < nx; ii++) {
          const i = sx > 0 ? ii : nx - 1 - ii;
          const o = (k * ny + j) * nx + i;
          const x = boxMin[0] + (i + 0.5) * h;
          const own = tri[o];
          if (ii > 0) {
            const t = tri[o - sx * strides[0]];
            if (t >= 0 && t !== own) {
              const d = triDist(t, x, y, z);
              if (d < dist[o]) {
                dist[o] = d;
                tri[o] = t;
              }
            }
          }
          if (jj > 0) {
            const t = tri[o - sy * strides[1]];
            if (t >= 0 && t !== tri[o]) {
              const d = triDist(t, x, y, z);
              if (d < dist[o]) {
                dist[o] = d;
                tri[o] = t;
              }
            }
          }
          if (kk > 0) {
            const t = tri[o - sz * strides[2]];
            if (t >= 0 && t !== tri[o]) {
              const d = triDist(t, x, y, z);
              if (d < dist[o]) {
                dist[o] = d;
                tri[o] = t;
              }
            }
          }
        }
      }
    }
  }
  for (let i = 0; i < count; i++) {
    dist[i] = Math.sqrt(dist[i]);
  }
  return dist;
}

/**
 * Bakes the signed distance field of a triangle mesh on the CPU.
 *
 * Distance is by closest-triangle propagation (see computeUnsignedDistances),
 * exact near the surface. The sign comes from
 * crossing parity along rays swept through the volume on the three axes, one
 * per row of voxels, and a majority vote of the three: a hole in the surface
 * spoils at most the rays passing through it, not the whole interior. Cost is
 * a few triangle distances per voxel and three BVH rays per row.
 *
 * @param positions - Vertex positions, xyz per vertex.
 * @param indices - Three indices per triangle.
 * @public
 */
export function bakeMeshSDF(
  positions: Float32Array,
  indices: Uint32Array,
  options?: MeshSDFBakeOptions
): MeshSDFData {
  const scale = Math.max(0.01, options?.resolutionScale ?? 1);
  const twoSided = !!options?.twoSided;
  const padding = Math.max(1, Math.floor(options?.padding ?? 2));
  const maxRes = Math.max(4, Math.floor(options?.maxResolution ?? 128));
  const minRes = Math.min(maxRes, Math.max(2, Math.floor(options?.minResolution ?? 8)));
  const meshMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const meshMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const numVerts = Math.floor(positions.length / 3);
  // Only the vertices triangles use count towards the bounds
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (v >= numVerts) {
      throw new Error('bakeMeshSDF(): index out of range');
    }
    for (let c = 0; c < 3; c++) {
      meshMin[c] = Math.min(meshMin[c], positions[v * 3 + c]);
      meshMax[c] = Math.max(meshMax[c], positions[v * 3 + c]);
    }
  }
  if (indices.length < 3) {
    throw new Error('bakeMeshSDF(): the mesh has no triangles');
  }
  const extent = [meshMax[0] - meshMin[0], meshMax[1] - meshMin[1], meshMax[2] - meshMin[2]];
  const longest = Math.max(extent[0], extent[1], extent[2], 1e-6);
  let voxelSize = longest / (64 * scale);
  // Fit the longest side, padding included, under the cap
  voxelSize = Math.max(voxelSize, longest / (maxRes - 2 * padding));
  const resolution: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    resolution[c] = Math.min(maxRes, Math.max(minRes, Math.ceil(extent[c] / voxelSize) + 2 * padding));
  }
  // Centre the mesh in the volume
  const boxMin: [number, number, number] = [0, 0, 0];
  const boxMax: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const size = resolution[c] * voxelSize;
    boxMin[c] = (meshMin[c] + meshMax[c]) * 0.5 - size * 0.5;
    boxMax[c] = boxMin[c] + size;
  }
  const bvh = new TriangleBVH(positions, indices);
  const [nx, ny, nz] = resolution;
  const count = nx * ny * nz;
  const distances = computeUnsignedDistances(positions, indices, boxMin, resolution, voxelSize);
  if (twoSided) {
    for (let i = 0; i < count; i++) {
      distances[i] -= voxelSize * 0.5;
    }
  } else {
    const votes = new Uint8Array(count);
    const hits = new Float32Array(MAX_RAY_HITS);
    // Rays start outside the volume and are nudged off the voxel centre lines
    // by an irrational fraction of a voxel, so they do not run along edges of
    // axis-aligned geometry, where a crossing would count twice or not at all.
    const nudgeA = voxelSize * 0.0137;
    const nudgeB = voxelSize * 0.0071;
    for (let axis = 0; axis < 3; axis++) {
      const a1 = (axis + 1) % 3;
      const a2 = (axis + 2) % 3;
      const n0 = resolution[axis];
      const n1 = resolution[a1];
      const n2 = resolution[a2];
      const start = boxMin[axis] - voxelSize;
      const origin = [0, 0, 0];
      const dir = [0, 0, 0];
      dir[axis] = 1;
      const stride = [1, nx, nx * ny];
      for (let v = 0; v < n2; v++) {
        for (let u = 0; u < n1; u++) {
          origin[axis] = start;
          origin[a1] = boxMin[a1] + (u + 0.5) * voxelSize + nudgeA;
          origin[a2] = boxMin[a2] + (v + 0.5) * voxelSize + nudgeB;
          const n = bvh.rayHits(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], hits);
          const sorted = hits.subarray(0, n).sort();
          let h = 0;
          let inside = false;
          const base = u * stride[a1] + v * stride[a2];
          for (let s = 0; s < n0; s++) {
            const t = (s + 0.5) * voxelSize + voxelSize;
            while (h < n && sorted[h] < t) {
              inside = !inside;
              h++;
              // Coincident crossings, from a ray through a shared edge, count once
              while (h < n && sorted[h] - sorted[h - 1] < voxelSize * 1e-5) {
                h++;
              }
            }
            if (inside) {
              votes[base + s * stride[axis]]++;
            }
          }
        }
      }
    }
    for (let i = 0; i < count; i++) {
      if (votes[i] >= 2) {
        distances[i] = -distances[i];
      }
    }
  }
  let minDistance = Infinity;
  let maxDistance = -Infinity;
  for (let i = 0; i < count; i++) {
    minDistance = Math.min(minDistance, distances[i]);
    maxDistance = Math.max(maxDistance, distances[i]);
  }
  return {
    boxMin,
    boxMax,
    resolution,
    voxelSize,
    meshBoxMin: meshMin,
    meshBoxMax: meshMax,
    twoSided,
    minDistance,
    maxDistance,
    distances
  };
}

/**
 * Trilinear sample of a baked field at a local position. Outside the volume
 * the nearest border sample plus the distance to the volume is returned, a
 * bound that never undershoots by more than the border's own error.
 * @public
 */
export function sampleMeshSDF(sdf: MeshSDFData, x: number, y: number, z: number) {
  const [nx, ny, nz] = sdf.resolution;
  const h = sdf.voxelSize;
  const cx = Math.min(Math.max(x, sdf.boxMin[0]), sdf.boxMax[0]);
  const cy = Math.min(Math.max(y, sdf.boxMin[1]), sdf.boxMax[1]);
  const cz = Math.min(Math.max(z, sdf.boxMin[2]), sdf.boxMax[2]);
  const outside = Math.hypot(x - cx, y - cy, z - cz);
  const fx = Math.min(Math.max((cx - sdf.boxMin[0]) / h - 0.5, 0), nx - 1);
  const fy = Math.min(Math.max((cy - sdf.boxMin[1]) / h - 0.5, 0), ny - 1);
  const fz = Math.min(Math.max((cz - sdf.boxMin[2]) / h - 0.5, 0), nz - 1);
  const i0 = Math.min(Math.floor(fx), nx - 2 < 0 ? 0 : nx - 2);
  const j0 = Math.min(Math.floor(fy), ny - 2 < 0 ? 0 : ny - 2);
  const k0 = Math.min(Math.floor(fz), nz - 2 < 0 ? 0 : nz - 2);
  const i1 = Math.min(i0 + 1, nx - 1);
  const j1 = Math.min(j0 + 1, ny - 1);
  const k1 = Math.min(k0 + 1, nz - 1);
  const tx = fx - i0;
  const ty = fy - j0;
  const tz = fz - k0;
  const d = sdf.distances;
  const at = (i: number, j: number, k: number) => d[(k * ny + j) * nx + i];
  const c00 = at(i0, j0, k0) * (1 - tx) + at(i1, j0, k0) * tx;
  const c10 = at(i0, j1, k0) * (1 - tx) + at(i1, j1, k0) * tx;
  const c01 = at(i0, j0, k1) * (1 - tx) + at(i1, j0, k1) * tx;
  const c11 = at(i0, j1, k1) * (1 - tx) + at(i1, j1, k1) * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz + outside;
}
