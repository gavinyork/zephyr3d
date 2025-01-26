import { Vector4 } from '@zephyr3d/base';
import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  myApp.on('tick', function () {
    myApp.device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
  });
  myApp.run();
});
