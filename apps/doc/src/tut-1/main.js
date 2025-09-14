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
  let str = '';
  // Define the clear color
  const clearColor = new Vector4(0, 0, 0, 1);
  // Set the font
  myApp.device.setFont('16px arial');
  // Frame event handler
  myApp.on('tick', function () {
    // Clears the frame buffer
    myApp.device.clearFrameBuffer(clearColor, 1, 0);
    // Render some text onto the screen
    myApp.device.drawText(str, 30, 30, '#ffff00');
  });
  // handle pointer move
  myApp.on('pointermove', function (ev) {
    // Display text
    str = `X:${ev.offsetX.toFixed()} Y:${ev.offsetY.toFixed()}`;
  });
  // The app has been initialized and the rendering loop begins
  myApp.run();
});
