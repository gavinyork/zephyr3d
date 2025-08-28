import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  SphereShape,
  DirectionalLight,
  AssetManager,
  PBRMetallicRoughnessMaterial,
  getInput
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  // Create scene and light
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  // Create a PBR material
  const material = new PBRMetallicRoughnessMaterial();
  // metallic 0.9
  material.metallic = 0.9;
  // roughness 0.6
  material.roughness = 0.6;
  // Load albedo map and normal map
  const assetManager = new AssetManager();
  assetManager.fetchTexture('assets/images/earthcolor.jpg').then((texture) => {
    material.albedoTexture = /** @type {import('@zephyr3d/device').Texture2D} */ (texture);
  });
  assetManager
    .fetchTexture('assets/images/earthnormal.png', {
      linearColorSpace: true
    })
    .then((texture) => {
      material.normalTexture = /** @type {import('@zephyr3d/device').Texture2D} */ (texture);
    });
  // Create a sphere mesh
  new Mesh(scene, new SphereShape(), material);

  // Create camera
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    myApp.device.canvas.width / myApp.device.canvas.height,
    1,
    100
  );
  camera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController();

  getInput().use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
