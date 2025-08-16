import { Application } from '@zephyr3d/scene';
import { imGuiInit } from '@zephyr3d/imgui';
import { Editor } from './core/editor';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { initLeakDetector } from './helpers/leakdetector';
import { initEmojiMapping } from './helpers/emoji';
import { ProjectService } from './core/services/project';
import { moduleSharing } from './core/moduleshare';

moduleSharing.shareZephyr3dModules();
const deviceType = new URL(window.location.href).searchParams.get('device');
const project = new URL(window.location.href).searchParams.get('project');
if (project) {
  await ProjectService.openProject(project);
}

const studioApp = new Application({
  backend: deviceType === 'webgl' ? backendWebGL1 : deviceType === 'webgl2' ? backendWebGL2 : backendWebGPU,
  canvas: document.querySelector('#canvas'),
  runtimeOptions: {
    VFS: project ? ProjectService.VFS : null,
    scriptsRoot: '/assets',
    editorMode: true,
    enabled: !!project
  }
});

studioApp.ready().then(async () => {
  if (!project) {
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
      editor.update(device.frameInfo.elapsedFrame, device.frameInfo.elapsedOverall);
      editor.render();
    });
  } else {
    // load startup script
    await studioApp.runtimeManager.attachScript(null, '#/index');
  }
  studioApp.run();
});
