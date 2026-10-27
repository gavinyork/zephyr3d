import type { VFS } from '@zephyr3d/base';
import type { AssetHierarchyNode, MeshSDFData, MeshImportSettings, SharedModel } from '@zephyr3d/scene';
import {
  decodeZsdf,
  getEngine,
  getMeshSDFPath,
  MESH_SDF_DIR,
  readMeshImportSettings,
  readPrimitiveTriangles,
  readZsdf,
  writeMeshImportSettings
} from '@zephyr3d/scene';
import type { SDFBakeRequest, SDFBakeResponse } from '../../workers/sdf_bake';
import { ProjectService } from './project';

/** Bumped whenever the baker's output changes, so every field is rebaked. */
const SDF_BAKER_VERSION = 3;

/** Outcome of baking one mesh. */
export interface MeshSDFBakeResult {
  path: string;
  sdf_path: string;
  /** True when an up-to-date field was already there */
  skipped: boolean;
  resolution?: [number, number, number];
  voxel_size?: number;
  triangles?: number;
  milliseconds?: number;
  err?: string;
}

async function sha1Hex(data: ArrayBuffer | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function settingsKey(settings: MeshImportSettings) {
  return JSON.stringify([
    settings.sdfResolutionScale,
    settings.sdfTwoSided,
    settings.sdfUnitScale,
    SDF_BAKER_VERSION
  ]);
}

/**
 * Bakes the signed distance fields of mesh assets into {@link MESH_SDF_DIR},
 * one `.zsdf` per `.zmsh`, in a pool of workers.
 *
 * A field records the content hash of its source and the settings it was baked
 * with, so a bake is skipped while both still match.
 */
export class MeshSDFBaker {
  private static readonly _workers: { worker: Worker; busy: boolean }[] = [];
  /** Requests waiting for a worker, oldest first */
  private static readonly _queue: (() => void)[] = [];
  private static _nextId = 1;
  private static readonly _pending = new Map<
    number,
    { resolve: (r: SDFBakeResponse) => void; reject: (e: Error) => void; worker: Worker }
  >();
  /** Decoded fields, per mesh path and the hash they were decoded at */
  private static readonly _decoded = new Map<string, { key: string; sdf: MeshSDFData }>();

  /** Bakes one mesh asset unless its field is up to date. */
  static async bake(path: string, force = false): Promise<MeshSDFBakeResult> {
    const vfs = ProjectService.VFS;
    const sdfPath = getMeshSDFPath(path);
    try {
      const settings = await readMeshImportSettings(vfs, path);
      const source = { hash: await this.sourceHash(path), settings: settingsKey(settings) };
      if (!force && (await this.isUpToDate(vfs, sdfPath, source))) {
        return { path, sdf_path: sdfPath, skipped: true };
      }
      const primitive = await getEngine().resourceManager.fetchPrimitive(path);
      if (!primitive) {
        throw new Error(`Mesh not found: ${path}`);
      }
      if (primitive.primitiveType !== 'triangle-list') {
        throw new Error(`Only triangle lists have a distance field: ${path} is ${primitive.primitiveType}`);
      }
      const { positions, indices } = await readPrimitiveTriangles(primitive, 0);
      // Read before the buffers are transferred to the worker
      const triangles = indices.length / 3;
      const res = await this.run({
        positions,
        indices,
        options: {
          resolutionScale: settings.sdfResolutionScale,
          twoSided: settings.sdfTwoSided,
          unitScale: settings.sdfUnitScale
        },
        source
      });
      if (!(await vfs.exists(MESH_SDF_DIR))) {
        await vfs.makeDirectory(MESH_SDF_DIR, true);
      }
      await vfs.writeFile(sdfPath, res.data!, { encoding: 'binary', create: true });
      this._decoded.delete(path);
      return {
        path,
        sdf_path: sdfPath,
        skipped: false,
        resolution: res.resolution,
        voxel_size: res.voxelSize,
        triangles,
        milliseconds: Math.round(res.milliseconds ?? 0)
      };
    } catch (err) {
      return {
        path,
        sdf_path: sdfPath,
        skipped: false,
        err: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /** Workers baking at once: one per core but the main thread's, at most eight. */
  static get poolSize() {
    return Math.max(1, Math.min(8, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1));
  }

  /** Bakes meshes with as many workers as the pool holds; results are in the order of `paths`. */
  static async bakeAll(
    paths: string[],
    force = false,
    onProgress?: (done: number, total: number) => void
  ): Promise<MeshSDFBakeResult[]> {
    const unique = [...new Set(paths)];
    const results: MeshSDFBakeResult[] = new Array(unique.length);
    let next = 0;
    let done = 0;
    const lane = async () => {
      while (next < unique.length) {
        const i = next++;
        results[i] = await this.bake(unique[i], force);
        onProgress?.(++done, unique.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.poolSize, unique.length) }, lane));
    return results;
  }

  /**
   * World units one local unit spans for each mesh of an imported model, the
   * largest over the nodes (and their instances) using it, keyed by mesh asset
   * path and merged into `scales`. Per node the product of the largest axis
   * scale of it and each of its parents, which bounds the stretch any rotation
   * between them can give.
   */
  static modelUnitScales(model: SharedModel, scales = new Map<string, number>()) {
    const largest = (v: { x: number; y: number; z: number }) =>
      Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    for (const node of model.nodes) {
      if (!node.mesh) {
        continue;
      }
      let scale = 1;
      for (let n: AssetHierarchyNode | null = node; n; n = n.parent) {
        scale *= largest(n.scaling);
      }
      if (node.instances.length > 0) {
        scale *= Math.max(...node.instances.map((i) => largest(i.s)));
      }
      for (const sub of node.mesh.subMeshes) {
        const path = sub.primitive?.path;
        if (path) {
          scales.set(path, Math.max(scales.get(path) ?? 0, scale));
        }
      }
    }
    return scales;
  }

  /**
   * Records in the meshes' settings the world units one of their local units
   * spans (`sdfUnitScale`), where it differs from what is recorded, so their
   * next bake measures the voxel density in world units. Built-in meshes,
   * whose settings cannot be written, are left out.
   */
  static async setUnitScales(scales: Map<string, number>) {
    const vfs = ProjectService.VFS;
    for (const [path, scale] of scales) {
      if (!(scale > 0) || !Number.isFinite(scale) || path.startsWith('/assets/@builtins/')) {
        continue;
      }
      // Rounded so scales that differ by float noise keep the same bake key
      const rounded = Number(scale.toPrecision(4));
      const settings = await readMeshImportSettings(vfs, path);
      if (settings.sdfUnitScale !== rounded) {
        await writeMeshImportSettings(vfs, path, { ...settings, sdfUnitScale: rounded });
      }
    }
  }

  /** The baked field of a mesh asset, decoded for CPU queries, or null if none is baked. */
  static async load(path: string): Promise<MeshSDFData | null> {
    const vfs = ProjectService.VFS;
    const sdfPath = getMeshSDFPath(path);
    if (!(await vfs.exists(sdfPath))) {
      return null;
    }
    const stat = await vfs.stat(sdfPath);
    const key = `${stat.size}|${stat.modified?.getTime?.() ?? 0}`;
    const cached = this._decoded.get(path);
    if (cached?.key === key) {
      return cached.sdf;
    }
    const sdf = decodeZsdf((await vfs.readFile(sdfPath, { encoding: 'binary' })) as ArrayBuffer);
    this._decoded.set(path, { key, sdf });
    return sdf;
  }

  private static async sourceHash(path: string) {
    // Built-in meshes may not be readable as files; they never change within a version
    try {
      const vfs = path.startsWith('/assets/@builtins/') ? getEngine().VFS : ProjectService.VFS;
      return await sha1Hex((await vfs.readFile(path, { encoding: 'binary' })) as ArrayBuffer);
    } catch {
      return await sha1Hex(path);
    }
  }

  private static async isUpToDate(vfs: VFS, sdfPath: string, source: { hash: string; settings: string }) {
    try {
      if (!(await vfs.exists(sdfPath))) {
        return false;
      }
      const { header } = readZsdf((await vfs.readFile(sdfPath, { encoding: 'binary' })) as ArrayBuffer);
      return header.source?.hash === source.hash && header.source?.settings === source.settings;
    } catch {
      return false;
    }
  }

  private static async run(req: Omit<SDFBakeRequest, 'id'>) {
    const slot = await this.acquireWorker();
    const id = this._nextId++;
    return new Promise<SDFBakeResponse>((resolve, reject) => {
      this._pending.set(id, { resolve, reject, worker: slot.worker });
      slot.worker.postMessage({ ...req, id }, [req.positions.buffer, req.indices.buffer]);
    });
  }

  /** An idle worker, a new one while the pool is not full, or the next one to finish. */
  private static acquireWorker(): Promise<{ worker: Worker; busy: boolean }> {
    const idle = this._workers.find((w) => !w.busy);
    if (idle) {
      idle.busy = true;
      return Promise.resolve(idle);
    }
    if (this._workers.length < this.poolSize) {
      const slot = { worker: this.createWorker(), busy: true };
      this._workers.push(slot);
      return Promise.resolve(slot);
    }
    return new Promise((resolve) => {
      this._queue.push(() => {
        const slot = this._workers.find((w) => !w.busy);
        if (slot) {
          slot.busy = true;
          resolve(slot);
        } else {
          // Every worker died meanwhile; start afresh
          const fresh = { worker: this.createWorker(), busy: true };
          this._workers.push(fresh);
          resolve(fresh);
        }
      });
    });
  }

  private static releaseWorker(worker: Worker) {
    const slot = this._workers.find((w) => w.worker === worker);
    if (slot) {
      slot.busy = false;
    }
    this._queue.shift()?.();
  }

  private static createWorker() {
    const worker = new Worker(new URL('../../workers/sdf_bake.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SDFBakeResponse>) => {
      const p = this._pending.get(e.data.id);
      if (p) {
        this._pending.delete(e.data.id);
        if (e.data.type === 'result') {
          p.resolve(e.data);
        } else {
          p.reject(new Error(e.data.message));
        }
      }
      this.releaseWorker(worker);
    };
    worker.onerror = (e) => {
      for (const [id, p] of [...this._pending]) {
        if (p.worker === worker) {
          this._pending.delete(id);
          p.reject(new Error(e.message || 'SDF bake worker crashed'));
        }
      }
      worker.terminate();
      const at = this._workers.findIndex((w) => w.worker === worker);
      if (at >= 0) {
        this._workers.splice(at, 1);
      }
      this._queue.shift()?.();
    };
    return worker;
  }
}
