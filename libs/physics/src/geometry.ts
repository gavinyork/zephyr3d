import { half2float } from '@zephyr3d/base';
import type { Primitive, PrimitiveTriangles } from '@zephyr3d/scene';
import { ClipmapTerrain, Mesh, readPrimitiveTriangles } from '@zephyr3d/scene';
import type { Collider } from './collider';

/** Triangles in the node's local space, for `mesh` and `convex` colliders. @internal */
export interface MeshGeometry {
  kind: 'mesh';
  positions: Float32Array;
  indices: Uint32Array;
  /** Where it came from, to tell when it is out of date; null for explicit data. */
  primitive: Primitive | null;
  lod: number;
}

/** Heights of a terrain, half floats decoded, row by row along X. @internal */
export interface TerrainGeometry {
  kind: 'terrain';
  heights: Float32Array;
  width: number;
  height: number;
  terrain: ClipmapTerrain;
  version: number;
}

/** @internal */
export type ColliderGeometry = MeshGeometry | TerrainGeometry;

/** What a collider's geometry should currently come from. @internal */
export type GeometrySource =
  | { kind: 'explicit' }
  | { kind: 'mesh'; primitive: Primitive; lod: number }
  | { kind: 'terrain'; terrain: ClipmapTerrain; version: number };

/** Shapes built from geometry rather than from size parameters. @internal */
export function needsGeometry(collider: Collider) {
  return collider.shape === 'mesh' || collider.shape === 'convex' || collider.shape === 'terrain';
}

/**
 * Works out where a collider's geometry comes from, or throws with a message
 * for the user when it cannot have any.
 *
 * @internal
 */
export function geometrySource(collider: Collider): GeometrySource {
  const host = collider.host!;
  if (collider.shape === 'terrain') {
    if (!(host instanceof ClipmapTerrain)) {
      throw new Error('A terrain collider must be on a terrain node');
    }
    return { kind: 'terrain', terrain: host, version: host.heightVersion };
  }
  if (collider._meshData) {
    return { kind: 'explicit' };
  }
  if (!(host instanceof Mesh)) {
    throw new Error('A mesh or convex collider must be on a mesh node, or be given its triangles');
  }
  const primitive = host.primitive;
  if (!primitive) {
    throw new Error('The mesh has no geometry');
  }
  // Their shape changes every frame; a fixed set of triangles would not match.
  if (host.skinBindingName || primitive.getVertexBufferInfo('blendIndices')) {
    throw new Error('Skinned meshes cannot be mesh or convex colliders; use basic shapes on the bones');
  }
  if (host.getMorphData()) {
    throw new Error('Meshes with morph targets cannot be mesh or convex colliders');
  }
  return { kind: 'mesh', primitive, lod: Math.min(collider.meshLod, primitive.lods.length) };
}

/** Whether geometry was made from the given source. @internal */
export function geometryMatches(geometry: ColliderGeometry | null, source: GeometrySource) {
  if (!geometry) {
    return false;
  }
  switch (source.kind) {
    case 'explicit':
      return geometry.kind === 'mesh' && geometry.primitive === null;
    case 'mesh':
      return (
        geometry.kind === 'mesh' && geometry.primitive === source.primitive && geometry.lod === source.lod
      );
    case 'terrain':
      return (
        geometry.kind === 'terrain' &&
        geometry.terrain === source.terrain &&
        geometry.version === source.version
      );
  }
}

/** Two sources asking for the same data. @internal */
export function sameSource(a: GeometrySource, b: GeometrySource) {
  switch (a.kind) {
    case 'explicit':
      return b.kind === 'explicit';
    case 'mesh':
      return b.kind === 'mesh' && a.primitive === b.primitive && a.lod === b.lod;
    case 'terrain':
      return b.kind === 'terrain' && a.terrain === b.terrain && a.version === b.version;
  }
}

/**
 * Read backs per primitive and level, shared by every collider using them: a
 * mesh placed a hundred times is read once. Unscaled, so differently scaled
 * instances share it too.
 */
const triangleCache = new WeakMap<Primitive, Map<number, Promise<PrimitiveTriangles>>>();

function readTriangles(primitive: Primitive, lod: number) {
  let levels = triangleCache.get(primitive);
  if (!levels) {
    levels = new Map();
    triangleCache.set(primitive, levels);
  }
  const cached = levels.get(lod);
  if (cached) {
    return cached;
  }
  const promise = readPrimitiveTriangles(primitive, lod);
  // A failed read back is not cached, so it can be retried.
  promise.catch(() => levels!.delete(lod));
  levels.set(lod, promise);
  return promise;
}

function decodeHeights(data: Uint16Array, count: number) {
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    heights[i] = half2float(data[i]);
  }
  return heights;
}

/**
 * Gets a collider's geometry: right away when it is on the CPU (explicit
 * triangles, a terrain's loaded heights), otherwise by reading it back from
 * the GPU.
 *
 * @internal
 */
export function fetchGeometry(
  collider: Collider,
  source: GeometrySource
): ColliderGeometry | Promise<ColliderGeometry> {
  switch (source.kind) {
    case 'explicit': {
      const data = collider._meshData!;
      return { kind: 'mesh', positions: data.positions, indices: data.indices, primitive: null, lod: 0 };
    }
    case 'mesh':
      return readTriangles(source.primitive, source.lod).then((t) => ({
        kind: 'mesh',
        positions: t.positions,
        indices: t.indices,
        primitive: source.primitive,
        lod: source.lod
      }));
    case 'terrain': {
      const { terrain, version } = source;
      const cpu = terrain.heightData;
      if (cpu) {
        return {
          kind: 'terrain',
          heights: decodeHeights(cpu.data, cpu.width * cpu.height),
          width: cpu.width,
          height: cpu.height,
          terrain,
          version
        };
      }
      const map = terrain.heightMap;
      if (!map) {
        throw new Error('The terrain has no height map');
      }
      const width = map.width;
      const height = map.height;
      const data = new Uint16Array(width * height);
      return map.readPixels(0, 0, width, height, 0, 0, data).then(() => ({
        kind: 'terrain',
        heights: decodeHeights(data, width * height),
        width,
        height,
        terrain,
        version
      }));
    }
  }
}

/**
 * Whether points span a volume, so their convex hull is a solid: at least four
 * of them, not all on one line or in one plane. Rapier builds a flat hull from
 * points in a plane rather than refusing them.
 *
 * @internal
 */
export function spansVolume(points: Float32Array) {
  const n = points.length / 3;
  if (n < 4) {
    return false;
  }
  let extent = 0;
  for (let i = 0; i < points.length; i++) {
    extent = Math.max(extent, Math.abs(points[i]));
  }
  const eps = Math.max(extent, 1e-12) * 1e-6;
  const p = (i: number, c: number) => points[i * 3 + c];
  // The farthest point from the first, then from that line, then from that plane.
  let b = 0;
  let best = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(p(i, 0) - p(0, 0), p(i, 1) - p(0, 1), p(i, 2) - p(0, 2));
    if (d > best) {
      best = d;
      b = i;
    }
  }
  if (best <= eps) {
    return false;
  }
  const ux = p(b, 0) - p(0, 0);
  const uy = p(b, 1) - p(0, 1);
  const uz = p(b, 2) - p(0, 2);
  let nx = 0;
  let ny = 0;
  let nz = 0;
  best = 0;
  for (let i = 1; i < n; i++) {
    const vx = p(i, 0) - p(0, 0);
    const vy = p(i, 1) - p(0, 1);
    const vz = p(i, 2) - p(0, 2);
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const d = Math.hypot(cx, cy, cz);
    if (d > best) {
      best = d;
      nx = cx;
      ny = cy;
      nz = cz;
    }
  }
  if (best <= eps * Math.hypot(ux, uy, uz)) {
    return false;
  }
  const len = Math.hypot(nx, ny, nz);
  for (let i = 1; i < n; i++) {
    const d = Math.abs((p(i, 0) - p(0, 0)) * nx + (p(i, 1) - p(0, 1)) * ny + (p(i, 2) - p(0, 2)) * nz) / len;
    if (d > eps) {
      return true;
    }
  }
  return false;
}
