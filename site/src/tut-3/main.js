import { Application, Compositor, PerspectiveCamera, Tonemap } from '@zephyr3d/scene';
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
  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());
  // Frame event handler
  myApp.on('tick', function () {
    // Render scene
    camera.render(scene, compositor);
  });
  myApp.run();
});
