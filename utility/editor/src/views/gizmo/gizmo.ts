import { Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type {
  BoxCreationOptions,
  CylinderCreationOptions,
  PlaneCreationOptions,
  SphereCreationOptions,
  TorusCreationOptions
} from '@zephyr3d/scene';
import {
  Application,
  BoundingBox,
  BoxShape,
  CylinderShape,
  PlaneShape,
  Primitive,
  SphereShape,
  TorusShape
} from '@zephyr3d/scene';

export function createSelectGizmo(): Primitive {
  const vertices: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();
  BoxShape.generateData({ anchor: 0, size: 1 }, vertices, null, null, uv, indices, bbox);
  const primitive = new Primitive();
  const vertexBuffer = Application.instance.device.createVertexBuffer(
    'position_f32x3',
    new Float32Array(vertices)
  );
  primitive.setVertexBuffer(vertexBuffer);
  const uvBuffer = Application.instance.device.createVertexBuffer('tex0_f32x2', new Float32Array(uv));
  primitive.setVertexBuffer(uvBuffer);
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
  CylinderShape.generateData(
    axisOptionsX,
    vertices,
    null,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[0])
  );
  // X arrow
  BoxShape.generateData(boxOptionsX, vertices, null, null, null, indices, bbox, vertices.length / 3, () =>
    diffuse.push(...rgb[0])
  );
  // Y axis
  CylinderShape.generateData(
    axisOptionsY,
    vertices,
    null,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[1])
  );
  // Y arrow
  BoxShape.generateData(boxOptionsY, vertices, null, null, null, indices, bbox, vertices.length / 3, () =>
    diffuse.push(...rgb[1])
  );
  // Z axis
  CylinderShape.generateData(
    axisOptionsZ,
    vertices,
    null,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[2])
  );
  // Z arrow
  BoxShape.generateData(boxOptionsZ, vertices, null, null, null, indices, bbox, vertices.length / 3, () =>
    diffuse.push(...rgb[2])
  );
  // center
  BoxShape.generateData(boxOptions, vertices, null, null, null, indices, bbox, vertices.length / 3, () =>
    diffuse.push(255, 255, 255, 255)
  );
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
  TorusShape.generateData(torusOptionsX, vertices, null, null, null, indices, bbox, vertices.length / 3, () =>
    diffuse.push(...rgb[0])
  );
  // Y arrow
  TorusShape.generateData(torusOptionsY, vertices, null, null, null, indices, bbox, vertices.length / 3, () =>
    diffuse.push(...rgb[1])
  );
  // Y axis
  TorusShape.generateData(torusOptionsZ, vertices, null, null, null, indices, bbox, vertices.length / 3, () =>
    diffuse.push(...rgb[2])
  );
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
  const planeOptionsX: PlaneCreationOptions = {
    size: axisLength * 0.5,
    twoSided: true,
    transform: Matrix4x4.translation(new Vector3(0, axisLength * 0.5, axisLength * 0.5)).rotateRight(
      Quaternion.fromAxisAngle(new Vector3(0, 0, -1), Math.PI * 0.5)
    )
  };
  const planeOptionsY: PlaneCreationOptions = {
    size: axisLength * 0.5,
    twoSided: true,
    transform: Matrix4x4.translation(new Vector3(axisLength * 0.5, 0, axisLength * 0.5))
  };
  const planeOptionsZ: PlaneCreationOptions = {
    size: axisLength * 0.5,
    twoSided: true,
    transform: Matrix4x4.translation(new Vector3(axisLength * 0.5, axisLength * 0.5, 0)).rotateRight(
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
  CylinderShape.generateData(
    axisOptionsX,
    vertices,
    null,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[0])
  );
  // X arrow
  CylinderShape.generateData(
    arrowOptionsX,
    vertices,
    null,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[0])
  );
  // X plane
  PlaneShape.generateData(planeOptionsX, vertices, null, null, null, indices, bbox, vertices.length / 3, () =>
    diffuse.push(...rgb[0])
  );
  // Y axis
  CylinderShape.generateData(
    axisOptionsY,
    vertices,
    null,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[1])
  );
  // Y arrow
  CylinderShape.generateData(
    arrowOptionsY,
    vertices,
    null,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[1])
  );
  // Y plane
  PlaneShape.generateData(planeOptionsY, vertices, null, null, null, indices, bbox, vertices.length / 3, () =>
    diffuse.push(...rgb[1])
  );
  // Z axis
  CylinderShape.generateData(
    axisOptionsZ,
    vertices,
    null,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[2])
  );
  // Z arrow
  CylinderShape.generateData(
    arrowOptionsZ,
    vertices,
    null,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[2])
  );
  // Z plane
  PlaneShape.generateData(planeOptionsZ, vertices, null, null, null, indices, bbox, vertices.length / 3, () =>
    diffuse.push(...rgb[2])
  );
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
export function createRotationEditGizmo(
  axisLength: number,
  axisRadius: number,
  arrowLength: number,
  arrowRadius: number,
  sphereRadius: number
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
  const sphereOptions: SphereCreationOptions = {
    radius: sphereRadius
  };
  const vertices: number[] = [];
  const normals: number[] = [];
  const diffuse: number[] = [];
  const rgb: number[][] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255]
  ];
  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();

  // X axis
  CylinderShape.generateData(
    axisOptionsX,
    vertices,
    normals,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[0])
  );
  // X arrow
  CylinderShape.generateData(
    arrowOptionsX,
    vertices,
    normals,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[0])
  );
  // Y axis
  CylinderShape.generateData(
    axisOptionsY,
    vertices,
    normals,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[1])
  );
  // Y arrow
  CylinderShape.generateData(
    arrowOptionsY,
    vertices,
    normals,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[1])
  );
  // Z axis
  CylinderShape.generateData(
    axisOptionsZ,
    vertices,
    normals,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[2])
  );
  // Z arrow
  CylinderShape.generateData(
    arrowOptionsZ,
    vertices,
    normals,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[2])
  );
  // Sphere
  SphereShape.generateData(
    sphereOptions,
    vertices,
    normals,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    () => diffuse.push(...rgb[3])
  );
  const primitive = new Primitive();
  const vertexBuffer = Application.instance.device.createVertexBuffer(
    'position_f32x3',
    new Float32Array(vertices)
  );
  primitive.setVertexBuffer(vertexBuffer);
  const normalBuffer = Application.instance.device.createVertexBuffer(
    'normal_f32x3',
    new Float32Array(normals)
  );
  primitive.setVertexBuffer(normalBuffer);
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
