import { Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type { CharacterController, Collider, ColliderOutline } from '@zephyr3d/scene';
import type { BackendWorld, ShapeDesc } from './backend';
import { fetchGeometry, geometrySource, needsGeometry, type ColliderGeometry } from './geometry';
import { buildColliderShape } from './shapes';

/** Lines per circle. */
const CIRCLE_SEGMENTS = 48;
/** At most this many lines across a terrain in each direction. */
const TERRAIN_LINES = 256;

/** A collider, or a character controller's own capsule. */
function colliderOf(target: Collider | CharacterController): Collider {
  return '_ownedCollider' in target ? target._ownedCollider : target;
}

let nextGeometryId = 1;
const geometryIds = new WeakMap<object, number>();
function objectId(object: object) {
  let id = geometryIds.get(object);
  if (!id) {
    id = nextGeometryId++;
    geometryIds.set(object, id);
  }
  return id;
}

/**
 * A key that changes whenever {@link getColliderOutline} would give a different
 * outline: the collider's settings, its node's scale, and its geometry. Moving
 * or turning the node does not change it, except for terrain colliders, which
 * are placed by the terrain's position.
 */
export function getColliderOutlineKey(target: Collider | CharacterController): string {
  const collider = colliderOf(target);
  const host = collider.node;
  if (!host) {
    return '';
  }
  const scale = new Vector3();
  host.worldMatrix.decompose(scale, new Quaternion(), new Vector3());
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  const parts: (string | number)[] = [
    collider.shape,
    round(scale.x),
    round(scale.y),
    round(scale.z),
    round(collider.offset.x),
    round(collider.offset.y),
    round(collider.offset.z)
  ];
  switch (collider.shape) {
    case 'box':
      parts.push(round(collider.size.x), round(collider.size.y), round(collider.size.z));
      break;
    case 'sphere':
      parts.push(round(collider.radius));
      break;
    case 'capsule':
    case 'cylinder':
      parts.push(round(collider.radius), round(collider.height));
      break;
    default:
      try {
        const source = geometrySource(collider);
        if (source.kind === 'mesh') {
          parts.push(objectId(source.primitive), source.lod);
        } else if (source.kind === 'terrain') {
          parts.push(objectId(source.terrain), source.version, collider.terrainResolution);
          parts.push(...Array.from(host.worldMatrix).map(round));
        } else {
          parts.push(objectId(collider._meshData!));
        }
      } catch (err) {
        parts.push(`error:${err}`);
      }
  }
  return parts.join(',');
}

/**
 * Traces a collider's shape as lines, exactly as the simulation builds it (for
 * a {@link CharacterController}, its capsule). Convex hulls and meshes are
 * built by the engine, in a world from `createWorld`, to read its result back.
 *
 * @returns The outline, or null if the collider is not on a node in a scene.
 * @throws An error with a message for the user when the shape cannot be built.
 */
export async function getColliderOutline(
  target: Collider | CharacterController,
  createWorld: () => BackendWorld
): Promise<ColliderOutline | null> {
  const collider = colliderOf(target);
  if (!collider.node?.attached) {
    return null;
  }
  let geometry: ColliderGeometry | null = null;
  if (needsGeometry(collider)) {
    geometry = await fetchGeometry(collider, geometrySource(collider));
    if (!collider.node?.attached) {
      return null;
    }
  }
  const built = buildColliderShape(collider, geometry);
  if ('error' in built) {
    throw new Error(built.error);
  }
  const colliderWorld = new Matrix4x4().compose(Vector3.one(), built.rotation, built.position);
  const transform = Matrix4x4.invertAffine(collider.node.worldMatrix).multiplyRight(colliderWorld);
  return { segments: shapeSegments(built.shape, createWorld), transform };
}

function shapeSegments(shape: ShapeDesc, createWorld: () => BackendWorld): Float32Array {
  const out: number[] = [];
  switch (shape.type) {
    case 'box': {
      const { x, y, z } = shape.halfExtents;
      const c = (i: number) => [i & 1 ? x : -x, i & 2 ? y : -y, i & 4 ? z : -z];
      for (const [a, b] of [
        [0, 1],
        [2, 3],
        [4, 5],
        [6, 7],
        [0, 2],
        [1, 3],
        [4, 6],
        [5, 7],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7]
      ]) {
        out.push(...c(a), ...c(b));
      }
      break;
    }
    case 'sphere':
      circle(out, shape.radius, 0, 'y');
      circle(out, shape.radius, 0, 'x');
      circle(out, shape.radius, 0, 'z');
      break;
    case 'capsule': {
      const { radius: r, halfHeight: h } = shape;
      circle(out, r, h, 'y');
      circle(out, r, -h, 'y');
      for (const [px, pz] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r]
      ]) {
        out.push(px, -h, pz, px, h, pz);
      }
      // Half circles over each end, in the two upright planes.
      for (const sign of [1, -1]) {
        for (const plane of ['x', 'z'] as const) {
          let prev: number[] | null = null;
          for (let i = 0; i <= CIRCLE_SEGMENTS / 2; i++) {
            const a = (i / (CIRCLE_SEGMENTS / 2)) * Math.PI;
            const u = Math.cos(a) * r;
            const v = Math.sin(a) * r * sign + h * sign;
            const p = plane === 'x' ? [u, v, 0] : [0, v, u];
            if (prev) {
              out.push(...prev, ...p);
            }
            prev = p;
          }
        }
      }
      break;
    }
    case 'cylinder': {
      const { radius: r, halfHeight: h } = shape;
      circle(out, r, h, 'y');
      circle(out, r, -h, 'y');
      for (const [px, pz] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r]
      ]) {
        out.push(px, -h, pz, px, h, pz);
      }
      break;
    }
    case 'trimesh':
    case 'convex':
      return meshEdges(shape, createWorld);
    case 'heightfield':
      return heightfieldLines(shape);
  }
  return new Float32Array(out);
}

/** A circle of radius `r`, around the axis given, at `offset` along it. */
function circle(out: number[], r: number, offset: number, axis: 'x' | 'y' | 'z') {
  const point = (a: number) => {
    const u = Math.cos(a) * r;
    const v = Math.sin(a) * r;
    return axis === 'y' ? [u, offset, v] : axis === 'x' ? [offset, u, v] : [u, v, offset];
  };
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    out.push(
      ...point((i / CIRCLE_SEGMENTS) * Math.PI * 2),
      ...point(((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2)
    );
  }
}

/**
 * Edges of a mesh or convex collider, from the triangles the physics engine
 * built: the hull it computed, with duplicate vertices merged.
 */
function meshEdges(
  shape: ShapeDesc & { type: 'trimesh' | 'convex' },
  createWorld: () => BackendWorld
): Float32Array {
  const world = createWorld();
  try {
    const body = world.createBody({
      motionType: 'static',
      position: Vector3.zero(),
      rotation: Quaternion.identity(),
      mass: 0,
      linearDamping: 0,
      angularDamping: 0,
      gravityScale: 1,
      ccd: false,
      canSleep: true,
      translationAxes: [true, true, true],
      rotationAxes: [true, true, true]
    });
    const collider = world.createCollider(body, shape, Vector3.zero(), Quaternion.identity(), {
      friction: 0,
      restitution: 0,
      isTrigger: false,
      groups: 0xffffffff
    });
    const triangles = collider ? world.colliderTriangles(collider) : null;
    if (!triangles) {
      throw new Error('Could not build the shape');
    }
    const { vertices, indices } = triangles;
    const seen = new Set<number>();
    const vertexCount = vertices.length / 3;
    const out: number[] = [];
    const edge = (a: number, b: number) => {
      const key = a < b ? a * vertexCount + b : b * vertexCount + a;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(
          vertices[a * 3],
          vertices[a * 3 + 1],
          vertices[a * 3 + 2],
          vertices[b * 3],
          vertices[b * 3 + 1],
          vertices[b * 3 + 2]
        );
      }
    };
    for (let i = 0; i + 2 < indices.length; i += 3) {
      edge(indices[i], indices[i + 1]);
      edge(indices[i + 1], indices[i + 2]);
      edge(indices[i + 2], indices[i]);
    }
    return new Float32Array(out);
  } finally {
    world.dispose();
  }
}

/**
 * Lines along rows and columns of a height field, through every sample on them.
 * Laid out as Rapier's height field: centred on the collider, `cols` samples
 * across X and `rows` across Z, `heights[x * rows + z]`.
 */
function heightfieldLines(shape: ShapeDesc & { type: 'heightfield' }): Float32Array {
  const { rows, cols, heights, scale } = shape;
  const px = (x: number) => (x / (cols - 1) - 0.5) * scale.x;
  const pz = (z: number) => (z / (rows - 1) - 0.5) * scale.z;
  const py = (x: number, z: number) => heights[x * rows + z] * scale.y;
  const stepX = Math.max(1, Math.ceil((cols - 1) / TERRAIN_LINES));
  const stepZ = Math.max(1, Math.ceil((rows - 1) / TERRAIN_LINES));
  const lineXs = lineIndices(cols, stepX);
  const lineZs = lineIndices(rows, stepZ);
  const out = new Float32Array((lineZs.length * (cols - 1) + lineXs.length * (rows - 1)) * 6);
  let n = 0;
  const push = (x: number, z: number) => {
    out[n++] = px(x);
    out[n++] = py(x, z);
    out[n++] = pz(z);
  };
  // Along X, at chosen rows.
  for (const z of lineZs) {
    for (let x = 0; x + 1 < cols; x++) {
      push(x, z);
      push(x + 1, z);
    }
  }
  // Along Z, at chosen columns.
  for (const x of lineXs) {
    for (let z = 0; z + 1 < rows; z++) {
      push(x, z);
      push(x, z + 1);
    }
  }
  return out;
}

/** Every `step`th of `count` samples, always including the last, so the edges show. */
function lineIndices(count: number, step: number) {
  const result: number[] = [];
  for (let i = 0; i < count; i += step) {
    result.push(i);
  }
  if (result[result.length - 1] !== count - 1) {
    result.push(count - 1);
  }
  return result;
}
