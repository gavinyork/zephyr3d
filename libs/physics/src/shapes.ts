import { Quaternion, Vector3 } from '@zephyr3d/base';
import type { ClipmapTerrain } from '@zephyr3d/scene';
import type { ShapeDesc } from './backend/types';
import type { Collider } from './collider';
import { spansVolume, type ColliderGeometry, type MeshGeometry, type TerrainGeometry } from './geometry';

/** @internal */
export const CONVEX_HULL_ERROR =
  'Could not build a convex hull: it needs at least four points that are not all in one plane';

/** A collider's shape as the simulation builds it, and where it sits in the world. @internal */
export interface ColliderShapeBuild {
  shape: ShapeDesc;
  position: Vector3;
  rotation: Quaternion;
}

const tmpScale = new Vector3();

/**
 * Builds the shape of a collider from its settings, its node's world transform
 * and, for mesh, convex and terrain colliders, its geometry. The world and the
 * outline drawn by tools both use this, so they agree.
 *
 * @returns The shape and its world pose, or an error message for the user.
 *
 * @internal
 */
export function buildColliderShape(
  component: Collider,
  geometry: ColliderGeometry | null
): ColliderShapeBuild | { error: string } {
  const host = component.host!;
  // The collider's world pose: its node, moved by its offset in node space.
  const position = new Vector3();
  const rotation = new Quaternion();
  host.worldMatrix.decompose(tmpScale, rotation, position);
  host.worldMatrix.transformPointAffine(component.offset, position);
  if (geometry?.kind === 'terrain') {
    const pose = { position, rotation };
    const shape = terrainShape(host as ClipmapTerrain, geometry, component.terrainResolution, pose);
    return shape ? { shape, ...pose } : { error: 'The terrain height map is too small for a collider' };
  }
  if (geometry) {
    // Signed: a mirrored mesh stays mirrored.
    const shape = meshShape(component, geometry, tmpScale);
    if (shape.type === 'trimesh' && shape.indices.length < 3) {
      return { error: 'A mesh collider needs triangles' };
    }
    if (shape.type === 'convex' && !spansVolume(shape.points)) {
      return { error: CONVEX_HULL_ERROR };
    }
    return { shape, position, rotation };
  }
  const scale = new Vector3(Math.abs(tmpScale.x), Math.abs(tmpScale.y), Math.abs(tmpScale.z));
  return { shape: basicShape(component, scale), position, rotation };
}

function basicShape(component: Collider, scale: Vector3): ShapeDesc {
  const radial = Math.max(scale.x, scale.z);
  switch (component.shape) {
    case 'sphere':
      return { type: 'sphere', radius: component.radius * Math.max(scale.x, scale.y, scale.z) };
    case 'capsule': {
      const radius = component.radius * radial;
      return {
        type: 'capsule',
        radius,
        halfHeight: Math.max(0, (component.height * scale.y) / 2 - radius)
      };
    }
    case 'cylinder':
      return {
        type: 'cylinder',
        radius: component.radius * radial,
        halfHeight: (component.height * scale.y) / 2
      };
    default:
      return {
        type: 'box',
        halfExtents: new Vector3(
          (component.size.x * scale.x) / 2,
          (component.size.y * scale.y) / 2,
          (component.size.z * scale.z) / 2
        )
      };
  }
}

/** Triangles or hull points, scaled along each axis, around the collider's origin. */
function meshShape(component: Collider, geometry: MeshGeometry, scale: Vector3): ShapeDesc {
  const src = geometry.positions;
  const points = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    points[i] = src[i] * scale.x;
    points[i + 1] = src[i + 1] * scale.y;
    points[i + 2] = src[i + 2] * scale.z;
  }
  return component.shape === 'convex'
    ? { type: 'convex', points }
    : { type: 'trimesh', vertices: points, indices: geometry.indices };
}

/**
 * A height field matching how the terrain is drawn: it spans from the node's
 * position along +X and +Z, height samples sit at texel centres, and heights
 * are scaled by the node's Y scale on top of its world height. Rotation is
 * ignored, as by the terrain itself. Sets `pose` to the field's centre.
 */
function terrainShape(
  terrain: ClipmapTerrain,
  geometry: TerrainGeometry,
  resolution: number,
  pose: { position: Vector3; rotation: Quaternion }
): ShapeDesc | null {
  const { width, height } = geometry;
  const cols = Math.floor((width - 1) / resolution) + 1;
  const rows = Math.floor((height - 1) / resolution) + 1;
  if (cols < 2 || rows < 2) {
    return null;
  }
  const heights = new Float32Array(rows * cols);
  for (let x = 0; x < cols; x++) {
    for (let z = 0; z < rows; z++) {
      heights[x * rows + z] = geometry.heights[z * resolution * width + x * resolution];
    }
  }
  // The same placement as ClipmapTerrain.updateRegion.
  const scale = terrain.scale;
  const cellX = (Math.abs(scale.x) * terrain.sizeX) / width;
  const cellZ = (Math.abs(scale.z) * terrain.sizeZ) / height;
  const px = terrain.position.x + (terrain.parent?.worldMatrix.m03 ?? 0);
  const pz = terrain.position.z + (terrain.parent?.worldMatrix.m23 ?? 0);
  const spanX = (cols - 1) * resolution * cellX;
  const spanZ = (rows - 1) * resolution * cellZ;
  pose.position.setXYZ(px + cellX * 0.5 + spanX / 2, terrain.worldMatrix.m13, pz + cellZ * 0.5 + spanZ / 2);
  pose.rotation.identity();
  return { type: 'heightfield', rows, cols, heights, scale: new Vector3(spanX, scale.y, spanZ) };
}
