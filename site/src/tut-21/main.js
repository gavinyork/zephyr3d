import { Vector3, Vector4 } from '@zephyr3d/base';
import { Scene, Application, OrbitCameraController, PerspectiveCamera, Compositor, Tonemap, LambertMaterial, Mesh, DirectionalLight, PlaneShape, TorusShape } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();

  // Turn off environment lighting
  scene.env.light.type = 'none';

  // Create a directional light
  const dirLight = new DirectionalLight(scene);
  // light direction
  dirLight.rotation.fromEulerAngle(-Math.PI/4, Math.PI/4, 0, 'ZYX');
  // Enable shadowing
  dirLight.castShadow = true;

  // Create a torus
  const material = new LambertMaterial();
  material.albedoColor = new Vector4(1, 1, 0, 1);
  const torus = new Mesh(scene, new TorusShape(), material);
  torus.position.setXYZ(0, 20, 0);

  // Create floor
  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(0, 1, 1, 1);
  const floor = new Mesh(scene, new PlaneShape({ size: 100 }), floorMaterial);
  floor.position.x = -50;
  floor.position.z = -50;

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  camera.lookAt(new Vector3(0, 40, 60), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController({ distance: camera.getWorldPosition().magnitude });

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    // light rotation
    dirLight.rotation.fromEulerAngle(-Math.PI/4, myApp.device.frameInfo.elapsedOverall * 0.0005, 0, 'ZYX');
    camera.updateController();

    const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
    const height = myApp.device.deviceToScreen(myApp.device.canvas.height);

    camera.viewport = [0, 0, width, height >> 1];
    dirLight.shadow.mode = 'hard';
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene);

    camera.viewport = [0, height >> 1, width, height - (height >> 1)];
    dirLight.shadow.mode = 'vsm';
    dirLight.shadow.vsmDarkness = 0.1;
    dirLight.shadow.vsmBlurKernelSize = 7;
    dirLight.shadow.vsmBlurRadius = 2;
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene);
  });

  myApp.run();
});
