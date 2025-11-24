import { Application, getEngine, PerspectiveCamera } from '@zephyr3d/scene';
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
  new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  // Set scene as active renderable object as layer 0
  getEngine().setRenderable(scene, 0);
  // The app has been initialized and the rendering loop begins
  myApp.run();
});
