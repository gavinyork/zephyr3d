import { Vector3, Vector4 } from '@zephyr3d/base';
import { Scene, Application, OrbitCameraController, PerspectiveCamera, Compositor, Tonemap, DirectionalLight, Mesh, BoxShape, LambertMaterial, PlaneShape, PointLight, SpotLight, NewLambertMaterial } from '@zephyr3d/scene';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import * as common from '../common';

const myApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});

const usePointLight = true;
const useSpotLight = true;
const useDirLight = true;

myApp.ready().then(async function () {
  await imGuiInit(myApp.device);
  
  const scene = new Scene();
  // Turn off environment lighting
  scene.env.light.type = 'none';

  let dlight: DirectionalLight = null;
  let plight: PointLight = null;
  let light: SpotLight = null;

  if (useDirLight) {
    // Create directional light
    dlight = new DirectionalLight(scene);
    // light direction
    dlight.rotation.fromEulerAngle(-Math.PI/4, Math.PI/4, 0, 'ZYX');
    // light color
    dlight.color = new Vector4(0, 0.3, 0.3, 1);
  }

  if (usePointLight) {
    // Create point light
    plight = new PointLight(scene);
    // point light range
    plight.range = 30;
    // light color
    plight.color = new Vector4(1, 1, 0, 1);
  }
  
  if (useSpotLight) {
    // Create spot light
    light = new SpotLight(scene);
    // light color
    light.color = new Vector4(0, 0, 1, 1);
    // light cutoff angle
    light.cutoff = Math.PI * 0.2;
    // light range
    light.range = 200;
    // light position
    light.position.setXYZ(0, 10, 0);
  }

  // Create several boxes
  const boxMaterial = new NewLambertMaterial();
  boxMaterial.albedoColor = new Vector4(1, 1, 1, 1);
  const boxShape = new BoxShape({ size: 6 });
  for (let i = 0; i < 16; i++) {
    const box = new Mesh(scene, boxShape, boxMaterial);
    box.position.setXYZ(Math.random() * 50 - 25, 0, Math.random() * 50 - 25);
  }
  // Create floor
  const floorMaterial = new NewLambertMaterial();
  floorMaterial.albedoColor = new Vector4(1, 1, 1, 1);
  const floor = new Mesh(scene, new PlaneShape({ size: 200 }), floorMaterial);
  floor.position.x = -100;
  floor.position.z = -100;

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  const eyePos = new Vector3(30, 30, 30);
  camera.lookAt(eyePos, new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController({ distance: eyePos.magnitude });

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  const inspector = new common.Inspector(scene, compositor, camera);

  myApp.inputManager.use(imGuiInjectEvent);
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    dlight?.rotation.fromEulerAngle(-Math.PI/4, myApp.device.frameInfo.elapsedOverall * 0.0005, 0, 'ZYX');
    plight?.position.setXYZ(20 * Math.cos(Date.now() * 0.001) - 10, 15, 20 * Math.sin(Date.now() * 0.001) - 10);
    light?.rotation.fromEulerAngle(-Math.PI/6, myApp.device.frameInfo.elapsedOverall * 0.0005, 0, 'ZYX');
    camera.updateController();
    camera.render(scene, compositor);

    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });

  myApp.run();
});
