import type { Editor } from '../core/editor';
import type { PropertyValue, SceneNode, Material } from '@zephyr3d/scene';
import { Mesh, Scene } from '@zephyr3d/scene';
import { getDevice, getEngine, OrthoCamera, PerspectiveCamera } from '@zephyr3d/scene';
import { BlobReader, BlobWriter, configure, ZipWriter } from '@zip.js/zip.js';
import { DRef, PathUtils, Quaternion, Vector3 } from '@zephyr3d/base';
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
type MaterialClass =
  | 'UnlitMaterial'
  | 'LambertMaterial'
  | 'BlinnMaterial'
  | 'PBRMetallicRoughnessMaterial'
  | 'PBRSpecularGlossinessMaterial'
  | 'StandardSpriteMaterial';

const builtinMaterials: Record<MaterialClass, string> = {
  UnlitMaterial: '/assets/@builtins/materials/unlit.zmtl',
  LambertMaterial: '/assets/@builtins/materials/lambert.zmtl',
  BlinnMaterial: '/assets/@builtins/materials/blinnphong.zmtl',
  StandardSpriteMaterial: '/assets/@builtins/materials/sprite_std.zmtl',
  PBRMetallicRoughnessMaterial: '/assets/@builtins/materials/pbr_metallic_roughness.zmtl',
  PBRSpecularGlossinessMaterial: '/assets/@builtins/materials/pbr_specular_glossiness.zmtl'
};

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
const SCREENSHOT_TIMEOUT_MS = 5000;
const DEFAULT_GENERATED_MODEL_TIMEOUT_MS = 60000;

type GeneratedModelJobStatus =
  | 'running'
  | 'writing'
  | 'creating_node'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

type GeneratedModelJob = {
  id: string;
  status: GeneratedModelJobStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  timeoutMs: number;
  destPath: string;
  nodeName: string;
  createNode: boolean;
  worker: Worker | null;
  timer: number;
  error: string | null;
  result: {
    primitivePath: string;
    node: { id: string; name: string; nodeClass: 'Mesh' } | null;
    vertexCount: number;
    indexCount: number;
    boxMin: number[];
    boxMax: number[];
    uvMin?: number[];
    uvMax?: number[];
    hasTangents?: boolean;
  } | null;
};

let consoleInstalled = false;
const consoleEntries: ConsoleEntry[] = [];
const generatedModelJobs = new Map<string, GeneratedModelJob>();

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

function getNode<T extends SceneNode>(editor: Editor, id: string): { node: T; err: string | null } {
  const scene = getScene(editor);
  if (!scene) {
    return {
      node: null,
      err: 'No scene is currently opened'
    };
  }
  const node = scene.findNodeById<T>(id);
  if (!node) {
    return {
      node: null,
      err: `Node not found in scene node tree: ${id}`
    };
  }
  return {
    node,
    err: null
  };
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

function startGeneratedModelJob(
  editor: Editor,
  params: any
):
  | { jobId: string; status: GeneratedModelJobStatus; err: null }
  | { jobId: null; status: null; err: string } {
  const controller = getSceneController(editor);
  const scene = controller?.model?.scene ?? null;
  if (!controller || !scene) {
    return {
      jobId: null,
      status: null,
      err: 'No scene is currently opened'
    };
  }
  const spec = params.spec;
  if (!spec || typeof spec !== 'object') {
    return {
      jobId: null,
      status: null,
      err: 'model_generate_begin requires `spec` to be an object'
    };
  }
  let destPath = typeof params.destPath === 'string' ? params.destPath.trim() : '';
  if (!destPath) {
    return {
      jobId: null,
      status: null,
      err: 'model_generate_begin requires `destPath`'
    };
  }
  if (!destPath.endsWith('.zmsh')) {
    destPath += '.zmsh';
  }
  destPath = ProjectService.VFS.normalizePath(destPath);
  if (destPath !== '/assets' && !destPath.startsWith('/assets/')) {
    return {
      jobId: null,
      status: null,
      err: 'destPath must be under /assets'
    };
  }
  if (destPath.startsWith('/assets/@builtins/')) {
    return {
      jobId: null,
      status: null,
      err: 'Writing to `/assets/@builtins` directory is not allowed'
    };
  }
  const timeoutMs = Math.max(
    1000,
    Math.min(10 * 60 * 1000, Number(params.generationTimeoutMs ?? DEFAULT_GENERATED_MODEL_TIMEOUT_MS))
  );
  const jobId = `gm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job: GeneratedModelJob = {
    id: jobId,
    status: 'running',
    progress: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    timeoutMs,
    destPath,
    nodeName:
      typeof params.name === 'string' && params.name.trim()
        ? params.name.trim()
        : PathUtils.basename(destPath, '.zmsh'),
    createNode: params.createNode !== false,
    worker: null,
    timer: 0,
    error: null,
    result: null
  };
  generatedModelJobs.set(jobId, job);
  const worker = new Worker(new URL('../workers/generated_model.ts', import.meta.url), { type: 'module' });
  job.worker = worker;
  job.timer = window.setTimeout(() => {
    failGeneratedModelJob(job, 'timed_out', `Generated model job timed out after ${timeoutMs}ms`);
  }, timeoutMs);
  worker.onmessage = (event: MessageEvent<any>) => {
    const message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'progress') {
      if (isGeneratedModelJobActive(job)) {
        job.progress = Math.max(job.progress, Math.max(0, Math.min(0.95, Number(message.progress) || 0)));
        job.updatedAt = Date.now();
      }
      return;
    }
    if (message.type === 'error') {
      failGeneratedModelJob(job, 'failed', String(message.error || 'Generated model worker failed'));
      return;
    }
    if (message.type === 'success') {
      void finishGeneratedModelJob(editor, job, message);
    }
  };
  worker.onerror = (event) => {
    const location = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
    failGeneratedModelJob(job, 'failed', `${event.message || 'Generated model worker failed'}${location}`);
  };
  worker.onmessageerror = () => {
    failGeneratedModelJob(job, 'failed', 'Generated model worker returned an unserializable message');
  };
  worker.postMessage({
    type: 'generate',
    spec,
    deadlineAt: Date.now() + timeoutMs
  });
  return {
    jobId,
    status: job.status,
    err: null
  };
}

async function finishGeneratedModelJob(editor: Editor, job: GeneratedModelJob, message: any): Promise<void> {
  if (!isGeneratedModelJobActive(job)) {
    return;
  }
  try {
    job.status = 'writing';
    job.progress = 0.96;
    job.updatedAt = Date.now();
    const dir = ProjectService.VFS.dirname(job.destPath);
    if (!(await ProjectService.VFS.exists(dir))) {
      await ProjectService.VFS.makeDirectory(dir, true);
    }
    await ProjectService.VFS.writeFile(job.destPath, String(message.primitiveText), {
      encoding: 'utf8',
      create: true
    });
    let createdNode: GeneratedModelJob['result']['node'] = null;
    if (job.createNode) {
      job.status = 'creating_node';
      job.progress = 0.98;
      job.updatedAt = Date.now();
      const controller = getSceneController(editor);
      const scene = controller?.model?.scene ?? null;
      if (!scene) {
        throw new Error('No scene is currently opened');
      }
      const primitive = await getEngine().resourceManager.fetchPrimitive(job.destPath);
      if (!primitive) {
        throw new Error(`Cannot load generated primitive: ${job.destPath}`);
      }
      const material = await getEngine().resourceManager.fetchMaterial(
        '/assets/@builtins/materials/pbr_metallic_roughness.zmtl'
      );
      if (!material) {
        throw new Error('Cannot load default PBR material');
      }
      const mesh = new Mesh(scene, primitive, material);
      mesh.name = job.nodeName;
      mesh.parent = scene.rootNode;
      createdNode = {
        id: mesh.persistentId,
        name: mesh.name,
        nodeClass: 'Mesh'
      };
      eventBus.dispatchEvent('scene_changed');
    }
    completeGeneratedModelJob(job, {
      primitivePath: job.destPath,
      node: createdNode,
      vertexCount: Number(message.vertexCount ?? 0),
      indexCount: Number(message.indexCount ?? 0),
      boxMin: Array.isArray(message.boxMin) ? message.boxMin : [],
      boxMax: Array.isArray(message.boxMax) ? message.boxMax : [],
      uvMin: Array.isArray(message.uvMin) ? message.uvMin : [],
      uvMax: Array.isArray(message.uvMax) ? message.uvMax : [],
      hasTangents: message.hasTangents === true
    });
  } catch (err) {
    failGeneratedModelJob(job, 'failed', err instanceof Error ? err.message : String(err));
  }
}

function completeGeneratedModelJob(
  job: GeneratedModelJob,
  result: NonNullable<GeneratedModelJob['result']>
): void {
  cleanupGeneratedModelJob(job);
  job.status = 'completed';
  job.progress = 1;
  job.updatedAt = Date.now();
  job.result = result;
  job.error = null;
}

function cancelGeneratedModelJob(jobId: string): {
  jobId: string | null;
  status: GeneratedModelJobStatus | null;
  err: string | null;
} {
  const job = generatedModelJobs.get(jobId);
  if (!job) {
    return {
      jobId: null,
      status: null,
      err: `Generated model job not found: ${jobId}`
    };
  }
  if (
    job.status === 'completed' ||
    job.status === 'failed' ||
    job.status === 'cancelled' ||
    job.status === 'timed_out'
  ) {
    return {
      jobId: job.id,
      status: job.status,
      err: null
    };
  }
  failGeneratedModelJob(job, 'cancelled', 'Generated model job was cancelled');
  return {
    jobId: job.id,
    status: job.status,
    err: null
  };
}

function failGeneratedModelJob(
  job: GeneratedModelJob,
  status: Exclude<GeneratedModelJobStatus, 'running' | 'writing' | 'creating_node' | 'completed'>,
  error: string
): void {
  cleanupGeneratedModelJob(job);
  job.status = status;
  job.progress = status === 'cancelled' ? job.progress : Math.min(job.progress, 0.99);
  job.updatedAt = Date.now();
  job.error = error;
}

function cleanupGeneratedModelJob(job: GeneratedModelJob): void {
  if (job.timer) {
    window.clearTimeout(job.timer);
    job.timer = 0;
  }
  if (job.worker) {
    job.worker.terminate();
    job.worker = null;
  }
}

function isGeneratedModelJobActive(job: GeneratedModelJob): boolean {
  return job.status === 'running' || job.status === 'writing' || job.status === 'creating_node';
}

function serializeGeneratedModelJob(job: GeneratedModelJob | undefined) {
  if (!job) {
    return {
      job: null,
      err: 'Generated model job not found'
    };
  }
  return {
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      timeoutMs: job.timeoutMs,
      destPath: job.destPath,
      error: job.error,
      result: job.result
    },
    err: null
  };
}

async function dispatch(editor: Editor, method: string, params: any): Promise<any> {
  switch (method) {
    case 'status':
      return getStatus(editor);
    case 'model_generate_begin':
      return startGeneratedModelJob(editor, params);
    case 'model_generate_status': {
      const jobId = typeof params.jobId === 'string' ? params.jobId.trim() : '';
      return serializeGeneratedModelJob(generatedModelJobs.get(jobId));
    }
    case 'model_generate_cancel': {
      const jobId = typeof params.jobId === 'string' ? params.jobId.trim() : '';
      return cancelGeneratedModelJob(jobId);
    }
    case 'mesh_get_material': {
      try {
        let meshId: string = params.mesh_id;
        if (typeof meshId !== 'string' || !meshId.trim()) {
          return {
            material_path: null,
            err: 'mesh_get_material requires mesh_id to be a non-empty string'
          };
        }
        const node = getNode<Mesh>(editor, meshId.trim());
        if (node.err) {
          return {
            material_path: null,
            err: node.err
          };
        }
        const materialPath = getEngine().resourceManager.getAssetId(node.node.material?.coreMaterial);
        return {
          material_path: materialPath,
          err: null
        };
      } catch (err) {
        return {
          err: `${err}`
        };
      }
    }
    case 'mesh_set_material': {
      try {
        let meshId: string = params.mesh_id;
        if (typeof meshId !== 'string' || !meshId.trim()) {
          return {
            err: 'mesh_set_material requires mesh_id to be a non-empty string'
          };
        }
        const node = getNode<Mesh>(editor, meshId.trim());
        if (node.err) {
          return {
            err: node.err
          };
        }
        let materialPath: string = params.material_path;
        if (typeof materialPath !== 'string' || !materialPath.trim()) {
          return {
            err: 'mesh_set_material requires material_path to be a non-empty string'
          };
        }
        materialPath = ProjectService.VFS.normalizePath(materialPath);
        const material = await getEngine().resourceManager.fetchMaterial(materialPath);
        if (!material) {
          return {
            err: `Cannot load material at path: ${materialPath}`
          };
        }
        node.node.material = material;
        return {
          err: null
        };
      } catch (err) {
        return {
          err: `${err}`
        };
      }
    }
    case 'asset_get_root': {
      return {
        root: '/assets',
        err: null
      };
    }
    case 'asset_create_material': {
      try {
        let path: string = params.directory;
        if (typeof path !== 'string' || !path) {
          return {
            path: null,
            err: 'asset_create_material requires path to be a non-empty string'
          };
        }
        path = ProjectService.VFS.normalizePath(path);
        if (path !== '/assets' && !path.startsWith('/assets/')) {
          return {
            path: null,
            err: 'path is not in asset root directory'
          };
        }
        if (path.startsWith('/assets/@builtins/')) {
          return {
            path: null,
            err: 'Writing to `/assets/@builtins` directory is not allowed'
          };
        }
        if (typeof params.class !== 'string' || !params.class) {
          return {
            path: null,
            err: 'asset_create_material requires class to be a non-empty string'
          };
        }
        if (!builtinMaterials[params.class]) {
          return {
            path: null,
            err: 'Invalid material class'
          };
        }
        if (typeof params.name !== 'string' || !params.name.trim()) {
          return {
            path: null,
            err: 'asset_create_material requires name to be a non-empty string'
          };
        }
        if (params.overwrite !== undefined && typeof params.overwrite !== 'boolean') {
          return {
            path: null,
            err: 'overwrite parameter must be a boolean or be omitted'
          };
        }
        let filename = params.name.trim() as string;
        if (!filename.endsWith('.zmtl')) {
          filename = filename.endsWith('.') ? `${filename}zmtl` : `${filename}.zmtl`;
        }
        const srcPath = builtinMaterials[params.class];
        const dstPath = await ProjectService.VFS.join(path, filename);
        if (!(await ProjectService.VFS.exists(path))) {
          await ProjectService.VFS.makeDirectory(path, true);
        }
        const stat = (await ProjectService.VFS.exists(dstPath))
          ? await ProjectService.VFS.stat(dstPath)
          : null;
        if (stat?.isDirectory) {
          return {
            path: null,
            err: `${dstPath} is a directory and cannot be overwritten`
          };
        }
        if (stat?.isFile && !params.overwrite) {
          return {
            path: null,
            err: `${dstPath} already exists`
          };
        }
        await ProjectService.VFS.copyFile(srcPath, dstPath, { overwrite: true });
        return {
          path: dstPath,
          err: null
        };
      } catch (err) {
        return {
          path: null,
          err: `${err}`
        };
      }
    }
    case 'asset_read_directory': {
      try {
        if (typeof params.path !== 'string' || !params.path) {
          return {
            result: null,
            err: 'asset_read_directory require path to be a non-empty string'
          };
        }
        if (params.recursive !== undefined && typeof params.recursive !== 'boolean') {
          return {
            result: null,
            err: 'recursive parameter must be a boolean or be omitted'
          };
        }
        if (params.pattern !== undefined && typeof params.pattern !== 'string') {
          return {
            result: null,
            err: 'pattern parameter must be a string or be omitted'
          };
        }
        const stat = await ProjectService.VFS.stat(params.path);
        if (!stat) {
          return {
            result: null,
            err: 'path not exists'
          };
        }
        if (!stat.isDirectory) {
          return {
            result: null,
            err: 'path is not directory'
          };
        }
        const entries = await ProjectService.VFS.readDirectory(params.path, {
          recursive: params.recursive,
          pattern: params.pattern
        });
        return {
          result: entries,
          err: null
        };
      } catch (err) {
        return {
          result: null,
          err: `${err}`
        };
      }
    }
    case 'material_get_properties': {
      // Get property values from a material by vfs path
      const materialRef = new DRef<Material>();
      try {
        let path = params.path as string;
        if (typeof path !== 'string' || !path.trim()) {
          return {
            values: null,
            err: 'material_get_properties requires the material file path'
          };
        }
        path = path.trim();
        const properties = params.properties as string[];
        if (!Array.isArray(properties) || properties.some((val) => typeof val !== 'string')) {
          return {
            values: null,
            err: 'material_get_properties requires the property list as string array'
          };
        }
        const material = await getEngine().resourceManager.fetchMaterial(path);
        if (!material) {
          return {
            values: null,
            err: `Load material failed: path: ${path}`
          };
        }
        materialRef.set(material);
        const materialClass = getEngine().resourceManager.getClassByObject(material);
        if (!materialClass) {
          return {
            values: null,
            err: `Load material class failed: path: ${path}`
          };
        }
        const values: (number[] | number | boolean | string)[] = [];
        const props = materialClass.getProps();
        for (const p of properties) {
          let propertyName = p as string;
          const prop = props.find((prop) => prop.name === propertyName);
          if (!prop) {
            return {
              values: null,
              err: `Invalid property: ${propertyName}`
            };
          }
          if (!prop.get) {
            return {
              values: null,
              err: `No getter for property ${prop.name}`
            };
          }
          if (prop.type === 'object_array') {
            return {
              values: null,
              err: `Gets property of type object_array is not supported`
            };
          }
          const value: PropertyValue = {
            num: [0, 0, 0, 0],
            str: ['', '', '', ''],
            bool: [false, false, false, false],
            object: []
          };
          prop.get.call(material, value as any);
          if (prop.type === 'bool') {
            values.push(value.bool[0]);
          } else if (prop.type === 'object' || prop.type === 'string') {
            values.push(value.str[0]);
          } else if (prop.type === 'float' || prop.type === 'int') {
            values.push(value.num[0]);
          } else if (prop.type === 'vec2' || prop.type === 'int2') {
            values.push(value.num.slice(0, 2));
          } else if (prop.type === 'vec3' || prop.type === 'int3' || prop.type === 'rgb') {
            values.push(value.num.slice(0, 3));
          } else if (prop.type === 'vec4' || prop.type === 'int4' || prop.type === 'rgba') {
            values.push(value.num);
          } else {
            return {
              values: null,
              err: `Invalid property type: ${prop.type}`
            };
          }
        }
        return {
          values,
          err: null
        };
      } catch (err) {
        return {
          values: null,
          err: `${err}`
        };
      } finally {
        materialRef.dispose();
      }
    }
    case 'material_set_properties': {
      // Load material from file and modify properties and then save it
      const materialRef = new DRef<Material>();
      try {
        let path = params.path as string;
        if (typeof path !== 'string' || !path.trim()) {
          return {
            err: 'material_set_properties requires the material file path'
          };
        }
        path = path.trim();
        const properties = params.properties as { propertyName: string; value: unknown }[];
        if (!Array.isArray(properties)) {
          return {
            err: 'material_set_properties requires the property list'
          };
        }
        const material = await getEngine().resourceManager.fetchMaterial(path);
        if (!material) {
          return {
            err: `Load material failed: path: ${path}`
          };
        }
        materialRef.set(material);
        const fileContent = (await ProjectService.VFS.readFile(path, { encoding: 'utf8' })) as string;
        const json = JSON.parse(fileContent);
        const materialClass = getEngine().resourceManager.getClassByObject(material);
        if (!materialClass) {
          return {
            err: `Load material class failed: path: ${path}`
          };
        }
        const props = materialClass.getProps();
        for (const p of properties) {
          let propertyName = p.propertyName as string;
          if (typeof propertyName !== 'string' || !propertyName.trim()) {
            return {
              err: 'material_set_properties requires the material property name'
            };
          }
          propertyName = propertyName.trim();
          const prop = props.find((prop) => prop.name === propertyName);
          if (!prop) {
            return {
              err: `Invalid property: ${propertyName}`
            };
          }
          if (!prop.set) {
            return {
              err: `Property ${prop.name} is readonly`
            };
          }
          if (prop.type === 'object_array') {
            return {
              err: `Sets property of type object_array is not supported`
            };
          }
          const value: PropertyValue = {
            num: [0, 0, 0, 0],
            str: ['', '', '', ''],
            bool: [false, false, false, false],
            object: []
          };
          if (typeof p.value === 'boolean') {
            if (prop.type !== 'bool') {
              return {
                err: `Boolean value is not supported for property ${prop.name}`
              };
            } else {
              value.bool[0] = p.value;
            }
          } else if (typeof p.value === 'string') {
            if (prop.type !== 'string' && prop.type !== 'object') {
              return {
                err: `String value is not supported for property ${prop.name}`
              };
            } else {
              value.str[0] = p.value;
            }
          } else if (typeof p.value === 'number') {
            if (prop.type !== 'float' && prop.type !== 'int') {
              return {
                err: `Number value is not supported for property ${prop.name}`
              };
            } else {
              value.num[0] = p.value;
            }
          } else if (Array.isArray(p.value)) {
            let n = 0;
            if (prop.type === 'vec2' || prop.type === 'int2') {
              n = 2;
            } else if (prop.type === 'vec3' || prop.type === 'int3' || prop.type === 'rgb') {
              n = 3;
            } else if (prop.type === 'vec4' || prop.type === 'int4' || prop.type === 'rgba') {
              n = 4;
            } else {
              return {
                err: `Unsupported property type: ${prop.type}`
              };
            }
            if (p.value.length !== n || p.value.some((val) => typeof val !== 'number')) {
              return {
                err: `Array of ${n} numbers required for property ${prop.name}`
              };
            }
            for (let i = 0; i < n; i++) {
              value.num[i] = p.value[i];
            }
          } else {
            return {
              err: 'Invalid property value'
            };
          }
          await prop.set.call(material, value as any);
        }
        json.data = await getEngine().resourceManager.serializeObject(material);
        await ProjectService.VFS.writeFile(path, JSON.stringify(json, null, 2), {
          encoding: 'utf8',
          create: true
        });
        return {
          err: null
        };
      } catch (err) {
        return {
          err: `${err}`
        };
      } finally {
        materialRef.dispose();
      }
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
    case 'getMaterialPropertyList': {
      let path = params.path as string;
      if (typeof path !== 'string' || !path.trim()) {
        return {
          propertyList: null,
          err: 'getMaterialPropertyList requires the material file path'
        };
      }
      path = path.trim();
      try {
        if (!(await ProjectService.VFS.exists(path))) {
          return {
            propertyList: null,
            err: `File not exists at ${path}`
          };
        }
        const content = (await ProjectService.VFS.readFile(path, { encoding: 'utf8' })) as string;
        const json = JSON.parse(content);
        const classname = json.data?.['ClassName'];
        const cls = getEngine()
          .resourceManager.getClasses()
          .find((val) => val.name === classname);
        if (!cls) {
          return {
            propertyList: null,
            err: `Invalid material file: class not found: ${classname}; root keys: ${Object.keys(json ?? {}).join(', ')}`
          };
        }
        return {
          propertyList: JSON.parse(JSON.stringify(getEngine().resourceManager.getPropertiesByClass(cls))),
          err: null
        };
      } catch (err) {
        return {
          propertyList: null,
          err: `${err}`
        };
      }
    }
    case 'getNodePropertyList': {
      const id = params.id as string;
      if (typeof id !== 'string' || !id.trim()) {
        return {
          propertyList: null,
          err: 'getNodePropertyList requires the node id to be a non-empty string'
        };
      }
      const node = getNode(editor, id.trim());
      if (node.err) {
        return {
          propertyList: null,
          err: node.err
        };
      }
      const cls = getEngine().resourceManager.getClassByObject(node.node);
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
    case 'getMaterialClasses': {
      const classes: MaterialClass[] = [
        'UnlitMaterial',
        'LambertMaterial',
        'BlinnMaterial',
        'StandardSpriteMaterial',
        'PBRMetallicRoughnessMaterial',
        'PBRSpecularGlossinessMaterial'
      ];
      return classes;
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
      if (typeof params.id !== 'string' || !params.id.trim()) {
        return {
          nodeClass: null,
          err: 'getNodeClass requires the node id to be a non-empty string'
        };
      }
      const node = getNode(editor, params.id.trim());
      if (node.err) {
        return {
          nodeClass: null,
          err: node.err
        };
      }
      const cls: NodeClass = node.node.isMesh()
        ? 'Mesh'
        : node.node.isBatchGroup()
          ? 'BatchGroup'
          : node.node.isClipmapTerrain()
            ? 'ClipmapTerrain'
            : node.node.isLight() && node.node.isDirectionLight()
              ? 'DirectionalLight'
              : node.node.isLight() && node.node.isPointLight()
                ? 'PointLight'
                : node.node.isLight() && node.node.isSpotLight()
                  ? 'SpotLight'
                  : node.node.isLight() && node.node.isRectLight()
                    ? 'RectLight'
                    : node.node.isMesh()
                      ? 'Mesh'
                      : node.node.isParticleSystem()
                        ? 'ParticleSystem'
                        : node.node.isWater()
                          ? 'Water'
                          : node.node instanceof PerspectiveCamera
                            ? 'PerspectiveCamera'
                            : node.node instanceof OrthoCamera
                              ? 'OrthoCamera'
                              : node.node.isCamera()
                                ? 'Camera'
                                : 'SceneNode';
      return {
        nodeClass: cls,
        err: null
      };
    }
    case 'setNodeLocalTransform': {
      const id = params.id as string;
      if (typeof id !== 'string' || !id.trim()) {
        return {
          transform: null,
          err: 'setNodeLocalTransform requires the node id to be a non-empty string'
        };
      }
      const node = getNode(editor, id.trim());
      if (node.err) {
        return {
          transform: null,
          err: node.err
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
        node.node.position.setXYZ(params.position[0], params.position[1], params.position[2]);
      }
      if (params.scale) {
        node.node.scale.setXYZ(params.scale[0], params.scale[1], params.scale[2]);
      }
      if (params.rotation) {
        node.node.rotation.setXYZW(
          params.rotation[0],
          params.rotation[1],
          params.rotation[2],
          params.rotation[3]
        );
      }
      return {
        transform: {
          position: [node.node.position.x, node.node.position.y, node.node.position.z],
          scale: [node.node.scale.x, node.node.scale.y, node.node.scale.z],
          rotation: [node.node.rotation.x, node.node.rotation.y, node.node.rotation.z, node.node.rotation.w]
        },
        err: null
      };
    }
    case 'getNodeLocalTransform': {
      const id = params.id as string;
      if (typeof id !== 'string' || !id.trim()) {
        return {
          transform: null,
          err: 'getNodeLocalTransform requires the node id to be non-empty string'
        };
      }
      const node = getNode(editor, id.trim());
      if (node.err) {
        return {
          transform: null,
          err: node.err
        };
      }
      return {
        transform: {
          position: [node.node.position.x, node.node.position.y, node.node.position.z],
          scale: [node.node.scale.x, node.node.scale.y, node.node.scale.z],
          rotation: [node.node.rotation.x, node.node.rotation.y, node.node.rotation.z, node.node.rotation.w]
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
      if (typeof id !== 'string' || !id.trim()) {
        return {
          parentNode: null,
          err: 'getParentNode requires the node id to be a non-empty string'
        };
      }
      const node = getNode(editor, id.trim());
      if (node.err) {
        return {
          parentNode: null,
          err: node.err
        };
      }
      return {
        parentNode: node.node.parent?.persistentId ?? null,
        err: null
      };
    }
    case 'removeNode': {
      const id = params.id as string;
      if (typeof id !== 'string' || !id.trim()) {
        return {
          err: 'removeNode requires the node id to be a non-empty string'
        };
      }
      const node = getNode(editor, id.trim());
      if (node.err) {
        return {
          err: node.err
        };
      }
      node.node.remove();
      return {
        err: null
      };
    }
    case 'setParentNode': {
      const id = params.id as string;
      if (typeof id !== 'string' || !id.trim()) {
        return {
          err: 'setParentNode requires the node id to be a non-empty string'
        };
      }
      const newParentId = params.parentId as string;
      if (typeof newParentId !== 'string' || !newParentId.trim()) {
        return {
          err: 'setParentNode requires the new parent id to be a non-empty string'
        };
      }
      const node = getNode(editor, id.trim());
      if (node.err) {
        return {
          err: node.err
        };
      }
      const newParentNode = getNode(editor, newParentId.trim());
      if (newParentNode.err) {
        return {
          err: newParentNode.err
        };
      }
      if (node.node.isParentOf(newParentNode.node)) {
        return {
          err: `Cannot set this node as parent: ${params.parentId}`
        };
      }
      node.node.parent = newParentNode.node;
      return {
        err: null
      };
    }
    case 'getSubNodes': {
      const parent = params.parent as string;
      if (typeof parent !== 'string' || !parent.trim()) {
        return {
          subNodes: null,
          err: 'getSubNodes requires the parent node id'
        };
      }
      const node = getNode(editor, parent.trim());
      if (node.err) {
        return {
          subNodes: null,
          err: node.err
        };
      }
      return {
        subNodes: node.node.children.map((child) => ({ id: child.persistentId, name: child.name })),
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
