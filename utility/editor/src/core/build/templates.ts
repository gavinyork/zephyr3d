import type { ProjectSettings } from '../services/project';
import { generateSplashScreenHTML, SPLASH_SCREEN_GLOBAL } from './splash';

export const projectFileName = 'project.json';
export const fileListFileName = 'filelist.json';
export const libDir = 'libs';
export const editorPluginModuleName = '@zephyr3d/editor/editor-plugin';

/** Background of the splash screen of a build */
export const DEFAULT_SPLASH_BACKGROUND = '#000000';

/** Parses a #rrggbb color into [r, g, b] in 0..1, black when malformed */
export function cssColorToRGB(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  const v = m ? parseInt(m[1], 16) : 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Formats [r, g, b] in 0..1 as #rrggbb */
export function rgbToCSSColor(rgb: [number, number, number]) {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(Math.max(c, 0), 1) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

function escapeHTML(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const templateScript = `import type { IDisposable } from '@zephyr3d/base';
import { RuntimeScript, scriptProp } from '@zephyr3d/scene';

// Change HostType to your attachment type
type HostType = IDisposable;

export default class extends RuntimeScript<HostType> {
  @scriptProp({ type: 'float', label: 'Speed', default: 1, minValue: 0 })
  speed = 1;

  @scriptProp({ type: 'asset', label: 'Texture', mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] })
  texture = '';

  @scriptProp({ type: 'node', label: 'Target Node', sceneNode: { kind: 'node' } })
  targetNode = '';

  @scriptProp({
    type: 'object_array',
    label: 'Waypoints',
    element: { type: 'node', sceneNode: { kind: 'node' } },
    default: []
  })
  waypoints: string[] = [];

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

export const templateEditorPlugin = `import type { EditorPlugin } from '${editorPluginModuleName}';
// If your plugin needs a third-party package, install it from
// System Plugins -> Install Package..., then import it directly:
// import { nanoid } from 'nanoid';

const plugin: EditorPlugin = {
  id: 'com.example.editor-plugin',
  name: 'Example Editor Plugin',
  version: '0.1.0',
  description: 'A system-level zephyr3d editor plugin.',
  activate(ctx) {
    ctx.registerMenuItems({
      location: 'main',
      parentId: 'project',
      items: [
        {
          id: 'example-editor-plugin.about',
          label: 'Example Plugin...',
          action: async () => {
            await ctx.ui.message(
              'Example Plugin',
              [
                'This command is provided by a system plugin.',
                '',
                'Use it as the starting point for your own editor extensions.'
              ].join('\\n'),
              480,
              0
            );
          }
        }
      ]
    });
  }
};

export default plugin;
`;

export const templateEditorPluginFiles = [
  {
    path: 'plugin.json',
    source: `{
  "id": "com.example.editor-plugin",
  "name": "Example Editor Plugin",
  "version": "0.1.0",
  "description": "A multi-file system-level zephyr3d editor plugin.",
  "entry": "index.ts"
}
`
  },
  {
    path: 'index.ts',
    source: `import type { EditorPluginDefinition } from '${editorPluginModuleName}';
// If your plugin needs a third-party package, install it from
// System Plugins -> Install Package..., then import it directly:
// import { nanoid } from 'nanoid';
import { createAboutMessage } from './about';

const plugin: EditorPluginDefinition = {
  activate(ctx) {
    ctx.registerMenuItems({
      location: 'main',
      parentId: 'project',
      items: [
        {
          id: 'example-editor-plugin.about',
          label: 'Example Plugin...',
          action: async () => {
            await ctx.ui.message('Example Plugin', createAboutMessage(), 480, 0);
          }
        }
      ]
    });
  }
};

export default plugin;
`
  },
  {
    path: 'about.ts',
    source: `export function createAboutMessage() {
  return [
    'This command is provided by a multi-file system plugin.',
    '',
    'Use this template as the starting point for splitting your plugin into modules.',
    '',
    'Third-party packages can be installed from the System Plugins dialog.'
  ].join('\\n');
}
`
  }
] as const;

/**
 * Generates the entry module of a build.
 *
 * @param physics - Load the physics engine before the startup scene; set when
 *   the project uses it (see projectUsesPhysics), so other builds do not ship it.
 */
export function generateIndexTS(settings: ProjectSettings, physics = false) {
  const rhiList =
    settings.preferredRHI?.map((val) => (val.toLowerCase() === 'webgl' ? 'webgl2' : val.toLowerCase())) ?? [];
  const splash = settings.defaultSplash !== false;
  const precompile = settings.precompilePipelines !== false;
  const startupScene = settings.startupScene ?? '';
  return `import { Application, getEngine, setActiveMorphTargetLimit, setMorphTargetLimit, setSkinInfluenceLimit${
    splash ? ', LoadingProgress' : ''
  } } from '@zephyr3d/scene';
import { FBXImporter, GLTFImporter, OBJImporter } from '@zephyr3d/loaders';
import type { DeviceBackend } from '@zephyr3d/device';
${physics ? `import { initPhysics } from '@zephyr3d/physics';\nimport { rapierPhysics } from '@zephyr3d/physics-rapier';\n` : ''}let backend: DeviceBackend = null;
${
  rhiList.includes('webgpu')
    ? `backend = backend || (await import('@zephyr3d/backend-webgpu')).backendWebGPU;
if (!(await backend.supported())) {
  backend = null;
}
`
    : ''
}
${
  rhiList.includes('webgl2')
    ? `backend = backend || (await import('@zephyr3d/backend-webgl')).backendWebGL2;
if (!(await backend.supported())) {
  backend = null;
}
`
    : ''
}
if (!backend) {
  throw new Error('No supported rendering device found');
}

const morphTargetLimit = ${settings.morphTargetLimit ?? 'undefined'};
const activeMorphTargetLimit =
  typeof ${settings.activeMorphTargetLimit ?? 'undefined'} === 'number'
    ? Math.min(${settings.activeMorphTargetLimit ?? 'undefined'}, morphTargetLimit ?? ${settings.activeMorphTargetLimit ?? 'undefined'})
    : undefined;
const skinInfluenceLimit = ${settings.skinInfluenceLimit ?? 'undefined'};

setMorphTargetLimit(morphTargetLimit);
setActiveMorphTargetLimit(activeMorphTargetLimit);
setSkinInfluenceLimit(skinInfluenceLimit);

const application = new Application({
  backend,
  canvas: document.querySelector('#canvas'),
  enableMSAA: ${settings.enableMSAA ? 'true' : 'false'},
  pixelRatio: ${(settings.renderScale ?? 0) <= 0 ? 'undefined' : settings.renderScale},
  runtimeOptions: {
    scriptsRoot: '/assets'
  }
});
application.ready().then(async () => {
  getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/fbx', new FBXImporter());
  getEngine().resourceManager.setModelLoader('model/obj', new OBJImporter());
  ${physics ? `// Before the startup scene, so it is simulated from its first frame\n  await initPhysics(rapierPhysics);\n  ` : ''}${
    splash
      ? `// The splash screen of index.html shows the loading until the startup scene is drawn
  const splashScreen = (window as any).${SPLASH_SCREEN_GLOBAL};
  const splash = splashScreen ? new LoadingProgress(splashScreen) : null;
  `
      : ''
  }const loading: Promise<unknown>[] = [];
  ${
    startupScene
      ? `// Asked alongside the pipeline manifest; a project may be published without the list
  const preloadList = ${JSON.stringify(`${startupScene}.zpreload`)};
  const hasPreloadList = getEngine().VFS.exists(preloadList);
  `
      : ''
  }${
    precompile
      ? `// Recorded pipelines are compiled before the draws that need them, so they do not stall
  const pipelineManifest = await getEngine().pipelineCache.loadManifest();
  if (pipelineManifest) {
    const cache = getEngine().pipelineCache;
    const pipelines = cache.createTask(cache.findEntries(pipelineManifest, { scenes: ${JSON.stringify(
      startupScene ? [startupScene] : []
    )} }));
    ${splash ? 'splash?.trackPipelines(pipelines, 1);\n    ' : ''}loading.push(pipelines.run());
  }
  `
      : ''
  }${
    startupScene
      ? `// The assets the startup scene fetches, recorded by the editor, load first with a known total
  const assets = (await hasPreloadList) ? getEngine().assetPreloader.createTask([preloadList]) : null;
  if (assets) {
    ${splash ? 'splash?.trackPreload(assets, 2);\n    ' : ''}loading.push(assets.run());
  }
  `
      : ''
  }${
    splash
      ? `// Without the list, nothing tells how far loading the scene got: it takes no share of the bar
  const sceneStage = splash?.addStage('Loading scene', ${startupScene ? 'assets ? 1 : 0' : '0'});
  `
      : ''
  }await Promise.all(loading);
  application.run();
  await getEngine().startup(${JSON.stringify(startupScene)}, ${JSON.stringify(settings.startupScript ?? '')});
  ${startupScene ? 'assets?.release();\n  ' : ''}${
    splash
      ? `// Up until the startup scene is on screen: the first frame compiles the shaders not precompiled
  await application.nextFrame();
  sceneStage?.done();
  await splash?.finish();`
      : ''
  }${
    precompile && settings.precompileOtherScenes !== false
      ? `
  // The pipelines of the other scenes, without holding up the frames
  if (pipelineManifest) {
    void getEngine().pipelineCache.createTask(pipelineManifest.entries).run({ priority: 'background' });
  }`
      : ''
  }
});
`;
}

export const templateIndex = `import { Application, getEngine, setActiveMorphTargetLimit, setMorphTargetLimit, setSkinInfluenceLimit } from '@zephyr3d/scene';
import { HttpFS } from '@zephyr3d/base';
import { FBXImporter, GLTFImporter, OBJImporter } from '@zephyr3d/loaders';
import type { DeviceBackend } from '@zephyr3d/device';
const VFS = new HttpFS('./');
const settingsJson = await VFS.readFile('/${projectFileName}', { encoding: 'utf8' }) as string;
const settings = JSON.parse(settingsJson);
const renderScale = typeof settings.renderScale === 'number' && Number.isFinite(settings.renderScale) ? settings.renderScale : 1;
const rhiList = settings.preferredRHI?.map((val) => (val.toLowerCase() === 'webgl' ? 'webgl2' : val.toLowerCase())) ?? [];
let backend: DeviceBackend = null;
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
if (!backend) {
  throw new Error('No supported rendering device found');
}

const morphTargetLimit = typeof settings.morphTargetLimit === 'number' ? settings.morphTargetLimit : undefined;
const activeMorphTargetLimit =
  typeof settings.activeMorphTargetLimit === 'number'
    ? Math.min(settings.activeMorphTargetLimit, morphTargetLimit ?? settings.activeMorphTargetLimit)
    : undefined;
const skinInfluenceLimit = typeof settings.skinInfluenceLimit === 'number' ? settings.skinInfluenceLimit : undefined;

setMorphTargetLimit(morphTargetLimit);
setActiveMorphTargetLimit(activeMorphTargetLimit);
setSkinInfluenceLimit(skinInfluenceLimit);

const application = new Application({
  backend,
  canvas: document.querySelector('#canvas'),
  enableMSAA: !!settings.enableMSAA,
  pixelRatio: renderScale <= 0 ? undefined : renderScale,
  runtimeOptions: {
    VFS,
    scriptsRoot: '/assets'
  }
});
application.ready().then(async () => {
  getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/fbx', new FBXImporter());
  getEngine().resourceManager.setModelLoader('model/obj', new OBJImporter());
  application.run();
  await getEngine().startup(settings.startupScene ?? '', settings.startupScript);
  await application.nextFrame();
});
`;

/**
 * Generates the index.html of a build.
 *
 * With the splash screen on, the page carries the editor's splash screen, drawn by
 * the browser before any script loads, so downloading the engine modules and
 * creating the device show feedback instead of a blank page; index.js drives it
 * through its LoadingScreen to show the loading progress and hides it once the
 * startup scene is drawn. Errors thrown while starting show on it.
 */
export function generateIndexHTML(options: {
  title: string;
  /** Extra head markup, e.g. the favicon link */
  head: string;
  /** Whether to show the default splash screen */
  splash: boolean;
  /** CSS color of the splash screen */
  splashBackground: string;
}) {
  const splash = options.splash
    ? generateSplashScreenHTML(options.splashBackground)
    : { style: '', markup: '', script: '' };
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHTML(options.title)}</title>
    ${options.head}
    <style>
      * {
        margin: 0;
        padding: 0;
      }
      html,
      body {
        width: 100vw;
        height: 100vh;
        background: ${options.splash ? options.splashBackground : '#000000'};
      }
      canvas {
        display: block;
        touch-action: none;
        overscroll-behavior: contain;
        overflow: hidden;
        outline: none;
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
      }
      canvas:focus {
        outline: none;
      }
    </style>
    ${splash.style}
  </head>
  <body>
    <canvas id="canvas"></canvas>
    ${splash.markup}
    ${splash.script ? `<script>
      ${splash.script}
    </script>` : ''}
  </body>
</html>
`;
}
