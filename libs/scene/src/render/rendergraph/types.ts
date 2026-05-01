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
 * Handles are obtained from {@link RGPassBuilder.createTexture}, {@link RGPassBuilder.createFramebuffer},
 * {@link RenderGraph.importTexture}, or {@link RGPassBuilder.write}. They are lightweight identifiers
 * used to declare dependencies between passes.
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
export type RGResourceKind = 'transient' | 'imported' | 'token' | 'framebuffer';

/**
 * Internal bookkeeping for a resource within the render graph.
 * @public
 */
export class RGResource {
  readonly id: number;
  readonly name: string;
  readonly kind: RGResourceKind;
  readonly desc: RGTextureDesc | RGFramebufferDesc | null;
  /** Resource ID of the physical backing resource used by imported versions. */
  readonly physicalId: number;
  /** The pass that creates / writes this resource (null for imported until written). */
  producer: RGPass | null = null;
  /** Passes that read this resource. */
  readonly consumers: RGPass[] = [];

  constructor(
    id: number,
    name: string,
    kind: RGResourceKind,
    desc: RGTextureDesc | RGFramebufferDesc | null,
    physicalId = id
  ) {
    this.id = id;
    this.name = name;
    this.kind = kind;
    this.desc = desc;
    this.physicalId = physicalId;
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
   * {@link RenderGraphExecutor.setImportedTexture}. The handle must be declared
   * by the current pass with {@link RGPassBuilder.read} or {@link RGPassBuilder.write}.
   *
   * @param handle - Handle of the resource to resolve.
   * @returns The resolved texture object (type depends on the allocator).
   */
  getTexture<TTexture = unknown>(handle: RGHandle): TTexture;

  /**
   * Resolve a framebuffer handle to the actual backend framebuffer object.
   *
   * The handle must be declared by the current pass with {@link RGPassBuilder.read}
   * or created by the same pass with {@link RGPassBuilder.createFramebuffer}.
   *
   * @param handle - Handle returned from {@link RGPassBuilder.createFramebuffer}.
   * @returns The resolved framebuffer object (type depends on the allocator).
   */
  getFramebuffer<TFramebuffer = unknown>(handle: RGHandle): TFramebuffer;

  /**
   * Create a temporary framebuffer managed by the graph executor.
   *
   * The framebuffer is released automatically when graph execution finishes or
   * aborts. Attachments may be actual backend resources or texture formats,
   * depending on the allocator implementation. If an attachment is an
   * {@link RGHandle}, the current pass must declare it with
   * {@link RGPassBuilder.read} or {@link RGPassBuilder.write}.
   *
   * @param desc - Framebuffer descriptor.
   * @returns The allocated framebuffer object (type depends on the allocator).
   */
  createFramebuffer<TFramebuffer = unknown>(desc: RGFramebufferDesc): TFramebuffer;

  /**
   * Register a cleanup callback to run when graph execution finishes or aborts.
   *
   * Callbacks run in reverse registration order. Use this for temporary objects
   * created inside pass execution that are not graph resources, such as pooled
   * framebuffers wrapping graph-managed textures. If pass execution throws, the
   * executor still runs cleanup callbacks and preserves the original pass error
   * ahead of cleanup errors.
   *
   * @param callback - Cleanup function to invoke after execution.
   */
  deferCleanup(callback: () => void): void;
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
 * Ordered execution step inside a render graph pass.
 *
 * Subpasses share the parent pass's resource declarations, lifetime, culling,
 * and access validation. They are intended to make multi-step pass bodies
 * explicit without splitting graph-level resource dependencies.
 *
 * @public
 */
export class RGSubpass<T = unknown> {
  readonly name: string;
  readonly executeFn: RGExecuteFn<T>;

  constructor(name: string, executeFn: RGExecuteFn<T>) {
    this.name = name;
    this.executeFn = executeFn;
  }
}

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
  /** Passes that must complete before this pass due to non-resource hazards. */
  readonly dependencies: RGPass[] = [];
  /** Whether this pass has side effects and must not be culled. */
  hasSideEffect = false;
  /** User data returned from the setup function. */
  data: T | null = null;
  /** Execute callback. */
  executeFn: RGExecuteFn<T> | null = null;
  /** Ordered subpasses for passes with multiple logical execution steps. */
  readonly subpasses: RGSubpass<T>[] = [];
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
   * Declare that this pass writes a new version of an existing resource.
   *
   * The returned handle represents the post-write version. Use it for subsequent
   * reads and as the graph output passed to {@link RenderGraph.compile}. Passing
   * an older version of the same resource to `compile()` is rejected because it
   * usually means the caller ignored the handle returned by `write()`. If the pass
   * needs the previous contents, call {@link read} on the input handle explicitly
   * before writing.
   *
   * @param handle - Handle of the resource to write to.
   * @returns A handle referencing the newly written version.
   */
  write(handle: RGHandle): RGHandle;

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
   * Create a graph-managed framebuffer view.
   *
   * The graph compiler infers dependencies from any attachment handles in the
   * descriptor. The executor creates and releases the framebuffer automatically.
   *
   * @param desc - Framebuffer descriptor.
   * @returns A handle referencing the framebuffer view.
   */
  createFramebuffer(desc: RGFramebufferDesc): RGHandle;

  /**
   * Mark this pass as having side effects.
   *
   * Side-effect passes are never culled by the graph compiler, regardless of
   * whether their outputs are consumed. Use this for GPU readback, picking,
   * debug overlays, etc.
   */
  sideEffect(): void;

  /**
   * Add an ordered logical subpass to this pass.
   *
   * Subpasses execute in registration order and share the parent pass's declared
   * reads, writes, framebuffer views, and user data. A pass may use either
   * subpasses or {@link setExecute}, but not both.
   *
   * @param name - Debug label for the subpass.
   * @param fn - Callback invoked when this subpass executes.
   */
  addSubpass<D>(name: string, fn: RGExecuteFn<D>): void;

  /**
   * Set the execution callback for this pass.
   *
   * A pass may use either this method or {@link addSubpass}, but not both.
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
 * Descriptor for a framebuffer view managed by the graph or created temporarily during pass execution.
 *
 * This is intentionally backend-agnostic: graph-managed descriptors may use
 * {@link RGHandle} attachments, and executor-created descriptors use resolved
 * resources or texture formats understood by the allocator.
 *
 * @public
 */
export interface RGFramebufferDesc {
  /** Debug label for this framebuffer. */
  label?: string;
  /** Framebuffer width. Required when attachments are formats. */
  width?: number;
  /** Framebuffer height. Required when attachments are formats. */
  height?: number;
  /** Color attachments or formats. */
  colorAttachments: unknown | unknown[] | null;
  /** Depth/stencil attachment or format. */
  depthAttachment?: unknown | null;
  /** Whether color attachments created from formats should support mipmapping. */
  mipmapping?: boolean;
  /** Framebuffer sample count. */
  sampleCount?: number;
  /** Whether to ignore depth/stencil during MSAA resolve. */
  ignoreDepthStencil?: boolean;
  /** Attachment mip level. */
  attachmentMipLevel?: number;
  /** Attachment cubemap face. */
  attachmentCubeface?: number;
  /** Attachment array layer. */
  attachmentLayer?: number;
}

/**
 * Interface for allocating and releasing transient textures.
 *
 * Implement this to bridge the render graph with your GPU device's resource pool.
 * The executor calls `allocate()` before a resource's first use and
 * `release()` after its last use.
 *
 * @typeParam TTexture - The concrete texture type (e.g. `Texture2D`).
 * @public
 */
export interface RGTextureAllocator<TTexture = unknown, TFramebuffer = unknown> {
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

  /**
   * Allocate a temporary framebuffer matching the given descriptor.
   *
   * Implementations should not auto-release this framebuffer; the graph executor
   * calls {@link releaseFramebuffer} when execution completes or aborts.
   *
   * @param desc - Framebuffer descriptor.
   * @returns The allocated framebuffer object.
   */
  allocateFramebuffer?(desc: RGFramebufferDesc): TFramebuffer;

  /**
   * Release a previously allocated temporary framebuffer.
   *
   * @param framebuffer - The framebuffer to release.
   */
  releaseFramebuffer?(framebuffer: TFramebuffer): void;
}
