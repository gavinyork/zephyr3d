import type { EditorMode } from '@zephyr3d/scene';
import { Application, getDevice, getEngine, getInput } from '@zephyr3d/scene';
import { imGuiInit } from '@zephyr3d/imgui';
import { Editor } from './core/editor';
import { initLeakDetector } from './helpers/leakdetector';
import { initEmojiMapping } from './helpers/emoji';
import { installEditorMCPBridge } from './helpers/mcpbridge';
import { flushPendingCaptures } from './helpers/capture';
import { runHeadlessCapture } from './helpers/headless';
import type { ProjectSettings } from './core/services/project';
import { ProjectService } from './core/services/project';
import { isDesktopApp } from './core/services/desktop';
import type { Nullable } from '@zephyr3d/base';
import { GenericHtmlDirectoryReader } from '@zephyr3d/base';
import type { DeviceBackend } from '@zephyr3d/device';
import { FBXImporter, GLTFImporter } from '@zephyr3d/loaders';

const searchParams = new URL(window.location.href).searchParams;
const project = searchParams.get('project');
const open = searchParams.get('open') !== null;
const remote = searchParams.get('remote') !== null;
const previewScene = searchParams.get('scene');
// One-shot headless capture mode (driven by `electron . --headless --screenshot ...`):
// preview mode with a manually stepped, fixed-timestep frame loop instead of run().
const headless = searchParams.get('headless') !== null;
const headlessFrames = Number(searchParams.get('frames')) || 64;
const headlessFixedDtParam = searchParams.get('fixedDt');
const headlessFixedDt =
  headlessFixedDtParam === null
    ? 1000 / 60
    : Number(headlessFixedDtParam) > 0
      ? Number(headlessFixedDtParam)
      : null;
const headlessDpr = Number(searchParams.get('dpr')) > 0 ? Number(searchParams.get('dpr')) : 1;
// During headless boot, any uncaught error (module top-level throws included,
// e.g. a bad project id) must fail the run fast instead of hitting the main
// process watchdog. The guards are removed once the controlled capture path
// takes over error handling.
let headlessBootFailed = false;
const reportHeadlessBootFailure = (err: unknown) => {
  if (headlessBootFailed) {
    return;
  }
  headlessBootFailed = true;
  const error = err instanceof Error ? (err.stack ?? err.message) : String(err);
  void window.zephyrEditorDesktop?.headless?.reportResult({ ok: false, error: `boot failed: ${error}` });
};
const onHeadlessBootError = (ev: ErrorEvent) => reportHeadlessBootFailure(ev.error ?? ev.message);
const onHeadlessBootRejection = (ev: PromiseRejectionEvent) => reportHeadlessBootFailure(ev.reason);
if (headless) {
  window.addEventListener('error', onHeadlessBootError);
  window.addEventListener('unhandledrejection', onHeadlessBootRejection);
}
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

  const info = remote
    ? await ProjectService.openRemoteProject(project, new GenericHtmlDirectoryReader())
    : await ProjectService.openProject(project);
  if (!info) {
    throw new Error('Open remote project failed');
  }
  settings = await ProjectService.getCurrentProjectSettings();
  if (!settings) {
    throw new Error('Get project settings failed');
  }
  rhiList = settings.preferredRHI?.map((val) => val.toLowerCase()) ?? [];
  if (headless) {
    const deviceType = searchParams.get('device');
    if (deviceType) {
      rhiList = [deviceType.toLowerCase()];
    }
  }
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

const renderScale =
  typeof settings?.renderScale === 'number' && Number.isFinite(settings.renderScale)
    ? settings.renderScale
    : 0;

const editorApp = new Application({
  backend,
  canvas: document.querySelector('#canvas')!,
  enableMSAA: !!settings?.enableMSAA,
  // In headless mode the pixel ratio is pinned (default 1) so the canvas
  // backing store exactly matches the requested window content size.
  pixelRatio: headless ? headlessDpr : renderScale <= 0 ? undefined : renderScale,
  runtimeOptions: {
    VFS: ProjectService.VFS,
    scriptsRoot: '/assets',
    editorMode,
    enabled: !!project
  }
});

function isEditableShortcutTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) {
    return false;
  }
  if (element.isContentEditable) {
    return true;
  }
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  return !!element.closest('.monaco-editor, .monaco-inputbox');
}

editorApp.ready().then(async () => {
  getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/fbx', new FBXImporter());
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
    installEditorMCPBridge(editor);
    getInput().use(editor.handleEvent.bind(editor));

    if (isDesktopApp()) {
      const forwardDesktopShortcut = (ev: KeyboardEvent) => {
        if (!(ev.ctrlKey || ev.metaKey) || ev.defaultPrevented || isEditableShortcutTarget(ev.target)) {
          return;
        }
        if (editor.handleEvent(ev)) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
        }
      };
      window.addEventListener('keydown', forwardDesktopShortcut, true);
      window.addEventListener('keyup', forwardDesktopShortcut, true);
    }

    document.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });

    editorApp.on('resize', (width, height) => {
      editor.resize(width, height);
    });

    editorApp.on('tick', () => {
      editor.update(device.frameInfo.elapsedFrame);
      editor.render();
      // Serve queued screenshot requests in the same JS task as the frame's
      // final draw. The editor registers no Engine renderables, so
      // editor.render() above is the last draw of this frame; if that ever
      // changes, move this flush to a post-frame hook.
      flushPendingCaptures(device.canvas as HTMLCanvasElement);
    });

    if (project) {
      if (remote) {
        await editor.openRemoteProject(project);
      } else {
        await editor.openProject(project);
      }
    }
  } else if (headless) {
    // One-shot headless capture: await startup (scene graph + attached runtime
    // scripts ready), render exactly N deterministic frames via stepFrame(),
    // then report the capture back to the Electron main process. The run loop
    // is intentionally never started. Splash screen is skipped for determinism.
    window.removeEventListener('error', onHeadlessBootError);
    window.removeEventListener('unhandledrejection', onHeadlessBootRejection);
    try {
      await getEngine().startup(previewScene ?? settings!.startupScene, null, settings!.startupScript);
      const result = await runHeadlessCapture(editorApp, {
        frames: headlessFrames,
        fixedDt: headlessFixedDt
      });
      await window.zephyrEditorDesktop?.headless?.reportResult({ ok: true, ...result });
    } catch (err) {
      const error = err instanceof Error ? (err.stack ?? err.message) : String(err);
      await window.zephyrEditorDesktop?.headless?.reportResult({ ok: false, error });
    }
    return;
  } else {
    // start engine
    getEngine().startup(
      previewScene ?? settings!.startupScene,
      settings!.splashScreen,
      settings!.startupScript
    );
  }
  if (headless) {
    // Persistent headless (hidden window): rAF never fires for windows that
    // were never shown (~1Hz fallback), so pace the frame loop with timers
    // instead. backgroundThrottling:false keeps timers running at full speed
    // in hidden windows, and stepFrame() preserves the exact
    // beginFrame/frame/endFrame sequence of the regular run loop.
    const stepMs = 1000 / 60;
    const loop = () => {
      editorApp.stepFrame();
      window.setTimeout(loop, stepMs);
    };
    loop();
  } else {
    editorApp.run();
  }
});
