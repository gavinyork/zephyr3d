import type { EditorMode } from '@zephyr3d/scene';
import { Application, getDevice, getEngine, getInput } from '@zephyr3d/scene';
import { imGuiInit } from '@zephyr3d/imgui';
import { Editor } from './core/editor';
import { initLeakDetector } from './helpers/leakdetector';
import { initEmojiMapping } from './helpers/emoji';
import type { ProjectSettings } from './core/services/project';
import { ProjectService } from './core/services/project';
import type { Nullable } from '@zephyr3d/base';
import { GenericHtmlDirectoryReader } from '@zephyr3d/base';
import type { DeviceBackend } from '@zephyr3d/device';

const searchParams = new URL(window.location.href).searchParams;
const project = searchParams.get('project');
const open = searchParams.get('open') !== null;
const remote = searchParams.get('remote') !== null;
let rhiList: string[] = [];
let settings: Nullable<ProjectSettings> = null;
let editorMode: EditorMode;
if (project && !open) {
  editorMode = 'editor-preview';
  const setFavicon = (href: string, options: { rels?: string[]; type: string; sizes?: string }) => {
    const { rels = ['icon', 'shortcut icon', 'apple-touch-icon'], type, sizes } = options;
    const head = document.head || document.getElementsByTagName('head')[0];
    const url = href;
    rels.forEach((rel) => {
      [...document.querySelectorAll(`link[rel="${rel}"]`)].forEach((el) => el.parentNode!.removeChild(el));
      const link = document.createElement('link');
      link.rel = rel;
      link.href = url;
      if (type) {
        link.type = type;
      }
      if (sizes) {
        link.sizes = sizes;
      }
      head.appendChild(link);
    });
  };

  if (remote) {
    await ProjectService.openRemoteProject(project, new GenericHtmlDirectoryReader());
  } else {
    await ProjectService.openProject(project);
  }
  const info = await ProjectService.getCurrentProjectInfo();
  if (!info) {
    throw new Error('Get project information failed');
  }
  settings = await ProjectService.getCurrentProjectSettings();
  if (!settings) {
    throw new Error('Get project settings failed');
  }
  rhiList = settings.preferredRHI?.map((val) => val.toLowerCase()) ?? [];
  document.title = settings.title ?? info.name;
  if (settings.favicon) {
    const content = (await ProjectService.VFS.readFile(settings.favicon, {
      encoding: 'binary'
    })) as ArrayBuffer;
    const type = ProjectService.VFS.guessMIMEType(settings.favicon);
    const url = URL.createObjectURL(new Blob([content], { type }));
    setFavicon(url, { type });
  }
} else {
  editorMode = 'editor';
  const deviceType = searchParams.get('device');
  if (deviceType) {
    rhiList = [deviceType];
  } else {
    rhiList = ['webgpu', 'webgl2', 'webgl'];
  }
}
let backend: Nullable<DeviceBackend> = null;
if (rhiList.includes('webgpu')) {
  backend = (await import('@zephyr3d/backend-webgpu')).backendWebGPU;
  if (!(await backend.supported())) {
    backend = null;
  }
}
if (!backend && rhiList.includes('webgl2')) {
  backend = (await import('@zephyr3d/backend-webgl')).backendWebGL2;
  if (!(await backend.supported())) {
    backend = null;
  }
}
if (!backend && rhiList.includes('webgl')) {
  backend = (await import('@zephyr3d/backend-webgl')).backendWebGL1;
  if (!(await backend.supported())) {
    backend = null;
  }
}
if (!backend) {
  throw new Error('No supported rendering device found');
}

const editorApp = new Application({
  backend,
  canvas: document.querySelector('#canvas')!,
  runtimeOptions: {
    VFS: ProjectService.VFS,
    scriptsRoot: '/assets',
    editorMode,
    enabled: !!project
  }
});

editorApp.ready().then(async () => {
  if (editorMode === 'editor') {
    await initLeakDetector();
    const device = getDevice();
    let fontSize: number;
    if (device.getScaleY() > 1) {
      fontSize = 24;
    } else {
      fontSize = 12;
    }
    await imGuiInit(device, `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`, 12, fontSize);
    initEmojiMapping();
    const editor = new Editor();
    await editor.init(fontSize);
    editor.registerModules();
    getInput().use(editor.handleEvent.bind(editor));

    document.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });

    editorApp.on('resize', (width, height) => {
      editor.resize(width, height);
    });

    editorApp.on('tick', () => {
      editor.update(device.frameInfo.elapsedFrame);
      editor.render();
    });

    if (project) {
      if (remote) {
        await editor.openRemoteProject(project);
      } else {
        await editor.openProject(project);
      }
    }
  } else {
    // start engine
    getEngine().startup(settings!.startupScene, settings!.splashScreen, settings!.startupScript);
  }
  editorApp.run();
});
