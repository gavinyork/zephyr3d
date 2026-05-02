import type { Editor } from '../core/editor';
import { Scene } from '@zephyr3d/scene';
import { getDevice, getEngine, OrthoCamera, PerspectiveCamera } from '@zephyr3d/scene';
import { BlobReader, BlobWriter, configure, ZipWriter } from '@zip.js/zip.js';
import { PathUtils, Quaternion, Vector3 } from '@zephyr3d/base';
import { ProjectService } from '../core/services/project';
import { fileListFileName, libDir } from '../core/build/templates';
import { SceneController } from '../controllers/scenecontroller';
import { AddShapeCommand } from '../commands/scenecommands';
import { eventBus } from '../core/eventbus';
import { shapePrimitivePaths, type ShapePrimitiveType } from './shapeprimitives';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type TreeData = { files: { name: string; size: number }[]; subDirs: { [name: string]: TreeData } };
type NodeClass =
  | 'SceneNode'
  | 'Mesh'
  | 'Water'
  | 'BatchGroup'
  | 'ClipmapTerrain'
  | 'Camera'
  | 'PerspectiveCamera'
  | 'OrthoCamera'
  | 'DirectionalLight'
  | 'PointLight'
  | 'SpotLight'
  | 'RectLight'
  | 'ParticleSystem'
  | 'Sprite';

interface BridgeRequest {
  id: number | string;
  method: string;
  params?: any;
}

interface ConsoleEntry {
  level: string;
  message: string;
  time: number;
}

const MAX_LOGS = 400;
const MAX_SERIALIZE_DEPTH = 5;
const DEFAULT_MCP_PORT = '47231';
const SCREENSHOT_TIMEOUT_MS = 10000;

let consoleInstalled = false;
const consoleEntries: ConsoleEntry[] = [];

function installConsoleCapture(): void {
  if (consoleInstalled) {
    return;
  }
  consoleInstalled = true;
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: any[]) => {
      consoleEntries.push({
        level,
        message: args.map((arg) => formatValue(arg)).join(' '),
        time: Date.now()
      });
      if (consoleEntries.length > MAX_LOGS) {
        consoleEntries.splice(0, consoleEntries.length - MAX_LOGS);
      }
      original(...args);
    };
  }
}

function formatValue(value: any): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(toJson(value, 2));
  } catch {
    return String(value);
  }
}

function toJson(value: any, depth = MAX_SERIALIZE_DEPTH, seen = new WeakSet<object>()): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  const t = typeof value;
  if (t === 'string' || t === 'boolean') {
    return value;
  }
  if (t === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (t === 'bigint') {
    return value.toString();
  }
  if (t === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }
  if (depth <= 0) {
    return `[${value?.constructor?.name ?? 'Object'}]`;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, 100).map((item) => toJson(item, depth - 1, seen));
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack ?? null
      };
    }
    if (value instanceof ArrayBuffer) {
      return { type: 'ArrayBuffer', byteLength: value.byteLength };
    }
    if (ArrayBuffer.isView(value)) {
      const values =
        typeof (value as { length?: number }).length === 'number'
          ? Array.from(value as unknown as ArrayLike<unknown>)
              .slice(0, 64)
              .map((item) => toJson(item, 0))
          : [];
      return {
        type: value.constructor.name,
        byteLength: value.byteLength,
        values
      };
    }
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).slice(0, 100)) {
      if (key.startsWith('_')) {
        continue;
      }
      try {
        out[key] = toJson(value[key], depth - 1, seen);
      } catch (err) {
        out[key] = `[Unserializable: ${err instanceof Error ? err.message : String(err)}]`;
      }
    }
    return out;
  }
  return String(value);
}

function getCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (!canvas) {
    throw new Error('Editor canvas was not found');
  }
  return canvas;
}

function getSceneController(editor: Editor) {
  let controller = editor.moduleManager.currentModule?.controller ?? null;
  if (!(controller instanceof SceneController)) {
    controller = null;
  }
  return controller as SceneController;
}

function getScene(editor: Editor): Scene {
  return getSceneController(editor)?.model?.scene ?? null;
}

function getCurrentScenePath(editor: Editor): string {
  return getSceneController(editor)?.scenePath ?? '';
}

async function prepareProjectChange(editor: Editor, params: any): Promise<string | null> {
  const controller = getSceneController(editor);
  if (!controller?.sceneChanged) {
    return null;
  }
  if (params?.saveSceneChanges) {
    const scenePath = getCurrentScenePath(editor);
    if (!scenePath) {
      return 'Current scene has unsaved changes and no path; cannot save without prompting';
    }
    await controller.saveScene?.();
    return controller.sceneChanged ? 'Current scene could not be saved' : null;
  }
  if (params?.discardSceneChanges) {
    controller.discardSceneChanges();
    return null;
  }
  return 'Current scene has unsaved changes; pass saveSceneChanges or discardSceneChanges';
}

async function closeCurrentProject(editor: Editor, params: any): Promise<string | null> {
  const err = await prepareProjectChange(editor, params);
  if (err) {
    return err;
  }
  return await editor.closeProject(getCurrentScenePath(editor));
}

async function exportCurrentProjectToMemory(editor: Editor): Promise<{
  err: string | null;
  filename?: string;
  bytes?: number;
}> {
  if (!editor.currentProject) {
    return { err: 'No project opened' };
  }
  const treeData: TreeData = {
    files: [],
    subDirs: {}
  };
  function addDirectory(path: string): TreeData {
    const entries = path.split('/').filter((val) => !!val);
    let data = treeData;
    while (entries.length > 0) {
      const name = entries.shift()!;
      let subdir = data.subDirs[name];
      if (!subdir) {
        subdir = { files: [], subDirs: {} };
        data.subDirs[name] = subdir;
      }
      data = subdir;
    }
    return data;
  }
  function addFile(path: string, size: number) {
    const dir = PathUtils.dirname(path);
    const name = PathUtils.basename(path);
    const data = addDirectory(dir);
    data.files.push({ name, size });
  }

  configure({ useWebWorkers: false });
  const zipWriter = new ZipWriter(new BlobWriter());
  const fileList = await ProjectService.VFS.glob('/**/*', {
    includeHidden: true,
    includeDirs: true,
    includeFiles: true,
    recursive: true
  });
  const files = fileList.filter(
    (path) =>
      path.type === 'file' &&
      !path.path.startsWith('/dist/') &&
      !path.path.startsWith('/assets/@builtins/') &&
      !path.path.startsWith(`/${libDir}/`) &&
      path.path !== `/${fileListFileName}`
  );
  let directories = fileList.filter(
    (path) =>
      path.type === 'directory' &&
      path.path !== '/dist' &&
      path.path !== '/assets/@builtins' &&
      path.path !== `/${libDir}` &&
      !path.path.startsWith('/dist/') &&
      !path.path.startsWith('/assets/@builtins/') &&
      !path.path.startsWith(`/${libDir}/`)
  );
  for (const file of files) {
    const content = (await ProjectService.VFS.readFile(file.path, { encoding: 'binary' })) as ArrayBuffer;
    const path = ProjectService.VFS.relative(file.path, '/');
    await zipWriter.add(path, new BlobReader(new Blob([content])));
    directories = directories.filter((dir) => !file.path.startsWith(`${dir.path}/`));
    addFile(file.path, file.size);
  }
  for (const dir of directories) {
    await zipWriter.add(`${ProjectService.VFS.relative(dir.path, '/')}/`);
    addDirectory(dir.path);
  }
  await zipWriter.add(fileListFileName, new BlobReader(new Blob([JSON.stringify(treeData, null, 2)])));
  const blob = await zipWriter.close();
  return {
    err: null,
    filename: `${editor.currentProject.name}.zip`,
    bytes: blob.size
  };
}

function getSceneStats(scene: any): JsonValue {
  if (!scene) {
    return null;
  }
  let nodeCount = 0;
  let drawableCount = 0;
  let lightCount = 0;
  try {
    scene.rootNode?.traverse?.({
      visit(target: any) {
        nodeCount++;
        if (target?.isDrawable?.()) {
          drawableCount++;
        }
        if (target?.isPunctualLight?.()) {
          lightCount++;
        }
        return true;
      }
    });
  } catch {
    // Traversal is best-effort; tests can still use eval for detailed checks.
  }
  return {
    nodeCount,
    drawableCount,
    lightCount,
    hasMainCamera: !!scene.mainCamera,
    envLightType: scene.env?.light?.type ?? null
  };
}

function parseNumberArray(
  value: unknown,
  name: string,
  length: number,
  defaultValue?: number[]
): { value: number[] | null; err: string | null } {
  if (value === undefined) {
    return {
      value: defaultValue ? [...defaultValue] : null,
      err: defaultValue ? null : `\`${name}\` parameter is required`
    };
  }
  if (!Array.isArray(value) || value.length !== length || value.some((val) => typeof val !== 'number')) {
    return {
      value: null,
      err: `\`${name}\` parameter can only be an array of numbers which has exactly ${length} elements, or undefined`
    };
  }
  return {
    value: value as number[],
    err: null
  };
}

export function installEditorMCPBridge(editor: Editor): void {
  const url = new URL(window.location.href);
  const mcpEnabled = url.searchParams.has('mcp') || url.searchParams.has('mcpPort');

  let ws: WebSocket | null = null;
  let reconnectTimer = 0;
  let closed = false;

  (window as any).__zephyrEditor = editor;
  (window as any).__zephyrEditorMCP = {
    get editor() {
      return editor;
    },
    get scene() {
      return getScene(editor);
    },
    get controller() {
      return getSceneController(editor);
    }
  };

  if (!mcpEnabled) {
    return;
  }

  const port = url.searchParams.get('mcp') || url.searchParams.get('mcpPort') || DEFAULT_MCP_PORT;
  const token = url.searchParams.get('mcpToken') ?? '';
  installConsoleCapture();

  const connect = () => {
    if (closed) {
      return;
    }
    ws = new WebSocket(`ws://127.0.0.1:${port}/editor-mcp`);
    ws.addEventListener('open', () => {
      ws?.send(
        JSON.stringify({
          type: 'hello',
          token,
          href: window.location.href,
          userAgent: navigator.userAgent
        })
      );
    });
    ws.addEventListener('message', (event) => {
      void handleMessage(editor, ws!, event.data);
    });
    ws.addEventListener('close', () => {
      ws = null;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(connect, 1000);
    });
  };

  window.addEventListener('beforeunload', () => {
    closed = true;
    ws?.close();
  });

  connect();
}

async function handleMessage(editor: Editor, ws: WebSocket, data: any): Promise<void> {
  let req: BridgeRequest;
  try {
    req = JSON.parse(String(data));
  } catch (err) {
    console.error('Invalid MCP bridge message', err);
    return;
  }
  try {
    const result = await dispatch(editor, req.method, req.params ?? {});
    ws.send(JSON.stringify({ id: req.id, result: toJson(result) }));
  } catch (err) {
    ws.send(
      JSON.stringify({
        id: req.id,
        error: {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
        }
      })
    );
  }
}

async function dispatch(editor: Editor, method: string, params: any): Promise<any> {
  switch (method) {
    case 'status':
      return getStatus(editor);
    case 'activateScene': {
      await editor.moduleManager.activate('Scene', params?.scenePath ?? '');
      return getStatus(editor);
    }
    case 'getScenePropertyList': {
      const props = getEngine().resourceManager.getPropertiesByClass(
        getEngine().resourceManager.getClassByConstructor(Scene)
      );
      return {
        propertyList: JSON.parse(JSON.stringify(props)),
        err: null
      };
    }
    case 'getNodePropertyList': {
      const id = params.id as string;
      if (!id) {
        return {
          propertyList: null,
          err: 'getNodePropertyList requires the node id'
        };
      }
      const scene = getScene(editor);
      if (!scene) {
        return {
          propertyList: null,
          err: 'No scene is currently opened'
        };
      }
      const node = scene.findNodeById(params.id);
      if (!node) {
        return {
          propertyList: null,
          err: `Node not found in scene node tree: ${params.id}`
        };
      }
      const cls = getEngine().resourceManager.getClassByObject(node);
      if (!cls) {
        return {
          propertyList: [],
          err: null
        };
      }
      return {
        propertyList: JSON.parse(JSON.stringify(getEngine().resourceManager.getPropertiesByClass(cls))),
        err: null
      };
    }
    // project related tools
    case 'getProjectList': {
      try {
        const list = await ProjectService.listProjects();
        return {
          projects: list.map((val) => ({ name: val.name, id: val.uuid })),
          err: null
        };
      } catch (err) {
        return {
          projects: null,
          err: `${err}`
        };
      }
    }
    case 'getCurrentProject': {
      return new Promise<{
        projectInfo: {
          name: string;
          id: string;
        };
        err: string;
      }>((resolve) => {
        ProjectService.getCurrentProjectInfo()
          .then((info) => {
            if (info) {
              resolve({
                projectInfo: {
                  name: info.name,
                  id: info.uuid
                },
                err: null
              });
            } else {
              resolve({
                projectInfo: null,
                err: 'No project opened'
              });
            }
          })
          .catch((err) => {
            resolve({
              projectInfo: null,
              err: `${err}`
            });
          });
      });
    }
    case 'createProject': {
      try {
        const name = params?.name as string;
        if (!name) {
          return {
            id: null,
            err: 'Project name is required to create'
          };
        }
        if (editor.currentProject) {
          const err = await closeCurrentProject(editor, params);
          if (err) {
            return { id: null, err };
          }
        }
        const id = await editor.newProject(name);
        return id ? { id, err: null } : { id: null, err: 'Project was not created' };
      } catch (err) {
        return {
          id: null,
          err: `${err}`
        };
      }
    }
    case 'openProject': {
      try {
        const id = params?.id as string;
        if (!id) {
          return {
            id: null,
            err: 'Project id is required to open'
          };
        }
        if (editor.currentProject) {
          const err = await closeCurrentProject(editor, params);
          if (err) {
            return { id: null, err };
          }
        }
        return await editor.openProject(id);
      } catch (err) {
        return {
          id: null,
          err: `${err}`
        };
      }
    }
    case 'closeProject': {
      try {
        return { err: await closeCurrentProject(editor, params) };
      } catch (err) {
        return {
          err: `${err}`
        };
      }
    }
    case 'exportProject': {
      try {
        const err = await prepareProjectChange(editor, params);
        if (err) {
          return { err };
        }
        return await exportCurrentProjectToMemory(editor);
      } catch (err) {
        return {
          err: `${err}`
        };
      }
    }
    case 'deleteProject': {
      try {
        if (!editor.currentProject) {
          return { err: 'No project opened' };
        }
        const id = editor.currentProject.uuid;
        const closeErr = await closeCurrentProject(editor, params);
        if (closeErr) {
          return { err: closeErr };
        }
        await editor.deleteProject(id);
        return { err: null };
      } catch (err) {
        return {
          err: `${err}`
        };
      }
    }
    case 'getNodeClasses': {
      const classes: NodeClass[] = [
        'SceneNode',
        'Mesh',
        'Water',
        'BatchGroup',
        'ClipmapTerrain',
        'Camera',
        'PerspectiveCamera',
        'OrthoCamera',
        'DirectionalLight',
        'PointLight',
        'SpotLight',
        'RectLight',
        'ParticleSystem',
        'Sprite'
      ];
      return classes;
    }
    case 'createShapeNode': {
      const controller = getSceneController(editor);
      const scene = controller?.model?.scene ?? null;
      if (!controller || !scene) {
        return {
          node: null,
          transform: null,
          err: 'No scene is currently opened'
        };
      }
      const shape = String(params.shape ?? '')
        .trim()
        .toLowerCase() as ShapePrimitiveType;
      if (!Object.prototype.hasOwnProperty.call(shapePrimitivePaths, shape)) {
        return {
          node: null,
          transform: null,
          err: `Unsupported shape type: ${params.shape}`
        };
      }
      const parentId = typeof params.parentId === 'string' ? params.parentId.trim() : '';
      const parentNode = parentId ? scene.findNodeById(parentId) : scene.rootNode;
      if (!parentNode) {
        return {
          node: null,
          transform: null,
          err: `Parent node not found in scene node tree: ${parentId}`
        };
      }
      const position = parseNumberArray(params.position, 'position', 3, [0, 0, 0]);
      if (position.err) {
        return {
          node: null,
          transform: null,
          err: position.err
        };
      }
      const scale = parseNumberArray(params.scale, 'scale', 3, [1, 1, 1]);
      if (scale.err) {
        return {
          node: null,
          transform: null,
          err: scale.err
        };
      }
      const rotation = parseNumberArray(params.rotation, 'rotation', 4, [0, 0, 0, 1]);
      if (rotation.err) {
        return {
          node: null,
          transform: null,
          err: rotation.err
        };
      }
      const name = typeof params.name === 'string' ? params.name.trim() : '';
      const node = await controller.view.cmdManager.execute(
        new AddShapeCommand(
          scene,
          shapePrimitivePaths[shape],
          new Vector3(position.value![0], position.value![1], position.value![2]),
          parentNode,
          name,
          new Vector3(scale.value![0], scale.value![1], scale.value![2]),
          new Quaternion(rotation.value![0], rotation.value![1], rotation.value![2], rotation.value![3])
        )
      );
      if (!node) {
        return {
          node: null,
          transform: null,
          err: `Failed to create shape node: ${shape}`
        };
      }
      eventBus.dispatchEvent('scene_changed');
      return {
        node: {
          id: node.persistentId,
          name: node.name,
          nodeClass: 'Mesh'
        },
        transform: {
          position: [node.position.x, node.position.y, node.position.z],
          scale: [node.scale.x, node.scale.y, node.scale.z],
          rotation: [node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.w]
        },
        err: null
      };
    }
    case 'getNodeClass': {
      const id = params.id as string;
      if (!id) {
        return {
          nodeClass: null,
          err: 'getNodeClass requires the node id'
        };
      }
      const scene = getScene(editor);
      if (!scene) {
        return {
          nodeClass: null,
          err: 'No scene is currently opened'
        };
      }
      const node = scene.findNodeById(params.id);
      if (!node) {
        return {
          nodeClass: null,
          err: `Node not found in scene node tree: ${params.id}`
        };
      }
      const cls: NodeClass = node.isMesh()
        ? 'Mesh'
        : node.isBatchGroup()
          ? 'BatchGroup'
          : node.isClipmapTerrain()
            ? 'ClipmapTerrain'
            : node.isLight() && node.isDirectionLight()
              ? 'DirectionalLight'
              : node.isLight() && node.isPointLight()
                ? 'PointLight'
                : node.isLight() && node.isSpotLight()
                  ? 'SpotLight'
                  : node.isLight() && node.isRectLight()
                    ? 'RectLight'
                    : node.isMesh()
                      ? 'Mesh'
                      : node.isParticleSystem()
                        ? 'ParticleSystem'
                        : node.isWater()
                          ? 'Water'
                          : node instanceof PerspectiveCamera
                            ? 'PerspectiveCamera'
                            : node instanceof OrthoCamera
                              ? 'OrthoCamera'
                              : node.isCamera()
                                ? 'Camera'
                                : 'SceneNode';
      return {
        nodeClass: cls,
        err: null
      };
    }
    case 'setNodeLocalTransform': {
      const id = params.id as string;
      if (!id) {
        return {
          transform: null,
          err: 'setNodeLocalTransform requires the node id'
        };
      }
      const scene = getScene(editor);
      if (!scene) {
        return {
          transform: null,
          err: 'No scene is currently opened'
        };
      }
      const node = scene.findNodeById(params.id);
      if (!node) {
        return {
          transform: null,
          err: `Node not found in scene node tree: ${params.id}`
        };
      }
      if (params.position) {
        if (
          !Array.isArray(params.position) ||
          params.position.length !== 3 ||
          params.position.some((val) => typeof val !== 'number')
        ) {
          return {
            transform: null,
            err: '`position` parameter can only be an array of numbers which has exactly 3 elements, or undefined'
          };
        }
      }
      if (params.scale) {
        if (
          !Array.isArray(params.scale) ||
          params.scale.length !== 3 ||
          params.scale.some((val) => typeof val !== 'number')
        ) {
          return {
            transform: null,
            err: '`scale` parameter can only be an array of numbers which has exactly 3 elements, or undefined'
          };
        }
      }
      if (params.rotation) {
        if (
          !Array.isArray(params.rotation) ||
          params.rotation.length !== 4 ||
          params.rotation.some((val) => typeof val !== 'number')
        ) {
          return {
            transform: null,
            err: '`rotation` parameter can only be an array of numbers which has exactly 4 elements, or undefined'
          };
        }
      }
      if (params.position) {
        node.position.setXYZ(params.position[0], params.position[1], params.position[2]);
      }
      if (params.scale) {
        node.scale.setXYZ(params.scale[0], params.scale[1], params.scale[2]);
      }
      if (params.rotation) {
        node.rotation.setXYZW(params.rotation[0], params.rotation[1], params.rotation[2], params.rotation[3]);
      }
      return {
        transform: {
          position: [node.position.x, node.position.y, node.position.z],
          scale: [node.scale.x, node.scale.y, node.scale.z],
          rotation: [node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.w]
        },
        err: null
      };
    }
    case 'getNodeLocalTransform': {
      const id = params.id as string;
      if (!id) {
        return {
          transform: null,
          err: 'getNodeLocalTransform requires the node id'
        };
      }
      const scene = getScene(editor);
      if (!scene) {
        return {
          transform: null,
          err: 'No scene is currently opened'
        };
      }
      const node = scene.findNodeById(params.id);
      if (!node) {
        return {
          transform: null,
          err: `Node not found in scene node tree: ${params.id}`
        };
      }
      return {
        transform: {
          position: [node.position.x, node.position.y, node.position.z],
          scale: [node.scale.x, node.scale.y, node.scale.z],
          rotation: [node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.w]
        },
        err: null
      };
    }
    case 'getSceneRootNode': {
      const project = await ProjectService.getCurrentProjectInfo();
      if (!project) {
        return {
          node: null,
          err: 'No project currently opened'
        };
      }
      const scene = getScene(editor);
      if (!scene) {
        return {
          node: null,
          err: 'Unknown error: Cannot get current scene'
        };
      }
      return {
        node: {
          id: scene.rootNode.persistentId,
          name: scene.rootNode.name
        },
        err: null
      };
    }
    case 'getParentNode': {
      const id = params.id as string;
      if (!id) {
        return {
          parentNode: null,
          err: 'getParentNode requires the node id'
        };
      }
      const scene = getScene(editor);
      if (!scene) {
        return {
          parentNode: null,
          err: 'No scene is currently opened'
        };
      }
      const node = scene.findNodeById(params.id);
      if (!node) {
        return {
          parentNode: null,
          err: `Node not found in scene node tree: ${params.id}`
        };
      }
      return {
        parentNode: node.parent?.persistentId ?? null,
        err: null
      };
    }
    case 'removeNode': {
      const id = params.id as string;
      if (!id) {
        return {
          err: 'removeNode requires the node id'
        };
      }
      const scene = getScene(editor);
      if (!scene) {
        return {
          err: 'No scene is currently opened'
        };
      }
      const node = scene.findNodeById(params.id);
      if (!node) {
        return {
          err: `Node not found in scene node tree: ${params.id}`
        };
      }
      node.remove();
      return {
        err: null
      };
    }
    case 'setParentNode': {
      const id = params.id as string;
      if (!id) {
        return {
          err: 'setParentNode requires the node id'
        };
      }
      const newParentId = params.parentId as string;
      if (!newParentId) {
        return {
          err: 'setParentNode requires the new parent id'
        };
      }
      const scene = getScene(editor);
      if (!scene) {
        return {
          err: 'No scene is currently opened'
        };
      }
      const node = scene.findNodeById(params.id);
      if (!node) {
        return {
          err: `Node not found in scene node tree: ${params.id}`
        };
      }
      const newParentNode = scene.findNodeById(params.parentId);
      if (!newParentNode) {
        return {
          err: `New parent node not found in scene node tree: ${params.parentId}`
        };
      }
      if (node.isParentOf(newParentNode)) {
        return {
          err: `Cannot set this node as parent: ${params.parentId}`
        };
      }
      node.parent = newParentNode;
      return {
        err: null
      };
    }
    case 'getSubNodes': {
      const parent = params.parent as string;
      if (!parent) {
        return {
          subNodes: null,
          err: 'getSubNodes requires the parent node id'
        };
      }
      const scene = getScene(editor);
      if (!scene) {
        return {
          subNodes: null,
          err: 'No scene is currently opened'
        };
      }
      const parentNode = scene.findNodeById(params.parent);
      if (!parentNode) {
        return {
          subNodes: null,
          err: `Parent node not found in scene node tree: ${params.parent}`
        };
      }
      return {
        subNodes: parentNode.children.map((child) => ({ id: child.persistentId, name: child.name })),
        err: null
      };
    }
    case 'createScene': {
      if (!editor.currentProject) {
        return {
          ...getStatus(editor),
          err: 'No project currently opened'
        };
      }
      const controller = getSceneController(editor);
      if (!controller?.createScene) {
        await editor.moduleManager.activate('Scene', '');
      }
      getSceneController(editor)?.createScene?.(params?.resetView ?? true, params?.path);
      return getStatus(editor);
    }
    case 'openScene': {
      const controller = getSceneController(editor);
      if (!controller?.openScene) {
        await editor.moduleManager.activate('Scene', '');
      }
      await getSceneController(editor)?.openScene(params.path, params?.resetView ?? true);
      return getStatus(editor);
    }
    case 'renderFrames': {
      const frames = Math.max(1, Math.min(Number(params?.frames ?? 1), 120));
      for (let i = 0; i < frames; i++) {
        editor.update(16.6667);
        editor.render();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return getStatus(editor);
    }
    case 'screenshot': {
      const canvas = getCanvas();
      return {
        width: canvas.width,
        height: canvas.height,
        dataUrl: await canvasToDataUrl(canvas, params?.mimeType ?? 'image/png', params?.quality)
      };
    }
    case 'samplePixels':
      return samplePixels(params);
    case 'consoleLogs': {
      const limit = Math.max(1, Math.min(Number(params?.limit ?? 100), MAX_LOGS));
      return consoleEntries.slice(-limit);
    }
    case 'eval':
      return runEval(editor, params?.script ?? params?.expression ?? '', !!params?.expression);
    default:
      throw new Error(`Unknown editor bridge method: ${method}`);
  }
}

async function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('Canvas screenshot timed out')),
      SCREENSHOT_TIMEOUT_MS
    );
    canvas.toBlob(
      (value) => {
        window.clearTimeout(timer);
        if (value) {
          resolve(value);
        } else {
          reject(new Error('Canvas screenshot failed'));
        }
      },
      mimeType,
      typeof quality === 'number' ? quality : undefined
    );
  });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Failed to read screenshot blob'))
    );
    reader.readAsDataURL(blob);
  });
}

function getStatus(editor: Editor) {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  const module = editor.moduleManager.currentModule;
  const scene = getScene(editor);
  const device = getDevice();
  return {
    ready: true,
    href: window.location.href,
    title: document.title,
    project: editor.currentProject
      ? {
          uuid: editor.currentProject.uuid,
          name: editor.currentProject.name,
          lastEditScene: editor.currentProject.lastEditScene ?? null
        }
      : null,
    currentModule: module?.name ?? null,
    sceneChanged: editor.sceneChanged,
    scene: getSceneStats(scene),
    canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
    device: {
      type: device.type,
      drawingBufferWidth: device.getDrawingBufferWidth(),
      drawingBufferHeight: device.getDrawingBufferHeight(),
      frameCounter: device.frameInfo.frameCounter
    }
  };
}

function samplePixels(params: any): JsonValue {
  const canvas = getCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable; pixel sampling cannot read this canvas');
  }
  const points = Array.isArray(params?.points)
    ? params.points
    : [{ x: canvas.width >> 1, y: canvas.height >> 1 }];
  return points.slice(0, 64).map((point: any) => {
    const x = Math.max(0, Math.min(canvas.width - 1, Number(point.x) || 0));
    const y = Math.max(0, Math.min(canvas.height - 1, Number(point.y) || 0));
    const data = ctx.getImageData(x, y, 1, 1).data;
    return { x, y, rgba: [data[0], data[1], data[2], data[3]] };
  });
}

async function runEval(editor: Editor, source: string, expression: boolean): Promise<any> {
  if (!source || typeof source !== 'string') {
    throw new Error('eval requires a non-empty script');
  }
  const controller = getSceneController(editor);
  const scene = getScene(editor);
  const body = expression ? `return (${source});` : source;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('editor', 'controller', 'scene', 'getDevice', 'getEngine', 'args', body);
  return fn(editor, controller, scene, getDevice, getEngine, {});
}
