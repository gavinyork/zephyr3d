import { Application, PerspectiveCamera } from '@zephyr3d/scene';
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
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    myApp.device.canvas.width / myApp.device.canvas.height,
    1,
    100
  );
  // Reset aspect ratio when size was changed
  myApp.on('resize', function (width, height) {
    camera.aspect = width / height;
  });
  // Frame event handler
  myApp.on('tick', function () {
    // Render scene
    camera.render(scene);
  });
  // The app has been initialized and the rendering loop begins
  myApp.run();
});
