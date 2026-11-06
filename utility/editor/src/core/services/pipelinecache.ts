import type { VFS } from '@zephyr3d/base';
import type { PipelineCacheData, PipelineRecorder } from '@zephyr3d/device';
import type { Application, Scene, SceneNode, Camera } from '@zephyr3d/scene';
import { getDevice, getEngine, PIPELINE_CACHE_FILE } from '@zephyr3d/scene';
import { recordAssetRequests, writeScenePreload } from './assetpreload';

// Pipelines recorded while a project is previewed, so a build can compile them
// before the draws that need them. They are kept in one file at the project root,
// shipped as it is at the root of a build. The file holds the recordings of every
// backend previewed, one each; recording replaces only its own.

/** Key in a camera's metadata marking it as a pipeline warmup camera */
const WARMUP_METADATA_KEY = 'pipelineWarmup';
/** Frames each warmup camera renders: the first frame of a view and the frames after differ */
const WARMUP_FRAMES = 4;
/** Recordings are written back this often while they grow */
const SAVE_INTERVAL_MS = 3000;

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

/** Reads the recordings of a pipeline cache file, one per backend */
export async function readPipelineCache(vfs: VFS, path = PIPELINE_CACHE_FILE): Promise<PipelineCacheData[]> {
  try {
    if (await vfs.exists(path)) {
      const parsed = JSON.parse((await vfs.readFile(path, { encoding: 'utf8' })) as string) as
        | PipelineCacheData
        | PipelineCacheData[];
      // Files written before they held several backends hold a single recording
      return (Array.isArray(parsed) ? parsed : [parsed]).filter((data) => data?.format === 'zephyr3d-pso');
    }
  } catch (err) {
    console.warn(`Pipeline cache ${path} unreadable: ${err}`);
  }
  return [];
}

/** Copies the pipeline cache of a project to the root of a build, where its entry reads it */
export async function shipPipelineCache(vfs: VFS, distDir: string) {
  if (await vfs.exists(PIPELINE_CACHE_FILE)) {
    await vfs.copyFile(PIPELINE_CACHE_FILE, vfs.join(distDir, PIPELINE_CACHE_FILE), { overwrite: true });
  }
}

/** The task compiling the recorded pipelines of a project, or null if none are recorded */
export async function createPipelineCacheTask(vfs: VFS) {
  return (await vfs.exists(PIPELINE_CACHE_FILE)) ? getEngine().pipelineCache.createTask() : null;
}

/**
 * Records the pipelines of a preview into the project.
 *
 * @remarks
 * Scenes get their warmup cameras rendered on `tick` the first time they are rendered.
 * Recording must start before the first frame, as render bundles replay draws without
 * requesting pipelines again.
 */
export class PipelineRecordingSession {
  private readonly _vfs: VFS;
  private readonly _recorder: PipelineRecorder;
  private readonly _scenePaths: WeakMap<Scene, string>;
  /** Warmup frames left per scene; scenes get their turn the first time they are rendered */
  private readonly _warmups: Map<Scene, number>;
  private readonly _warmedUp: WeakSet<Scene>;
  /** Pipelines when last written */
  private _written: number;
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
    this._written = -1;
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
        ? 'Pipelines not recorded: this device does not record pipelines'
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
  /** Earlier recordings of this backend are kept: each session adds what it sees */
  private async mergeExisting() {
    const backend = getDevice().type;
    for (const data of await readPipelineCache(this._vfs)) {
      if (data.backend === backend) {
        // All in one group, as the file is read whole
        this._recorder.merge({ ...data, tag: null });
        this._written = data.render.length + data.compute.length;
      }
    }
  }
  /** Scenes loaded from files record what they fetch, and get warmed up when first shown */
  private watchScenes() {
    const engine = getEngine();
    const loadSceneFromFile = engine.loadSceneFromFile.bind(engine);
    engine.loadSceneFromFile = async (path: string) => {
      // With scripts running, loading may fetch more than the editor sees when it opens the scene
      const { result: scene, requests } = await recordAssetRequests(() => loadSceneFromFile(path));
      if (scene && !this._scenePaths.has(scene)) {
        const scenePath = engine.VFS.normalizePath(path);
        this._scenePaths.set(scene, scenePath);
        scene.on('startrender', this.onStartRender, this);
        void writeScenePreload(this._vfs, scenePath, 'runtime', requests);
      }
      return scene;
    };
  }
  private onStartRender(scene: Scene) {
    if (!this._warmedUp.has(scene)) {
      this._warmedUp.add(scene);
      this._warmups.set(scene, WARMUP_FRAMES);
    }
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
  /** Writes back the recording once it grew since it was last written */
  private async save() {
    const count = this._recorder.count;
    if (this._saving || count === this._lastCount) {
      return;
    }
    this._saving = true;
    try {
      const data = this._recorder.export(null);
      const size = data.render.length + data.compute.length;
      if (size !== this._written) {
        // The recordings of the other backends stay as they are
        const others = (await readPipelineCache(this._vfs)).filter((other) => other.backend !== data.backend);
        await this._vfs.writeFile(PIPELINE_CACHE_FILE, JSON.stringify([...others, data]), {
          encoding: 'utf8',
          create: true
        });
        this._written = size;
      }
      this._lastCount = count;
    } catch (err) {
      console.error(`Writing the pipeline cache failed: ${err}`);
    } finally {
      this._saving = false;
      this.updateBadge();
    }
  }
  private updateBadge() {
    this._badge.textContent = `Recording pipelines: ${this._recorder.count}`;
  }
}
