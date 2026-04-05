import { getDevice } from '../app/api';
import type { Mesh } from '../scene';
import { Primitive } from '../render/primitive';
import { BoundingBox } from '../utility/bounding_volume';
import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { StructuredBuffer } from '@zephyr3d/device';

export type GeometryCacheFrame = {
  positions: Float32Array;
  normals?: Nullable<Float32Array>;
  boundingBox: BoundingBox;
};

export type GeometryCacheState = {
  positions: Float32Array;
  normals?: Nullable<Float32Array>;
  boundingBox: BoundingBox;
};

export type GeometryCacheMeshBinding = {
  primitive: Primitive;
  positionBuffer: StructuredBuffer;
  normalBuffer: Nullable<StructuredBuffer>;
};

export function createGeometryCacheState(frame: Pick<GeometryCacheFrame, 'positions' | 'normals'>): GeometryCacheState {
  return {
    positions: new Float32Array(frame.positions.length),
    normals: frame.normals ? new Float32Array(frame.normals.length) : null,
    boundingBox: new BoundingBox()
  };
}

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

export function ensureGeometryCacheMeshBinding(
  meshBindings: WeakMap<Mesh, GeometryCacheMeshBinding>,
  mesh: Mesh,
  state: GeometryCacheState,
  errorPrefix: string
) {
  let binding = meshBindings.get(mesh);
  if (!binding) {
    const primitive = mesh.primitive;
    if (!primitive) {
      throw new Error(`${errorPrefix}: target mesh has no primitive`);
    }
    const expectedPositionLength = primitive.getNumVertices() * 3;
    if (state.positions.length !== expectedPositionLength) {
      throw new Error(
        `${errorPrefix}: position count mismatch, expected ${expectedPositionLength}, got ${state.positions.length}`
      );
    }
    const cachePrimitive = primitive.clone();
    cachePrimitive.setBoundingVolume(primitive.getBoundingVolume()!);
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
      const expectedNormalLength = primitive.getNumVertices() * 3;
      if (state.normals.length !== expectedNormalLength) {
        throw new Error(
          `${errorPrefix}: normal count mismatch, expected ${expectedNormalLength}, got ${state.normals.length}`
        );
      }
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
    mesh.primitive = cachePrimitive;
    binding = {
      primitive: cachePrimitive,
      positionBuffer,
      normalBuffer
    };
    meshBindings.set(mesh, binding);
  }
  return binding;
}
