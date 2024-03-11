import { Application } from '@zephyr3d/scene';
import type { DeviceBackend } from '@zephyr3d/device';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Demo } from './demo';
import { imGuiInit, imGuiInjectEvent } from '@zephyr3d/imgui';

function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

function getBackend(): DeviceBackend {
  const type = getQueryString('dev') || 'webgl';
  if (type === 'webgpu') {
    if (backendWebGPU.supported()) {
      return backendWebGPU;
    } else {
      console.warn('No WebGPU support, fall back to WebGL2');
    }
  }
  if (type === 'webgl2') {
    if (backendWebGL2.supported()) {
      return backendWebGL2;
    } else {
      console.warn('No WebGL2 support, fall back to WebGL1');
    }
  }
  return backendWebGL1;
}

const terrainApp = new Application({
  backend: getBackend(),
  canvas: document.querySelector('#canvas'),
  enableMSAA: false
});

terrainApp.ready().then(async () => {
  await imGuiInit(terrainApp.device);
  const demo = new Demo();
  const device = terrainApp.device;
  device.canvas.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    return false;
  });
  terrainApp.inputManager.use(imGuiInjectEvent);
  terrainApp.inputManager.use(demo.camera.handleEvent.bind(demo.camera));

  terrainApp.on('pointerup', (ev) => {
    demo.handlePointerUp(ev.button, ev.offsetX, ev.offsetY);
  });
  Application.instance.device.canvas.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    return false;
  });
  terrainApp.on('resize', (ev) => {
    demo.camera.aspect = ev.width / ev.height;
  });
  terrainApp.on('tick', (ev) => {
    demo.render();
  });
  demo.load();
  terrainApp.run();
});
