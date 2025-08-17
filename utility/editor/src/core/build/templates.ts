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
import * as zephyr3d_base from '@zephyr3d/base';
import * as zephyr3d_device from '@zephyr3d/device';
import * as zephyr3d_scene from '@zephyr3d/scene';
import * as zephyr3d_runtime from '@zephyr3d/runtime';
import * as zephyr3d_backend_webgl from '@zephyr3d/backend-webgl';
import * as zephyr3d_backend_webgpu from '@zephyr3d/backend-webgpu';

zephyr3d_base.moduleSharing.shareModules({
  '@zephyr3d/base': zephyr3d_base,
  '@zephyr3d/device': zephyr3d_device,
  '@zephyr3d/scene': zephyr3d_scene,
  '@zephyr3d/runtime': zephyr3d_runtime,
  '@zephyr3d/backend-webgl': zephyr3d_backend_webgl,
  '@zephyr3d/backend-webgpu': zephyr3d_backend_webgpu
});

const deviceType = new URL(window.location.href).searchParams.get('device');
const HelloApp = new Application({
  backend: deviceType === 'webgl' ? backendWebGL1 : deviceType === 'webgl2' ? backendWebGL2 : backendWebGPU,
  canvas: document.querySelector('#canvas'),
  runtimeOptions: {
    scriptsRoot: '/assets'
  }
});
HelloApp.ready().then(async () => {
  await HelloApp.runtimeManager.attachScript(null, '#/index');
  HelloApp.run();
});
`;

export const templateIndexHTML = `<!DOCTYPE html>
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
  </body>
</html>
`;
