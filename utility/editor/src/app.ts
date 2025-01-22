import { Application } from '@zephyr3d/scene';
import { imGuiInit } from '@zephyr3d/imgui';
import { Editor } from './core/editor';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const studioApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#canvas')
});

studioApp.ready().then(async () => {
  const device = studioApp.device;
  await imGuiInit(device, `'Consolas', 'Monaco', 'Courier New', monospace`);
  const editor = Editor.instance;
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
