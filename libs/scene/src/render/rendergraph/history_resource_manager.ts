import type { Texture2D } from '@zephyr3d/device';
import type { RenderGraph } from './rendergraph';
import type { RenderGraphExecutor } from './executor';
import type { RGHandle, RGTextureAllocator, RGTextureDesc, RGResolvedSize } from './types';

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

/**
 * Manages cross-frame history resources that can be imported into a render graph.
 *
 * History resources are textures that persist across frames for temporal effects
 * like TAA, motion blur, or temporal upscaling. Previous-frame textures can be
 * imported into a {@link RenderGraph}, and current-frame textures are committed
 * only after graph execution succeeds.
 *
 * Usage:
 * ```ts
 * const historyMgr = new HistoryResourceManager(allocator);
 * historyMgr.beginFrame();
 * const prev = historyMgr.importPrevious(graph, 'taaColor');
 * // declare builder.read(prev) if non-null
 * historyMgr.bindImportedTextures(executor);
 * // after successful execution:
 * historyMgr.commitFrame();
 * ```
 *
 * @typeParam TTexture - The concrete texture type (e.g. `Texture2D`).
 * @public
 */
export class HistoryResourceManager<TTexture = Texture2D> {
  private _resources: Map<string, HistoryResource<TTexture>> = new Map();
  private _allocator: RGTextureAllocator<TTexture>;
  private _pendingImports: Map<RGHandle, TTexture> = new Map();
  private _pendingCommits: Map<string, PendingHistoryCommit<TTexture>> = new Map();
  private _readScopeStack: Array<Map<string, TTexture>> = [];

  /**
   * Create a new history resource manager.
   *
   * @param allocator - Texture allocator for creating history textures.
   */
  constructor(allocator: RGTextureAllocator<TTexture>) {
    this._allocator = allocator;
  }

  /**
   * Get the previous-frame texture resolved by the current render graph pass.
   *
   * The resource must have been imported with {@link importPrevious} or
   * {@link importPreviousIfCompatible}, declared as a pass read, and bound with
   * {@link beginReadScope} before this method is called.
   *
   * @param name - Name of the history resource.
   * @returns The graph-resolved previous-frame texture.
   * @throws If no read scope is active for the resource.
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

  /**
   * Check whether a valid history resource exists and matches the descriptor.
   *
   * @param name - Name of the history resource.
   * @param desc - Expected texture descriptor.
   * @param size - Expected resolved size.
   * @returns True if the resource exists, is valid, and matches.
   */
  isCompatible(name: string, desc: RGTextureDesc, size: RGResolvedSize): boolean {
    const resource = this._resources.get(name);
    return !!resource?.valid && this._matches(resource, desc, size);
  }

  /**
   * Start collecting graph imports and deferred commits for a new frame.
   */
  beginFrame(): void {
    this.discardFrame();
    this._pendingImports.clear();
    this._readScopeStack.length = 0;
  }

  /**
   * Import the latest committed texture for a history resource into the graph.
   *
   * Returns null when the resource has no valid previous frame.
   *
   * @param graph - Render graph to import into.
   * @param name - History resource name.
   * @returns Imported graph handle, or null when no valid previous texture exists.
   */
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
   * Import the latest committed texture only when it matches the expected shape.
   *
   * This is the preferred API for effects that can declare their history reads
   * while building the graph: incompatible history is treated as absent, so the
   * pass does not declare stale reads after resize or format changes.
   *
   * @param graph - Render graph to import into.
   * @param name - History resource name.
   * @param desc - Expected texture descriptor.
   * @param size - Expected resolved size.
   * @returns Imported graph handle, or null when no compatible history exists.
   */
  importPreviousIfCompatible(
    graph: RenderGraph,
    name: string,
    desc: RGTextureDesc,
    size: RGResolvedSize
  ): RGHandle | null {
    return this.isCompatible(name, desc, size) ? this.importPrevious(graph, name) : null;
  }

  /**
   * Bind all history imports created for this frame to the executor.
   *
   * @param executor - Render graph executor for the current frame.
   */
  bindImportedTextures(executor: Pick<RenderGraphExecutor<TTexture>, 'setImportedTexture'>): void {
    for (const [handle, texture] of this._pendingImports) {
      executor.setImportedTexture(handle, texture);
    }
  }

  /**
   * Make resolved history textures available to code executing inside a pass.
   *
   * @param bindings - History name to resolved texture bindings.
   */
  beginReadScope(bindings: Array<{ name: string; texture: TTexture }>): void {
    const scope = new Map<string, TTexture>();
    for (const binding of bindings) {
      scope.set(binding.name, binding.texture);
    }
    this._readScopeStack.push(scope);
  }

  /**
   * End the most recent history read scope.
   */
  endReadScope(): void {
    this._readScopeStack.pop();
  }

  /**
   * Queue a current-frame texture to become the next previous-frame history.
   *
   * The texture is committed only when {@link commitFrame} is called. If the
   * frame fails, {@link discardFrame} releases owned pending textures instead.
   *
   * @param name - History resource name.
   * @param desc - Texture descriptor.
   * @param size - Resolved texture size.
   * @param texture - Texture produced by the current frame.
   * @param ownsTexture - Whether this manager should release the texture later.
   */
  queueCommit(
    name: string,
    desc: RGTextureDesc,
    size: RGResolvedSize,
    texture: TTexture,
    ownsTexture = true
  ): void {
    const existing = this._pendingCommits.get(name);
    if (existing?.ownsTexture) {
      this._allocator.release(existing.texture);
    }
    this._pendingCommits.set(name, {
      desc: { ...desc },
      size: { ...size },
      texture,
      ownsTexture
    });
  }

  /**
   * Commit all current-frame history writes.
   */
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
  }

  /**
   * Discard all uncommitted frame history writes.
   */
  discardFrame(): void {
    for (const pending of this._pendingCommits.values()) {
      if (pending.ownsTexture) {
        this._allocator.release(pending.texture);
      }
    }
    this._pendingCommits.clear();
    this._pendingImports.clear();
    this._readScopeStack.length = 0;
  }

  /**
   * Release all history resources and clear the manager.
   *
   * Call this when disposing the render context or when history is no longer needed.
   */
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
    const otherIndex = 1 - index;
    if (resource.ownsTexture[index] && resource.textures[otherIndex] !== texture) {
      this._allocator.release(texture);
    }
    resource.textures[index] = null;
    resource.ownsTexture[index] = false;
  }
}
