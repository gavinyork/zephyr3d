import type { VFS } from '@zephyr3d/base';
import type { PipelineCacheData, PipelineRecorder } from '@zephyr3d/device';
import type { Application, PipelineCacheManifest, Scene, SceneNode, Camera } from '@zephyr3d/scene';
import { getDevice, getEngine, PIPELINE_CACHE_MANIFEST_FILE } from '@zephyr3d/scene';

// Pipelines recorded while a project is previewed, so a build can compile them
// before the draws that need them. A scene's pipelines are kept beside it as
// `<scene>.zpso`, carried along with the scene like `.zmeta` sidecars and shipped
// with the assets; those no scene claimed go to the project root.

/** Extension of the pipeline cache kept beside a scene */
export const PIPELINE_CACHE_EXTENSION = '.zpso';
/** Pipelines no scene claimed */
export const PIPELINE_CACHE_COMMON_FILE = `/pipeline-cache${PIPELINE_CACHE_EXTENSION}`;
/** Key in a camera's metadata marking it as a pipeline warmup camera */
const WARMUP_METADATA_KEY = 'pipelineWarmup';
/** Frames each warmup camera renders: the first frame of a view and the frames after differ */
const WARMUP_FRAMES = 4;
/** Recordings are written back this often while they grow */
const SAVE_INTERVAL_MS = 3000;

export function getScenePipelineCachePath(scenePath: string) {
  return `${scenePath}${PIPELINE_CACHE_EXTENSION}`;
}

/** Whether a path is the pipeline cache beside a scene */
export function isScenePipelineCachePath(path: string) {
  return path.toLowerCase().endsWith(`.zscn${PIPELINE_CACHE_EXTENSION}`);
}

export function isPipelineWarmupCamera(node: SceneNode) {
  const metaData = node.metaData as Record<string, unknown> | null;
  return !!node.isCamera() && !!metaData && typeof metaData === 'object' && !!metaData[WARMUP_METADATA_KEY];
}

export function setPipelineWarmupCamera(node: SceneNode, warmup: boolean) {
  const metaData = { ...((node.metaData as Record<string, unknown>) ?? {}) };
  if (warmup) {
    metaData[WARMUP_METADATA_KEY] = true;
  } else {
    delete metaData[WARMUP_METADATA_KEY];
  }
  node.metaData = Object.keys(metaData).length > 0 ? metaData : null;
}

async function readPipelineCache(vfs: VFS, path: string) {
  try {
    if (await vfs.exists(path)) {
      const data = JSON.parse(
        (await vfs.readFile(path, { encoding: 'utf8' })) as string
      ) as PipelineCacheData;
      return data?.format === 'zephyr3d-pso' ? data : null;
    }
  } catch (err) {
    console.warn(`Pipeline cache ${path} unreadable: ${err}`);
  }
  return null;
}

/** Pipeline cache files of a project: the common file, then those beside scenes */
export async function listPipelineCacheFiles(vfs: VFS) {
  const files: string[] = [];
  if (await vfs.exists(PIPELINE_CACHE_COMMON_FILE)) {
    files.push(PIPELINE_CACHE_COMMON_FILE);
  }
  // Scenes live under /assets; a build's copies under /dist are not the project's
  const sidecars = await vfs.glob(`/assets/**/*.zscn${PIPELINE_CACHE_EXTENSION}`, {
    includeDirs: false,
    recursive: true
  });
  files.push(...sidecars.map((entry) => entry.path).sort());
  return files;
}

/**
 * Manifest of the pipeline caches of a project, read from the files themselves,
 * as {@link PipelineCacheManager.findEntries} takes it
 */
export async function scanPipelineCacheManifest(vfs: VFS): Promise<PipelineCacheManifest> {
  const entries: PipelineCacheManifest['entries'] = [];
  for (const file of await listPipelineCacheFiles(vfs)) {
    const data = await readPipelineCache(vfs, file);
    if (data) {
      entries.push({
        tag: file === PIPELINE_CACHE_COMMON_FILE ? null : file.slice(0, -PIPELINE_CACHE_EXTENSION.length),
        file,
        render: data.render.length,
        compute: data.compute.length
      });
    }
  }
  return { format: 'zephyr3d-pso-manifest', version: 1, entries };
}

/**
 * Ships the pipeline caches with a build: those beside scenes are copied with the
 * assets, this adds the common file and the manifest the build's entry reads
 */
export async function shipPipelineCaches(vfs: VFS, distDir: string) {
  const manifest = await scanPipelineCacheManifest(vfs);
  if (manifest.entries.length === 0) {
    return;
  }
  if (await vfs.exists(PIPELINE_CACHE_COMMON_FILE)) {
    await vfs.copyFile(PIPELINE_CACHE_COMMON_FILE, vfs.join(distDir, PIPELINE_CACHE_COMMON_FILE), {
      overwrite: true
    });
  }
  // Relative to the manifest, so the build can be served from any path
  const shipped: PipelineCacheManifest = {
    ...manifest,
    entries: manifest.entries.map((entry) => ({ ...entry, file: entry.file.replace(/^\/+/, '') }))
  };
  await vfs.writeFile(vfs.join(distDir, PIPELINE_CACHE_MANIFEST_FILE), JSON.stringify(shipped, null, 2), {
    encoding: 'utf8',
    create: true
  });
}

/**
 * Compiles the recorded pipelines of a scene, and those no scene claimed, before it
 * starts; then, if asked, those of the other scenes in the background. The preview
 * does what a build's entry does
 */
export async function precompileStartupPipelines(
  vfs: VFS,
  startupScene: string | null | undefined,
  options: { otherScenes: boolean; onProgress?: (done: number, total: number) => void }
) {
  const manifest = await scanPipelineCacheManifest(vfs);
  if (manifest.entries.length === 0) {
    return;
  }
  const cache = getEngine().pipelineCache;
  const entries = cache.findEntries(manifest, { scenes: startupScene ? [startupScene] : [] });
  await cache.createTask(entries, { name: 'startup' }).run({
    onProgress: (p) => options.onProgress?.(p.completed + p.failed + p.skipped, p.total)
  });
  if (options.otherScenes) {
    void cache.createTask(manifest.entries, { name: 'other scenes' }).run({ priority: 'background' });
  }
}

/**
 * Records the pipelines of a preview into the project.
 *
 * @remarks
 * Only uses what the engine offers anyway: the device's pipeline recorder, the
 * scenes' `startrender`/`endrender` events to group pipelines by scene, and the
 * application's `tick` to render warmup cameras before each frame. Rendering itself
 * is untouched. Recording starts before the first frame, as render bundles replay
 * their draws without asking for pipelines again.
 */
export class PipelineRecordingSession {
  private readonly _vfs: VFS;
  private readonly _recorder: PipelineRecorder;
  private readonly _scenePaths: WeakMap<Scene, string>;
  /** Warmup frames left per scene; scenes get their turn the first time they are rendered */
  private readonly _warmups: Map<Scene, number>;
  private readonly _warmedUp: WeakSet<Scene>;
  /** Pipelines per tag when last written */
  private readonly _written: Map<string | null, number>;
  private _warmingUp: boolean;
  private _saving: boolean;
  private _lastCount: number;
  private readonly _badge: HTMLDivElement;
  private constructor(vfs: VFS, recorder: PipelineRecorder) {
    this._vfs = vfs;
    this._recorder = recorder;
    this._scenePaths = new WeakMap();
    this._warmups = new Map();
    this._warmedUp = new WeakSet();
    this._written = new Map();
    this._warmingUp = false;
    this._saving = false;
    this._lastCount = -1;
    this._badge = PipelineRecordingSession.createBadge();
  }
  /**
   * Starts recording the pipelines of the preview into the project.
   * @returns The session, or null if nothing can be recorded
   */
  static async start(app: Application, vfs: VFS) {
    const recorder = getDevice().getPipelineRecorder();
    if (!recorder || vfs.readOnly) {
      const badge = PipelineRecordingSession.createBadge();
      badge.textContent = !recorder
        ? 'Pipelines not recorded: only WebGPU records pipelines'
        : 'Pipelines not recorded: the project is read-only';
      return null;
    }
    const session = new PipelineRecordingSession(vfs, recorder);
    recorder.begin();
    await session.mergeExisting();
    session.watchScenes();
    app.on('tick', () => session.warmup());
    setInterval(() => void session.save(), SAVE_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void session.save();
      }
    });
    session.updateBadge();
    return session;
  }
  private static createBadge() {
    const badge = document.createElement('div');
    // Never takes the focus or the pointer away from the canvas
    badge.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:10000;pointer-events:none;user-select:none;' +
      'padding:4px 8px;border-radius:4px;background:rgba(160,20,20,0.75);color:#fff;' +
      'font:12px sans-serif;';
    document.body.appendChild(badge);
    return badge;
  }
  /** Earlier recordings are kept: each session adds what it sees */
  private async mergeExisting() {
    for (const file of await listPipelineCacheFiles(this._vfs)) {
      const data = await readPipelineCache(this._vfs, file);
      if (data) {
        this._recorder.merge(data);
        this._written.set(data.tag, data.render.length + data.compute.length);
      }
    }
  }
  /** Scenes loaded from files group their pipelines under their path */
  private watchScenes() {
    const engine = getEngine();
    const loadSceneFromFile = engine.loadSceneFromFile.bind(engine);
    engine.loadSceneFromFile = async (path: string) => {
      const scene = await loadSceneFromFile(path);
      if (scene && !this._scenePaths.has(scene)) {
        this._scenePaths.set(scene, engine.VFS.normalizePath(path));
        scene.on('startrender', this.onStartRender, this);
        scene.on('endrender', this.onEndRender, this);
      }
      return scene;
    };
  }
  private onStartRender(scene: Scene) {
    this._recorder.pushTag(this._scenePaths.get(scene)!);
    if (!this._warmedUp.has(scene)) {
      this._warmedUp.add(scene);
      this._warmups.set(scene, WARMUP_FRAMES);
    }
  }
  private onEndRender() {
    this._recorder.popTag();
  }
  /**
   * Renders the warmup cameras of newly shown scenes before the frame: the frame then
   * renders as usual over them, so what is shown and played does not change
   */
  private warmup() {
    if (this._warmingUp || this._warmups.size === 0) {
      return;
    }
    this._warmingUp = true;
    try {
      for (const [scene, frames] of this._warmups) {
        const cameras: Camera[] = [];
        scene.rootNode.iterate((node) => {
          if (node !== scene.mainCamera && isPipelineWarmupCamera(node)) {
            cameras.push(node as Camera);
          }
          return false;
        });
        for (const camera of cameras) {
          camera.render(scene);
        }
        if (frames <= 1 || cameras.length === 0) {
          this._warmups.delete(scene);
        } else {
          this._warmups.set(scene, frames - 1);
        }
      }
    } finally {
      this._warmingUp = false;
    }
  }
  /** Writes back the recordings that grew since they were last written */
  private async save() {
    const count = this._recorder.count;
    if (this._saving || count === this._lastCount) {
      return;
    }
    this._saving = true;
    try {
      for (const tag of this._recorder.tags()) {
        const data = this._recorder.export(tag);
        const size = data.render.length + data.compute.length;
        if (size === this._written.get(tag)) {
          continue;
        }
        const path = tag === null ? PIPELINE_CACHE_COMMON_FILE : getScenePipelineCachePath(tag);
        await this._vfs.writeFile(path, JSON.stringify(data), { encoding: 'utf8', create: true });
        this._written.set(tag, size);
      }
      this._lastCount = count;
    } catch (err) {
      console.error(`Writing pipeline caches failed: ${err}`);
    } finally {
      this._saving = false;
      this.updateBadge();
    }
  }
  private updateBadge() {
    this._badge.textContent = `Recording pipelines: ${this._recorder.count}`;
  }
}
