import type { VFS } from '@zephyr3d/base';
import type { MeshSDFData, MeshImportSettings } from '@zephyr3d/scene';
import {
  decodeZsdf,
  getEngine,
  getMeshSDFPath,
  MESH_SDF_DIR,
  readMeshImportSettings,
  readPrimitiveTriangles,
  readZsdf
} from '@zephyr3d/scene';
import type { SDFBakeRequest, SDFBakeResponse } from '../../workers/sdf_bake';
import { ProjectService } from './project';

/** Bumped whenever the baker's output changes, so every field is rebaked. */
const SDF_BAKER_VERSION = 1;

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
  return JSON.stringify([settings.sdfResolutionScale, settings.sdfTwoSided, SDF_BAKER_VERSION]);
}

/**
 * Bakes the signed distance fields of mesh assets into {@link MESH_SDF_DIR},
 * one `.zsdf` per `.zmsh`, in a worker.
 *
 * A field records the content hash of its source and the settings it was baked
 * with, so a bake is skipped while both still match.
 */
export class MeshSDFBaker {
  private static _worker: Worker | null = null;
  private static _nextId = 1;
  private static readonly _pending = new Map<
    number,
    { resolve: (r: SDFBakeResponse) => void; reject: (e: Error) => void }
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
        options: { resolutionScale: settings.sdfResolutionScale, twoSided: settings.sdfTwoSided },
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

  /** Bakes meshes one after another, so the worker is never handed more than one. */
  static async bakeAll(
    paths: string[],
    force = false,
    onProgress?: (done: number, total: number) => void
  ): Promise<MeshSDFBakeResult[]> {
    const unique = [...new Set(paths)];
    const results: MeshSDFBakeResult[] = [];
    for (let i = 0; i < unique.length; i++) {
      results.push(await this.bake(unique[i], force));
      onProgress?.(i + 1, unique.length);
    }
    return results;
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

  private static run(req: Omit<SDFBakeRequest, 'id'>) {
    const id = this._nextId++;
    return new Promise<SDFBakeResponse>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.getWorker().postMessage({ ...req, id }, [req.positions.buffer, req.indices.buffer]);
    });
  }

  private static getWorker() {
    if (!this._worker) {
      this._worker = new Worker(new URL('../../workers/sdf_bake.ts', import.meta.url), { type: 'module' });
      this._worker.onmessage = (e: MessageEvent<SDFBakeResponse>) => {
        const p = this._pending.get(e.data.id);
        if (p) {
          this._pending.delete(e.data.id);
          if (e.data.type === 'result') {
            p.resolve(e.data);
          } else {
            p.reject(new Error(e.data.message));
          }
        }
      };
      this._worker.onerror = (e) => {
        for (const p of this._pending.values()) {
          p.reject(new Error(e.message || 'SDF bake worker crashed'));
        }
        this._pending.clear();
        this._worker?.terminate();
        this._worker = null;
      };
    }
    return this._worker;
  }
}
