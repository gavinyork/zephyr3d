import type {
  CompiledRenderGraph,
  RGTextureAllocator,
  RGTextureDesc,
  RGResolvedSize,
  RGExecuteContext,
  RGExecuteFn
} from './types';
import type { RGHandle } from './types';

/**
 * Executes a compiled render graph with automatic resource lifecycle management.
 *
 * The executor allocates transient textures before their first use and releases
 * them after their last use, using the provided {@link RGTextureAllocator}.
 *
 * Usage:
 * ```ts
 * const executor = new RenderGraphExecutor(myAllocator, backbufferWidth, backbufferHeight);
 * executor.setImportedTexture(backbufferHandle, actualBackbufferTexture);
 * executor.execute(compiledGraph);
 * ```
 *
 * @typeParam TTexture - The concrete texture type (e.g. `Texture2D`).
 * @public
 */
export class RenderGraphExecutor<TTexture = unknown> {
  /** @internal */
  private _allocator: RGTextureAllocator<TTexture>;
  /** @internal */
  private _backbufferWidth: number;
  /** @internal */
  private _backbufferHeight: number;
  /** @internal */
  private _importedTextures: Map<number, TTexture> = new Map();
  /** @internal */
  private _allocatedTextures: Map<number, TTexture> = new Map();

  constructor(allocator: RGTextureAllocator<TTexture>, backbufferWidth: number, backbufferHeight: number) {
    this._allocator = allocator;
    this._backbufferWidth = backbufferWidth;
    this._backbufferHeight = backbufferHeight;
  }

  /**
   * Update the backbuffer dimensions used for 'backbuffer-relative' sizing.
   */
  setBackbufferSize(width: number, height: number): void {
    this._backbufferWidth = width;
    this._backbufferHeight = height;
  }

  /**
   * Register an imported (external) texture so it can be resolved during execution.
   *
   * @param handle - The handle returned from {@link RenderGraph.importTexture}.
   * @param texture - The actual GPU texture object.
   */
  setImportedTexture(handle: RGHandle, texture: TTexture): void {
    this._importedTextures.set(handle._id, texture);
  }

  /**
   * Execute the compiled graph with full resource lifecycle management.
   *
   * For each pass in topological order:
   * 1. Allocate any transient resources whose lifetime begins at this pass
   * 2. Invoke the pass's execute callback with a context that resolves handles
   * 3. Release any transient resources whose lifetime ends at this pass
   *
   * @param compiled - The compiled graph from {@link RenderGraph.compile}.
   */
  execute(compiled: CompiledRenderGraph): void {
    // Build per-pass allocation and release schedules
    const allocateAt = new Map<number, number[]>(); // passIndex -> resourceIds to allocate
    const releaseAt = new Map<number, number[]>(); // passIndex -> resourceIds to release

    for (const [resId, lifetime] of compiled.lifetimes) {
      if (lifetime.resource.kind === 'transient') {
        if (!allocateAt.has(lifetime.firstUse)) {
          allocateAt.set(lifetime.firstUse, []);
        }
        allocateAt.get(lifetime.firstUse)!.push(resId);

        if (!releaseAt.has(lifetime.lastUse)) {
          releaseAt.set(lifetime.lastUse, []);
        }
        releaseAt.get(lifetime.lastUse)!.push(resId);
      }
    }

    const ctx = this._createContext();

    for (let i = 0; i < compiled.orderedPasses.length; i++) {
      const pass = compiled.orderedPasses[i];

      // Allocate resources that start at this pass
      const toAllocate = allocateAt.get(i);
      if (toAllocate) {
        for (const resId of toAllocate) {
          const lifetime = compiled.lifetimes.get(resId)!;
          const desc = lifetime.resource.desc!;
          const size = this._resolveSize(desc);
          const texture = this._allocator.allocate(desc, size);
          this._allocatedTextures.set(resId, texture);
        }
      }

      // Execute the pass with exception safety for resource cleanup
      try {
        if (pass.executeFn) {
          (pass.executeFn as RGExecuteFn<unknown>)(ctx, pass.data);
        }
      } finally {
        // Release resources that end at this pass (always runs even if pass throws)
        const toRelease = releaseAt.get(i);
        if (toRelease) {
          for (const resId of toRelease) {
            const texture = this._allocatedTextures.get(resId);
            if (texture !== undefined) {
              this._allocator.release(texture);
              this._allocatedTextures.delete(resId);
            }
          }
        }
      }
    }
  }

  /**
   * Clear imported texture registrations and any leftover allocated textures.
   * Call this after execution or when resetting for a new frame.
   */
  reset(): void {
    // Release any textures that weren't released (shouldn't happen in normal flow)
    for (const texture of this._allocatedTextures.values()) {
      this._allocator.release(texture);
    }
    this._allocatedTextures.clear();
    this._importedTextures.clear();
  }

  // ─── Private ────────────────────────────────────────────────────────

  /** @internal */
  private _resolveSize(desc: RGTextureDesc): RGResolvedSize {
    const mode = desc.sizeMode ?? 'backbuffer-relative';
    if (mode === 'absolute') {
      return {
        width: desc.width ?? 1,
        height: desc.height ?? 1
      };
    }
    // backbuffer-relative: width/height are scale factors (default 1.0)
    const scaleX = desc.width ?? 1.0;
    const scaleY = desc.height ?? 1.0;
    return {
      width: Math.max(1, Math.floor(this._backbufferWidth * scaleX)),
      height: Math.max(1, Math.floor(this._backbufferHeight * scaleY))
    };
  }

  /** @internal */
  private _createContext(): RGExecuteContext {
    const self = this;
    return {
      getTexture<T>(handle: RGHandle): T {
        // Check imported first
        const imported = self._importedTextures.get(handle._id);
        if (imported !== undefined) {
          return imported as unknown as T;
        }
        // Check allocated transient
        const allocated = self._allocatedTextures.get(handle._id);
        if (allocated !== undefined) {
          return allocated as unknown as T;
        }
        throw new Error(
          `RenderGraphExecutor: cannot resolve resource "${handle.name}" (id=${handle._id}). ` +
            `It may not have been allocated yet or was already released.`
        );
      }
    };
  }
}
