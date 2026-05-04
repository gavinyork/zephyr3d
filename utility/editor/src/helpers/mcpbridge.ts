import type { Editor } from '../core/editor';
import type { PropertyValue, SceneNode, Material } from '@zephyr3d/scene';
import type { Primitive } from '@zephyr3d/scene';
import { Mesh, Scene } from '@zephyr3d/scene';
import { getDevice, getEngine, OrthoCamera, PerspectiveCamera } from '@zephyr3d/scene';
import { BlobReader, BlobWriter, configure, ZipWriter } from '@zip.js/zip.js';
import { base64ToUint8Array, DRef, PathUtils, Quaternion, uint8ArrayToBase64, Vector3 } from '@zephyr3d/base';
import { ProjectService } from '../core/services/project';
import { fileListFileName, libDir } from '../core/build/templates';
import { SceneController } from '../controllers/scenecontroller';
import { AddShapeCommand } from '../commands/scenecommands';
import { eventBus } from '../core/eventbus';
import { shapePrimitivePaths, type ShapePrimitiveType } from './shapeprimitives';
import { SharedModel, type AssetPrimitiveInfo } from '../loaders/model';
import { buildPrimitiveGlbFromZmshContent } from './primitiveglb';

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
    throw new Error('Editor canvas element #canvas was not found; make sure the editor page is loaded');
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
      err: 'No scene is currently opened; create or open a scene first'
    };
  }
  const node = scene.findNodeById<T>(id);
  if (!node) {
    return {
      node: null,
      err: `Scene node not found by persistent id: ${id}`
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
    return { err: 'No project is currently opened; create or open a project before exporting' };
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
      err: defaultValue ? null : `Parameter \`${name}\` is required`
    };
  }
  if (!Array.isArray(value) || value.length !== length || value.some((val) => typeof val !== 'number')) {
    return {
      value: null,
      err: `Parameter \`${name}\` must be an array of exactly ${length} numbers`
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

async function startGeneratedModelJob(
  editor: Editor,
  params: any
): Promise<
  { jobId: string; status: GeneratedModelJobStatus; err: null } | { jobId: null; status: null; err: string }
> {
  const info = await ProjectService.getCurrentProjectInfo();
  if (!info) {
    return {
      jobId: null,
      status: null,
      err: 'No project is currently opened; create or open a project first'
    };
  }
  const controller = getSceneController(editor);
  const scene = controller?.model?.scene ?? null;
  if (!controller || !scene) {
    return {
      jobId: null,
      status: null,
      err: 'No scene is currently opened; create or open a scene first'
    };
  }
  const spec = params.spec;
  if (!spec || typeof spec !== 'object') {
    return {
      jobId: null,
      status: null,
      err: 'model_generate_begin requires `spec` to be a procedural model JSON object'
    };
  }
  let destPath = typeof params.destPath === 'string' ? params.destPath.trim() : '';
  if (!destPath) {
    return {
      jobId: null,
      status: null,
      err: 'model_generate_begin requires `destPath`, for example /assets/generated/model.zmsh'
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
      err: `destPath must be under /assets: ${destPath}`
    };
  }
  if (destPath.startsWith('/assets/@builtins/')) {
    return {
      jobId: null,
      status: null,
      err: `Cannot write generated model to read-only built-in asset directory: ${destPath}`
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
    await SharedModel.writePrimitive(
      ProjectService.VFS,
      createGeneratedAssetPrimitive(message),
      job.destPath
    );
    let createdNode: GeneratedModelJob['result']['node'] = null;
    if (job.createNode) {
      job.status = 'creating_node';
      job.progress = 0.98;
      job.updatedAt = Date.now();
      const controller = getSceneController(editor);
      const scene = controller?.model?.scene ?? null;
      if (!scene) {
        throw new Error('No scene is currently opened; cannot create a mesh node for the generated model');
      }
      const primitive = await getEngine().resourceManager.fetchPrimitive(job.destPath);
      if (!primitive) {
        throw new Error(
          `Generated .zmsh was written but could not be loaded as a primitive: ${job.destPath}`
        );
      }
      const material = await getEngine().resourceManager.fetchMaterial(
        '/assets/@builtins/materials/pbr_metallic_roughness.zmtl'
      );
      if (!material) {
        throw new Error(
          'Cannot load default PBR material: /assets/@builtins/materials/pbr_metallic_roughness.zmtl'
        );
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

function createGeneratedAssetPrimitive(message: any): AssetPrimitiveInfo {
  const primitive = message?.primitive;
  if (!primitive || typeof primitive !== 'object') {
    throw new Error('Generated model worker did not return primitive data');
  }
  const indices = primitive.indices;
  if (!(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) {
    throw new Error('Generated model worker returned invalid primitive indices');
  }
  const normalizedIndices =
    indices instanceof Uint16Array ? new Uint16Array(indices) : new Uint32Array(indices);
  const vertices: AssetPrimitiveInfo['vertices'] = {} as AssetPrimitiveInfo['vertices'];
  if (!primitive.vertices || typeof primitive.vertices !== 'object') {
    throw new Error('Generated model worker returned invalid primitive vertices');
  }
  for (const [semantic, vertex] of Object.entries(primitive.vertices as Record<string, any>)) {
    if (!vertex || typeof vertex.format !== 'string' || !ArrayBuffer.isView(vertex.data)) {
      throw new Error(`Generated model worker returned invalid vertex buffer: ${semantic}`);
    }
    vertices[semantic as keyof AssetPrimitiveInfo['vertices']] = {
      format: vertex.format,
      data: vertex.data
    } as AssetPrimitiveInfo['vertices'][keyof AssetPrimitiveInfo['vertices']];
  }
  const boxMin = Array.isArray(primitive.boxMin) ? primitive.boxMin : message.boxMin;
  const boxMax = Array.isArray(primitive.boxMax) ? primitive.boxMax : message.boxMax;
  if (!isNumberArray(boxMin, 3) || !isNumberArray(boxMax, 3)) {
    throw new Error('Generated model worker returned invalid primitive bounds');
  }
  return {
    vertices,
    indices: normalizedIndices,
    indexCount: Number(primitive.indexCount ?? normalizedIndices.length),
    type: primitive.type === 'triangle-list' ? 'triangle-list' : primitive.type,
    boxMin: new Vector3(boxMin),
    boxMax: new Vector3(boxMax)
  };
}

async function exportPrimitiveGlb(
  params: any
): Promise<{ path: string | null; bytes: number; err: string | null }> {
  try {
    const info = await ProjectService.getCurrentProjectInfo();
    if (!info) {
      return {
        path: null,
        bytes: 0,
        err: 'No project is currently opened; create or open a project first'
      };
    }
    let srcPath = typeof params.srcPath === 'string' ? params.srcPath.trim() : '';
    if (!srcPath && typeof params.path === 'string') {
      srcPath = params.path.trim();
    }
    if (!srcPath) {
      return {
        path: null,
        bytes: 0,
        err: 'primitive_export_glb requires `srcPath`, the source .zmsh primitive path under /assets'
      };
    }
    srcPath = ProjectService.VFS.normalizePath(srcPath);
    if (srcPath !== '/assets' && !srcPath.startsWith('/assets/')) {
      return {
        path: null,
        bytes: 0,
        err: `srcPath must be under /assets: ${srcPath}`
      };
    }
    if (!srcPath.endsWith('.zmsh')) {
      return {
        path: null,
        bytes: 0,
        err: `srcPath must point to a .zmsh primitive asset: ${srcPath}`
      };
    }
    let destPath = typeof params.destPath === 'string' ? params.destPath.trim() : '';
    if (!destPath) {
      destPath = `${srcPath.slice(0, -'.zmsh'.length)}.glb`;
    }
    if (!destPath.endsWith('.glb')) {
      destPath += '.glb';
    }
    destPath = ProjectService.VFS.normalizePath(destPath);
    if (destPath !== '/assets' && !destPath.startsWith('/assets/')) {
      return {
        path: null,
        bytes: 0,
        err: `destPath must be under /assets: ${destPath}`
      };
    }
    if (destPath.startsWith('/assets/@builtins/')) {
      return {
        path: null,
        bytes: 0,
        err: `Cannot write GLB to read-only built-in asset directory: ${destPath}`
      };
    }
    const srcStat = await ProjectService.VFS.stat(srcPath);
    if (!srcStat?.isFile) {
      return {
        path: null,
        bytes: 0,
        err: `Primitive asset not found: ${srcPath}`
      };
    }
    const content = (await ProjectService.VFS.readFile(srcPath, { encoding: 'utf8' })) as string;
    const glb = buildPrimitiveGlbFromZmshContent(content, PathUtils.basename(destPath, '.glb'), srcPath);
    const dir = ProjectService.VFS.dirname(destPath);
    if (!(await ProjectService.VFS.exists(dir))) {
      await ProjectService.VFS.makeDirectory(dir, true);
    }
    await ProjectService.VFS.writeFile(destPath, glb, {
      encoding: 'binary',
      create: true
    });
    return {
      path: destPath,
      bytes: glb.byteLength,
      err: null
    };
  } catch (err) {
    return {
      path: null,
      bytes: 0,
      err: err instanceof Error ? err.message : String(err)
    };
  }
}

function isNumberArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'number');
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
      err: 'Generated model job not found; pass a jobId returned by model_generate_begin'
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
    case 'primitive_export_glb':
      return exportPrimitiveGlb(params);
    case 'model_generate_status': {
      const jobId = typeof params.jobId === 'string' ? params.jobId.trim() : '';
      if (!jobId) {
        return {
          job: null,
          err: 'model_generate_status requires `jobId`, returned by model_generate_begin'
        };
      }
      return serializeGeneratedModelJob(generatedModelJobs.get(jobId));
    }
    case 'model_generate_cancel': {
      const jobId = typeof params.jobId === 'string' ? params.jobId.trim() : '';
      if (!jobId) {
        return {
          jobId: null,
          status: null,
          err: 'model_generate_cancel requires `jobId`, returned by model_generate_begin'
        };
      }
      return cancelGeneratedModelJob(jobId);
    }
    case 'mesh_create': {
      const primitiveRef = new DRef<Primitive>();
      const materialRef = new DRef<Material>();
      try {
        const scene = getScene(editor);
        if (!scene) {
          return {
            mesh_id: null,
            err: 'No scene is currently opened; create or open a scene before creating a mesh'
          };
        }
        let parentId: string = params.parent_id;
        if (parentId !== undefined) {
          if (typeof parentId !== 'string' || !parentId.trim()) {
            return {
              mesh_id: null,
              err: 'mesh_create `parent_id` must be a non-empty scene node id when provided'
            };
          }
          parentId = parentId.trim();
        }
        const parent = parentId ? getNode(editor, parentId) : { node: scene.rootNode, err: null };
        if (parent.err) {
          return {
            mesh_id: null,
            err: parent.err
          };
        }
        let primitivePath: string = params.primitive_path;
        if (typeof primitivePath !== 'string' || !primitivePath.trim()) {
          return {
            mesh_id: null,
            err: 'mesh_create requires `primitive_path`, for example /assets/generated/model.zmsh'
          };
        }
        primitivePath = primitivePath.trim();
        const primitive = await getEngine().resourceManager.fetchPrimitive(primitivePath);
        if (!primitive) {
          return {
            mesh_id: null,
            err: `Cannot load primitive asset for mesh_create: ${primitivePath}`
          };
        }
        primitiveRef.set(primitive);
        let materialPath: string = params.material_path;
        if (typeof materialPath !== 'string' || !materialPath.trim()) {
          return {
            mesh_id: null,
            err: 'mesh_create requires `material_path`, for example /assets/materials/mat.zmtl'
          };
        }
        materialPath = materialPath.trim();
        const material = await getEngine().resourceManager.fetchMaterial(materialPath);
        if (!material) {
          return {
            mesh_id: null,
            err: `Cannot load material asset for mesh_create: ${materialPath}`
          };
        }
        materialRef.set(material);
        const mesh = new Mesh(scene, primitive, material);
        mesh.parent = parent.node;
        return {
          mesh_id: mesh.persistentId,
          err: null
        };
      } catch (err) {
        return {
          mesh_id: null,
          err: `${err}`
        };
      } finally {
        primitiveRef.dispose();
        materialRef.dispose();
      }
    }
    case 'mesh_get_material': {
      try {
        let meshId: string = params.mesh_id;
        if (typeof meshId !== 'string' || !meshId.trim()) {
          return {
            material_path: null,
            err: 'mesh_get_material requires `mesh_id`, the persistent id of a Mesh node'
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
            err: 'mesh_set_material requires `mesh_id`, the persistent id of a Mesh node'
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
            err: 'mesh_set_material requires `material_path`, for example /assets/materials/mat.zmtl'
          };
        }
        materialPath = ProjectService.VFS.normalizePath(materialPath);
        const material = await getEngine().resourceManager.fetchMaterial(materialPath);
        if (!material) {
          return {
            err: `Cannot load material asset for mesh_set_material: ${materialPath}`
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
    case 'mesh_get_primitive': {
      try {
        let meshId: string = params.mesh_id;
        if (typeof meshId !== 'string' || !meshId.trim()) {
          return {
            primitive_path: null,
            err: 'mesh_get_primitive requires `mesh_id`, the persistent id of a Mesh node'
          };
        }
        const node = getNode<Mesh>(editor, meshId.trim());
        if (node.err) {
          return {
            primitive_path: null,
            err: node.err
          };
        }
        const primitivePath = getEngine().resourceManager.getAssetId(node.node.primitive);
        return {
          primitive_path: primitivePath,
          err: null
        };
      } catch (err) {
        return {
          err: `${err}`
        };
      }
    }
    case 'mesh_set_primitive': {
      try {
        let meshId: string = params.mesh_id;
        if (typeof meshId !== 'string' || !meshId.trim()) {
          return {
            err: 'mesh_set_primitive requires `mesh_id`, the persistent id of a Mesh node'
          };
        }
        const node = getNode<Mesh>(editor, meshId.trim());
        if (node.err) {
          return {
            err: node.err
          };
        }
        let primitivePath: string = params.primitive_path;
        if (typeof primitivePath !== 'string' || !primitivePath.trim()) {
          return {
            err: 'mesh_set_primitive requires `primitive_path`, for example /assets/generated/model.zmsh'
          };
        }
        primitivePath = ProjectService.VFS.normalizePath(primitivePath);
        const primitive = await getEngine().resourceManager.fetchPrimitive(primitivePath);
        if (!primitive) {
          return {
            err: `Cannot load primitive asset for mesh_set_primitive: ${primitivePath}`
          };
        }
        node.node.primitive = primitive;
        return {
          err: null
        };
      } catch (err) {
        return {
          err: `${err}`
        };
      }
    }
    case 'asset_get_root_directory': {
      try {
        const info = await ProjectService.getCurrentProjectInfo();
        if (!info) {
          return {
            root: null,
            err: 'No project is currently opened; create or open a project first'
          };
        }
        return {
          root: '/assets',
          err: null
        };
      } catch (err) {
        return {
          root: null,
          err: `${err}`
        };
      }
    }
    case 'asset_get_builtin_materials': {
      try {
        const info = await ProjectService.getCurrentProjectInfo();
        if (!info) {
          return {
            material_list: null,
            err: 'No project is currently opened; create or open a project first'
          };
        }
        return {
          material_list: [
            {
              path: '/assets/@builtins/materials/blinnphong.zmtl',
              type: 'blinnphong',
              immutable: true
            },
            {
              path: '/assets/@builtins/materials/lambert.zmtl',
              type: 'lambert',
              immuable: true
            },
            {
              path: '/assets/@builtins/materials/pbr_metallic_roughness',
              type: 'pbr_metallic_roughness',
              immutable: true
            },
            {
              path: '/assets/@builtins/materials/pbr_specular_glossiness',
              type: 'pbr_specular_glossiness',
              immutable: true
            },
            {
              path: '/assets/@builtins/materials/prite_std.zmtl',
              type: 'sprite_standard',
              immutable: true
            },
            {
              path: '/assets/@builtins/materials/unlit.zmtl',
              type: 'unlit',
              immutable: true
            }
          ],
          err: null
        };
      } catch (err) {
        return {
          material_list: null,
          err: `${err}`
        };
      }
    }
    case 'asset_get_builtin_primitives': {
      try {
        const info = await ProjectService.getCurrentProjectInfo();
        if (!info) {
          return {
            primitive_list: null,
            err: 'No project is currently opened; create or open a project first'
          };
        }
        return {
          primitive_list: [
            {
              path: '/assets/@builtins/primitives/box.zmsh',
              type: 'box'
            },
            {
              path: '/assets/@builtins/primitives/sphere.zmsh',
              type: 'sphere'
            },
            {
              path: '/assets/@builtins/primitives/capsule.zmsh',
              type: 'capsule'
            },
            {
              path: '/assets/@builtins/primitives/cylinder.zmsh',
              type: 'cylinder'
            },
            {
              path: '/assets/@builtins/primitives/plane.zmsh',
              type: 'plane'
            },
            {
              path: '/assets/@builtins/primitives/tetrahedron.zmsh',
              type: 'tetrahedron'
            },
            {
              path: '/assets/@builtins/primitives/torus.zmsh',
              type: 'torus'
            }
          ],
          err: null
        };
      } catch (err) {
        return {
          primitive_list: null,
          err: `${err}`
        };
      }
    }
    case 'asset_create_material': {
      try {
        const info = await ProjectService.getCurrentProjectInfo();
        if (!info) {
          return {
            path: null,
            err: 'No project is currently opened; create or open a project first'
          };
        }
        let path: string = params.directory;
        if (typeof path !== 'string' || !path) {
          return {
            path: null,
            err: 'asset_create_material requires `directory`, for example /assets/materials'
          };
        }
        path = ProjectService.VFS.normalizePath(path);
        if (path !== '/assets' && !path.startsWith('/assets/')) {
          return {
            path: null,
            err: `asset_create_material directory must be under /assets: ${path}`
          };
        }
        if (path.startsWith('/assets/@builtins/')) {
          return {
            path: null,
            err: `Cannot create material in read-only built-in asset directory: ${path}`
          };
        }
        if (typeof params.class !== 'string' || !params.class) {
          return {
            path: null,
            err: 'asset_create_material requires `class`, for example PBRMetallicRoughnessMaterial'
          };
        }
        if (!builtinMaterials[params.class]) {
          return {
            path: null,
            err: `Unsupported material class: ${params.class}. Valid classes: ${Object.keys(builtinMaterials).join(', ')}`
          };
        }
        if (typeof params.name !== 'string' || !params.name.trim()) {
          return {
            path: null,
            err: 'asset_create_material requires `name`, for example car_body.zmtl'
          };
        }
        if (params.overwrite !== undefined && typeof params.overwrite !== 'boolean') {
          return {
            path: null,
            err: 'asset_create_material `overwrite` must be a boolean when provided'
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
    case 'asset_clone_material': {
      // It is not possibly modifying a builtin material, unless you clone the material
      try {
        const info = await ProjectService.getCurrentProjectInfo();
        if (!info) {
          return {
            err: 'No project is currently opened; create or open a project first'
          };
        }
        let srcPath: string = params.srcPath;
        if (typeof srcPath !== 'string' || !srcPath) {
          return {
            err: 'asset_clone_material requires `srcPath`, for example /assets/@builtins/unlit.zmtl'
          };
        }
        srcPath = ProjectService.VFS.normalizePath(srcPath);
        let dstPath: string = params.dstPath;
        if (typeof dstPath !== 'string' || !dstPath) {
          return {
            err: 'asset_clone_material requires `dstPath`, for example /assets/new_material.zmtl'
          };
        }
        await ProjectService.VFS.copyFile(srcPath, dstPath, { overwrite: true });
        return {
          err: null
        };
      } catch (err) {
        return {
          path: null,
          err: `${err}`
        };
      }
    }
    case 'asset_read_file': {
      try {
        const info = await ProjectService.getCurrentProjectInfo();
        if (!info) {
          return {
            result: null,
            err: 'No project is currently opened; create or open a project first'
          };
        }
        if (typeof params.path !== 'string' || !params.path) {
          return {
            result: null,
            err: 'asset_read_file requires `path`, the asset file VFS path under /assets'
          };
        }
        const encoding = params.encoding ?? 'utf8';
        if (encoding !== 'utf8' && encoding !== 'binary') {
          return {
            result: null,
            err: 'asset_read_file `encoding` must be `utf8` or `binary`'
          };
        }
        const stat = await ProjectService.VFS.stat(params.path);
        if (!stat) {
          return {
            result: null,
            err: `Asset file not found: ${params.path}`
          };
        }
        if (!stat.isFile) {
          return {
            result: null,
            err: `Asset path is not a file: ${params.path}`
          };
        }
        const content = await ProjectService.VFS.readFile(params.path, { encoding });
        return {
          result:
            encoding === 'utf8'
              ? (content as string)
              : uint8ArrayToBase64(new Uint8Array(content as ArrayBuffer)),
          err: null
        };
      } catch (err) {
        return {
          result: null,
          err: `${err}`
        };
      }
    }
    case 'asset_write_file': {
      try {
        const info = await ProjectService.getCurrentProjectInfo();
        if (!info) {
          return {
            err: 'No project is currently opened; create or open a project first'
          };
        }
        if (typeof params.path !== 'string' || !params.path) {
          return {
            err: 'asset_write_file requires `path`, the asset file VFS path under /assets'
          };
        }
        const encoding = params.encoding ?? 'utf8';
        if (encoding !== 'utf8' && encoding !== 'binary') {
          return {
            err: 'asset_write_file `encoding` must be `utf8` or `binary`'
          };
        }
        if (typeof params.content !== 'string') {
          return {
            err: 'asset_write_file requires `content` as a string; use base64 text when encoding is binary'
          };
        }
        const content = encoding === 'utf8' ? params.content : base64ToUint8Array(params.content).buffer;
        await ProjectService.VFS.writeFile(params.path, content, {
          encoding,
          create: true
        });
        return {
          err: null
        };
      } catch (err) {
        return {
          result: null,
          err: `${err}`
        };
      }
    }
    case 'asset_read_directory': {
      try {
        const info = await ProjectService.getCurrentProjectInfo();
        if (!info) {
          return {
            result: null,
            err: 'No project is currently opened; create or open a project first'
          };
        }
        if (typeof params.path !== 'string' || !params.path) {
          return {
            result: null,
            err: 'asset_read_directory requires `path`, the asset directory VFS path under /assets'
          };
        }
        if (params.recursive !== undefined && typeof params.recursive !== 'boolean') {
          return {
            result: null,
            err: 'asset_read_directory `recursive` must be a boolean when provided'
          };
        }
        if (params.pattern !== undefined && typeof params.pattern !== 'string') {
          return {
            result: null,
            err: 'asset_read_directory `pattern` must be a string when provided'
          };
        }
        const stat = await ProjectService.VFS.stat(params.path);
        if (!stat) {
          return {
            result: null,
            err: `Asset directory not found: ${params.path}`
          };
        }
        if (!stat.isDirectory) {
          return {
            result: null,
            err: `Asset path is not a directory: ${params.path}`
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
      const info = await ProjectService.getCurrentProjectInfo();
      if (!info) {
        return {
          values: null,
          err: 'No project is currently opened; create or open a project first'
        };
      }
      const materialRef = new DRef<Material>();
      try {
        let path = params.path as string;
        if (typeof path !== 'string' || !path.trim()) {
          return {
            values: null,
            err: 'material_get_properties requires `path`, the material asset VFS path'
          };
        }
        path = path.trim();
        const properties = params.properties as string[];
        if (!Array.isArray(properties) || properties.some((val) => typeof val !== 'string')) {
          return {
            values: null,
            err: 'material_get_properties requires `properties` as an array of material property names'
          };
        }
        const material = await getEngine().resourceManager.fetchMaterial(path);
        if (!material) {
          return {
            values: null,
            err: `Cannot load material asset for material_get_properties: ${path}`
          };
        }
        materialRef.set(material);
        const materialClass = getEngine().resourceManager.getClassByObject(material);
        if (!materialClass) {
          return {
            values: null,
            err: `Cannot resolve material class for asset: ${path}`
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
              err: `Unknown material property "${propertyName}" for ${path}. Use material_get_property_list first and pass one of its propertyName/name values.`
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
              err: `material_get_properties does not support object_array property "${prop.name}"`
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
              err: `material_get_properties does not support property "${prop.name}" of type ${prop.type}`
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
        const info = await ProjectService.getCurrentProjectInfo();
        if (!info) {
          return {
            err: 'No project is currently opened; create or open a project first'
          };
        }
        let path = params.path as string;
        if (typeof path !== 'string' || !path.trim()) {
          return {
            err: 'material_set_properties requires `path`, the material asset VFS path'
          };
        }
        path = ProjectService.VFS.normalizePath(path.trim());
        if (path.startsWith('/assets/@builtins')) {
          return {
            err: 'Builtin materials are not modifierable, use `asset_clone_material` first'
          };
        }
        const properties = params.properties as { propertyName: string; value: unknown }[];
        if (!Array.isArray(properties)) {
          return {
            err: 'material_set_properties requires `properties` as an array of { propertyName, value } objects'
          };
        }
        const material = await getEngine().resourceManager.fetchMaterial(path);
        if (!material) {
          return {
            err: `Cannot load material asset for material_set_properties: ${path}`
          };
        }
        materialRef.set(material);
        const fileContent = (await ProjectService.VFS.readFile(path, { encoding: 'utf8' })) as string;
        const json = JSON.parse(fileContent);
        const materialClass = getEngine().resourceManager.getClassByObject(material);
        if (!materialClass) {
          return {
            err: `Cannot resolve material class for asset: ${path}`
          };
        }
        const props = materialClass.getProps();
        for (const p of properties) {
          let propertyName = p.propertyName as string;
          if (typeof propertyName !== 'string' || !propertyName.trim()) {
            return {
              err: 'material_set_properties requires each property update to include non-empty `propertyName`'
            };
          }
          propertyName = propertyName.trim();
          const prop = props.find((prop) => prop.name === propertyName);
          if (!prop) {
            return {
              err: `Unknown material property "${propertyName}" for ${path}. Use material_get_property_list first and pass one of its propertyName/name values.`
            };
          }
          if (!prop.set) {
            return {
              err: `Material property "${prop.name}" is read-only and cannot be set`
            };
          }
          if (prop.type === 'object_array') {
            return {
              err: `material_set_properties does not support object_array property "${prop.name}"`
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
                err: `Property "${prop.name}" expects ${prop.type}; boolean value is not accepted`
              };
            } else {
              value.bool[0] = p.value;
            }
          } else if (typeof p.value === 'string') {
            if (prop.type !== 'string' && prop.type !== 'object') {
              return {
                err: `Property "${prop.name}" expects ${prop.type}; string value is not accepted`
              };
            } else {
              value.str[0] = p.value;
            }
          } else if (typeof p.value === 'number') {
            if (prop.type !== 'float' && prop.type !== 'int') {
              return {
                err: `Property "${prop.name}" expects ${prop.type}; number value is not accepted`
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
                err: `Property "${prop.name}" has unsupported type ${prop.type}; cannot set from an array`
              };
            }
            if (p.value.length !== n || p.value.some((val) => typeof val !== 'number')) {
              return {
                err: `Property "${prop.name}" expects ${prop.type}; provide an array of exactly ${n} numbers`
              };
            }
            for (let i = 0; i < n; i++) {
              value.num[i] = p.value[i];
            }
          } else {
            return {
              err: `Invalid value for material property "${prop.name}"; expected value compatible with type ${prop.type}`
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
      try {
        const props = getEngine().resourceManager.getPropertiesByClass(
          getEngine().resourceManager.getClassByConstructor(Scene)
        );
        return {
          propertyList: JSON.parse(JSON.stringify(props)),
          err: null
        };
      } catch (err) {
        return {
          propertyList: null,
          err: `${err}`
        };
      }
    }
    case 'getMaterialPropertyList': {
      let path = params.path as string;
      if (typeof path !== 'string' || !path.trim()) {
        return {
          propertyList: null,
          err: 'getMaterialPropertyList requires `path`, the material asset VFS path'
        };
      }
      path = path.trim();
      try {
        const info = await ProjectService.getCurrentProjectInfo();
        if (!info) {
          return {
            propertyList: null,
            err: 'No project is currently opened; create or open a project first'
          };
        }
        if (!(await ProjectService.VFS.exists(path))) {
          return {
            propertyList: null,
            err: `Material asset file not found: ${path}`
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
            err: `Invalid material asset file: expected json.data.ClassName to name a registered material class, got ${String(classname)} at ${path}; root keys: ${Object.keys(json ?? {}).join(', ')}`
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
          err: 'getNodePropertyList requires `id`, the persistent id of a scene node'
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
                err: 'No project is currently opened'
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
            err: 'createProject requires `name`, the new project display name'
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
            err: 'openProject requires `id`, the project uuid returned by project_list'
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
          return { err: 'No project is currently opened; cannot delete a project' };
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
          err: 'No scene is currently opened; create or open a scene before creating a shape node'
        };
      }
      const shape = String(params.shape ?? '')
        .trim()
        .toLowerCase() as ShapePrimitiveType;
      if (!Object.prototype.hasOwnProperty.call(shapePrimitivePaths, shape)) {
        return {
          node: null,
          transform: null,
          err: `Unsupported shape type: ${params.shape}. Supported shapes: ${Object.keys(shapePrimitivePaths).join(', ')}`
        };
      }
      const parentId = typeof params.parentId === 'string' ? params.parentId.trim() : '';
      const parentNode = parentId ? scene.findNodeById(parentId) : scene.rootNode;
      if (!parentNode) {
        return {
          node: null,
          transform: null,
          err: `Parent node not found in current scene: ${parentId}`
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
          err: 'getNodeClass requires `id`, the persistent id of a scene node'
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
          err: 'setNodeLocalTransform requires `id`, the persistent id of a scene node'
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
            err: 'setNodeLocalTransform `position` must be an array of exactly 3 numbers: [x, y, z]'
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
            err: 'setNodeLocalTransform `scale` must be an array of exactly 3 numbers: [x, y, z]'
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
            err: 'setNodeLocalTransform `rotation` must be a quaternion array of exactly 4 numbers: [x, y, z, w]'
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
          err: 'getNodeLocalTransform requires `id`, the persistent id of a scene node'
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
          err: 'No project is currently opened; create or open a project first'
        };
      }
      const scene = getScene(editor);
      if (!scene) {
        return {
          node: null,
          err: 'No scene is currently opened; create or open a scene first'
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
          err: 'getParentNode requires `id`, the persistent id of a scene node'
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
          err: 'removeNode requires `id`, the persistent id of a scene node'
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
          err: 'setParentNode requires `id`, the persistent id of the node to reparent'
        };
      }
      const newParentId = params.parentId as string;
      if (typeof newParentId !== 'string' || !newParentId.trim()) {
        return {
          err: 'setParentNode requires `parentId`, the persistent id of the new parent node'
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
          err: `Cannot reparent node ${id.trim()} under its descendant ${newParentId.trim()}`
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
          err: 'getSubNodes requires `parent`, the persistent id of the parent scene node'
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
          err: 'No project is currently opened; create or open a project before creating a scene'
        };
      }
      const controller = getSceneController(editor);
      if (!controller?.createScene) {
        await editor.moduleManager.activate('Scene', '');
      }
      const sceneController = getSceneController(editor);
      if (!sceneController?.createScene) {
        return {
          ...getStatus(editor),
          err: 'Scene module is not active or does not support creating scenes'
        };
      }
      sceneController.createScene(params?.resetView ?? true, params?.path);
      return getStatus(editor);
    }
    case 'openScene': {
      const path = typeof params?.path === 'string' ? params.path.trim() : '';
      if (!path) {
        return {
          ...getStatus(editor),
          err: 'openScene requires `path`, for example /assets/scene.zscn'
        };
      }
      const controller = getSceneController(editor);
      if (!controller?.openScene) {
        await editor.moduleManager.activate('Scene', '');
      }
      const sceneController = getSceneController(editor);
      if (!sceneController?.openScene) {
        return {
          ...getStatus(editor),
          err: 'Scene module is not active or does not support opening scenes'
        };
      }
      await sceneController.openScene(path, params?.resetView ?? true);
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
      // GPU-backed canvases, especially WebGPU, may not remain serializable once the
      // render task has completed. Re-render immediately before capture so screenshot
      // encoding happens in the same task as drawing.
      editor.render();
      return {
        width: canvas.width,
        height: canvas.height,
        dataUrl: await canvasToDataUrl(canvas, params?.mimeType ?? 'image/png', params?.quality)
      };
    }
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
          reject(new Error('Canvas screenshot failed: canvas.toBlob returned null'));
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

async function runEval(editor: Editor, source: string, expression: boolean): Promise<any> {
  if (!source || typeof source !== 'string') {
    throw new Error('eval requires a non-empty JavaScript `script` string');
  }
  const controller = getSceneController(editor);
  const scene = getScene(editor);
  const body = expression ? `return (${source});` : source;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('editor', 'controller', 'scene', 'getDevice', 'getEngine', 'args', body);
  return fn(editor, controller, scene, getDevice, getEngine, {});
}
