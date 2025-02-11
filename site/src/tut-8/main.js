import { Quaternion, Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  Compositor,
  Tonemap,
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
  // All sphere meshes share the same vertex data and materials, allowing for rendering with geometry instances on WebGL2 and WebGPU devices
  const spherePrimitive = new SphereShape();
  // Create a sphere mesh as the parent node
  const sphere1 = new Mesh(scene, spherePrimitive, material);
  // Create a sphere mesh as a child of sphere1 with the X axis 8 units away from the sphere1 node
  const sphere2 = new Mesh(scene, spherePrimitive, material);
  sphere2.parent = sphere1;
  sphere2.position.x = 8;
  // Create a sphere mesh as a child of sphere2 with the Y axis 4 units away from the sphere2 node
  const sphere3 = new Mesh(scene, spherePrimitive, material);
  sphere3.parent = sphere2;
  sphere3.position.y = 4;

  // Create camera
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    myApp.device.canvas.width / myApp.device.canvas.height,
    1,
    100
  );
  camera.lookAt(new Vector3(0, 0, 20), Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController();

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  let x = 0;
  myApp.on('tick', function () {
    // Sphere1 rotates about the Z-axis
    sphere1.rotation = Quaternion.fromAxisAngle(new Vector3(0, 0, 1), x);
    // Sphere2 rotates about the x-axis
    sphere2.rotation = Quaternion.fromAxisAngle(new Vector3(1, 0, 0), x * 8);
    x += 0.01;
    camera.updateController();
    camera.render(scene, compositor);
  });

  myApp.run();
});
