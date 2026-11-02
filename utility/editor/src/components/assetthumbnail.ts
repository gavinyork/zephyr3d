import { DRef, Disposable, type FileMetadata, type Nullable, type VFS } from '@zephyr3d/base';
import type { Texture2D } from '@zephyr3d/device';
import { CopyBlitter, fetchSampler, getDevice, getEngine } from '@zephyr3d/scene';
import { withoutPreloadRecording } from '../core/services/assetpreload';

export type AssetThumbnailStatus = 'loading' | 'ready' | 'error' | 'unsupported';

export type AssetThumbnailRequest = {
  vfs: VFS;
  path: string;
  mimeType: string;
  meta: FileMetadata;
  thumbnailSize: number;
};

export type AssetThumbnailResult = {
  texture: Texture2D;
  aspectRatio?: number;
  // Optional cleanup hook for provider-owned side resources such as framebuffers.
  dispose?: () => void;
};

export type AssetThumbnailEntry = {
  status: AssetThumbnailStatus;
  path: string;
  texture: DRef<Texture2D>;
  aspectRatio: number;
  error: string | null;
};

export interface AssetThumbnailProvider {
  readonly id: string;
  matches(request: AssetThumbnailRequest): boolean;
  getVariantKey?(request: AssetThumbnailRequest): string;
  load(request: AssetThumbnailRequest): Promise<Nullable<AssetThumbnailResult>>;
}

const IMAGE_THUMBNAIL_BUCKETS = [64, 128, 256] as const;

function getBucketedThumbnailSize(requestedSize: number) {
  const normalizedSize = Math.max(1, Math.ceil(requestedSize || 1));
  for (const bucket of IMAGE_THUMBNAIL_BUCKETS) {
    if (normalizedSize <= bucket) {
      return bucket;
    }
  }
  return IMAGE_THUMBNAIL_BUCKETS[IMAGE_THUMBNAIL_BUCKETS.length - 1];
}

type InternalAssetThumbnailEntry = AssetThumbnailEntry & {
  cacheKey: string;
  disposeSideResources: (() => void) | null;
  queued: boolean;
  promise: Promise<void> | null;
  lastUsed: number;
};

type AssetThumbnailLoadJob = {
  entry: InternalAssetThumbnailEntry;
  provider: AssetThumbnailProvider;
  request: AssetThumbnailRequest;
};

export class AssetThumbnailService extends Disposable {
  private readonly _providers: AssetThumbnailProvider[];
  private readonly _entries: Map<string, InternalAssetThumbnailEntry>;
  private readonly _maxEntries: number;
  private readonly _maxConcurrentLoads: number;
  private readonly _pendingLoads: AssetThumbnailLoadJob[];
  private _activeLoads: number;
  private _useTick: number;

  constructor(providers: AssetThumbnailProvider[] = [], maxEntries = 256, maxConcurrentLoads = 2) {
    super();
    this._providers = providers.slice();
    this._entries = new Map();
    this._maxEntries = Math.max(16, maxEntries | 0);
    this._maxConcurrentLoads = Math.max(1, maxConcurrentLoads | 0);
    this._pendingLoads = [];
    this._activeLoads = 0;
    this._useTick = 0;
  }

  registerProvider(provider: AssetThumbnailProvider) {
    this._providers.push(provider);
  }

  request(request: AssetThumbnailRequest): AssetThumbnailEntry {
    const normalizedPath = request.vfs.normalizePath(request.path);
    const normalizedRequest = {
      ...request,
      path: normalizedPath
    };
    const provider = this._providers.find((candidate) => candidate.matches(normalizedRequest));
    if (!provider) {
      return {
        status: 'unsupported',
        path: normalizedPath,
        texture: null,
        aspectRatio: 1,
        error: null
      };
    }

    const cacheKey = this.getCacheKey(provider, normalizedRequest);
    let entry = this._entries.get(cacheKey);
    if (!entry) {
      entry = {
        cacheKey,
        disposeSideResources: null,
        error: null,
        path: normalizedPath,
        queued: false,
        promise: null,
        status: 'loading',
        texture: null,
        aspectRatio: 1,
        lastUsed: 0
      };
      this._entries.set(cacheKey, entry);
      this.enqueueLoad(entry, provider, normalizedRequest);
    }

    entry.lastUsed = ++this._useTick;
    this.trimCache();
    return entry;
  }

  invalidate(path: string, recursive = false) {
    const normalizedPath = path === '/' ? '/' : path.replace(/\\/g, '/');
    if (normalizedPath === '/') {
      this.clear();
      return;
    }
    for (const [cacheKey, entry] of this._entries) {
      if (entry.path === normalizedPath || (recursive && entry.path.startsWith(`${normalizedPath}/`))) {
        this.disposeEntry(cacheKey, entry);
      }
    }
  }

  clear() {
    for (const [cacheKey, entry] of this._entries) {
      this.disposeEntry(cacheKey, entry);
    }
  }

  protected override onDispose() {
    this.clear();
  }

  private getCacheKey(provider: AssetThumbnailProvider, request: AssetThumbnailRequest) {
    const variantKey = provider.getVariantKey?.(request) ?? 'default';
    const modifiedTime = request.meta.modified?.getTime?.() ?? 0;
    return [
      provider.id,
      request.path,
      request.mimeType || '',
      request.meta.size ?? 0,
      modifiedTime,
      variantKey
    ].join('::');
  }

  private async loadEntry(
    entry: InternalAssetThumbnailEntry,
    provider: AssetThumbnailProvider,
    request: AssetThumbnailRequest
  ) {
    try {
      const result = await provider.load(request);
      if (this.disposed || this._entries.get(entry.cacheKey) !== entry) {
        result?.dispose?.();
        return;
      }
      if (!result?.texture) {
        entry.status = 'unsupported';
        return;
      }
      entry.texture = new DRef(result.texture);
      entry.aspectRatio = this.getAspectRatio(result.texture, result.aspectRatio);
      entry.disposeSideResources = result.dispose ?? null;
      entry.status = 'ready';
      entry.error = null;
    } catch (err) {
      entry.status = 'error';
      entry.error = err instanceof Error ? err.message : `${err}`;
    }
  }

  private getAspectRatio(texture: Texture2D, aspectRatio?: number) {
    if (typeof aspectRatio === 'number' && Number.isFinite(aspectRatio) && aspectRatio > 0) {
      return aspectRatio;
    }
    const width = Math.max(1, texture?.width ?? 1);
    const height = Math.max(1, texture?.height ?? 1);
    return width / height;
  }

  private trimCache() {
    if (this._entries.size <= this._maxEntries) {
      return;
    }
    const evictable = Array.from(this._entries.values())
      .filter((entry) => !entry.promise && !entry.queued)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (this._entries.size > this._maxEntries && evictable.length > 0) {
      const entry = evictable.shift()!;
      this.disposeEntry(entry.cacheKey, entry);
    }
  }

  private enqueueLoad(
    entry: InternalAssetThumbnailEntry,
    provider: AssetThumbnailProvider,
    request: AssetThumbnailRequest
  ) {
    if (entry.queued || entry.promise) {
      return;
    }
    entry.queued = true;
    this._pendingLoads.push({
      entry,
      provider,
      request
    });
    this.pumpLoadQueue();
  }

  private pumpLoadQueue() {
    while (!this.disposed && this._activeLoads < this._maxConcurrentLoads && this._pendingLoads.length > 0) {
      const job = this._pendingLoads.shift()!;
      const currentEntry = this._entries.get(job.entry.cacheKey);
      if (currentEntry !== job.entry) {
        continue;
      }
      job.entry.queued = false;
      this._activeLoads++;
      job.entry.promise = this.loadEntry(job.entry, job.provider, job.request).finally(() => {
        if (this._entries.get(job.entry.cacheKey) === job.entry) {
          job.entry.promise = null;
        }
        this._activeLoads = Math.max(0, this._activeLoads - 1);
        this.trimCache();
        this.pumpLoadQueue();
      });
    }
  }

  private disposeEntry(cacheKey: string, entry: InternalAssetThumbnailEntry) {
    if (!this._entries.delete(cacheKey)) {
      return;
    }
    if (entry.queued) {
      entry.queued = false;
      const index = this._pendingLoads.findIndex((job) => job.entry === entry);
      if (index >= 0) {
        this._pendingLoads.splice(index, 1);
      }
    }
    entry.texture?.dispose();
    entry.texture = null;
    entry.disposeSideResources?.();
    entry.disposeSideResources = null;
  }
}

export class ImageAssetThumbnailProvider implements AssetThumbnailProvider {
  readonly id = 'image';

  matches(request: AssetThumbnailRequest) {
    return request.mimeType.startsWith('image/');
  }

  getVariantKey(request: AssetThumbnailRequest) {
    return `bucket-${getBucketedThumbnailSize(request.thumbnailSize)}`;
  }

  async load(request: AssetThumbnailRequest) {
    const textureRef = new DRef<Texture2D>(
      // Thumbnails are not what a scene loading meanwhile fetches
      await withoutPreloadRecording(() =>
        getEngine().resourceManager.fetchTexture<Texture2D>(request.path, {
          mimeType: request.mimeType || undefined
        })
      )
    );
    try {
      const texture = textureRef.get();
      if (!texture?.isTexture2D()) {
        return null;
      }

      const bucketSize = getBucketedThumbnailSize(request.thumbnailSize);
      const sourceWidth = Math.max(1, texture.width);
      const sourceHeight = Math.max(1, texture.height);
      const sourceMaxDimension = Math.max(sourceWidth, sourceHeight);
      const targetMaxDimension = Math.min(bucketSize, sourceMaxDimension);

      const scale = targetMaxDimension / sourceMaxDimension;
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
      const targetFormat = texture.isSRGBFormat() ? 'rgba8unorm-srgb' : 'rgba8unorm';
      const targetTexture = getDevice().createTexture2D(targetFormat, targetWidth, targetHeight, {
        mipmapping: false
      });
      targetTexture.name = `!!thumbnail::${texture.name}`;
      const blitter = new CopyBlitter();
      blitter.blit(texture, targetTexture, fetchSampler('clamp_linear_nomip'));

      return {
        texture: targetTexture,
        aspectRatio: sourceWidth / sourceHeight
      };
    } finally {
      textureRef.dispose();
    }
  }
}
