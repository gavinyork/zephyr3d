import { Vector3 } from '@zephyr3d/base';
import { generatePrimitive, type GeneratedModelSpec } from '@zephyr3d/modelgen';
import { BoundingBox, Primitive } from '@zephyr3d/scene';

/**
 * Turns a procedural model spec into a renderable {@link Primitive}.
 *
 * This is the runtime half of the generator pipeline: `@zephyr3d/procgen` emits a
 * spec, `@zephyr3d/modelgen` tessellates it into plain typed arrays, and this
 * uploads those arrays to the GPU. Nothing is written to disk — the editor path
 * takes the same buffers and saves a `.zmsh` asset instead.
 *
 * Requires a live graphics device, which is why it lives here rather than in
 * either library.
 *
 * @param spec - The spec to tessellate.
 * @param timeoutMs - Wall-clock budget for tessellation. Generation throws if exceeded.
 */
export function primitiveFromSpec(spec: GeneratedModelSpec, timeoutMs = 10000): Primitive {
  const result = generatePrimitive(spec, Date.now() + timeoutMs);
  const { vertices, indices, boxMin, boxMax } = result.primitive;

  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', vertices.position.data);
  primitive.createAndSetVertexBuffer('normal_f32x3', vertices.normal.data);
  primitive.createAndSetVertexBuffer('tex0_f32x2', vertices.texCoord0.data);
  if (vertices.tangent) {
    primitive.createAndSetVertexBuffer('tangent_f32x4', vertices.tangent.data);
  }
  primitive.createAndSetIndexBuffer(indices);
  primitive.primitiveType = 'triangle-list';
  primitive.indexCount = result.indexCount;
  primitive.setBoundingVolume(
    new BoundingBox(
      new Vector3(boxMin[0], boxMin[1], boxMin[2]),
      new Vector3(boxMax[0], boxMax[1], boxMax[2])
    )
  );
  return primitive;
}
