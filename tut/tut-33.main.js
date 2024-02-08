import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Scene, AssetManager, Application, PerspectiveCamera, OrbitCameraController, panoramaToCubemap, Compositor, Tonemap } from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});


myApp.ready().then(async() => {
  const device = myApp.device;

  // Create scene
  const scene = new Scene();

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, device.canvas.width / device.canvas.height, 1, 500);
  camera.controller = new OrbitCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  const assetManager = new AssetManager();
  // Load panorama
  const panorama = await assetManager.fetchTexture('assets/images/Wide_Street.hdr');
  // Create the skybox cubemap
  const skyboxTexture = myApp.device.createCubeTexture('rgba16f', 512);
  // Call the built-in panoramaToCubemap method to render the panorama into the skybox texture
  await panoramaToCubemap(panorama, skyboxTexture);

  // Set the sky rendering mode to Skybox
  scene.env.sky.skyType = 'skybox';
  // Set the skybox texture
  scene.env.sky.skyboxTexture = skyboxTexture;

  // High dynamic range sky requires tone mapping
  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  // Reset aspect ratio when size was changed
  myApp.on('resize', ev => {
    camera.aspect = ev.width / ev.height;
  });

  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene, compositor);
  });

  myApp.run();
});
