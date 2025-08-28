export const templateScript = `import type { IDisposable } from '@zephyr3d/base';
import { RuntimeScript } from '@zephyr3d/runtime';
// Change HostType to your attachment type
type HostType = IDisposable;
export default class MyScript extends RuntimeScript<HostType> {
  onCreated(): void | Promise<void> {
  }
  onAttached(_host: HostType): void | Promise<void> {
  }
  onUpdate(_deltaTime: number, _elapsedTime: number) {
  }
  onDetached() {
  }
  onDestroy() {
  }
}
`;

export const templateIndex = `import { Application } from '@zephyr3d/scene';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
const deviceType = new URL(window.location.href).searchParams.get('device');
const application = new Application({
  backend: deviceType === 'webgl' ? backendWebGL1 : deviceType === 'webgl2' ? backendWebGL2 : backendWebGPU,
  canvas: document.querySelector('#canvas'),
  runtimeOptions: {
    scriptsRoot: '/assets'
  }
});
application.ready().then(async () => {
  await application.engine.attachScript(null, '#/index');
  application.run();
});
`;

export const templateIndexHTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>%s</title>
    %s
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
        touch-action: none;
        overscroll-behavior: contain;
        overflow: hidden;
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
  </body>
</html>
`;
