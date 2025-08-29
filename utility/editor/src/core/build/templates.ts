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

export const templateIndex = `import { Application, getEngine } from '@zephyr3d/scene';
import { HttpFS } from '@zephyr3d/base';
import type { DeviceBackend } from '@zephyr3d/device';
const VFS = new HttpFS('./');
const settingsJson = await VFS.readFile('/settings.json', { encoding: 'utf8' }) as string;
const settings = JSON.parse(settingsJson);
const rhiList = settings.preferredRHI?.map((val) => val.toLowerCase()) ?? [];
let backend: DeviceBackend = null;
if (rhiList.includes('webgpu')) {
  backend = (await import('@zephyr3d/backend-webgpu')).backendWebGPU;
  if (!backend.supported()) {
    backend = null;
  }
}
if (!backend && rhiList.includes('webgl2')) {
  backend = (await import('@zephyr3d/backend-webgl')).backendWebGL2;
  if (!backend.supported()) {
    backend = null;
  }
}
if (!backend && rhiList.includes('webgl')) {
  backend = (await import('@zephyr3d/backend-webgl')).backendWebGL1;
  if (!backend.supported()) {
    backend = null;
  }
}
if (!backend) {
  throw new Error('No supported rendering device found');
}

const application = new Application({
  backend,
  canvas: document.querySelector('#canvas'),
  runtimeOptions: {
    scriptsRoot: '/assets'
  }
});
application.ready().then(async () => {
  getEngine().startup(settings.startupScene, settings.splashScreen, settings.startupScript);
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
