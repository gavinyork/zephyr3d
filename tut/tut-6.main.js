import { Vector3 } from '@zephyr3d/base';
import { Scene, Application, Mesh, OrbitCameraController, PerspectiveCamera, Compositor, Tonemap, SphereShape, DirectionalLight, AssetManager, PBRMetallicRoughnessMaterial } from '@zephyr3d/scene';
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
  material.lightModel.metallic = 0.9;
  // roughness 0.6
  material.lightModel.roughness = 0.6;
  // Load albedo map and normal map
  const assetManager = new AssetManager();
  assetManager.fetchTexture('assets/images/earthcolor.jpg').then(texture => {
    material.lightModel.setAlbedoMap(texture, null, 0);
  });
  assetManager.fetchTexture('assets/images/earthnormal.png', {
    linearColorSpace: true
  }).then(texture => {
    material.lightModel.setNormalMap(texture, null, 0);
  });
  // Create a sphere mesh
  const sphere = new Mesh(scene, new SphereShape(), material);

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 100);
  camera.lookAt(new Vector3(0, 0, 4), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController({ distance: 4 });

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene, compositor);
  });

  myApp.run();
});
