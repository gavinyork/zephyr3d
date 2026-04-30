import { getDevice, getEngine } from '../app/api';
import type { Mesh } from '../scene';
import type { Primitive } from '../render/primitive';
import { BoundingBox } from '../utility/bounding_volume';
import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { StructuredBuffer } from '@zephyr3d/device';

/**
 * Geometry cache frame data for a single sampled time.
 *
 * @public
 */
export type GeometryCacheFrame = {
  positions: Float32Array;
  normals?: Nullable<Float32Array>;
  boundingBox: BoundingBox;
};

/**
 * Mutable working state used while evaluating geometry cache tracks.
 *
 * @public
 */
export type GeometryCacheState = {
  positions: Float32Array;
  normals?: Nullable<Float32Array>;
  boundingBox: BoundingBox;
};

/**
 * GPU resources bound to a mesh while a geometry cache track is active.
 *
 * @public
 */
export type GeometryCacheMeshBinding = {
  originalPrimitive: Primitive;
  primitive: Primitive;
  positionBuffer: StructuredBuffer;
  normalBuffer: Nullable<StructuredBuffer>;
};

type GeometryCacheMeshState = {
  originalPrimitive: Primitive;
  originalPrimitiveAssetId: string;
  cachePrimitive: Primitive;
  positionBuffer: StructuredBuffer;
  normalBuffer: Nullable<StructuredBuffer>;
};

const geometryCacheMeshStates = new WeakMap<Mesh, GeometryCacheMeshState>();

/**
 * Creates a reusable geometry cache state buffer for a frame layout.
 *
 * @public
 */
export function createGeometryCacheState(
  frame: Pick<GeometryCacheFrame, 'positions' | 'normals'>
): GeometryCacheState {
  return {
    positions: new Float32Array(frame.positions.length),
    normals: frame.normals ? new Float32Array(frame.normals.length) : null,
    boundingBox: new BoundingBox()
  };
}

/**
 * Linearly interpolates two geometry-cache bounding boxes.
 *
 * @public
 */
export function mixGeometryCacheBoundingBox(a: BoundingBox, b: BoundingBox, t: number) {
  return new BoundingBox(
    new Vector3(
      a.minPoint.x + (b.minPoint.x - a.minPoint.x) * t,
      a.minPoint.y + (b.minPoint.y - a.minPoint.y) * t,
      a.minPoint.z + (b.minPoint.z - a.minPoint.z) * t
    ),
    new Vector3(
      a.maxPoint.x + (b.maxPoint.x - a.maxPoint.x) * t,
      a.maxPoint.y + (b.maxPoint.y - a.maxPoint.y) * t,
      a.maxPoint.z + (b.maxPoint.z - a.maxPoint.z) * t
    )
  );
}

/**
 * Ensures the target mesh has GPU buffers compatible with the geometry cache state.
 *
 * @public
 */
export function ensureGeometryCacheMeshBinding(
  meshBindings: WeakMap<Mesh, GeometryCacheMeshBinding>,
  mesh: Mesh,
  state: GeometryCacheState,
  errorPrefix: string
) {
  let binding = meshBindings.get(mesh);
  if (!binding) {
    const primitive = mesh.primitive;
    const meshState = geometryCacheMeshStates.get(mesh);
    const originalPrimitive = meshState?.originalPrimitive ?? primitive;
    if (!originalPrimitive) {
      throw new Error(`${errorPrefix}: target mesh has no primitive`);
    }
    validateGeometryCacheState(originalPrimitive, state, errorPrefix);
    const ensuredState = meshState
      ? ensureGeometryCacheNormalBuffer(meshState, originalPrimitive, state, errorPrefix)
      : createGeometryCacheMeshState(originalPrimitive, state);
    geometryCacheMeshStates.set(mesh, ensuredState);
    if (mesh.primitive !== ensuredState.cachePrimitive) {
      mesh.primitive = ensuredState.cachePrimitive;
    }
    binding = {
      originalPrimitive,
      primitive: ensuredState.cachePrimitive,
      positionBuffer: ensuredState.positionBuffer,
      normalBuffer: ensuredState.normalBuffer
    };
    meshBindings.set(mesh, binding);
  }
  return binding;
}

/**
 * Restores a mesh primitive after geometry cache playback.
 *
 * @public
 */
export async function restoreGeometryCacheMeshBinding(mesh: Mesh) {
  const meshState = geometryCacheMeshStates.get(mesh);
  if (!meshState) {
    return false;
  }
  const primitiveToRestore = await resolveOriginalPrimitive(meshState);
  if (mesh.primitive === meshState.cachePrimitive) {
    mesh.primitive = primitiveToRestore;
  }
  mesh.setAnimatedBoundingBox(null);
  mesh.scene?.queueUpdateNode(mesh);
  geometryCacheMeshStates.delete(mesh);
  return true;
}

function validateGeometryCacheState(primitive: Primitive, state: GeometryCacheState, errorPrefix: string) {
  const expectedPositionLength = primitive.getNumVertices() * 3;
  if (state.positions.length !== expectedPositionLength) {
    throw new Error(
      `${errorPrefix}: position count mismatch, expected ${expectedPositionLength}, got ${state.positions.length}`
    );
  }
  if (state.normals) {
    const expectedNormalLength = primitive.getNumVertices() * 3;
    if (state.normals.length !== expectedNormalLength) {
      throw new Error(
        `${errorPrefix}: normal count mismatch, expected ${expectedNormalLength}, got ${state.normals.length}`
      );
    }
  }
}

function createGeometryCacheMeshState(
  originalPrimitive: Primitive,
  state: GeometryCacheState
): GeometryCacheMeshState {
  const cachePrimitive = originalPrimitive.clone();
  cachePrimitive.setBoundingVolume(originalPrimitive.getBoundingVolume()!);
  const primitiveAssetId = getEngine().resourceManager.getAssetId(originalPrimitive);
  if (primitiveAssetId) {
    getEngine().resourceManager.setAssetId(cachePrimitive, primitiveAssetId);
  }
  cachePrimitive.removeVertexBuffer('position');
  const positionBuffer = getDevice().createVertexBuffer(
    'position_f32x3',
    state.positions as unknown as Float32Array<ArrayBuffer>,
    {
      dynamic: true
    }
  )!;
  cachePrimitive.setVertexBuffer(positionBuffer);
  let normalBuffer: Nullable<StructuredBuffer> = null;
  if (state.normals) {
    cachePrimitive.removeVertexBuffer('normal');
    normalBuffer = getDevice().createVertexBuffer(
      'normal_f32x3',
      state.normals as unknown as Float32Array<ArrayBuffer>,
      {
        dynamic: true
      }
    )!;
    cachePrimitive.setVertexBuffer(normalBuffer);
  }
  return {
    originalPrimitive,
    originalPrimitiveAssetId: primitiveAssetId ?? '',
    cachePrimitive,
    positionBuffer,
    normalBuffer
  };
}

function ensureGeometryCacheNormalBuffer(
  meshState: GeometryCacheMeshState,
  originalPrimitive: Primitive,
  state: GeometryCacheState,
  errorPrefix: string
) {
  if (state.normals && !meshState.normalBuffer) {
    const expectedNormalLength = originalPrimitive.getNumVertices() * 3;
    if (state.normals.length !== expectedNormalLength) {
      throw new Error(
        `${errorPrefix}: normal count mismatch, expected ${expectedNormalLength}, got ${state.normals.length}`
      );
    }
    meshState.cachePrimitive.removeVertexBuffer('normal');
    meshState.normalBuffer = getDevice().createVertexBuffer(
      'normal_f32x3',
      state.normals as unknown as Float32Array<ArrayBuffer>,
      {
        dynamic: true
      }
    )!;
    meshState.cachePrimitive.setVertexBuffer(meshState.normalBuffer);
  }
  return meshState;
}

async function resolveOriginalPrimitive(meshState: GeometryCacheMeshState) {
  if (meshState.originalPrimitiveAssetId) {
    const restoredPrimitive = await getEngine().resourceManager.fetchPrimitive(
      meshState.originalPrimitiveAssetId
    );
    if (restoredPrimitive) {
      return restoredPrimitive;
    }
  }
  return meshState.originalPrimitive;
}
