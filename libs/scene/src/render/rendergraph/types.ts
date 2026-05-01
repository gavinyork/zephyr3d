import type { TextureFormat } from '@zephyr3d/device';

// ─── Resource Descriptors ───────────────────────────────────────────────

/**
 * Sizing mode for render graph textures.
 *
 * - 'absolute': fixed pixel dimensions
 * - 'backbuffer-relative': scaled relative to the backbuffer size
 *
 * @public
 */
export type RGSizeMode = 'absolute' | 'backbuffer-relative';

/**
 * Descriptor for a transient texture resource within the render graph.
 *
 * Transient textures are allocated and released automatically by the graph compiler.
 *
 * @public
 */
export interface RGTextureDesc {
  /** Debug label for this resource. */
  label?: string;
  /** Texture format (e.g. 'rgba8unorm', 'r32f', 'rgba16f'). */
  format: TextureFormat;
  /** Sizing mode. Default 'backbuffer-relative'. */
  sizeMode?: RGSizeMode;
  /** Width in pixels (absolute) or scale factor (backbuffer-relative, default 1.0). */
  width?: number;
  /** Height in pixels (absolute) or scale factor (backbuffer-relative, default 1.0). */
  height?: number;
  /** Number of mip levels. Default 1. */
  mipLevels?: number;
}

// ─── Handles ────────────────────────────────────────────────────────────

/**
 * Opaque handle referencing a resource within the render graph.
 *
 * Handles are obtained from {@link RGPassBuilder.createTexture}, {@link RenderGraph.importTexture},
 * or {@link RGPassBuilder.write}. They are lightweight identifiers used to declare
 * dependencies between passes.
 *
 * @public
 */
export class RGHandle {
  /** @internal */
  readonly _id: number;
  /** @internal */
  readonly _name: string;

  /** @internal */
  constructor(id: number, name: string) {
    this._id = id;
    this._name = name;
  }

  /** Debug-friendly name of the referenced resource. */
  get name(): string {
    return this._name;
  }
}

// ─── Internal Resource Tracking ─────────────────────────────────────────

/** @public */
export type RGResourceKind = 'transient' | 'imported' | 'token';

/**
 * Internal bookkeeping for a resource within the render graph.
 * @public
 */
export class RGResource {
  readonly id: number;
  readonly name: string;
  readonly kind: RGResourceKind;
  readonly desc: RGTextureDesc | null;
  /** The pass that creates / writes this resource (null for imported until written). */
  producer: RGPass | null = null;
  /** Passes that read this resource. */
  readonly consumers: RGPass[] = [];

  constructor(id: number, name: string, kind: RGResourceKind, desc: RGTextureDesc | null) {
    this.id = id;
    this.name = name;
    this.kind = kind;
    this.desc = desc;
  }
}

// ─── Internal Pass Tracking ─────────────────────────────────────────────

// ─── Execution Context ──────────────────────────────────────────────

/**
 * Context passed to pass execute callbacks during graph execution.
 *
 * Provides access to resolved GPU resources by their handles.
 *
 * @public
 */
export interface RGExecuteContext {
  /**
   * Resolve a handle to the actual GPU texture object.
   *
   * For transient resources, this returns the texture allocated by the executor.
   * For imported resources, this returns the texture registered via
   * {@link RenderGraphExecutor.setImportedTexture}.
   *
   * @param handle - Handle of the resource to resolve.
   * @returns The resolved texture object (type depends on the allocator).
   */
  getTexture<TTexture = unknown>(handle: RGHandle): TTexture;
}

/**
 * Execute callback signature.
 *
 * The callback receives a context for resolving handles to GPU resources,
 * plus the user data returned from the setup function.
 *
 * @public
 */
export type RGExecuteFn<T = void> = (ctx: RGExecuteContext, data: T) => void;

/**
 * Internal bookkeeping for a pass within the render graph.
 * @public
 */
export class RGPass<T = unknown> {
  readonly index: number;
  readonly name: string;
  /** Resources this pass reads (dependencies). */
  readonly reads: RGResource[] = [];
  /** Resources this pass creates or writes. */
  readonly writes: RGResource[] = [];
  /** Whether this pass has side effects and must not be culled. */
  hasSideEffect = false;
  /** User data returned from the setup function. */
  data: T | null = null;
  /** Execute callback. */
  executeFn: RGExecuteFn<T> | null = null;
  /** Set during compilation: true if this pass is needed. */
  alive = true;

  constructor(index: number, name: string) {
    this.index = index;
    this.name = name;
  }
}

// ─── Pass Builder ───────────────────────────────────────────────────────

/**
 * Builder interface used within the setup callback of {@link RenderGraph.addPass}
 * to declare a pass's resource requirements.
 *
 * @public
 */
export interface RGPassBuilder {
  /**
   * Declare a read dependency on an existing resource.
   *
   * The resource must have been created by a prior pass or imported into the graph.
   *
   * @param handle - Handle of the resource to read.
   */
  read(handle: RGHandle): void;

  /**
   * Declare that this pass writes to an existing resource (typically an imported resource).
   *
   * @param handle - Handle of the resource to write to.
   */
  write(handle: RGHandle): void;

  /**
   * Create a new transient texture resource that this pass will produce.
   *
   * @param desc - Texture descriptor.
   * @returns A handle referencing the newly created resource.
   */
  createTexture(desc: RGTextureDesc): RGHandle;

  /**
   * Create a logical dependency token produced by this pass.
   *
   * Tokens do not resolve to GPU resources and are not allocated by the executor.
   * They are useful for ordering passes whose dependencies are side effects rather
   * than texture reads/writes.
   *
   * @param name - Debug label for this token.
   * @returns A handle referencing the newly created token.
   */
  createToken(name?: string): RGHandle;

  /**
   * Mark this pass as having side effects.
   *
   * Side-effect passes are never culled by the graph compiler, regardless of
   * whether their outputs are consumed. Use this for GPU readback, picking,
   * debug overlays, etc.
   */
  sideEffect(): void;

  /**
   * Set the execution callback for this pass.
   *
   * @param fn - Callback invoked during graph execution.
   */
  setExecute<D>(fn: RGExecuteFn<D>): void;
}

// ─── Compiled Graph ─────────────────────────────────────────────────────

/**
 * Lifetime information for a resource within the compiled graph.
 *
 * @public
 */
export interface RGResourceLifetime {
  /** The resource. */
  readonly resource: RGResource;
  /** Index of the first pass that uses (produces or reads) this resource. */
  readonly firstUse: number;
  /** Index of the last pass that uses this resource. */
  readonly lastUse: number;
}

/**
 * Result of compiling a render graph.
 *
 * Contains the ordered list of passes to execute and lifetime information
 * for automatic resource management.
 *
 * @public
 */
export interface CompiledRenderGraph {
  /** Topologically sorted passes (only non-culled passes). */
  readonly orderedPasses: ReadonlyArray<RGPass>;
  /** Resource lifetime information keyed by resource ID. */
  readonly lifetimes: ReadonlyMap<number, RGResourceLifetime>;
}

// ─── Texture Allocator ──────────────────────────────────────────────

/**
 * Resolved dimensions for a texture allocation.
 * @public
 */
export interface RGResolvedSize {
  width: number;
  height: number;
}

/**
 * Interface for allocating and releasing transient textures.
 *
 * Implement this to bridge the render graph with your GPU device's resource pool.
 * The executor calls {@link allocate} before a resource's first use and
 * {@link release} after its last use.
 *
 * @typeParam TTexture - The concrete texture type (e.g. `Texture2D`).
 * @public
 */
export interface RGTextureAllocator<TTexture = unknown> {
  /**
   * Allocate a transient texture matching the given descriptor and resolved size.
   *
   * @param desc - The texture descriptor from the pass builder.
   * @param size - The resolved pixel dimensions.
   * @returns The allocated texture object.
   */
  allocate(desc: RGTextureDesc, size: RGResolvedSize): TTexture;

  /**
   * Release a previously allocated transient texture back to the pool.
   *
   * @param texture - The texture to release.
   */
  release(texture: TTexture): void;
}
