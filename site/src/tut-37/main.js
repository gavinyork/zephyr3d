import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3, Vector4 } from '@zephyr3d/base';
import { Scene, Application, PerspectiveCamera, DirectionalLight, Compositor, Tonemap, PBRMetallicRoughnessMaterial, BoxShape, Mesh, FPSCameraController } from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});


myApp.ready().then(async() => {
  // Create scene
  const scene = new Scene();

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  camera.lookAt(new Vector3(0, 8, 30), new Vector3(0, 8, 0), Vector3.axisPY());
  camera.controller = new FPSCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  // Create sunlight
  const sunLight = new DirectionalLight(scene);
  sunLight.lookAt(new Vector3(1, 1, 1), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  sunLight.castShadow = true;
  sunLight.shadow.numShadowCascades = 4;

  // Set the sky rendering mode to Atmospheric Scattering
  scene.env.sky.skyType = 'scatter';
  // Set the fog mode to exponential (exp or exp2)
  scene.env.sky.fogType = 'exp';
  // Fog density
  scene.env.sky.fogDensity = 0.006;
  // Fog height
  scene.env.sky.fogTop = 120;
  // Fog color
  scene.env.sky.fogColor.setXYZW(0, 0.4, 0.7, 1);

  // Create the ground and some boxes
  const material = new PBRMetallicRoughnessMaterial();
  material.lightModel.metallic = 0.1;
  material.lightModel.roughness = 0.6;
  material.lightModel.albedo = new Vector4(0.3, 0.2, 0.2, 1);

  const box = new BoxShape();
  const floor = new Mesh(scene, box);
  floor.scale.setXYZ(2000, 10, 2000);
  floor.position.setXYZ(-1000, -10, -1000);
  floor.material = material;

  for (let i = -40; i <= 40; i++) {
    const box1 = new Mesh(scene, box);
    box1.scale.setXYZ(3, 30, 3);
    box1.position.setXYZ(-20, 0, i * 10);
    box1.material = material;
    const box2 = new Mesh(scene, box);
    box2.scale.setXYZ(3, 30, 3);
    box2.position.setXYZ(20, 0, i * 10);
    box2.material = material;
  }

  // Added a Tonemap post-processing effect
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
