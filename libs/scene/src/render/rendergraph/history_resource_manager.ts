import type { Texture2D } from '@zephyr3d/device';
import type { RenderGraph } from './rendergraph';
import type { RenderGraphExecutor } from './executor';
import type { RGHandle, RGExecuteContext, RGTextureAllocator, RGTextureDesc, RGResolvedSize } from './types';

interface HistoryResource<TTexture> {
  desc: RGTextureDesc;
  size: RGResolvedSize;
  textures: [TTexture | null, TTexture | null];
  ownsTexture: [boolean, boolean];
  currentIndex: number;
  valid: boolean;
}

interface PendingHistoryCommit<TTexture> {
  desc: RGTextureDesc;
  size: RGResolvedSize;
  texture: TTexture;
  ownsTexture: boolean;
}

/** Manages render graph textures retained across frames. @public */
export class HistoryResourceManager<TTexture = Texture2D> {
  private _resources: Map<string, HistoryResource<TTexture>> = new Map();
  private _allocator: RGTextureAllocator<TTexture>;
  private _pendingImports: Map<RGHandle, TTexture> = new Map();
  private _pendingCommits: Map<string, PendingHistoryCommit<TTexture>> = new Map();
  private _readScopeStack: Array<Map<string, TTexture>> = [];
  private _frameActive = false;
  // Delay replaced commits until frame end to prevent pool reuse while queued.
  private _deferredReleases: TTexture[] = [];

  /** Create a history manager using the given allocator. */
  constructor(allocator: RGTextureAllocator<TTexture>) {
    this._allocator = allocator;
  }

  /**
   * Return a previous-frame texture from the active read scope.
   * @throws When the resource is not available in that scope.
   */
  getPrevious(name: string): TTexture {
    const scoped = this._getScopedRead(name);
    if (scoped) {
      return scoped;
    }
    throw new Error(
      `History resource '${name}' is not available in the current render graph read scope. ` +
        `Import it and declare a pass read before accessing it.`
    );
  }

  /** Return a scoped previous-frame texture, or null. */
  tryGetPrevious(name: string): TTexture | null {
    return this._getScopedRead(name);
  }

  /** Whether a history frame is active. */
  get frameActive(): boolean {
    return this._frameActive;
  }

  /** Check for valid history matching the descriptor and size. */
  isCompatible(name: string, desc: RGTextureDesc, size: RGResolvedSize): boolean {
    const resource = this._resources.get(name);
    return !!resource?.valid && this._matches(resource, desc, size);
  }

  /** Begin collecting imports and commits for a frame. */
  beginFrame(): void {
    this.discardFrame();
    this._pendingImports.clear();
    this._readScopeStack.length = 0;
    this._frameActive = true;
  }

  /** Import the latest history texture, or return null when unavailable. */
  importPrevious(graph: RenderGraph, name: string): RGHandle | null {
    const resource = this._resources.get(name);
    const texture = resource?.valid ? resource.textures[resource.currentIndex] : null;
    if (!texture) {
      return null;
    }
    const handle = graph.importTexture(`history:${name}:previous`);
    this._pendingImports.set(handle, texture);
    return handle;
  }

  /**
   * Import the latest history only when its descriptor and size match.
   */
  importPreviousIfCompatible(
    graph: RenderGraph,
    name: string,
    desc: RGTextureDesc,
    size: RGResolvedSize
  ): RGHandle | null {
    return this.isCompatible(name, desc, size) ? this.importPrevious(graph, name) : null;
  }

  /** Bind this frame's history imports to an executor. */
  bindImportedTextures(executor: Pick<RenderGraphExecutor<TTexture>, 'setImportedTexture'>): void {
    for (const [handle, texture] of this._pendingImports) {
      executor.setImportedTexture(handle, texture);
    }
  }

  /** Push a history read scope for pass execution. */
  beginReadScope(bindings: Array<{ name: string; texture: TTexture }>): void {
    const scope = new Map<string, TTexture>();
    for (const binding of bindings) {
      scope.set(binding.name, binding.texture);
    }
    this._readScopeStack.push(scope);
  }

  /** Pop the latest history read scope. */
  endReadScope(): void {
    this._readScopeStack.pop();
  }

  /**
   * Queue the next history texture. It becomes visible on `commitFrame`; owned
   * textures are released on `discardFrame`.
   */
  queueCommit(
    name: string,
    desc: RGTextureDesc,
    size: RGResolvedSize,
    texture: TTexture,
    ownsTexture = true
  ): void {
    if (!this._frameActive) {
      throw new Error(
        `HistoryResourceManager: cannot queue history commit '${name}' outside an active frame. ` +
          `Call beginFrame() first.`
      );
    }
    const existing = this._pendingCommits.get(name);
    if (existing?.ownsTexture && existing.texture !== texture) {
      // Re-queuing the same texture keeps its existing reference.
      this._deferredReleases.push(existing.texture);
    }
    this._pendingCommits.set(name, {
      desc: { ...desc },
      size: { ...size },
      texture,
      ownsTexture
    });
  }

  /**
   * Retain and queue a graph texture from its declaring pass.
   */
  queueCommitFromGraph(
    name: string,
    desc: RGTextureDesc,
    size: RGResolvedSize,
    ctx: Pick<RGExecuteContext, 'getTexture'>,
    handle: RGHandle
  ): TTexture {
    const texture = ctx.getTexture<TTexture>(handle);
    this.queueRetainedCommit(name, desc, size, texture);
    return texture;
  }

  /** Retain a texture through the allocator and queue it as history. */
  queueRetainedCommit(name: string, desc: RGTextureDesc, size: RGResolvedSize, texture: TTexture): void {
    if (!this._allocator.retain) {
      throw new Error(
        `HistoryResourceManager: cannot retain history resource '${name}'. ` +
          `The allocator does not support retained graph texture handoff.`
      );
    }
    this._allocator.retain(texture);
    this.queueCommit(name, desc, size, texture, true);
  }

  /** Commit all pending history writes. */
  commitFrame(): void {
    for (const [name, pending] of this._pendingCommits) {
      let resource = this._resources.get(name);
      if (resource && !this._matches(resource, pending.desc, pending.size)) {
        this._releaseResource(resource);
        this._resources.delete(name);
        resource = undefined;
      }
      if (!resource) {
        resource = {
          desc: { ...pending.desc },
          size: { ...pending.size },
          textures: [null, null],
          ownsTexture: [false, false],
          currentIndex: 0,
          valid: false
        };
        this._resources.set(name, resource);
      }

      const writeIndex = resource.valid ? 1 - resource.currentIndex : resource.currentIndex;
      this._releaseSlot(resource, writeIndex);
      resource.textures[writeIndex] = pending.texture;
      resource.ownsTexture[writeIndex] = pending.ownsTexture;
      resource.desc = { ...pending.desc };
      resource.size = { ...pending.size };
      resource.currentIndex = writeIndex;
      resource.valid = true;
    }
    this._pendingCommits.clear();
    this._pendingImports.clear();
    this._readScopeStack.length = 0;
    this._frameActive = false;
    this._flushDeferredReleases();
  }

  /** Discard all pending history writes. */
  discardFrame(): void {
    for (const pending of this._pendingCommits.values()) {
      if (pending.ownsTexture) {
        this._allocator.release(pending.texture);
      }
    }
    this._pendingCommits.clear();
    this._pendingImports.clear();
    this._readScopeStack.length = 0;
    this._frameActive = false;
    this._flushDeferredReleases();
  }

  /**
   * Invalidate one named history resource without disturbing unrelated
   * temporal effects. If called during a frame, owned textures are released
   * after that frame so already-imported graph reads remain valid.
   */
  invalidate(name: string): void {
    const pending = this._pendingCommits.get(name);
    if (pending) {
      if (pending.ownsTexture) {
        if (this._frameActive) {
          this._deferredReleases.push(pending.texture);
        } else {
          this._allocator.release(pending.texture);
        }
      }
      this._pendingCommits.delete(name);
    }
    const resource = this._resources.get(name);
    if (!resource) {
      return;
    }
    if (this._frameActive) {
      for (let i = 0; i < resource.textures.length; i++) {
        const texture = resource.textures[i];
        if (texture && resource.ownsTexture[i]) {
          this._deferredReleases.push(texture);
        }
        resource.textures[i] = null;
        resource.ownsTexture[i] = false;
      }
      resource.valid = false;
    } else {
      this._releaseResource(resource);
    }
    this._resources.delete(name);
  }

  /** @internal */
  private _flushDeferredReleases(): void {
    for (const texture of this._deferredReleases) {
      this._allocator.release(texture);
    }
    this._deferredReleases.length = 0;
  }

  /** Release all history resources. */
  dispose(): void {
    this.discardFrame();
    for (const resource of this._resources.values()) {
      this._releaseResource(resource);
    }
    this._resources.clear();
  }

  /** @internal */
  private _getScopedRead(name: string): TTexture | null {
    for (let i = this._readScopeStack.length - 1; i >= 0; i--) {
      const texture = this._readScopeStack[i].get(name);
      if (texture) {
        return texture;
      }
    }
    return null;
  }

  /** @internal */
  private _matches(resource: HistoryResource<TTexture>, desc: RGTextureDesc, size: RGResolvedSize): boolean {
    return (
      resource.desc.format === desc.format &&
      (resource.desc.mipLevels ?? 1) === (desc.mipLevels ?? 1) &&
      // A 2D texture and a one-layer array are distinct types.
      resource.desc.arrayLayers === desc.arrayLayers &&
      resource.size.width === size.width &&
      resource.size.height === size.height
    );
  }

  /** @internal */
  private _releaseResource(resource: HistoryResource<TTexture>): void {
    this._releaseSlot(resource, 0);
    this._releaseSlot(resource, 1);
    resource.valid = false;
  }

  /** @internal */
  private _releaseSlot(resource: HistoryResource<TTexture>, index: number): void {
    const texture = resource.textures[index];
    if (!texture) {
      return;
    }
    // Each owning slot represents one retained reference.
    if (resource.ownsTexture[index]) {
      this._allocator.release(texture);
    }
    resource.textures[index] = null;
    resource.ownsTexture[index] = false;
  }
}
