import { Quaternion, Vector3 } from '@zephyr3d/base';
import { Scene, Application, Mesh, OrbitCameraController, PerspectiveCamera, Compositor, Tonemap, SphereShape, BlinnMaterial, DirectionalLight, AssetManager, Quadtree } from '@zephyr3d/scene';
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
  material.lightModel.shininess = 256;
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

  let x = 0;
  myApp.on('tick', function () {
    // Update sphere rotation
    sphere.rotation = Quaternion.fromAxisAngle(new Vector3(0, 1, 0), x);
    // Update sphere position
    sphere.position.y = Math.sin(x);
    x += 0.04;
    camera.updateController();
    camera.render(scene, compositor);
  });

  myApp.run();
});
