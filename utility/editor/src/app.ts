import { Application } from '@zephyr3d/scene';
import { imGuiInit } from '@zephyr3d/imgui';
import { Editor } from './core/editor';
//import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { initLeakDetector, testSourceMap } from './helpers/leakdetector';

const studioApp = new Application({
  backend: backendWebGPU,
  canvas: document.querySelector('#canvas')
});

studioApp.ready().then(async () => {
  await initLeakDetector();
  testSourceMap();
  const device = studioApp.device;
  await imGuiInit(device, `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`, 12);
  const editor = new Editor();
  await editor.init();
  editor.registerModules();
  studioApp.inputManager.use(editor.handleEvent.bind(editor));

  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  studioApp.on('resize', (width, height) => {
    editor.resize(width, height);
  });
  studioApp.on('tick', () => {
    editor.update(device.frameInfo.elapsedFrame);
    editor.render();
  });
  studioApp.run();
});
