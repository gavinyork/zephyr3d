import type { Nullable } from '@zephyr3d/base';
import { CubeFace } from '@zephyr3d/base';
import { Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type {
  BoxCreationOptions,
  CylinderCreationOptions,
  PlaneCreationOptions,
  SphereCreationOptions,
  TorusCreationOptions
} from '@zephyr3d/scene';
import {
  BoundingBox,
  BoxShape,
  CylinderShape,
  getDevice,
  PlaneShape,
  Primitive,
  SphereShape,
  TorusShape
} from '@zephyr3d/scene';

export const AXIS_X = 1 << 0;
export const AXIS_Y = 1 << 1;
export const AXIS_Z = 1 << 2;
export const axisList = [AXIS_X, AXIS_Y, AXIS_Z];
export function createSelectGizmo(): Primitive {
  const vertices: number[] = [];
  const barycentric: number[] = [];
  const bcCoords = [1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0];
  const uv: number[] = [];
  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();
  BoxShape.generateData({ anchor: 0, size: 1 }, vertices, null, null, uv, indices, bbox, null, (index) => {
    const t = index % 4;
    barycentric.push(bcCoords[t], bcCoords[t + 1], bcCoords[t + 2]);
  });
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
  primitive.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uv));
  primitive.createAndSetVertexBuffer('tex1_f32', new Float32Array(vertices.length / 3).fill(0));
  primitive.createAndSetVertexBuffer('tex2_f32x3', new Float32Array(barycentric));
  primitive.createAndSetIndexBuffer(new Uint16Array(indices));
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
export function createScaleGizmo(
  axisLength: number,
  axisRadius: number,
  boxRadius: number,
  orthoDirection: Nullable<CubeFace>
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
  const axies: number[] = [];
  const rgb: number[][] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255]
  ];

  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();

  if (orthoDirection === null || (orthoDirection !== CubeFace.PX && orthoDirection !== CubeFace.NX)) {
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
      () => {
        diffuse.push(...rgb[0]);
        axies.push(axisList[0]);
      }
    );
    // X arrow
    BoxShape.generateData(boxOptionsX, vertices, null, null, null, indices, bbox, vertices.length / 3, () => {
      diffuse.push(...rgb[0]);
      axies.push(axisList[0]);
    });
  }
  if (orthoDirection === null || (orthoDirection !== CubeFace.PY && orthoDirection !== CubeFace.NY)) {
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
      () => {
        diffuse.push(...rgb[1]);
        axies.push(axisList[1]);
      }
    );
    // Y arrow
    BoxShape.generateData(boxOptionsY, vertices, null, null, null, indices, bbox, vertices.length / 3, () => {
      diffuse.push(...rgb[1]);
      axies.push(axisList[1]);
    });
  }
  if (orthoDirection === null || (orthoDirection !== CubeFace.PZ && orthoDirection !== CubeFace.NZ)) {
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
      () => {
        diffuse.push(...rgb[2]);
        axies.push(axisList[2]);
      }
    );
    // Z arrow
    BoxShape.generateData(boxOptionsZ, vertices, null, null, null, indices, bbox, vertices.length / 3, () => {
      diffuse.push(...rgb[2]);
      axies.push(axisList[2]);
    });
  }
  // center
  BoxShape.generateData(boxOptions, vertices, null, null, null, indices, bbox, vertices.length / 3, () => {
    diffuse.push(255, 255, 255, 255);
    axies.push(axisList[0] + axisList[1] + axisList[2]);
  });
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
  primitive.createAndSetVertexBuffer('diffuse_u8normx4', new Uint8Array(diffuse));
  primitive.createAndSetVertexBuffer('tex0_f32', new Float32Array(axies));
  primitive.createAndSetIndexBuffer(new Uint16Array(indices));
  primitive.primitiveType = 'triangle-list';
  primitive.indexCount = indices.length;
  primitive.setBoundingVolume(bbox);

  return primitive;
}
export function createEditAABBGizmo(): Primitive {
  const boxOptions: BoxCreationOptions = {
    size: 1,
    anchor: 0
  };
  const vertices: number[] = [];
  const diffuse: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const axies: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();
  BoxShape.generateData(
    boxOptions,
    vertices,
    normals,
    null,
    null,
    indices,
    bbox,
    vertices.length / 3,
    (index) => {
      const normal = normals.slice(index * 3, index * 3 + 3);
      const rgb = normal.map((val) => ((Math.abs(val) * 0.5 + 0.5) * 255) >> 0);
      diffuse.push(...rgb, 128);
      const axis = normal.findIndex((val) => Math.abs(val) === 1);
      axies.push(1 << axis);
    }
  );
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
  primitive.createAndSetVertexBuffer('diffuse_u8normx4', new Uint8Array(diffuse));
  primitive.createAndSetVertexBuffer('tex0_f32', new Float32Array(axies));
  primitive.createAndSetIndexBuffer(new Uint16Array(indices));
  primitive.primitiveType = 'triangle-list';
  primitive.indexCount = indices.length;
  primitive.setBoundingVolume(bbox);

  return primitive;
}
/**
 * Creates a primitive that presents the scale-with-handles gizmo
 * @param boxRadius - Half size of the boxes
 * @returns The created primitive
 *
 * @public
 */
export function createScaleWithHandleGizmo(boxRadius: number): Primitive {
  const boxOptions: BoxCreationOptions = {
    sizeX: boxRadius * 2,
    sizeY: boxRadius * 2,
    sizeZ: 0
  };
  const vertices: number[] = [];

  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();
  BoxShape.generateData(boxOptions, vertices, null, null, null, indices, bbox, vertices.length / 3);
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
  primitive.createAndSetVertexBuffer('tex0_f32x3', new Float32Array(3 * 9), 'instance');
  primitive.createAndSetIndexBuffer(new Uint16Array(indices));
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
export function createRotationGizmo(
  outerRadius: number,
  innerRadius: number,
  orthoDirection: Nullable<CubeFace>
) {
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
  const axies: number[] = [];
  const rgb: number[][] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255]
  ];
  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();

  if (orthoDirection === null || orthoDirection === CubeFace.PX || orthoDirection === CubeFace.NX) {
    // X axis
    TorusShape.generateData(
      torusOptionsX,
      vertices,
      null,
      null,
      null,
      indices,
      bbox,
      vertices.length / 3,
      () => {
        diffuse.push(...rgb[0]);
        axies.push(axisList[0]);
      }
    );
  }
  if (orthoDirection === null || orthoDirection === CubeFace.PY || orthoDirection === CubeFace.NY) {
    // Y axis
    TorusShape.generateData(
      torusOptionsY,
      vertices,
      null,
      null,
      null,
      indices,
      bbox,
      vertices.length / 3,
      () => {
        diffuse.push(...rgb[1]);
        axies.push(axisList[1]);
      }
    );
  }
  if (orthoDirection === null || orthoDirection === CubeFace.PZ || orthoDirection === CubeFace.NZ) {
    // Z axis
    TorusShape.generateData(
      torusOptionsZ,
      vertices,
      null,
      null,
      null,
      indices,
      bbox,
      vertices.length / 3,
      () => {
        diffuse.push(...rgb[2]);
        axies.push(axisList[2]);
      }
    );
  }
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
  primitive.createAndSetVertexBuffer('diffuse_u8normx4', new Uint8Array(diffuse));
  primitive.createAndSetVertexBuffer('tex0_f32', new Float32Array(axies));
  primitive.createAndSetIndexBuffer(new Uint16Array(indices));
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
  arrowRadius: number,
  boxRadius: number,
  orthoDirection: Nullable<CubeFace>
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
  const boxOptions: BoxCreationOptions = {
    size: boxRadius * 2
  };

  const vertices: number[] = [];
  const diffuse: number[] = [];
  const axies: number[] = [];
  const rgb: number[][] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255]
  ];
  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();

  if (orthoDirection === null || (orthoDirection !== CubeFace.PX && orthoDirection !== CubeFace.NX)) {
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
      () => {
        diffuse.push(...rgb[0]);
        axies.push(axisList[0]);
      }
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
      () => {
        diffuse.push(...rgb[0]);
        axies.push(axisList[0]);
      }
    );
  }
  if (orthoDirection === null || orthoDirection === CubeFace.PX || orthoDirection === CubeFace.NX) {
    // X plane
    PlaneShape.generateData(
      planeOptionsX,
      vertices,
      null,
      null,
      null,
      indices,
      bbox,
      vertices.length / 3,
      () => {
        diffuse.push(...rgb[0]);
        axies.push(axisList[1] + axisList[2]);
      }
    );
  }
  if (orthoDirection === null || (orthoDirection !== CubeFace.PY && orthoDirection !== CubeFace.NY)) {
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
      () => {
        diffuse.push(...rgb[1]);
        axies.push(axisList[1]);
      }
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
      () => {
        diffuse.push(...rgb[1]);
        axies.push(axisList[1]);
      }
    );
  }
  if (orthoDirection === null || orthoDirection === CubeFace.PY || orthoDirection === CubeFace.NY) {
    // Y plane
    PlaneShape.generateData(
      planeOptionsY,
      vertices,
      null,
      null,
      null,
      indices,
      bbox,
      vertices.length / 3,
      () => {
        diffuse.push(...rgb[1]);
        axies.push(axisList[0] + axisList[2]);
      }
    );
  }
  if (orthoDirection === null || (orthoDirection !== CubeFace.PZ && orthoDirection !== CubeFace.NZ)) {
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
      () => {
        diffuse.push(...rgb[2]);
        axies.push(axisList[2]);
      }
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
      () => {
        diffuse.push(...rgb[2]);
        axies.push(axisList[2]);
      }
    );
  }
  if (orthoDirection === null || orthoDirection === CubeFace.PZ || orthoDirection === CubeFace.NZ) {
    // Z plane
    PlaneShape.generateData(
      planeOptionsZ,
      vertices,
      null,
      null,
      null,
      indices,
      bbox,
      vertices.length / 3,
      () => {
        diffuse.push(...rgb[2]);
        axies.push(axisList[0] + axisList[1]);
      }
    );
  }
  if (orthoDirection === null) {
    // center
    BoxShape.generateData(boxOptions, vertices, null, null, null, indices, bbox, vertices.length / 3, () => {
      diffuse.push(255, 255, 255, 255);
      axies.push(axisList[0] + axisList[1] + axisList[2]);
    });
  }
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
  primitive.createAndSetVertexBuffer('diffuse_u8normx4', new Uint8Array(diffuse));
  primitive.createAndSetVertexBuffer('tex0_f32', new Float32Array(axies));
  primitive.createAndSetIndexBuffer(new Uint16Array(indices));
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
  const vertexBuffer = getDevice().createVertexBuffer('position_f32x3', new Float32Array(vertices));
  primitive.setVertexBuffer(vertexBuffer);
  const normalBuffer = getDevice().createVertexBuffer('normal_f32x3', new Float32Array(normals));
  primitive.setVertexBuffer(normalBuffer);
  const diffuseBuffer = getDevice().createVertexBuffer('diffuse_u8normx4', new Uint8Array(diffuse));
  primitive.setVertexBuffer(diffuseBuffer);
  const indexBuffer = getDevice().createIndexBuffer(new Uint16Array(indices));
  primitive.setIndexBuffer(indexBuffer);
  primitive.primitiveType = 'triangle-list';
  primitive.indexCount = indices.length;
  primitive.setBoundingVolume(bbox);

  return primitive;
}
