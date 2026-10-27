import { closestPointOnTriangle, TriangleBVH } from './bvh';

/**
 * Options of {@link bakeMeshSDF}.
 * @public
 */
export interface MeshSDFBakeOptions {
  /**
   * Scale on the voxel density of {@link SDF_VOXELS_PER_UNIT} voxels per world
   * unit, before the padding and the clamp. Default 1.
   */
  resolutionScale?: number;
  /**
   * World units one local unit of the mesh spans where it is used, which the
   * density is measured in. Default 1.
   */
  unitScale?: number;
  /**
   * Treat the mesh as a thin open surface (a leaf, a sail, a terrain skirt):
   * no inside, the distance is unsigned less half a voxel so the surface still
   * has a negative shell. Default false.
   */
  twoSided?: boolean;
  /**
   * Rays per hemisphere that decide which side of the surface a voxel is on,
   * a square number; 49 by default. More rays settle ambiguous voxels, such as
   * those near where single-sided sheets meet, at proportionally more time.
   */
  signSamples?: number;
  /** Voxels of empty space around the mesh bounds on every side. Default 2. */
  padding?: number;
  /**
   * Voxels per axis, at most, padding included. Default 128, or 256 for a
   * resolution scale above 1, as Unreal halves r.DistanceFields.MaxPerMeshResolution
   * (256) for meshes not scaled up (MeshDistanceFieldUtilities.cpp).
   */
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

/**
 * Voxels per world unit of a baked field at a resolution scale of 1, taking a
 * unit as a metre: Unreal's r.DistanceFields.DefaultVoxelDensity, 0.2 voxels a
 * centimetre (DistanceFieldAtlas.cpp). The density is fixed, so a small mesh
 * gets few voxels and a large one many, up to the cap per axis; the global
 * field composites them all at its own voxel size of a quarter metre and up.
 * Unreal counts it per local unit, its meshes being built in centimetres; here
 * a mesh keeps the units it was authored in, so the bake is told the world
 * units a local unit spans ({@link MeshSDFBakeOptions.unitScale}).
 * @public
 */
export const SDF_VOXELS_PER_UNIT = 20;

/** Voxels from the surface within which the sign is decided by rays; further voxels take it from their neighbours. */
const SIGN_BAND_VOXELS = 1;
/** Length of a sign ray in voxel diagonals, the band size of the Unreal Engine mesh distance fields. */
const SIGN_TRACE_DIAGONALS = 4;
/** Fraction of the sign rays that must hit a back face for a voxel to count as inside. */
const SIGN_BACK_FRACTION = 0.25;
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
 * exact near the surface. The sign comes from the faces the voxels see (see
 * signDistances): a voxel within a band of the surface is inside when more
 * than a quarter of the rays cast from it hit back faces, and the voxels
 * further out take the sign of the band around them. Unlike crossing parity
 * this needs no closed surface: a single-sided wall is solid just behind it,
 * so the courtyard it encloses stays empty, and a surface that is open at the
 * back is still a surface. Cost is a few triangle distances per voxel and, in
 * the band, one short BVH ray per sample direction.
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
  const maxRes = Math.max(4, Math.floor(options?.maxResolution ?? (scale > 1 ? 256 : 128)));
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
  const unitScale = options?.unitScale && options.unitScale > 0 ? options.unitScale : 1;
  let voxelSize = 1 / (SDF_VOXELS_PER_UNIT * scale * unitScale);
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
    signDistances(distances, bvh, boxMin, resolution, voxelSize, options?.signSamples);
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

/** Deterministic 32-bit generator (mulberry32), so a mesh bakes the same every time. */
function makeRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stratified directions over the sphere: a square grid of jittered samples on
 * each hemisphere, mapped through the concentric disk [Shirley & Chiu 1997],
 * one hemisphere mirrored in z. xyz per direction.
 */
function sphereDirections(perHemisphere: number) {
  const dim = Math.max(1, Math.floor(Math.sqrt(perHemisphere)));
  const random = makeRandom(0);
  const dirs = new Float32Array(dim * dim * 2 * 3);
  let n = 0;
  // The two hemispheres interleave, so a prefix of the list covers both sides
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      for (let hemi = 0; hemi < 2; hemi++) {
        const u = ((i + random()) / dim) * 2 - 1;
        const v = ((j + random()) / dim) * 2 - 1;
        let x = 0;
        let y = 0;
        let z = 1;
        if (u !== 0 || v !== 0) {
          let r: number;
          let theta: number;
          if (Math.abs(u) > Math.abs(v)) {
            r = u;
            theta = (Math.PI / 4) * (v / u);
          } else {
            r = v;
            theta = Math.PI / 2 - (Math.PI / 4) * (u / v);
          }
          const r2 = r * r;
          const s = Math.sqrt(2 - r2);
          x = r * Math.cos(theta) * s;
          y = r * Math.sin(theta) * s;
          z = 1 - r2;
        }
        dirs[n++] = x;
        dirs[n++] = y;
        dirs[n++] = hemi === 0 ? z : -z;
      }
    }
  }
  return dirs;
}

/**
 * Gives the unsigned distances their sign. Every voxel within SIGN_BAND_VOXELS
 * of the surface casts the sample directions a few voxels out and is inside
 * when it hit anything and more than SIGN_BACK_FRACTION of the rays hit a
 * back face: the criterion of the Unreal Engine mesh distance field builder,
 * which holds for open and single-sided meshes where crossing parity does
 * not. The voxels beyond the band are flood filled in connected regions; a
 * region reaching the volume border is outside, any other takes the sign most
 * of the band voxels around it have (the interior of a thick part, the air in
 * a closed room).
 */
function signDistances(
  distances: Float32Array,
  bvh: TriangleBVH,
  boxMin: [number, number, number],
  resolution: [number, number, number],
  h: number,
  samples?: number
) {
  const [nx, ny, nz] = resolution;
  const count = nx * ny * nz;
  const dirs = sphereDirections(Math.max(1, Math.floor(samples ?? 49)));
  const numDirs = dirs.length / 3;
  const band = SIGN_BAND_VOXELS * h;
  const traceDistance = SIGN_TRACE_DIAGONALS * Math.sqrt(3) * h;
  // Pulled back a little so a ray starting on a triangle still crosses it
  const pullback = 1e-4 * traceDistance;
  const tMax = traceDistance + pullback;
  const needBack = SIGN_BACK_FRACTION * numDirs;
  // 0: beyond the band, 1: outside, 2: inside
  const side = new Uint8Array(count);
  for (let k = 0; k < nz; k++) {
    const z = boxMin[2] + (k + 0.5) * h;
    for (let j = 0; j < ny; j++) {
      const y = boxMin[1] + (j + 0.5) * h;
      for (let i = 0; i < nx; i++) {
        const index = i + j * nx + k * nx * ny;
        if (distances[index] > band) {
          continue;
        }
        const x = boxMin[0] + (i + 0.5) * h;
        let hit = 0;
        let hitBack = 0;
        // Stops once the back faces seen settle it either way
        for (let d = 0; d < numDirs && hitBack <= needBack && hitBack + numDirs - d > needBack; d++) {
          const dx = dirs[d * 3];
          const dy = dirs[d * 3 + 1];
          const dz = dirs[d * 3 + 2];
          const t = bvh.rayNearestHit(
            x - dx * pullback,
            y - dy * pullback,
            z - dz * pullback,
            dx,
            dy,
            dz,
            tMax
          );
          if (t !== 0) {
            hit++;
            if (t < 0) {
              hitBack++;
            }
          }
        }
        side[index] = hit > 0 && hitBack > needBack ? 2 : 1;
      }
    }
  }
  // Regions beyond the band, six-connected
  const queue = new Int32Array(count);
  const region = new Int32Array(count).fill(-1);
  const strides = [1, nx, nx * ny];
  for (let seed = 0; seed < count; seed++) {
    if (side[seed] !== 0 || region[seed] >= 0) {
      continue;
    }
    let head = 0;
    let tail = 0;
    let border = false;
    let inside = 0;
    let outside = 0;
    queue[tail++] = seed;
    region[seed] = seed;
    while (head < tail) {
      const v = queue[head++];
      const vi = v % nx;
      const vj = ((v - vi) / nx) % ny;
      const vk = (v - vi - vj * nx) / (nx * ny);
      const coord = [vi, vj, vk];
      for (let axis = 0; axis < 3; axis++) {
        for (let step = -1; step <= 1; step += 2) {
          const c = coord[axis] + step;
          if (c < 0 || c >= resolution[axis]) {
            border = true;
            continue;
          }
          const w = v + step * strides[axis];
          const s = side[w];
          if (s === 0) {
            if (region[w] < 0) {
              region[w] = seed;
              queue[tail++] = w;
            }
          } else if (s === 2) {
            inside++;
          } else {
            outside++;
          }
        }
      }
    }
    if (!border && inside > outside) {
      for (let q = 0; q < tail; q++) {
        side[queue[q]] = 2;
      }
    }
  }
  for (let i = 0; i < count; i++) {
    if (side[i] === 2) {
      distances[i] = -distances[i];
    }
  }
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
