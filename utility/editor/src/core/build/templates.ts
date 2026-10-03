import type { ProjectSettings } from '../services/project';

export const projectFileName = 'project.json';
export const fileListFileName = 'filelist.json';
export const libDir = 'libs';
export const editorPluginModuleName = '@zephyr3d/editor/editor-plugin';

/** Loading screen of a build's index.html */
export const DEFAULT_SPLASH_BACKGROUND = '#000000';
const SPLASH_ELEMENT_ID = 'zephyr-splash';
const SPLASH_HIDDEN_CLASS = 'zephyr-splash-hidden';

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

export function generateIndexTS(settings: ProjectSettings) {
  const rhiList = settings.preferredRHI?.map((val) => val.toLowerCase()) ?? [];
  return `import { Application, getEngine, setActiveMorphTargetLimit, setMorphTargetLimit, setSkinInfluenceLimit } from '@zephyr3d/scene';
import { HttpFS } from '@zephyr3d/base';
import { FBXImporter, GLTFImporter, OBJImporter } from '@zephyr3d/loaders';
import type { DeviceBackend } from '@zephyr3d/device';
let backend: DeviceBackend = null;
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
${
  rhiList.includes('webgl')
    ? `backend = backend || (await import('@zephyr3d/backend-webgl')).backendWebGL1;
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
  application.run();
  await getEngine().startup(${JSON.stringify(settings.startupScene ?? '')}, ${JSON.stringify(settings.startupScript ?? '')});
  // Keep the loading screen of index.html until the startup scene is on screen
  await application.nextFrame();
  ${splashHideCode}
});
`;
}

/** Fades out and removes the loading screen of index.html */
const splashHideCode = `const splash = document.getElementById('${SPLASH_ELEMENT_ID}');
  if (splash) {
    splash.classList.add('${SPLASH_HIDDEN_CLASS}');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 1000);
  }`;

export const templateIndex = `import { Application, getEngine, setActiveMorphTargetLimit, setMorphTargetLimit, setSkinInfluenceLimit } from '@zephyr3d/scene';
import { HttpFS } from '@zephyr3d/base';
import { FBXImporter, GLTFImporter, OBJImporter } from '@zephyr3d/loaders';
import type { DeviceBackend } from '@zephyr3d/device';
const VFS = new HttpFS('./');
const settingsJson = await VFS.readFile('/${projectFileName}', { encoding: 'utf8' }) as string;
const settings = JSON.parse(settingsJson);
const renderScale = typeof settings.renderScale === 'number' && Number.isFinite(settings.renderScale) ? settings.renderScale : 1;
const rhiList = settings.preferredRHI?.map((val) => val.toLowerCase()) ?? [];
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
if (!backend && rhiList.includes('webgl')) {
  backend = (await import('@zephyr3d/backend-webgl')).backendWebGL1;
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
  ${splashHideCode}
});
`;

/**
 * Generates the index.html of a build.
 *
 * The page carries a loading screen (#zephyr-splash) drawn by the browser before
 * any script loads, so downloading the engine modules and creating the device show
 * feedback instead of a blank page; index.js removes it once the startup scene is
 * drawn. Errors thrown while starting replace its spinner with the error message.
 */
export function generateIndexHTML(options: {
  title: string;
  /** Extra head markup, e.g. the favicon link */
  head: string;
  /** Page-relative URL of the splash image, empty for none */
  splashImage: string;
  /** CSS color of the loading screen */
  splashBackground: string;
}) {
  const [r, g, b] = cssColorToRGB(options.splashBackground);
  const lightBackground = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
  const foreground = lightBackground ? '#202020' : '#e0e0e0';
  const image = options.splashImage ? `<img src="${escapeHTML(options.splashImage)}" alt="" />` : '';
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
        background: ${rgbToCSSColor([r, g, b])};
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
      #${SPLASH_ELEMENT_ID} {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 24px;
        background: ${rgbToCSSColor([r, g, b])};
        color: ${foreground};
        font: 14px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        transition: opacity 0.3s ease;
      }
      #${SPLASH_ELEMENT_ID}.${SPLASH_HIDDEN_CLASS} {
        opacity: 0;
        pointer-events: none;
      }
      #${SPLASH_ELEMENT_ID} img {
        max-width: 60vw;
        max-height: 50vh;
        object-fit: contain;
      }
      #${SPLASH_ELEMENT_ID}-spinner {
        width: 28px;
        height: 28px;
        box-sizing: border-box;
        border: 3px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        opacity: 0.6;
        animation: ${SPLASH_ELEMENT_ID}-spin 0.9s linear infinite;
      }
      #${SPLASH_ELEMENT_ID}-message {
        max-width: 80vw;
        text-align: center;
        white-space: pre-wrap;
      }
      @keyframes ${SPLASH_ELEMENT_ID}-spin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    <div id="${SPLASH_ELEMENT_ID}" role="status" aria-live="polite">
      ${image}
      <div id="${SPLASH_ELEMENT_ID}-spinner"></div>
      <div id="${SPLASH_ELEMENT_ID}-message"></div>
    </div>
    <script>
      // Failures while starting (module loading, no supported device, startup
      // scene or script) leave the loading screen up showing the error.
      const showStartupError = (message) => {
        const splash = document.getElementById('${SPLASH_ELEMENT_ID}');
        if (splash) {
          splash.classList.remove('${SPLASH_HIDDEN_CLASS}');
          splash.setAttribute('role', 'alert');
          document.getElementById('${SPLASH_ELEMENT_ID}-spinner')?.remove();
          document.getElementById('${SPLASH_ELEMENT_ID}-message').textContent = \`Startup failed: \${message}\`;
        }
      };
      window.addEventListener('error', (event) => {
        if (event.message) {
          showStartupError(event.message);
        }
      });
      window.addEventListener('unhandledrejection', (event) => {
        showStartupError(event.reason?.message || String(event.reason || 'Unhandled promise rejection'));
      });
    </script>
  </body>
</html>
`;
}
