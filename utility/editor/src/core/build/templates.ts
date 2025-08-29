export const templateScript = `import type { IDisposable } from '@zephyr3d/base';
import { RuntimeScript } from '@zephyr3d/runtime';

// Change HostType to your attachment type
type HostType = IDisposable;

export default class extends RuntimeScript<HostType> {
  /**
   * Called exactly once right after the constructor.
   * Use this for initialization that may be asynchronous (e.g., loading assets).
   * You can return a Promise to delay subsequent lifecycle steps until initialization completes.
   */
  onCreated(): void | Promise<void> {
  }

  /**
   * Called after onCreated() when this script is attached to a host object.
   * You should store the attached host in your own member(s) for later use.
   *
   * If this script is implemented as a singleton, it may be attached to multiple hosts.
   * In that case, onAttached() can be called multiple times; consider using an array
   * (or a Set) to keep track of all attached hosts.
   */
  onAttached(_host: HostType): void | Promise<void> {
  }

  /**
   * Called once per frame.
   * Use this for per-frame updates such as animations, state changes, or logic.
   *
   * @param _deltaTime  Time elapsed since the previous frame (in seconds).
   * @param _elapsedTime Total time since this script started running (in seconds).
   */
  onUpdate(_deltaTime: number, _elapsedTime: number) {
  }

  /**
   * Called when this script is detached from a specific host via Engine.detachScript(),
   * or when that host is destroyed.
   * Update your stored list of attached hosts here (e.g., remove the host).
   */
  onDetached(_host: HostType) {
  }

  /**
   * Called after all hosts have been detached from this script.
   * The script instance will be discarded afterwards.
   * Use this to clean up resources and free memory (dispose handles, cancel timers, remove listeners, etc.).
   */
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
