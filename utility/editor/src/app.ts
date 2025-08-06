import { Application } from '@zephyr3d/scene';
import { imGuiInit } from '@zephyr3d/imgui';
import { Editor } from './core/editor';
import { backendWebGL1 } from '@zephyr3d/backend-webgl';
//import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { initLeakDetector } from './helpers/leakdetector';
import { initEmojiMapping } from './helpers/emoji';

const studioApp = new Application({
  backend: backendWebGL1,
  canvas: document.querySelector('#canvas')
});

studioApp.ready().then(async () => {
  await initLeakDetector();
  const device = studioApp.device;
  await imGuiInit(device, `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`, 12);
  initEmojiMapping();
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
