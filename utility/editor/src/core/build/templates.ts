import type { ProjectSettings } from '../services/project';

export const projectFileName = 'project.json';
export const fileListFileName = 'filelist.json';
export const libDir = 'libs';
export const editorPluginModuleName = 'zephyr3d/editor-plugin';

export const templateScript = `import type { IDisposable } from '@zephyr3d/base';
import { RuntimeScript } from '@zephyr3d/scene';

// Change HostType to your attachment type
type HostType = IDisposable;

export default class extends RuntimeScript<HostType> {
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

export const editorPluginTypeDeclarations = `declare module '${editorPluginModuleName}' {
  export type DisposableLike = {
    dispose(): void;
  };

  export type EditorMenuLocation = 'main' | 'scene-hierarchy' | 'asset-content' | 'asset-directory';

  export type EditorMenuItem = {
    id?: string;
    label: string;
    shortCut?: string;
    visible?: (ctx: EditorMenuContext) => boolean;
    enabled?: (ctx: EditorMenuContext) => boolean;
    checked?: () => boolean;
    action?: () => void;
    subMenus?: EditorMenuItem[];
  };

  export type EditorMenuContribution = {
    location: EditorMenuLocation;
    parentId?: string;
    items: EditorMenuItem[] | ((ctx: EditorMenuContext) => EditorMenuItem[]);
  };

  export type EditorToolbarItem = {
    label?: string;
    shortcut?: string;
    tooltip?: () => string;
    visible?: () => boolean;
    selected?: () => boolean;
    render?: () => boolean;
    action?: () => void;
  };

  export type EditorToolbarContribution =
    | EditorToolbarItem
    | ((ctx: EditorToolbarContext) => EditorToolbarItem | null | undefined);

  export type EditorEditToolFactory = {
    id: string;
    canEdit: (obj: unknown, ctx: EditorEditToolFactoryContext) => boolean;
    create: (obj: unknown, ctx: EditorEditToolFactoryContext) => unknown | null;
    priority?: number;
  };

  export type EditorSceneContext = {
    editor: unknown;
    scene: unknown | null;
    selectedNodes: readonly unknown[];
    activeNode: unknown | null;
    commandManager: unknown;
    executeCommand<T>(command: unknown): Promise<T>;
    notifySceneChanged(): void;
    refreshProperties(): void;
    getCamera(): unknown | null;
    getViewportRect(): readonly [number, number, number, number] | null;
  };

  export type EditorAssetContext = {
    editor: unknown;
    vfs: unknown;
    selectedDir: { path: string } | null;
    selectedFiles: readonly { meta: { path: string; name?: string; size?: number } }[];
    selectedItems: readonly unknown[];
  };

  export type EditorMenuContext = {
    location: EditorMenuLocation;
    scene?: EditorSceneContext;
    assets?: EditorAssetContext;
    target?: unknown;
  };

  export type EditorToolbarContext = {
    scene: EditorSceneContext;
  };

  export type EditorEditToolFactoryContext = {
    editor: unknown;
    executeCommand<T>(command: unknown): Promise<T>;
    notifySceneChanged(): void;
    refreshProperties(): void;
    getCamera(): unknown | null;
    getViewportRect(): readonly [number, number, number, number] | null;
  };

  export type EditorEventMap = {
    sceneOpening: [path: string];
    sceneOpened: [scene: unknown, path: string];
    sceneCreated: [scene: unknown, path: string];
    sceneSaving: [scene: unknown, path: string];
    sceneSaved: [scene: unknown, path: string];
    sceneDirty: [scene: unknown];
    selectionChanged: [selectedNodes: readonly unknown[], activeNode: unknown | null];
    nodeAdded: [node: unknown];
    nodeRemoved: [node: unknown];
    nodeDeleted: [node: unknown];
    nodeTransformed: [node: unknown];
    propertyChanged: [target: object | null, prop: unknown];
    propertyEditFinished: [target: object | null, prop: unknown, oldValue: unknown, newValue: unknown];
    editToolActivated: [tool: unknown, target: unknown];
    editToolDeactivated: [tool: unknown, target: unknown];
    assetSelectionChanged: [ctx: EditorAssetContext];
  };

  export type EditorEventSource = {
    dispatchEvent<K extends keyof EditorEventMap>(type: K, ...args: EditorEventMap[K]): void;
  };

  export type EditorPluginContext = {
    editor: unknown;
    events: EditorEventSource;
    project: {
      getSettings(): Promise<Record<string, unknown> | null>;
      saveSettings(settings: Record<string, unknown>): Promise<void>;
    };
    system: {
      getState<T = unknown>(): Promise<T | null>;
      saveState<T = unknown>(state: T): Promise<void>;
    };
    ui: {
      message(title: string, message: string, width?: number, height?: number): Promise<void>;
    };
    registerMenuItems(contribution: EditorMenuContribution): () => void;
    registerToolbarItem(item: EditorToolbarContribution): () => void;
    registerEditTool(factory: EditorEditToolFactory): () => void;
    on<K extends keyof EditorEventMap>(
      type: K,
      listener: (...args: EditorEventMap[K]) => void,
      context?: unknown
    ): DisposableLike;
    subscriptions: DisposableLike[];
    log(...args: unknown[]): void;
  };

  export type EditorPlugin = {
    id: string;
    name?: string;
    version?: string;
    description?: string;
    activate: (ctx: EditorPluginContext) => void | Promise<void>;
    deactivate?: (ctx: EditorPluginContext) => void | Promise<void>;
  };
}
`;

export const templateEditorPlugin = `import type { EditorPlugin } from '${editorPluginModuleName}';

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

export function generateIndexTS(settings: ProjectSettings) {
  const rhiList = settings.preferredRHI?.map((val) => val.toLowerCase()) ?? [];
  return `import { Application, getEngine } from '@zephyr3d/scene';
import { HttpFS } from '@zephyr3d/base';
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
  getEngine().startup('${settings.startupScene ?? ''}', '${settings.splashScreen ?? ''}', '${settings.startupScript ?? ''}');
  application.run();
});
`;
}

export const templateIndex = `import { Application, getEngine } from '@zephyr3d/scene';
import { HttpFS } from '@zephyr3d/base';
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
  getEngine().startup(settings.startupScene ?? '', settings.splashScreen, settings.startupScript);
  application.run();
});
`;

export const templateIndexHTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>%s</title>
    %s
    <style>
      * {
        margin: 0;
        padding: 0;
      }
      html,
      body {
        width: 100vw;
        height: 100vh;
      }
      canvas {
        touch-action: none;
        overscroll-behavior: contain;
        overflow: hidden;
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
  </body>
</html>
`;
