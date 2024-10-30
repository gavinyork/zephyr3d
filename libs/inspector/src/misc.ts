import { Vector3, Vector4 } from '@zephyr3d/base';
import { Application, CylinderShape, Mesh, SceneNode, UnlitMaterial, type Scene } from '@zephyr3d/scene';

export function createAxisGroup(
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
  arrowXMesh.position.setXYZ(0, 10, 0);
  axisXMesh.parent = axisGroup;
  axisXMesh.scale.setXYZ(0.1, 1, 0.1);
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
  arrowYMesh.position.setXYZ(0, 10, 0);
  axisYMesh.parent = axisGroup;
  axisYMesh.scale.setXYZ(0.1, 1, 0.1);

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
  arrowZMesh.position.setXYZ(0, 10, 0);
  axisZMesh.parent = axisGroup;
  axisZMesh.scale.setXYZ(0.1, 1, 0.1);
  axisZMesh.rotation.fromAxisAngle(new Vector3(1, 0, 0), Math.PI * 0.5);

  return axisGroup;
}
