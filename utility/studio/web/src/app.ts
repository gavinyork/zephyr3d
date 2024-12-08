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
  const studio = Editor.instance;
  studioApp.inputManager.use(studio.handleEvent.bind(studio));

  studioApp.on('resize', (width, height) => {
    studio.resize(width, height);
  });
  studioApp.on('tick', () => {
    studio.update(device.frameInfo.elapsedFrame);
    studio.render();
  });
  studioApp.run();
});
