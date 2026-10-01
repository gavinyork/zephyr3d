import type { VFS } from '@zephyr3d/base';
import type { AssetSourceKind, MeshImportSettings, TextureImportSettings } from '@zephyr3d/scene';
import {
  ASSET_META_EXTENSION,
  getEngine,
  isAssetMetaPath,
  isSRGBTextureUsage,
  readMeshImportSettings,
  readTextureImportSettings,
  resolveTextureCompression
} from '@zephyr3d/scene';
import { isTextureSourcePath } from './assetmeta';
import { encodeCompressedPrimitive, isCompressiblePrimitive } from './meshencoder';
import type { EncodeRequest, EncodeResponse } from '../../workers/basis_encode';

/**
 * Derived data cache for compressed assets, after UE's DDC and Unity's Library:
 * the editor never alters source files, it derives a compressed copy per source
 * content + settings + encoder and keeps it under /.cache, which can be deleted
 * at any time and is rebuilt on demand. Textures derive KTX2 through the Basis
 * encoder, meshes a binary meshopt .zmsh.
 *
 * Bump an encoder id with its vendored encoder and the pipeline version with any
 * change to how settings map onto encoder options; either invalidates every
 * entry of that kind.
 */
const TEXTURE_ENCODER_ID = 'basisu-v2_50';
const TEXTURE_PIPELINE_VERSION = 1;
const MESH_ENCODER_ID = 'meshopt-1.3';
const MESH_PIPELINE_VERSION = 1;

export const DERIVED_CACHE_ROOT = '/.cache';
const DERIVED_DIR = '/.cache/derived';
const INDEX_PATH = '/.cache/derived/source-index.json';

const KINDS = {
  texture: { dir: `${DERIVED_DIR}/textures`, ext: '.ktx2', mimeType: 'image/ktx2' },
  primitive: { dir: `${DERIVED_DIR}/meshes`, ext: '.zmsh', mimeType: 'application/octet-stream' }
} as const;

export interface DerivedAssetStatus {
  state: 'unavailable' | 'uncompressed' | 'pending' | 'ready' | 'failed';
  sourceSize?: number;
  derivedSize?: number;
  loaded?: boolean;
  error?: string;
}

interface SourceIndexEntry {
  size: number;
  modified: number;
  hash: string;
}

interface PendingEncode {
  resolve: (res: EncodeResponse) => void;
  reject: (err: Error) => void;
}

async function sha1Hex(data: ArrayBuffer | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Which pipeline a source file goes through, or null if it is not a derived asset source */
export function getDerivedAssetKind(path: string): AssetSourceKind | null {
  if (isTextureSourcePath(path)) {
    return 'texture';
  }
  return path.toLowerCase().endsWith('.zmsh') ? 'primitive' : null;
}

function textureSettingsKey(settings: TextureImportSettings) {
  // Fixed field order, so the key does not depend on how the settings object was built
  const { usage, compression, quality, maxSize, mipmaps } = settings;
  return JSON.stringify([usage, compression, quality, maxSize, mipmaps]);
}

function meshSettingsKey(settings: MeshImportSettings) {
  return JSON.stringify([settings.compression, settings.normalBits]);
}

export class DerivedAssetService {
  private static _vfs: VFS | null = null;
  private static _index: Record<string, SourceIndexEntry> = {};
  private static _indexLoaded: Promise<void> | null = null;
  private static _indexDirty = false;
  private static _indexSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly _queue: string[] = [];
  private static readonly _queued = new Set<string>();
  private static readonly _failed = new Map<string, string>();
  private static _running = false;
  private static _current = '';
  private static _done = 0;
  private static _worker: Worker | null = null;
  private static readonly _pending = new Map<number, PendingEncode>();
  /** Derived file last handed to the asset loader, per source path, this session */
  private static readonly _served = new Map<string, string>();
  /** Content hash of .zmsh files found to hold nothing compressible (parametric shapes) */
  private static readonly _notCompressible = new Map<string, string>();
  private static _nextId = 1;

  /** Starts serving derived assets for a project; null stops it */
  static attach(vfs: VFS | null) {
    if (vfs === this._vfs) {
      return;
    }
    this.flushIndex();
    this._vfs?.off('changed', this.handleVFSChanged, this);
    this._vfs = vfs;
    this._index = {};
    this._indexLoaded = null;
    this._queue.length = 0;
    this._queued.clear();
    this._failed.clear();
    this._served.clear();
    this._notCompressible.clear();
    this._done = 0;
    getEngine().resourceManager.assetManager.assetSourceResolver = vfs
      ? (url, kind) => this.resolve(url, kind)
      : null;
    if (vfs && !vfs.readOnly) {
      vfs.on('changed', this.handleVFSChanged, this);
      void this.scanProject(vfs);
    }
  }

  /**
   * Queues every asset whose derived copy is missing, whether or not a scene
   * uses it yet: a build needs them all. Unchanged sources cost one stat each,
   * since their content hash comes from the index.
   */
  private static async scanProject(vfs: VFS) {
    let files: { path: string; type: string }[];
    try {
      files = await vfs.glob('/assets/**/*', {
        includeHidden: true,
        includeDirs: false,
        includeFiles: true,
        recursive: true
      });
    } catch (err) {
      console.warn(`Failed to scan project assets: ${err}`);
      return;
    }
    for (const file of files) {
      if (this._vfs !== vfs) {
        return;
      }
      if (
        file.type === 'file' &&
        !file.path.startsWith('/assets/@builtins/') &&
        getDerivedAssetKind(file.path)
      ) {
        try {
          await this.ensureDerived(file.path, false);
        } catch (err) {
          console.warn(`Failed to check derived asset for ${file.path}: ${err}`);
        }
      }
    }
  }

  /** Re-queues an asset when its source or its .zmeta sidecar changes */
  private static handleVFSChanged(
    type: 'created' | 'deleted' | 'moved' | 'modified',
    path: string,
    itemType: 'file' | 'directory'
  ) {
    if (itemType !== 'file' || type === 'deleted' || !path.startsWith('/assets/')) {
      return;
    }
    const source = isAssetMetaPath(path) ? path.slice(0, -ASSET_META_EXTENSION.length) : path;
    if (getDerivedAssetKind(source)) {
      this.request(source);
    }
  }

  /** One-line progress for the status bar, empty when idle */
  static get statusText() {
    if (!this._running && this._queue.length === 0) {
      return this._failed.size > 0 ? `Asset compression: ${this._failed.size} failed (see console)` : '';
    }
    const name = this._current.slice(this._current.lastIndexOf('/') + 1);
    return `Compressing assets ${this._done + 1}/${this._done + this._queue.length + 1}: ${name}`;
  }

  /**
   * Where an asset stands in the pipeline, for display. `loaded` tells whether
   * the current derived copy is what the editor actually loaded this session,
   * which pixels alone cannot show: a good encode looks like its source.
   */
  static async getStatus(path: string): Promise<DerivedAssetStatus> {
    const vfs = this._vfs;
    if (!vfs) {
      return { state: 'unavailable' };
    }
    const sourceSize = (await vfs.stat(path).catch(() => null))?.size ?? 0;
    const target = await this.getDerivedPath(vfs, path);
    if (!target) {
      return { state: 'uncompressed', sourceSize };
    }
    if (await vfs.exists(target)) {
      const derivedSize = (await vfs.stat(target)).size;
      return { state: 'ready', sourceSize, derivedSize, loaded: this._served.get(path) === target };
    }
    if (this._failed.has(path)) {
      return { state: 'failed', sourceSize, error: this._failed.get(path) };
    }
    return { state: 'pending', sourceSize };
  }

  /**
   * Derived copy of an asset, encoded now if missing. For builds, which need
   * every asset rather than the ones a scene happened to load. Null when the
   * asset ships as its source; throws when encoding fails.
   */
  static async getDerivedFile(path: string): Promise<string | null> {
    const vfs = this._vfs;
    if (!vfs || !getDerivedAssetKind(path)) {
      return null;
    }
    let target = await this.getDerivedPath(vfs, path);
    if (target && !(await vfs.exists(target))) {
      await this.encodeOne(path);
      // Encoding may find the source has nothing to compress
      target = await this.getDerivedPath(vfs, path);
      if (target && !(await vfs.exists(target))) {
        throw new Error(`No compressed copy could be produced for ${path}`);
      }
    }
    return target;
  }

  /** Re-encodes an asset now, e.g. after its settings changed */
  static request(path: string) {
    this._failed.delete(path);
    void this.ensureDerived(path);
  }

  /**
   * Asset source resolver: the derived copy when it exists, otherwise null (load
   * the source) after queueing the encode, so the next load gets the compressed copy.
   */
  private static async resolve(url: string, kind: AssetSourceKind) {
    const vfs = this._vfs;
    if (!vfs || !url.startsWith('/assets/') || getDerivedAssetKind(url) !== kind) {
      return null;
    }
    const target = await this.getDerivedPath(vfs, url);
    if (!target) {
      return null;
    }
    if (await vfs.exists(target)) {
      const data = (await vfs.readFile(target, { encoding: 'binary' })) as ArrayBuffer;
      this._served.set(url, target);
      return { data, mimeType: KINDS[kind].mimeType };
    }
    if (!this._failed.has(url)) {
      this.enqueue(url);
    }
    return null;
  }

  private static async ensureDerived(path: string, invalidate = true) {
    const vfs = this._vfs;
    if (!vfs || !getDerivedAssetKind(path)) {
      return;
    }
    const target = await this.getDerivedPath(vfs, path);
    if (target && !(await vfs.exists(target))) {
      this.enqueue(path);
    } else if (invalidate) {
      // Settings went back to an already cached variant, or to no compression
      getEngine().resourceManager.assetManager.invalidateAsset(path);
    }
  }

  /** Cache path for the current source content and settings, or null if the asset ships as its source */
  private static async getDerivedPath(vfs: VFS, path: string) {
    const kind = getDerivedAssetKind(path);
    if (!kind) {
      return null;
    }
    let settingsKey: string;
    if (kind === 'texture') {
      const settings = await readTextureImportSettings(vfs, path);
      if (resolveTextureCompression(settings) === 'none') {
        return null;
      }
      settingsKey = `${textureSettingsKey(settings)}|${TEXTURE_ENCODER_ID}|${TEXTURE_PIPELINE_VERSION}`;
    } else {
      const settings = await readMeshImportSettings(vfs, path);
      if (settings.compression === 'none') {
        return null;
      }
      settingsKey = `${meshSettingsKey(settings)}|${MESH_ENCODER_ID}|${MESH_PIPELINE_VERSION}`;
    }
    const sourceHash = await this.getSourceHash(vfs, path);
    if (!sourceHash || this._notCompressible.get(path) === sourceHash) {
      return null;
    }
    const key = await sha1Hex(`${sourceHash}|${settingsKey}`);
    return `${KINDS[kind].dir}/${key.slice(0, 2)}/${key}${KINDS[kind].ext}`;
  }

  /** Content hash of a source, recomputed only when its size or modification time changed */
  private static async getSourceHash(vfs: VFS, path: string) {
    await this.loadIndex(vfs);
    let stat;
    try {
      stat = await vfs.stat(path);
    } catch {
      return null;
    }
    const modified = stat.modified?.getTime?.() ?? 0;
    const entry = this._index[path];
    if (entry && entry.size === stat.size && entry.modified === modified) {
      return entry.hash;
    }
    const hash = await sha1Hex((await vfs.readFile(path, { encoding: 'binary' })) as ArrayBuffer);
    this._index[path] = { size: stat.size, modified, hash };
    this.scheduleIndexSave();
    return hash;
  }

  private static loadIndex(vfs: VFS) {
    if (!this._indexLoaded) {
      this._indexLoaded = (async () => {
        try {
          if (await vfs.exists(INDEX_PATH)) {
            const parsed = JSON.parse((await vfs.readFile(INDEX_PATH, { encoding: 'utf8' })) as string);
            if (this._vfs === vfs && parsed && typeof parsed === 'object') {
              this._index = { ...parsed, ...this._index };
            }
          }
        } catch (err) {
          console.warn(`Ignoring unreadable derived data index: ${err}`);
        }
      })();
    }
    return this._indexLoaded;
  }

  private static scheduleIndexSave() {
    this._indexDirty = true;
    if (!this._indexSaveTimer) {
      this._indexSaveTimer = setTimeout(() => this.flushIndex(), 2000);
    }
  }

  private static flushIndex() {
    if (this._indexSaveTimer) {
      clearTimeout(this._indexSaveTimer);
      this._indexSaveTimer = null;
    }
    const vfs = this._vfs;
    if (!vfs || !this._indexDirty || vfs.readOnly) {
      return;
    }
    this._indexDirty = false;
    const content = JSON.stringify(this._index);
    void vfs
      .makeDirectory(DERIVED_DIR, true)
      .then(() => vfs.writeFile(INDEX_PATH, content, { encoding: 'utf8', create: true }))
      .catch((err) => console.warn(`Failed to save derived data index: ${err}`));
  }

  private static enqueue(path: string) {
    if (this._queued.has(path)) {
      return;
    }
    this._queued.add(path);
    this._queue.push(path);
    void this.pump();
  }

  private static async pump() {
    if (this._running) {
      return;
    }
    this._running = true;
    try {
      while (this._queue.length > 0) {
        const path = this._queue.shift()!;
        this._current = path;
        try {
          await this.encodeOne(path);
        } catch (err) {
          this._failed.set(path, String(err));
          console.error(`Asset compression failed for ${path}: ${err}`);
        } finally {
          this._queued.delete(path);
          this._done++;
        }
      }
    } finally {
      this._running = false;
      this._current = '';
      this._done = 0;
    }
  }

  private static async encodeOne(path: string) {
    const vfs = this._vfs;
    if (!vfs || vfs.readOnly) {
      return;
    }
    const target = await this.getDerivedPath(vfs, path);
    if (!target || (await vfs.exists(target))) {
      return;
    }
    let data: ArrayBuffer;
    if (getDerivedAssetKind(path) === 'texture') {
      data = await this.encodeTexture(vfs, path);
    } else {
      const json = (await vfs.readFile(path, { encoding: 'utf8' })) as string;
      if (!isCompressiblePrimitive(JSON.parse(json))) {
        // A parametric shape: tiny, nothing to compress, ships as it is
        this._notCompressible.set(path, (await this.getSourceHash(vfs, path)) ?? '');
        return;
      }
      data = await encodeCompressedPrimitive(json, await readMeshImportSettings(vfs, path));
    }
    // The project may have been closed while encoding
    if (this._vfs !== vfs) {
      return;
    }
    await vfs.makeDirectory(target.slice(0, target.lastIndexOf('/')), true);
    await vfs.writeFile(target, data, { encoding: 'binary', create: true });
    // Later loads of this path now resolve to the compressed copy
    getEngine().resourceManager.assetManager.invalidateAsset(path);
  }

  private static async encodeTexture(vfs: VFS, path: string) {
    const settings = await readTextureImportSettings(vfs, path);
    const encoding = resolveTextureCompression(settings);
    if (encoding === 'none') {
      throw new Error(`${path} is not set to be compressed`);
    }
    const source = (await vfs.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
    const res = await this.runEncode({
      type: 'encode',
      id: 0,
      source,
      mimeType: vfs.guessMIMEType(path),
      encoding,
      quality: settings.quality,
      srgb: isSRGBTextureUsage(settings.usage),
      normalMap: settings.usage === 'normal',
      mipmaps: settings.mipmaps,
      maxSize: settings.maxSize
    });
    return res.data!;
  }

  private static runEncode(req: EncodeRequest) {
    const worker = this.getWorker();
    const id = this._nextId++;
    return new Promise<EncodeResponse>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      worker.postMessage({ ...req, id }, [req.source]);
    });
  }

  private static getWorker() {
    if (!this._worker) {
      const worker = new Worker(new URL('../../workers/basis_encode.ts', import.meta.url), {
        type: 'module'
      });
      worker.onmessage = (e: MessageEvent<EncodeResponse>) => {
        const pending = this._pending.get(e.data.id);
        if (pending) {
          this._pending.delete(e.data.id);
          if (e.data.type === 'result') {
            pending.resolve(e.data);
          } else {
            pending.reject(new Error(e.data.message));
          }
        }
      };
      worker.onerror = (e) => {
        // A crashed worker fails everything in flight; the next request starts a new one
        for (const pending of this._pending.values()) {
          pending.reject(new Error(e.message || 'Basis encoder worker crashed'));
        }
        this._pending.clear();
        this._worker?.terminate();
        this._worker = null;
      };
      // Relative to the page: the editor may be served from a sub-path (vite base './')
      const base = new URL('vendor/basis-encoder/', document.baseURI);
      worker.postMessage({
        type: 'init',
        scriptUrl: new URL('basis_encoder.js', base).href,
        wasmUrl: new URL('basis_encoder.wasm', base).href
      });
      this._worker = worker;
    }
    return this._worker;
  }
}
