import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  BoxShape,
  PlaneShape,
  TorusShape,
  PBRMetallicRoughnessMaterial,
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
  scene.env.light.strength = 0.4;

  const dirLight = new DirectionalLight(scene);
  dirLight.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  dirLight.castShadow = true;
  dirLight.shadow.mode = 'pcf-opt';

  // Create scene
  const material = new PBRMetallicRoughnessMaterial();
  material.metallic = 0.1;
  material.roughness = 0.9;
  const box = new Mesh(scene, new BoxShape({ size: 10 }), material);
  box.position.setXYZ(16, 5, -12);
  new Mesh(scene, new PlaneShape({ size: 60 }), material);
  const torus = new Mesh(scene, new TorusShape(), material);
  torus.scale.setXYZ(8, 8, 8);
  torus.position.setXYZ(0, 3, 0);

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  scene.mainCamera.lookAt(new Vector3(0, 40, 60), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();
  scene.mainCamera.SSAOIntensity = 0.03;
  scene.mainCamera.SSAORadius = 100;

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0, {
    beforeRender(scene) {
      const width = myApp.device.deviceXToScreen(myApp.device.canvas.width);
      const height = myApp.device.deviceYToScreen(myApp.device.canvas.height);
      // The lower half of the screen uses SSAO
      scene.mainCamera.viewport = [0, 0, width, height >> 1];
      scene.mainCamera.SSAO = true;
    }
  });

  getEngine().setRenderable(scene, 1, {
    beforeRender(scene) {
      const width = myApp.device.deviceXToScreen(myApp.device.canvas.width);
      const height = myApp.device.deviceYToScreen(myApp.device.canvas.height);
      scene.mainCamera.viewport = [0, height >> 1, width, height - (height >> 1)];
      scene.mainCamera.SSAO = false;
    }
  });

  myApp.run();
});
