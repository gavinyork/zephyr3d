import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  LambertMaterial,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  SphereShape,
  DirectionalLight,
  getInput
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// Creates the application.
const myApp = new Application({
  // Use WebGL2 rendering backend.
  backend: backendWebGL2,
  // The canvas element
  canvas: document.querySelector('#canvas')
});

// Wait for the application to be ready.
myApp.ready().then(function () {
  // Create scene and light
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  // Create a lambert material
  const material = new LambertMaterial();
  material.albedoColor = new Vector4(1, 0, 0, 1);
  // Create a sphere mesh
  new Mesh(scene, new SphereShape(), material);

  // Create camera with orbit controll
  const camera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  camera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController({ center: Vector3.zero() });

  // Handle camera input events
  getInput().use(camera.handleEvent.bind(camera));

  // frame animation
  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene);
  });

  // Starts rendering loop
  myApp.run();
});
