import { Application, Compositor, OrbitCameraController, PerspectiveCamera, Tonemap } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Scene } from '@zephyr3d/scene';

// Create the application
const myApp = new Application({
  // Use WebGL2 as the rendering backend
  // We currently support three types of rendering backends: WebGL, WebGL2 and WebGPU.
  backend: backendWebGL2,
  // Canvas element
  canvas: document.querySelector('#my-canvas')
});

// Wait for the rendering device to be ready
myApp.ready().then(function () {
  // Create scene
  const scene = new Scene();
  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 100);
  // Set camera controller
  camera.controller = new OrbitCameraController();
  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());
  // Input handler middleware for camera controll
  myApp.inputManager.use(camera.handleEvent.bind(camera));
  // Frame event handler
  myApp.on('tick', function () {
    // Update camera controller state
    camera.updateController();
    // Render scene
    camera.render(scene, compositor);
  });
  myApp.run();
});
