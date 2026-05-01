import type {
  CompiledRenderGraph,
  RGTextureAllocator,
  RGTextureDesc,
  RGFramebufferDesc,
  RGResolvedSize,
  RGExecuteContext,
  RGExecuteFn,
  RGPass
} from './types';
import { RGHandle } from './types';

interface RGPassAccessScope {
  passName: string;
  accessibleIds: Set<number>;
  textureIds: Set<number>;
  framebufferIds: Set<number>;
}

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
export class RenderGraphExecutor<TTexture = unknown, TFramebuffer = unknown> {
  /** @internal */
  private _allocator: RGTextureAllocator<TTexture, TFramebuffer>;
  /** @internal */
  private _backbufferWidth: number;
  /** @internal */
  private _backbufferHeight: number;
  /** @internal */
  private _importedTextures: Map<number, TTexture> = new Map();
  /** @internal */
  private _allocatedTextures: Map<number, TTexture> = new Map();
  /** @internal */
  private _allocatedFramebuffers: Map<number, TFramebuffer> = new Map();
  /** @internal */
  private _importedTextureAliases: Map<number, number> = new Map();
  /** @internal */
  private _resolvedImportedTextures: Map<number, TTexture> = new Map();
  /** @internal */
  private _cleanupCallbacks: Array<() => void> = [];

  constructor(
    allocator: RGTextureAllocator<TTexture, TFramebuffer>,
    backbufferWidth: number,
    backbufferHeight: number
  ) {
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
    this._cleanupCallbacks.length = 0;
    this._resolveImportedTextureAliases(compiled);

    // Build per-pass allocation and release schedules
    const allocateAt = new Map<number, number[]>(); // passIndex -> transient texture resourceIds to allocate
    const releaseAt = new Map<number, number[]>(); // passIndex -> transient texture resourceIds to release
    const allocateFramebufferAt = new Map<number, number[]>(); // passIndex -> framebuffer resourceIds to allocate
    const releaseFramebufferAt = new Map<number, number[]>(); // passIndex -> framebuffer resourceIds to release

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
      } else if (lifetime.resource.kind === 'framebuffer') {
        if (!allocateFramebufferAt.has(lifetime.firstUse)) {
          allocateFramebufferAt.set(lifetime.firstUse, []);
        }
        allocateFramebufferAt.get(lifetime.firstUse)!.push(resId);

        if (!releaseFramebufferAt.has(lifetime.lastUse)) {
          releaseFramebufferAt.set(lifetime.lastUse, []);
        }
        releaseFramebufferAt.get(lifetime.lastUse)!.push(resId);
      }
    }

    let completed = false;
    let executionError: unknown = null;
    try {
      for (let i = 0; i < compiled.orderedPasses.length; i++) {
        const pass = compiled.orderedPasses[i];

        // Allocate resources that start at this pass
        const toAllocate = allocateAt.get(i);
        if (toAllocate) {
          for (const resId of toAllocate) {
            const lifetime = compiled.lifetimes.get(resId)!;
            const desc = lifetime.resource.desc as RGTextureDesc;
            const size = this._resolveSize(desc);
            const texture = this._allocator.allocate(desc, size);
            this._allocatedTextures.set(resId, texture);
          }
        }

        // Allocate framebuffer views after their texture attachments are available.
        const framebuffersToAllocate = allocateFramebufferAt.get(i);
        if (framebuffersToAllocate) {
          for (const resId of framebuffersToAllocate) {
            const lifetime = compiled.lifetimes.get(resId)!;
            const desc = lifetime.resource.desc as RGFramebufferDesc;
            const framebuffer = this._createFramebuffer(this._resolveFramebufferDesc(desc), false);
            this._allocatedFramebuffers.set(resId, framebuffer);
          }
        }

        // Execute the pass with exception safety for resource cleanup.
        // Release errors must not hide the original pass execution error.
        let passError: unknown = null;
        try {
          if (pass.executeFn) {
            const accessScope = this._createAccessScope(pass);
            const ctx = this._createContext(accessScope);
            (pass.executeFn as RGExecuteFn<unknown>)(ctx, pass.data);
          }
        } catch (e) {
          passError = e;
        }

        let releaseError: unknown = null;
        const framebuffersToRelease = releaseFramebufferAt.get(i);
        if (framebuffersToRelease) {
          for (const resId of framebuffersToRelease) {
            const framebuffer = this._allocatedFramebuffers.get(resId);
            if (framebuffer !== undefined) {
              try {
                this._releaseFramebuffer(framebuffer);
                this._allocatedFramebuffers.delete(resId);
              } catch (e) {
                releaseError ??= e;
              }
            }
          }
        }
        // Release resources that end at this pass (always runs even if pass throws)
        const toRelease = releaseAt.get(i);
        if (toRelease) {
          for (const resId of toRelease) {
            const texture = this._allocatedTextures.get(resId);
            if (texture !== undefined) {
              try {
                this._allocator.release(texture);
                this._allocatedTextures.delete(resId);
              } catch (e) {
                releaseError ??= e;
              }
            }
          }
        }
        if (passError) {
          throw passError;
        }
        if (releaseError) {
          throw releaseError;
        }
      }
      completed = true;
    } catch (e) {
      executionError = e;
    } finally {
      let cleanupError: unknown = null;
      try {
        this._runCleanupCallbacks();
      } catch (e) {
        cleanupError = e;
      } finally {
        if (!completed) {
          try {
            this.reset();
          } catch (e) {
            cleanupError ??= e;
          }
        }
      }
      if (executionError) {
        throw executionError;
      }
      if (cleanupError) {
        throw cleanupError;
      }
    }
  }

  /**
   * Clear imported texture registrations and any leftover allocated textures.
   * Call this after execution or when resetting for a new frame.
   */
  reset(): void {
    this._runCleanupCallbacks();
    // Release any textures that weren't released (shouldn't happen in normal flow)
    for (const framebuffer of this._allocatedFramebuffers.values()) {
      this._releaseFramebuffer(framebuffer);
    }
    this._allocatedFramebuffers.clear();
    for (const texture of this._allocatedTextures.values()) {
      this._allocator.release(texture);
    }
    this._allocatedTextures.clear();
    this._importedTextures.clear();
    this._importedTextureAliases.clear();
    this._resolvedImportedTextures.clear();
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
  private _resolveImportedTextureAliases(compiled: CompiledRenderGraph): void {
    this._importedTextureAliases.clear();
    this._resolvedImportedTextures.clear();
    const physicalToTexture = new Map<number, TTexture>();
    for (const lifetime of compiled.lifetimes.values()) {
      const resource = lifetime.resource;
      if (resource.kind !== 'imported') {
        continue;
      }
      const texture =
        this._importedTextures.get(resource.id) ?? this._importedTextures.get(resource.physicalId);
      if (texture !== undefined) {
        physicalToTexture.set(resource.physicalId, texture);
      }
    }
    for (const lifetime of compiled.lifetimes.values()) {
      const resource = lifetime.resource;
      if (resource.kind !== 'imported') {
        continue;
      }
      this._importedTextureAliases.set(resource.id, resource.physicalId);
      const texture = physicalToTexture.get(resource.physicalId);
      if (texture !== undefined) {
        this._resolvedImportedTextures.set(resource.id, texture);
        this._resolvedImportedTextures.set(resource.physicalId, texture);
      }
    }
  }

  /** @internal */
  private _runCleanupCallbacks(): void {
    let error: unknown = null;
    while (this._cleanupCallbacks.length > 0) {
      const callback = this._cleanupCallbacks.pop()!;
      try {
        callback();
      } catch (e) {
        error ??= e;
      }
    }
    if (error) {
      throw error;
    }
  }

  /** @internal */
  private _createFramebuffer(desc: RGFramebufferDesc, autoCleanup = true): TFramebuffer {
    if (!this._allocator.allocateFramebuffer || !this._allocator.releaseFramebuffer) {
      throw new Error('RenderGraphExecutor: framebuffer allocation is not supported by this allocator.');
    }
    const framebuffer = this._allocator.allocateFramebuffer(desc);
    if (autoCleanup) {
      this._cleanupCallbacks.push(() => {
        this._allocator.releaseFramebuffer!(framebuffer);
      });
    }
    return framebuffer;
  }

  /** @internal */
  private _releaseFramebuffer(framebuffer: TFramebuffer): void {
    if (!this._allocator.releaseFramebuffer) {
      throw new Error('RenderGraphExecutor: framebuffer release is not supported by this allocator.');
    }
    this._allocator.releaseFramebuffer(framebuffer);
  }

  /** @internal */
  private _resolveFramebufferDesc(desc: RGFramebufferDesc, accessScope?: RGPassAccessScope): RGFramebufferDesc {
    const resolveAttachment = (attachment: unknown): unknown => {
      if (attachment instanceof RGHandle) {
        if (accessScope) {
          this._assertDeclaredAccess(accessScope, attachment, 'texture');
        }
        return this._resolveResource(attachment);
      }
      return attachment;
    };
    const colors = Array.isArray(desc.colorAttachments)
      ? desc.colorAttachments.map(resolveAttachment)
      : desc.colorAttachments
        ? resolveAttachment(desc.colorAttachments)
        : null;
    return {
      ...desc,
      colorAttachments: colors,
      depthAttachment: resolveAttachment(desc.depthAttachment)
    };
  }

  /** @internal */
  private _resolveResource(handle: RGHandle): TTexture {
    const imported = this._importedTextures.get(handle._id);
    if (imported !== undefined) {
      return imported;
    }
    const resolvedImported = this._resolvedImportedTextures.get(handle._id);
    if (resolvedImported !== undefined) {
      return resolvedImported;
    }
    const importedAlias = this._importedTextureAliases.get(handle._id);
    if (importedAlias !== undefined) {
      const aliased =
        this._importedTextures.get(importedAlias) ?? this._resolvedImportedTextures.get(importedAlias);
      if (aliased !== undefined) {
        return aliased;
      }
    }
    const allocated = this._allocatedTextures.get(handle._id);
    if (allocated !== undefined) {
      return allocated;
    }
    throw new Error(
      `RenderGraphExecutor: cannot resolve resource "${handle.name}" (id=${handle._id}). ` +
        `It may not have been allocated yet or was already released.`
    );
  }

  /** @internal */
  private _createAccessScope(pass: RGPass): RGPassAccessScope {
    const accessibleIds = new Set<number>();
    const textureIds = new Set<number>();
    const framebufferIds = new Set<number>();
    for (const resource of pass.reads) {
      accessibleIds.add(resource.id);
      if (resource.kind === 'transient' || resource.kind === 'imported') {
        textureIds.add(resource.id);
      } else if (resource.kind === 'framebuffer') {
        framebufferIds.add(resource.id);
      }
    }
    for (const resource of pass.writes) {
      accessibleIds.add(resource.id);
      if (resource.kind === 'transient' || resource.kind === 'imported') {
        textureIds.add(resource.id);
      } else if (resource.kind === 'framebuffer') {
        framebufferIds.add(resource.id);
      }
    }
    return {
      passName: pass.name,
      accessibleIds,
      textureIds,
      framebufferIds
    };
  }

  /** @internal */
  private _assertDeclaredAccess(
    accessScope: RGPassAccessScope,
    handle: RGHandle,
    access: 'texture' | 'framebuffer'
  ): void {
    if (!accessScope.accessibleIds.has(handle._id)) {
      throw new Error(
        `RenderGraphExecutor: pass "${accessScope.passName}" tried to access ${access} "${handle.name}" ` +
          `without declaring a read/write dependency.`
      );
    }
    if (access === 'texture' && !accessScope.textureIds.has(handle._id)) {
      throw new Error(
        `RenderGraphExecutor: pass "${accessScope.passName}" tried to access "${handle.name}" as a texture, ` +
          `but it is not a texture resource.`
      );
    }
    if (access === 'framebuffer' && !accessScope.framebufferIds.has(handle._id)) {
      throw new Error(
        `RenderGraphExecutor: pass "${accessScope.passName}" tried to access "${handle.name}" as a framebuffer, ` +
          `but it is not a framebuffer resource.`
      );
    }
  }

  /** @internal */
  private _createContext(accessScope: RGPassAccessScope): RGExecuteContext {
    const self = this;
    return {
      getTexture<T>(handle: RGHandle): T {
        self._assertDeclaredAccess(accessScope, handle, 'texture');
        return self._resolveResource(handle) as unknown as T;
      },
      getFramebuffer<TFramebuffer = unknown>(handle: RGHandle): TFramebuffer {
        self._assertDeclaredAccess(accessScope, handle, 'framebuffer');
        const framebuffer = self._allocatedFramebuffers.get(handle._id);
        if (framebuffer !== undefined) {
          return framebuffer as unknown as TFramebuffer;
        }
        throw new Error(
          `RenderGraphExecutor: cannot resolve framebuffer "${handle.name}" (id=${handle._id}). ` +
            `It may not have been allocated yet or was already released.`
        );
      },
      createFramebuffer<TFramebuffer = unknown>(desc: RGFramebufferDesc): TFramebuffer {
        return self._createFramebuffer(self._resolveFramebufferDesc(desc, accessScope)) as unknown as TFramebuffer;
      },
      deferCleanup(callback: () => void): void {
        self._cleanupCallbacks.push(callback);
      }
    };
  }
}
