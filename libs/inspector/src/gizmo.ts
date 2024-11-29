import { Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type { BoxCreationOptions, CylinderCreationOptions, TorusCreationOptions } from '@zephyr3d/scene';
import { Application, BoundingBox, BoxShape, CylinderShape, Primitive, TorusShape } from '@zephyr3d/scene';

/**
 * Creates a primitive that presents the translation gizmo
 * @param axisLength - Length of the axies
 * @param axisRadius - Radius of the axies
 * @param boxRadius - Half size of the boxes
 * @returns The created primitive
 *
 * @public
 */
export function createScaleGizmo(axisLength: number, axisRadius: number, boxRadius: number): Primitive {
  const axisOptions: CylinderCreationOptions = {
    topRadius: axisRadius,
    bottomRadius: axisRadius,
    height: axisLength,
    anchor: 0
  };
  const axisOptionsX: CylinderCreationOptions = {
    ...axisOptions,
    transform: Matrix4x4.rotation(new Vector3(0, 0, -1), Math.PI * 0.5)
  };
  const axisOptionsY = axisOptions;
  const axisOptionsZ: CylinderCreationOptions = {
    ...axisOptions,
    transform: Matrix4x4.rotation(new Vector3(1, 0, 0), Math.PI * 0.5)
  };
  const boxOptions: BoxCreationOptions = {
    size: boxRadius * 2
  };
  const boxOptionsX: CylinderCreationOptions = {
    ...boxOptions,
    transform: Matrix4x4.translation(new Vector3(0, axisLength + boxRadius, 0)).rotateLeft(
      Quaternion.fromAxisAngle(new Vector3(0, 0, -1), Math.PI * 0.5)
    )
  };
  const boxOptionsY: CylinderCreationOptions = {
    ...boxOptions,
    transform: Matrix4x4.translation(new Vector3(0, axisLength + boxRadius, 0))
  };
  const boxOptionsZ: CylinderCreationOptions = {
    ...boxOptions,
    transform: Matrix4x4.translation(new Vector3(0, axisLength + boxRadius, 0)).rotateLeft(
      Quaternion.fromAxisAngle(new Vector3(1, 0, 0), Math.PI * 0.5)
    )
  };
  const vertices: number[] = [];
  const diffuse: number[] = [];
  const rgb: number[][] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255]
  ];
  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();

  // X axis
  CylinderShape.generateData(axisOptionsX, vertices, null, null, indices, bbox, vertices.length / 3);
  // X arrow
  BoxShape.generateData(boxOptionsX, vertices, null, null, indices, bbox, vertices.length / 3);
  // Y axis
  CylinderShape.generateData(axisOptionsY, vertices, null, null, indices, bbox, vertices.length / 3);
  // Y arrow
  BoxShape.generateData(boxOptionsY, vertices, null, null, indices, bbox, vertices.length / 3);
  // Z axis
  CylinderShape.generateData(axisOptionsZ, vertices, null, null, indices, bbox, vertices.length / 3);
  // Z arrow
  BoxShape.generateData(boxOptionsZ, vertices, null, null, indices, bbox, vertices.length / 3);
  // diffuse color
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < vertices.length / 3 / 3; j++) {
      diffuse.push(...rgb[i]);
    }
  }
  const primitive = new Primitive();
  const vertexBuffer = Application.instance.device.createVertexBuffer(
    'position_f32x3',
    new Float32Array(vertices)
  );
  primitive.setVertexBuffer(vertexBuffer);
  const diffuseBuffer = Application.instance.device.createVertexBuffer(
    'diffuse_u8normx4',
    new Uint8Array(diffuse)
  );
  primitive.setVertexBuffer(diffuseBuffer);
  const indexBuffer = Application.instance.device.createIndexBuffer(new Uint16Array(indices));
  primitive.setIndexBuffer(indexBuffer);
  primitive.primitiveType = 'triangle-list';
  primitive.indexCount = indices.length;
  primitive.setBoundingVolume(bbox);

  return primitive;
}
/**
 * Creates a primitive that presents the rotation gizmo
 * @param outerRadius - The outer radius
 * @param innerRadius - The inner radius
 * @returns The created primitive
 *
 * @public
 */
export function createRotationGizmo(outerRadius: number, innerRadius: number) {
  const torusOptionsX: TorusCreationOptions = {
    outerRadius,
    innerRadius,
    transform: Matrix4x4.rotation(new Vector3(0, 0, -1), Math.PI * 0.5)
  };
  const torusOptionsY: TorusCreationOptions = {
    outerRadius,
    innerRadius
  };
  const torusOptionsZ: TorusCreationOptions = {
    outerRadius,
    innerRadius,
    transform: Matrix4x4.rotation(new Vector3(1, 0, 0), Math.PI * 0.5)
  };
  const vertices: number[] = [];
  const diffuse: number[] = [];
  const rgb: number[][] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255]
  ];
  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();

  // X axis
  TorusShape.generateData(torusOptionsX, vertices, null, null, indices, bbox, vertices.length / 3);
  // X arrow
  TorusShape.generateData(torusOptionsY, vertices, null, null, indices, bbox, vertices.length / 3);
  // Y axis
  TorusShape.generateData(torusOptionsZ, vertices, null, null, indices, bbox, vertices.length / 3);
  // diffuse color
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < vertices.length / 3 / 3; j++) {
      diffuse.push(...rgb[i]);
    }
  }
  const primitive = new Primitive();
  const vertexBuffer = Application.instance.device.createVertexBuffer(
    'position_f32x3',
    new Float32Array(vertices)
  );
  primitive.setVertexBuffer(vertexBuffer);
  const diffuseBuffer = Application.instance.device.createVertexBuffer(
    'diffuse_u8normx4',
    new Uint8Array(diffuse)
  );
  primitive.setVertexBuffer(diffuseBuffer);
  const indexBuffer = Application.instance.device.createIndexBuffer(new Uint16Array(indices));
  primitive.setIndexBuffer(indexBuffer);
  primitive.primitiveType = 'triangle-list';
  primitive.indexCount = indices.length;
  primitive.setBoundingVolume(bbox);

  return primitive;
}

/**
 * Creates a primitive that presents the translation gizmo
 * @param axisLength - Length of the axies
 * @param axisRadius - Radius of the axies
 * @param arrowLength - Length of the arrows
 * @param arrowRadius - Radius of the arrows
 * @returns The created primitive
 *
 * @public
 */
export function createTranslationGizmo(
  axisLength: number,
  axisRadius: number,
  arrowLength: number,
  arrowRadius: number
): Primitive {
  const axisOptions: CylinderCreationOptions = {
    topRadius: axisRadius,
    bottomRadius: axisRadius,
    height: axisLength,
    anchor: 0
  };
  const axisOptionsX: CylinderCreationOptions = {
    ...axisOptions,
    transform: Matrix4x4.rotation(new Vector3(0, 0, -1), Math.PI * 0.5)
  };
  const axisOptionsY = axisOptions;
  const axisOptionsZ: CylinderCreationOptions = {
    ...axisOptions,
    transform: Matrix4x4.rotation(new Vector3(1, 0, 0), Math.PI * 0.5)
  };
  const arrowOptions: CylinderCreationOptions = {
    topRadius: 0,
    bottomRadius: arrowRadius,
    height: arrowLength,
    anchor: 0
  };
  const arrowOptionsX: CylinderCreationOptions = {
    ...arrowOptions,
    transform: Matrix4x4.translation(new Vector3(0, axisLength, 0)).rotateLeft(
      Quaternion.fromAxisAngle(new Vector3(0, 0, -1), Math.PI * 0.5)
    )
  };
  const arrowOptionsY: CylinderCreationOptions = {
    ...arrowOptions,
    transform: Matrix4x4.translation(new Vector3(0, axisLength, 0))
  };
  const arrowOptionsZ: CylinderCreationOptions = {
    ...arrowOptions,
    transform: Matrix4x4.translation(new Vector3(0, axisLength, 0)).rotateLeft(
      Quaternion.fromAxisAngle(new Vector3(1, 0, 0), Math.PI * 0.5)
    )
  };
  const vertices: number[] = [];
  const diffuse: number[] = [];
  const rgb: number[][] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255]
  ];
  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();

  // X axis
  CylinderShape.generateData(axisOptionsX, vertices, null, null, indices, bbox, vertices.length / 3);
  // X arrow
  CylinderShape.generateData(arrowOptionsX, vertices, null, null, indices, bbox, vertices.length / 3);
  // Y axis
  CylinderShape.generateData(axisOptionsY, vertices, null, null, indices, bbox, vertices.length / 3);
  // Y arrow
  CylinderShape.generateData(arrowOptionsY, vertices, null, null, indices, bbox, vertices.length / 3);
  // Z axis
  CylinderShape.generateData(axisOptionsZ, vertices, null, null, indices, bbox, vertices.length / 3);
  // Z arrow
  CylinderShape.generateData(arrowOptionsZ, vertices, null, null, indices, bbox, vertices.length / 3);
  // diffuse color
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < vertices.length / 3 / 3; j++) {
      diffuse.push(...rgb[i]);
    }
  }
  const primitive = new Primitive();
  const vertexBuffer = Application.instance.device.createVertexBuffer(
    'position_f32x3',
    new Float32Array(vertices)
  );
  primitive.setVertexBuffer(vertexBuffer);
  const diffuseBuffer = Application.instance.device.createVertexBuffer(
    'diffuse_u8normx4',
    new Uint8Array(diffuse)
  );
  primitive.setVertexBuffer(diffuseBuffer);
  const indexBuffer = Application.instance.device.createIndexBuffer(new Uint16Array(indices));
  primitive.setIndexBuffer(indexBuffer);
  primitive.primitiveType = 'triangle-list';
  primitive.indexCount = indices.length;
  primitive.setBoundingVolume(bbox);

  return primitive;
}
