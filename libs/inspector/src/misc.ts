import { Matrix4x4, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import type { CylinderCreationOptions } from '@zephyr3d/scene';
import {
  Application,
  BoundingBox,
  CylinderShape,
  Mesh,
  Primitive,
  SceneNode,
  UnlitMaterial,
  type Scene
} from '@zephyr3d/scene';

export function createAxisPrimitive(
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

export function createAxisGroup(
  scene: Scene,
  axisLength: number,
  axisRadius: number,
  arrowLength: number,
  arrowRadius: number
) {
  const primitive = createAxisPrimitive(axisLength, axisRadius, arrowLength, arrowRadius);
  const material = new UnlitMaterial();
  material.albedoColor = new Vector4(1, 1, 1, 1);
  material.vertexColor = true;
  return new Mesh(scene, primitive, material);
}

export function createAxisGroup2(
  scene: Scene,
  axisLength: number,
  axisRadius: number,
  arrowLength: number,
  arrowRadius: number
) {
  const axisGroup = new SceneNode(scene);

  const primitiveAxis = new CylinderShape({
    topRadius: axisRadius,
    bottomRadius: axisRadius,
    height: axisLength,
    anchor: 0
  });
  const primitiveArrow = new CylinderShape({
    topRadius: 0,
    bottomRadius: arrowRadius,
    height: arrowLength,
    anchor: 0
  });

  const useInstancing = Application.instance.device.type !== 'webgl';
  const materialAxis = useInstancing ? new UnlitMaterial() : null;

  const materialAxisX = useInstancing ? materialAxis.createInstance() : new UnlitMaterial();
  materialAxisX.albedoColor = new Vector4(1, 0, 0, 1);
  const axisXMesh = new Mesh(scene, primitiveAxis, materialAxisX);
  axisXMesh.name = 'axisX';
  axisXMesh.pickable = true;
  const arrowXMesh = new Mesh(scene, primitiveArrow, materialAxisX);
  arrowXMesh.name = 'arrowX';
  arrowXMesh.pickable = true;
  arrowXMesh.setPickTarget(axisXMesh);
  arrowXMesh.parent = axisXMesh;
  arrowXMesh.position.setXYZ(0, axisLength, 0);
  axisXMesh.parent = axisGroup;
  axisXMesh.rotation.fromAxisAngle(new Vector3(0, 0, -1), Math.PI * 0.5);

  const materialAxisY = useInstancing ? materialAxis.createInstance() : new UnlitMaterial();
  materialAxisY.albedoColor = new Vector4(0, 1, 0, 1);
  const axisYMesh = new Mesh(scene, primitiveAxis, materialAxisY);
  axisYMesh.name = 'axisY';
  axisYMesh.pickable = true;
  const arrowYMesh = new Mesh(scene, primitiveArrow, materialAxisY);
  arrowYMesh.name = 'arrowY';
  arrowYMesh.pickable = true;
  arrowYMesh.setPickTarget(axisYMesh);
  arrowYMesh.parent = axisYMesh;
  arrowYMesh.position.setXYZ(0, axisLength, 0);
  axisYMesh.parent = axisGroup;

  const materialAxisZ = useInstancing ? materialAxis.createInstance() : new UnlitMaterial();
  materialAxisZ.albedoColor = new Vector4(0, 0, 1, 1);
  const axisZMesh = new Mesh(scene, primitiveAxis, materialAxisZ);
  axisZMesh.name = 'axisZ';
  axisZMesh.pickable = true;
  const arrowZMesh = new Mesh(scene, primitiveArrow, materialAxisZ);
  arrowZMesh.name = 'arrowZ';
  arrowZMesh.pickable = true;
  arrowZMesh.setPickTarget(axisZMesh);
  arrowZMesh.parent = axisZMesh;
  arrowZMesh.position.setXYZ(0, axisLength, 0);
  axisZMesh.parent = axisGroup;
  axisZMesh.rotation.fromAxisAngle(new Vector3(1, 0, 0), Math.PI * 0.5);

  return axisGroup;
}
