import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  BoxShape,
  PBRMetallicRoughnessMaterial,
  PlaneShape,
  RectLight,
  UnlitMaterial,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();
  // Turn off environment lighting
  scene.env.light.type = 'none';

  // #region rectlight
  // Create rect light
  const light = new RectLight(scene);
  // Rectangle dimensions in scene units
  light.width = 4;
  light.height = 2;
  // Falloff range
  light.range = 40;
  // light color and intensity
  light.color = new Vector4(1, 1, 1, 1);
  light.intensity = 5;
  // #endregion rectlight

  // The light itself is invisible: a thin unlit panel the size of the
  // rectangle shows where it is. As a child, it moves and turns with the light.
  const panelMaterial = new UnlitMaterial();
  panelMaterial.albedoColor = new Vector4(1, 1, 1, 1);
  new Mesh(
    scene,
    new BoxShape({ size: light.width, sizeY: light.height, sizeZ: 0.05 }),
    panelMaterial
  ).parent = light;

  // Create several boxes. A smooth floor shows the rect-shaped highlight.
  const boxMaterial = new PBRMetallicRoughnessMaterial();
  boxMaterial.albedoColor = new Vector4(1, 1, 0, 1);
  boxMaterial.metallic = 0;
  boxMaterial.roughness = 0.5;
  const boxShape = new BoxShape({ size: 2 });
  for (let i = 0; i < 8; i++) {
    const box = new Mesh(scene, boxShape, boxMaterial);
    const angle = (i / 8) * Math.PI * 2;
    box.position.setXYZ(Math.cos(angle) * 5, 1, Math.sin(angle) * 5);
  }
  // Create floor
  const floorMaterial = new PBRMetallicRoughnessMaterial();
  floorMaterial.albedoColor = new Vector4(0, 1, 1, 1);
  floorMaterial.metallic = 0;
  floorMaterial.roughness = 0.2;
  new Mesh(scene, new PlaneShape({ size: 60 }), floorMaterial);

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  const eyePos = new Vector3(14, 12, 14);
  scene.mainCamera.lookAt(eyePos, Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.on('tick', function () {
    // Circle the scene, facing its centre: light travels along the node's -Z axis.
    const t = myApp.device.frameInfo.elapsedOverall * 0.0003;
    light.lookAt(new Vector3(Math.cos(t) * 8, 4, Math.sin(t) * 8), Vector3.zero(), Vector3.axisPY());
  });

  myApp.run();
});
