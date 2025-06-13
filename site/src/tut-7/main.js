import { Quaternion, Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  SphereShape,
  BlinnMaterial,
  DirectionalLight,
  AssetManager
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

  // Create a blinn material
  const material = new BlinnMaterial();
  material.shininess = 256;
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
  const sphere = new Mesh(scene, new SphereShape(), material);

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

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  let x = 0;
  myApp.on('tick', function () {
    // Update sphere rotation
    sphere.rotation = Quaternion.fromAxisAngle(new Vector3(0, 1, 0), x);
    // Update sphere position
    sphere.position.y = Math.sin(x);
    x += 0.04;
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
