import { Application } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { imGuiInit } from '@zephyr3d/imgui';
import { Editor } from './core/editor';

const studioApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#canvas')
});

studioApp.ready().then(async () => {
  const device = studioApp.device;
  await imGuiInit(device);
  const editor = Editor.instance;
  await editor.loadEditorFonts('zef-16px');
  editor.registerModules();
  studioApp.inputManager.use(editor.handleEvent.bind(editor));

  studioApp.on('resize', (width, height) => {
    editor.resize(width, height);
  });
  studioApp.on('tick', () => {
    editor.update(device.frameInfo.elapsedFrame);
    editor.render();
  });
  studioApp.run();
});
