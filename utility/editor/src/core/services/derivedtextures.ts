import type { VFS } from '@zephyr3d/base';
import type { TextureImportSettings } from '@zephyr3d/scene';
import {
  ASSET_META_EXTENSION,
  getEngine,
  isAssetMetaPath,
  isSRGBTextureUsage,
  readTextureImportSettings,
  resolveTextureCompression
} from '@zephyr3d/scene';
import { isTextureSourcePath } from './assetmeta';
import type { EncodeRequest, EncodeResponse } from '../../workers/basis_encode';

/**
 * Derived data cache for compressed textures, after UE's DDC and Unity's Library:
 * the editor never alters source images, it derives a KTX2 copy per source
 * content + settings + encoder and keeps it under /.cache, which can be deleted
 * at any time and is rebuilt on demand.
 *
 * Bump ENCODER_ID with the vendored encoder and PIPELINE_VERSION with any change
 * to how settings map onto encoder options; either invalidates every entry.
 */
const ENCODER_ID = 'basisu-v2_50';
const PIPELINE_VERSION = 1;

export const DERIVED_CACHE_ROOT = '/.cache';
const CACHE_DIR = '/.cache/derived/textures';
const INDEX_PATH = '/.cache/derived/source-index.json';
const MIME_KTX2 = 'image/ktx2';

export interface DerivedTextureStatus {
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

function settingsKey(settings: TextureImportSettings) {
  // Fixed field order, so the key does not depend on how the settings object was built
  const { usage, compression, quality, maxSize, mipmaps } = settings;
  return JSON.stringify([usage, compression, quality, maxSize, mipmaps]);
}

export class DerivedTextureService {
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
  /** Derived file last handed to the texture loader, per source path, this session */
  private static readonly _served = new Map<string, string>();
  private static _nextId = 1;

  /** Starts serving derived textures for a project; null stops it */
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
    this._done = 0;
    getEngine().resourceManager.assetManager.assetSourceResolver = vfs
      ? (url, kind) => (kind === 'texture' ? this.resolve(url) : Promise.resolve(null))
      : null;
    if (vfs && !vfs.readOnly) {
      vfs.on('changed', this.handleVFSChanged, this);
      void this.scanProject(vfs);
    }
  }

  /**
   * Queues every texture whose derived copy is missing, whether or not a scene
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
      console.warn(`Failed to scan project textures: ${err}`);
      return;
    }
    for (const file of files) {
      if (this._vfs !== vfs) {
        return;
      }
      if (
        file.type === 'file' &&
        !file.path.startsWith('/assets/@builtins/') &&
        isTextureSourcePath(file.path)
      ) {
        try {
          await this.ensureDerived(file.path, false);
        } catch (err) {
          console.warn(`Failed to check derived texture for ${file.path}: ${err}`);
        }
      }
    }
  }

  /** Re-queues a texture when its source or its .zmeta sidecar changes */
  private static handleVFSChanged(
    type: 'created' | 'deleted' | 'moved' | 'modified',
    path: string,
    itemType: 'file' | 'directory'
  ) {
    if (itemType !== 'file' || type === 'deleted' || !path.startsWith('/assets/')) {
      return;
    }
    const source = isAssetMetaPath(path) ? path.slice(0, -ASSET_META_EXTENSION.length) : path;
    if (isTextureSourcePath(source)) {
      this.request(source);
    }
  }

  /** One-line progress for the status bar, empty when idle */
  static get statusText() {
    if (!this._running && this._queue.length === 0) {
      return this._failed.size > 0 ? `Texture compression: ${this._failed.size} failed (see console)` : '';
    }
    const name = this._current.slice(this._current.lastIndexOf('/') + 1);
    return `Compressing textures ${this._done + 1}/${this._done + this._queue.length + 1}: ${name}`;
  }

  /**
   * Where a texture stands in the pipeline, for display. `loaded` tells whether
   * the current derived copy is what the editor actually loaded this session,
   * which pixels alone cannot show: a good encode looks like its source.
   */
  static async getStatus(path: string): Promise<DerivedTextureStatus> {
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
   * Derived KTX2 for a texture, encoded now if missing. For builds, which need
   * every texture rather than the ones a scene happened to load. Null when the
   * texture ships uncompressed; throws when encoding fails.
   */
  static async getDerivedFile(path: string): Promise<string | null> {
    const vfs = this._vfs;
    if (!vfs || !isTextureSourcePath(path)) {
      return null;
    }
    const target = await this.getDerivedPath(vfs, path);
    if (!target) {
      return null;
    }
    if (!(await vfs.exists(target))) {
      await this.encodeOne(path);
      if (!(await vfs.exists(target))) {
        throw new Error(`No compressed copy could be produced for ${path}`);
      }
    }
    return target;
  }

  /** Re-encodes a texture now, e.g. after its settings changed */
  static request(path: string) {
    this._failed.delete(path);
    void this.ensureDerived(path);
  }

  /**
   * Texture source resolver: the derived KTX2 when it exists, otherwise null (load
   * the source) after queueing the encode, so the next load gets the compressed copy.
   */
  private static async resolve(url: string) {
    const vfs = this._vfs;
    if (!vfs || !url.startsWith('/assets/') || !isTextureSourcePath(url)) {
      return null;
    }
    const target = await this.getDerivedPath(vfs, url);
    if (!target) {
      return null;
    }
    if (await vfs.exists(target)) {
      const data = (await vfs.readFile(target, { encoding: 'binary' })) as ArrayBuffer;
      this._served.set(url, target);
      return { data, mimeType: MIME_KTX2 };
    }
    if (!this._failed.has(url)) {
      this.enqueue(url);
    }
    return null;
  }

  private static async ensureDerived(path: string, invalidate = true) {
    const vfs = this._vfs;
    if (!vfs || !isTextureSourcePath(path)) {
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

  /** Cache path for the current source content and settings, or null if the texture ships uncompressed */
  private static async getDerivedPath(vfs: VFS, path: string) {
    const settings = await readTextureImportSettings(vfs, path);
    if (resolveTextureCompression(settings) === 'none') {
      return null;
    }
    const sourceHash = await this.getSourceHash(vfs, path);
    if (!sourceHash) {
      return null;
    }
    const key = await sha1Hex(`${sourceHash}|${settingsKey(settings)}|${ENCODER_ID}|${PIPELINE_VERSION}`);
    return `${CACHE_DIR}/${key.slice(0, 2)}/${key}.ktx2`;
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
      .makeDirectory(CACHE_DIR, true)
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
          console.error(`Texture compression failed for ${path}: ${err}`);
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
    const settings = await readTextureImportSettings(vfs, path);
    const encoding = resolveTextureCompression(settings);
    const target = await this.getDerivedPath(vfs, path);
    if (encoding === 'none' || !target || (await vfs.exists(target))) {
      return;
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
    // The project may have been closed while encoding
    if (this._vfs !== vfs) {
      return;
    }
    await vfs.makeDirectory(target.slice(0, target.lastIndexOf('/')), true);
    await vfs.writeFile(target, res.data!, { encoding: 'binary', create: true });
    // Later loads of this path now resolve to the compressed copy
    getEngine().resourceManager.assetManager.invalidateAsset(path);
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
