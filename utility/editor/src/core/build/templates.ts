export const templateIndex = `
import { Application } from '@zephyr3d/scene';
import { HttpFS } from '@zephyr3d/base';
import { RuntimeManager } from '@zephyr3d/runtime';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

const deviceType = new URL(window.location.href).searchParams.get('device');
const HelloApp = new Application({
  backend: deviceType === 'webgl' ? backendWebGL1 : deviceType === 'webgl2' ? backendWebGL2 : backendWebGPU,
  canvas: document.querySelector('#canvas')
});
HelloApp.ready().then(async () => {
  const httpFS = new HttpFS('./');
  await RuntimeManager.init(httpFS, '/', false);
  HelloApp.on('tick', (deltaTime, elapsedTime) => {
    RuntimeManager.update(deltaTime, elapsedTime);
  });
});
`;

export const templateIndexHTML = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>HelloApp</title>
    <style>
      * {
        margin: 0;
        padding: 0;
      }
      html,
      body {
        width: 100vw;
        height: 100vh;
      }
      canvas {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    <script type="module" src="js/tut-0.js"></script>
  </body>
</html>
`;
