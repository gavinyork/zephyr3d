// 引入Vector4
import { Vector4 } from '@zephyr3d/base';
import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

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
  // Frame event handler
  myApp.on('tick', function(){
    // device is the rendering device, and we call its clearFrameBuffer method to clear the screen to green
    myApp.device.clearFrameBuffer(new Vector4(0, 1, 0, 1), 1, 0);
  });
  // The app has been initialized and the rendering loop begins
  myApp.run();
});
