import type { AbstractDevice, TextureFormat, TimestampQueryStatus } from '@zephyr3d/device';
import type { RGTextureAffinityCache } from './texture_affinity_cache';

/**
 * Texture size mode: fixed pixels or a backbuffer-relative scale. @public
 */
export type RGSizeMode = 'absolute' | 'backbuffer-relative';

/** Descriptor for a graph-managed transient texture. @public */
export interface RGTextureDesc {
  /** Debug label for this resource. */
  label?: string;
  /**
   * Stable identity used to prefer the same pooled texture across graph executions.
   * When omitted, the graph derives one from the declaring pass and resource label.
   */
  allocationKey?: string;
  /** Texture format. */
  format: TextureFormat;
  /** Sizing mode. Default 'backbuffer-relative'. */
  sizeMode?: RGSizeMode;
  /** Pixel width or backbuffer scale. Default 1. */
  width?: number;
  /** Pixel height or backbuffer scale. Default 1. */
  height?: number;
  /** Number of mip levels. Default 1. */
  mipLevels?: number;
  /** Array layers. Any defined value, including 1, requests a 2D array texture. */
  arrayLayers?: number;
}

/** Resource kinds that can be referenced by a graph handle. @public */
export type RGHandleKind = 'texture' | 'framebuffer' | 'token';

/** Opaque render graph resource handle. @public */
export class RGHandle<K extends RGHandleKind = RGHandleKind, TValue = unknown> {
  /** Compile-time backing resource type. */
  declare readonly _value: TValue;
  /** @internal */
  readonly _id: number;
  /** @internal */
  readonly _name: string;
  /** Resource kind used for compile-time and runtime validation. */
  readonly kind: K;

  /** @internal */
  constructor(id: number, name: string, kind: K = 'texture' as K) {
    this._id = id;
    this._name = name;
    this.kind = kind;
  }

  /** Debug-friendly name of the referenced resource. */
  get name(): string {
    return this._name;
  }
}

/** Texture resource handle. @public */
export type RGTextureHandle<TTexture = unknown> = RGHandle<'texture', TTexture>;

/** Framebuffer resource handle. @public */
export type RGFramebufferHandle<TFramebuffer = unknown> = RGHandle<'framebuffer', TFramebuffer>;

/** Ordering-only resource handle. @public */
export type RGTokenHandle = RGHandle<'token', void>;

/** @public */
export type RGResourceKind = 'transient' | 'imported' | 'token' | 'framebuffer';

/** Render graph resource metadata. @public */
export class RGResource {
  readonly id: number;
  readonly name: string;
  readonly kind: RGResourceKind;
  readonly desc: RGTextureDesc | RGFramebufferDesc | null;
  /** Resource ID of the physical backing resource used by imported versions. */
  readonly physicalId: number;
  /** Stable identity used for cross-frame transient texture allocation affinity. */
  readonly allocationKey: string | null;
  /** The pass that creates / writes this resource (null for imported until written). */
  producer: RGPass<any> | null = null;
  /** The pass that superseded this version via write(), or null while latest. */
  nextWriter: RGPass<any> | null = null;
  /** Passes that read this resource. */
  readonly consumers: RGPass<any>[] = [];

  constructor(
    id: number,
    name: string,
    kind: RGResourceKind,
    desc: RGTextureDesc | RGFramebufferDesc | null,
    physicalId = id,
    allocationKey: string | null = null
  ) {
    this.id = id;
    this.name = name;
    this.kind = kind;
    this.desc = desc;
    this.physicalId = physicalId;
    this.allocationKey = allocationKey;
  }
}

/** Resolves resources during pass execution. @public */
export interface RGExecuteContext {
  /**
   * Resolve a declared texture handle. Imported textures must first be bound on
   * the executor.
   */
  getTexture<TTexture>(handle: RGTextureHandle<TTexture>): TTexture;
  /** Resolve a texture handle stored in a generic resource container. */
  getTexture<TTexture = unknown>(handle: RGHandle<RGHandleKind, any>): TTexture;

  /** Resolve a framebuffer declared or created by the current pass. */
  getFramebuffer<TFramebuffer>(handle: RGFramebufferHandle<TFramebuffer>): TFramebuffer;
  /** Resolve a framebuffer handle stored in a generic resource container. */
  getFramebuffer<TFramebuffer = unknown>(handle: RGHandle<RGHandleKind, any>): TFramebuffer;

  /**
   * Create a temporary framebuffer released after execution. Handle attachments
   * must be declared by the current pass.
   */
  createFramebuffer<TFramebuffer = unknown>(desc: RGFramebufferDesc): TFramebuffer;

  /**
   * Run cleanup after execution or abort. Callbacks run in reverse order.
   */
  deferCleanup(callback: () => void): void;
}

/** Render graph execute callback. @public */
export type RGExecuteFn<T = void> = (ctx: RGExecuteContext, data: T) => void;

/** Ordered step sharing its parent pass's resources and lifetime. @public */
export class RGSubpass<T = unknown> {
  readonly name: string;
  readonly executeFn: RGExecuteFn<T>;

  constructor(name: string, executeFn: RGExecuteFn<T>) {
    this.name = name;
    this.executeFn = executeFn;
  }
}

/** Controls whether a write needs the previous resource contents. @public */
export interface RGWriteOptions {
  /**
   * Use `discard` for a full overwrite so old-content producers may be culled.
   * Default `load`.
   */
  load?: 'load' | 'discard';
}

/** Render graph pass metadata. @public */
export class RGPass<T = void> {
  readonly index: number;
  readonly name: string;
  /** Occurrence of this pass name within the graph, used for stable allocation keys. */
  readonly nameOccurrence: number;
  /** Resources this pass reads (dependencies). */
  readonly reads: RGResource[] = [];
  /** Resources this pass creates or writes. */
  readonly writes: RGResource[] = [];
  /**
   * RAW/WAW predecessors that propagate liveness.
   */
  readonly dependencies: RGPass<any>[] = [];
  /** WAW predecessors used only for ordering, including discard writes. */
  readonly orderingDependencies: RGPass<any>[] = [];
  /** WAR predecessors used only when both passes are alive. */
  readonly warDependencies: RGPass<any>[] = [];
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

  constructor(index: number, name: string, nameOccurrence = 0) {
    this.index = index;
    this.name = name;
    this.nameOccurrence = nameOccurrence;
  }
}

/** Declares a pass's resource access and execution callback. @public */
export interface RGPassBuilder<TData = any> {
  /** Declare a read of an existing resource. */
  read(handle: RGHandle): void;

  /**
   * Write a new resource version. Use the returned handle for later reads and
   * graph outputs. `discard` permits old-content producers to be culled.
   */
  write<TTexture>(handle: RGTextureHandle<TTexture>, options?: RGWriteOptions): RGTextureHandle<TTexture>;

  /** Generic-container fallback; runtime validation still applies. */
  write(handle: RGHandle, options?: RGWriteOptions): RGTextureHandle;

  /** Create a transient texture produced by this pass. */
  createTexture<TTexture = unknown>(desc: RGTextureDesc): RGTextureHandle<TTexture>;

  /** Create a logical token for ordering passes without resource dependencies. */
  createToken(name?: string): RGTokenHandle;

  /** Create a graph-managed framebuffer and infer attachment dependencies. */
  createFramebuffer<TFramebuffer = unknown>(desc: RGFramebufferDesc): RGFramebufferHandle<TFramebuffer>;

  /** Prevent this pass from being culled. */
  sideEffect(): void;

  /** Add an ordered subpass. Cannot be combined with {@link setExecute}. */
  addSubpass<D = TData>(name: string, fn: RGExecuteFn<D>): void;

  /** Set the pass callback. Cannot be combined with {@link addSubpass}. */
  setExecute<D = TData>(fn: RGExecuteFn<D>): void;
}

/** Compiled resource lifetime. @public */
export interface RGResourceLifetime {
  /** The resource. */
  readonly resource: RGResource;
  /** Index of the first pass that uses (produces or reads) this resource. */
  readonly firstUse: number;
  /** Index of the last pass that uses this resource. */
  readonly lastUse: number;
}

/** Ordered passes and resource lifetimes from graph compilation. @public */
export interface CompiledRenderGraph {
  /** Topologically sorted passes (only non-culled passes). */
  readonly orderedPasses: ReadonlyArray<RGPass<any>>;
  /** Resource lifetime information keyed by resource ID. */
  readonly lifetimes: ReadonlyMap<number, RGResourceLifetime>;
}

/** Profiling scope type. @public */
export type RGProfileScopeType = 'graph' | 'pass' | 'subpass';

/** GPU timestamp profiling options. @public */
export interface RGProfilingOptions {
  /** Enable render graph timestamp profiling. Default true when an options object is provided. */
  enabled?: boolean;
  /** Measure the whole graph execution. Default true. */
  graph?: boolean;
  /** Measure every render graph pass. Default true. */
  pass?: boolean;
  /** Measure every subpass and expose it as a child scope. Default true. */
  subpass?: boolean;
  /** Include pending upload/copy commands at timestamp boundaries. Default true. */
  includePendingUploads?: boolean;
  /** Allow graph profile scopes to remain open across frame boundaries. Default false. */
  allowCrossFrame?: boolean;
  /** Maximum unresolved profile frames kept by the executor. Default 3. */
  maxPendingFrames?: number;
  /** Root graph profile label. Default 'RenderGraph'. */
  label?: string;
  /** Device used for timestamp queries. If omitted, the scene global getDevice() is used. */
  device?: AbstractDevice;
}

/** Render graph executor options. @public */
export interface RenderGraphExecutorOptions<TTexture = unknown> {
  /** Device used for timestamp queries. If omitted, the scene global getDevice() is used. */
  device?: AbstractDevice;
  /** Render graph timestamp profiling options. Default false. */
  profiling?: boolean | RGProfilingOptions;
  /** Cross-execution affinity state used to stabilize transient texture identities. */
  textureAffinityCache?: RGTextureAffinityCache<TTexture>;
}

/** External resources bound for one graph execution. @public */
export interface RenderGraphExecutionBindings<TTexture = unknown> {
  /** Imported graph texture handles and their physical textures. */
  readonly importedTextures?: ReadonlyMap<RGTextureHandle<TTexture>, TTexture>;
}

/** Resolved GPU timing for one scope. @public */
export interface RGProfileScopeResult {
  /** Scope label. */
  name: string;
  /** Scope type. */
  type: RGProfileScopeType;
  /** Timestamp query id used by the device, or 0 for synthetic/unsupported scopes. */
  queryId: number;
  /** GPU duration in milliseconds. */
  durationMs: number;
  /** Timestamp result status. */
  status: TimestampQueryStatus;
  /** Child scopes. */
  children: RGProfileScopeResult[];
  /** Optional diagnostic message. */
  message?: string;
}

/** GPU timing tree for one graph execution. @public */
export interface RGProfileResult {
  /** Render frame id when profiling began. */
  frameId: number;
  /** Aggregate profile status. */
  status: TimestampQueryStatus;
  /** Root graph scope. */
  graph: RGProfileScopeResult;
  /** Top-level pass scopes. Same objects as graph.children. */
  passes: RGProfileScopeResult[];
}

/** Resolved texture dimensions. @public */
export interface RGResolvedSize {
  width: number;
  height: number;
}

export type RGTextureAttachment<TTexture = unknown> = RGTextureHandle<TTexture> | TTexture | TextureFormat;

/** Backend-independent framebuffer descriptor. @public */
export interface RGFramebufferDesc<TTexture = unknown> {
  /** Debug label for this framebuffer. */
  label?: string;
  /** Framebuffer width. Required when attachments are formats. */
  width?: number;
  /** Framebuffer height. Required when attachments are formats. */
  height?: number;
  /** Color attachments or formats. */
  colorAttachments: RGTextureAttachment<TTexture> | RGTextureAttachment<TTexture>[] | null;
  /** Depth/stencil attachment or format. */
  depthAttachment?: RGTextureAttachment<TTexture> | null;
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
 * Framebuffers are released before their attachments at the same pass boundary.
 * A released framebuffer must retain its attachments until texture release.
 *
 * @public
 */
export interface RGTextureAllocator<TTexture = unknown, TFramebuffer = unknown> {
  /** Allocate a transient texture, preferring a compatible prior allocation. */
  allocate(desc: RGTextureDesc, size: RGResolvedSize, preferred?: TTexture): TTexture;

  /** Release a transient texture. */
  release(texture: TTexture): void;

  /**
   * Retain a transient texture beyond graph execution. The external owner must
   * later release it.
   */
  retain?(texture: TTexture): void;

  /** Allocate a framebuffer released by the executor. */
  allocateFramebuffer?(desc: RGFramebufferDesc): TFramebuffer;

  /** Release a temporary framebuffer. */
  releaseFramebuffer?(framebuffer: TFramebuffer): void;
}
