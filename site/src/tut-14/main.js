import { Vector3, Vector4 } from '@zephyr3d/base';
import { Scene, Application, OrbitCameraController, PerspectiveCamera, Compositor, Tonemap, AssetManager, panoramaToCubemap, prefilterCubemap, DirectionalLight } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();

  const assetManager = new AssetManager();
  // Load panorama
  assetManager.fetchTexture('assets/images/Wide_Street.hdr').then(tex => {
    // Generate a cube sky map from the panorama
    const skyMap = myApp.device.createCubeTexture('rgba16f', 512);
    panoramaToCubemap(/** @type {import('@zephyr3d/device').Texture2D} */ (tex), skyMap);
    // Generate an radiance map from the cube sky map
    const radianceMap = myApp.device.createCubeTexture('rgba16f', 256);
    prefilterCubemap(skyMap, 'ggx', radianceMap);
    // Generate an irradiance map from the cube sky map
    const irradianceMap = myApp.device.createCubeTexture('rgba16f', 64);
    prefilterCubemap(skyMap, 'lambertian', irradianceMap);
    // Set the sky mode to a skybox and set the skybox texture
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = skyMap;
    // Set the environment lighting mode to IBL and set the radiance map and irradiance map
    scene.env.light.type = 'ibl';
    scene.env.light.radianceMap = radianceMap;
    scene.env.light.irradianceMap = irradianceMap;
  });

  // Create directional light
  const light = new DirectionalLight(scene);
  light.rotation.fromEulerAngle(-Math.PI/4, Math.PI/4, 0, 'ZYX');
  light.color = new Vector4(1, 1, 1, 1);

  // Load a model
  assetManager.fetchModel(scene, 'assets/models/DamagedHelmet.glb').then(info => {
    info.group.scale.setXYZ(10, 10, 10);
  });

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  const eyePos = new Vector3(0, 0, 30);
  camera.lookAt(eyePos, Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController();

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    camera.updateController();

    const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
    const height = myApp.device.deviceToScreen(myApp.device.canvas.height);

    // The lower half of the screen has ambient light
    scene.env.light.type = 'ibl';
    camera.viewport = [0, 0, width, height >> 1];
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene, compositor);
    // No ambient light on the upper half of the screen
    scene.env.light.type = 'none';
    camera.viewport = [0, height >> 1, width, height - (height >> 1)];
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene, compositor);
  });

  myApp.run();
});
