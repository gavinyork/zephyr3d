import type {
  CompiledRenderGraph,
  RenderGraphExecutorOptions,
  RGProfileResult,
  RGProfileScopeResult,
  RGProfileScopeType,
  RGProfilingOptions,
  RGTextureAllocator,
  RGTextureDesc,
  RGFramebufferDesc,
  RGResolvedSize,
  RGExecuteContext,
  RGExecuteFn,
  RGPass,
  RGTextureHandle,
  RGFramebufferHandle,
  RenderGraphExecutionBindings
} from './types';
import { RGHandle } from './types';
import type { RGTextureAffinityCache, RGTextureAffinityEntry } from './texture_affinity_cache';
import type {
  AbstractDevice,
  FrameBuffer,
  TimestampQueryResult,
  TimestampQueryStatus
} from '@zephyr3d/device';
import { getDevice } from '../../app/api';

interface RGPassAccessScope {
  passName: string;
  accessibleIds: Set<number>;
  textureIds: Set<number>;
  framebufferIds: Set<number>;
}

type RGResolvedProfilingOptions = Required<Omit<RGProfilingOptions, 'device'>> & {
  device?: AbstractDevice;
};

interface RGProfileScopeInternal {
  result: RGProfileScopeResult;
  queryId: number;
  ended: boolean;
}

interface RGProfileFrameInternal {
  serial: number;
  device: AbstractDevice | null;
  supported: boolean;
  result: RGProfileResult;
  root: RGProfileScopeInternal;
  scopes: RGProfileScopeInternal[];
  resolvePromise: Promise<RGProfileResult>;
}

const DEFAULT_PROFILING_OPTIONS: RGResolvedProfilingOptions = {
  enabled: false,
  graph: true,
  pass: true,
  subpass: true,
  includePendingUploads: true,
  allowCrossFrame: false,
  maxPendingFrames: 3,
  label: 'RenderGraph'
};

/** Executes compiled graphs with automatic resource lifetimes. @public */
export class RenderGraphExecutor<TTexture = unknown> {
  private static _defaultProfilingOptions: boolean | RGProfilingOptions = false;
  private static _latestProfileResult: RGProfileResult | null = null;
  private static _latestPendingProfileFrame: RGProfileFrameInternal | null = null;
  private static _latestResolvedProfileSerial = 0;
  private static _nextProfileSerial = 0;

  private _allocator: RGTextureAllocator<TTexture>;
  private _backbufferWidth: number;
  private _backbufferHeight: number;
  private _importedTextures: Map<number, TTexture> = new Map();
  private _allocatedTextures: Map<number, TTexture> = new Map();
  private _allocatedFramebuffers: Map<number, FrameBuffer> = new Map();
  private _importedTextureAliases: Map<number, number> = new Map();
  private _transientTextureAliases: Map<number, number> = new Map();
  private _resolvedImportedTextures: Map<number, TTexture> = new Map();
  private _cleanupCallbacks: Array<() => void> = [];
  private _profilingOptions: RGResolvedProfilingOptions;
  private _pendingProfileFrames: RGProfileFrameInternal[] = [];
  private _latestProfileResult: RGProfileResult | null = null;
  private _latestResolvedProfileSerial = 0;
  private _textureAffinityCache: RGTextureAffinityCache<TTexture> | null;

  constructor(
    allocator: RGTextureAllocator<TTexture>,
    backbufferWidth: number,
    backbufferHeight: number,
    options?: RenderGraphExecutorOptions<TTexture>
  ) {
    this._allocator = allocator;
    this._backbufferWidth = backbufferWidth;
    this._backbufferHeight = backbufferHeight;
    this._profilingOptions = this._normalizeProfilingOptions(
      options?.profiling ?? RenderGraphExecutor._defaultProfilingOptions,
      options?.device
    );
    this._textureAffinityCache = options?.textureAffinityCache ?? null;
  }

  /** Set profiling defaults for new executors. */
  static setDefaultProfilingOptions(options: boolean | RGProfilingOptions): void {
    RenderGraphExecutor._defaultProfilingOptions = options;
  }

  /** Return the latest resolved result from any executor. */
  static getLatestProfileResult(): RGProfileResult | null {
    return RenderGraphExecutor._latestProfileResult;
  }

  /** Resolve the latest pending result from any executor. */
  static resolveProfileResult(): Promise<RGProfileResult | null> {
    return (
      RenderGraphExecutor._latestPendingProfileFrame?.resolvePromise ??
      Promise.resolve(RenderGraphExecutor._latestProfileResult)
    );
  }

  /** Update timestamp profiling for this executor. */
  setProfilingOptions(options: boolean | RGProfilingOptions): void {
    this._profilingOptions = this._normalizeProfilingOptions(options, this._profilingOptions.device);
  }

  /** Return this executor's latest resolved profile. */
  getLatestProfileResult(): RGProfileResult | null {
    return this._latestProfileResult;
  }

  /** Resolve this executor's latest pending profile. */
  resolveProfileResult(): Promise<RGProfileResult | null> {
    return (
      this._pendingProfileFrames[this._pendingProfileFrames.length - 1]?.resolvePromise ??
      Promise.resolve(this._latestProfileResult)
    );
  }

  /** Update dimensions used for backbuffer-relative resources. */
  setBackbufferSize(width: number, height: number): void {
    this._backbufferWidth = width;
    this._backbufferHeight = height;
  }

  /** Bind an imported texture for execution. */
  setImportedTexture(handle: RGHandle, texture: TTexture): void {
    this._importedTextures.set(handle._id, texture);
  }

  /** Execute a compiled graph and manage its transient resources. */
  execute(compiled: CompiledRenderGraph, bindings?: RenderGraphExecutionBindings<TTexture>): void {
    if (bindings?.importedTextures) {
      for (const [handle, texture] of bindings.importedTextures) {
        this.setImportedTexture(handle, texture);
      }
    }
    this._cleanupCallbacks.length = 0;
    this._resolveImportedTextureAliases(compiled);
    const profileFrame = this._beginProfileFrame();
    const affinityEntries = new Map<string, RGTextureAffinityEntry<TTexture>>();

    const allocateAt = new Map<number, number[]>();
    const releaseAt = new Map<number, number[]>();
    const allocateFramebufferAt = new Map<number, number[]>();
    const releaseFramebufferAt = new Map<number, number[]>();

    // Merge lifetimes of versions sharing one physical texture.
    this._transientTextureAliases.clear();
    const transientSchedules = new Map<
      number,
      { firstUse: number; lastUse: number; desc: RGTextureDesc; allocationKey: string | null }
    >();
    for (const [resId, lifetime] of compiled.lifetimes) {
      if (lifetime.resource.kind === 'transient') {
        const physicalId = lifetime.resource.physicalId;
        this._transientTextureAliases.set(resId, physicalId);
        const merged = transientSchedules.get(physicalId);
        if (merged) {
          merged.firstUse = Math.min(merged.firstUse, lifetime.firstUse);
          merged.lastUse = Math.max(merged.lastUse, lifetime.lastUse);
        } else {
          transientSchedules.set(physicalId, {
            firstUse: lifetime.firstUse,
            lastUse: lifetime.lastUse,
            desc: lifetime.resource.desc as RGTextureDesc,
            allocationKey: lifetime.resource.allocationKey
          });
        }
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
    for (const [physicalId, schedule] of transientSchedules) {
      if (!allocateAt.has(schedule.firstUse)) {
        allocateAt.set(schedule.firstUse, []);
      }
      allocateAt.get(schedule.firstUse)!.push(physicalId);

      if (!releaseAt.has(schedule.lastUse)) {
        releaseAt.set(schedule.lastUse, []);
      }
      releaseAt.get(schedule.lastUse)!.push(physicalId);
    }

    let completed = false;
    let executionError: unknown = null;
    try {
      for (let i = 0; i < compiled.orderedPasses.length; i++) {
        const pass = compiled.orderedPasses[i];

        const toAllocate = allocateAt.get(i);
        if (toAllocate) {
          for (const resId of toAllocate) {
            const schedule = transientSchedules.get(resId)!;
            const size = this._resolveSize(schedule.desc);
            const descriptorSignature = this._getTextureDescriptorSignature(schedule.desc, size);
            const preferred = schedule.allocationKey
              ? this._textureAffinityCache?.getPreferredTexture(schedule.allocationKey, descriptorSignature)
              : undefined;
            const texture = this._allocator.allocate(schedule.desc, size, preferred);
            this._allocatedTextures.set(resId, texture);
            if (schedule.allocationKey) {
              affinityEntries.set(schedule.allocationKey, { texture, descriptorSignature });
            }
          }
        }

        // Allocate framebuffers after their attachments.
        const framebuffersToAllocate = allocateFramebufferAt.get(i);
        if (framebuffersToAllocate) {
          for (const resId of framebuffersToAllocate) {
            const lifetime = compiled.lifetimes.get(resId)!;
            const desc = lifetime.resource.desc as RGFramebufferDesc;
            const framebuffer = this._createFramebuffer(this._resolveFramebufferDesc(desc), false);
            this._allocatedFramebuffers.set(resId, framebuffer);
          }
        }

        // Preserve pass errors ahead of release errors.
        let passError: unknown = null;
        const passProfile = this._beginPassProfileScope(profileFrame, pass);
        try {
          if (pass.subpasses.length > 0) {
            const accessScope = this._createAccessScope(pass);
            const ctx = this._createContext(accessScope);
            for (const subpass of pass.subpasses) {
              const subpassProfile = this._beginSubpassProfileScope(
                profileFrame,
                passProfile,
                pass,
                subpass.name
              );
              try {
                (subpass.executeFn as RGExecuteFn<unknown>)(ctx, pass.data);
              } catch (e) {
                throw this._wrapSubpassError(pass.name, subpass.name, e);
              } finally {
                this._endProfileScope(profileFrame, subpassProfile);
              }
            }
          } else if (pass.executeFn) {
            const accessScope = this._createAccessScope(pass);
            const ctx = this._createContext(accessScope);
            (pass.executeFn as RGExecuteFn<unknown>)(ctx, pass.data);
          }
        } catch (e) {
          passError = e;
        } finally {
          this._endProfileScope(profileFrame, passProfile);
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
      this._finishProfileFrame(profileFrame);
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
      if (completed && !executionError && !cleanupError) {
        this._textureAffinityCache?.replace(affinityEntries);
      }
      if (executionError) {
        throw executionError;
      }
      if (cleanupError) {
        throw cleanupError;
      }
    }
  }

  /** Release remaining resources and clear imported bindings. */
  reset(): void {
    this._runCleanupCallbacks();
    // Handles aborted execution and allocator failures.
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
    this._transientTextureAliases.clear();
    this._resolvedImportedTextures.clear();
  }

  private _normalizeProfilingOptions(
    options: boolean | RGProfilingOptions | undefined,
    fallbackDevice?: AbstractDevice
  ): RGResolvedProfilingOptions {
    const source = typeof options === 'object' ? options : {};
    const enabled = typeof options === 'boolean' ? options : (source.enabled ?? true);
    return {
      enabled,
      graph: source.graph ?? DEFAULT_PROFILING_OPTIONS.graph,
      pass: source.pass ?? DEFAULT_PROFILING_OPTIONS.pass,
      subpass: source.subpass ?? DEFAULT_PROFILING_OPTIONS.subpass,
      includePendingUploads: source.includePendingUploads ?? DEFAULT_PROFILING_OPTIONS.includePendingUploads,
      allowCrossFrame: source.allowCrossFrame ?? DEFAULT_PROFILING_OPTIONS.allowCrossFrame,
      maxPendingFrames: Math.max(1, source.maxPendingFrames ?? DEFAULT_PROFILING_OPTIONS.maxPendingFrames),
      label: source.label ?? DEFAULT_PROFILING_OPTIONS.label,
      device: source.device ?? fallbackDevice
    };
  }

  private _getProfilingDevice(): AbstractDevice | null {
    if (this._profilingOptions.device) {
      return this._profilingOptions.device;
    }
    try {
      return getDevice();
    } catch {
      return null;
    }
  }

  private _beginProfileFrame(): RGProfileFrameInternal | null {
    if (!this._profilingOptions.enabled) {
      return null;
    }
    const device = this._getProfilingDevice();
    const supported = !!device?.getDeviceCaps().miscCaps.supportTimestampQuery;
    const rootResult: RGProfileScopeResult = {
      name: this._profilingOptions.label,
      type: 'graph',
      queryId: 0,
      durationMs: 0,
      status: supported ? 'resolved' : 'unsupported',
      children: [],
      message: supported ? undefined : 'GPU timestamp queries are not supported'
    };
    const result: RGProfileResult = {
      frameId: device?.frameInfo.frameCounter ?? -1,
      status: rootResult.status,
      graph: rootResult,
      passes: rootResult.children
    };
    const root: RGProfileScopeInternal = {
      result: rootResult,
      queryId: 0,
      ended: false
    };
    const frame: RGProfileFrameInternal = {
      serial: ++RenderGraphExecutor._nextProfileSerial,
      device,
      supported,
      result,
      root,
      scopes: [],
      resolvePromise: Promise.resolve(result)
    };
    if (this._profilingOptions.graph) {
      this._beginTimestampScope(frame, root, this._profilingOptions.label);
    }
    return frame;
  }

  private _beginPassProfileScope(
    frame: RGProfileFrameInternal | null,
    pass: RGPass
  ): RGProfileScopeInternal | null {
    if (!frame || (!this._profilingOptions.pass && !this._profilingOptions.subpass)) {
      return null;
    }
    return this._beginProfileScope(frame, frame.root, 'pass', pass.name, this._profilingOptions.pass);
  }

  private _beginSubpassProfileScope(
    frame: RGProfileFrameInternal | null,
    passScope: RGProfileScopeInternal | null,
    pass: RGPass,
    subpassName: string
  ): RGProfileScopeInternal | null {
    if (!frame || !this._profilingOptions.subpass) {
      return null;
    }
    const parent = passScope ?? frame.root;
    return this._beginProfileScope(
      frame,
      parent,
      'subpass',
      subpassName,
      true,
      `${pass.name}/${subpassName}`
    );
  }

  private _beginProfileScope(
    frame: RGProfileFrameInternal,
    parent: RGProfileScopeInternal,
    type: RGProfileScopeType,
    name: string,
    queryEnabled: boolean,
    queryLabel?: string
  ): RGProfileScopeInternal {
    const status =
      frame.supported && !queryEnabled ? 'resolved' : frame.supported ? 'pending' : 'unsupported';
    const result: RGProfileScopeResult = {
      name,
      type,
      queryId: 0,
      durationMs: 0,
      status,
      children: [],
      message: frame.supported ? undefined : 'GPU timestamp queries are not supported'
    };
    parent.result.children.push(result);
    const scope: RGProfileScopeInternal = {
      result,
      queryId: 0,
      ended: false
    };
    if (queryEnabled) {
      this._beginTimestampScope(frame, scope, queryLabel ?? name);
    }
    return scope;
  }

  private _beginTimestampScope(
    frame: RGProfileFrameInternal,
    scope: RGProfileScopeInternal,
    label: string
  ): void {
    if (!frame.supported || !frame.device) {
      scope.result.status = 'unsupported';
      scope.result.message = 'GPU timestamp queries are not supported';
      return;
    }
    const queryId = frame.device.beginTimestampQuery(label, {
      includePendingUploads: this._profilingOptions.includePendingUploads,
      allowCrossFrame: this._profilingOptions.allowCrossFrame
    });
    scope.queryId = queryId;
    scope.result.queryId = queryId;
    if (queryId > 0) {
      scope.result.status = 'pending';
      frame.scopes.push(scope);
    } else {
      scope.result.status = 'unsupported';
      scope.result.message = 'GPU timestamp query was not started';
    }
  }

  private _endProfileScope(frame: RGProfileFrameInternal | null, scope: RGProfileScopeInternal | null): void {
    if (!frame || !frame.device || !scope || scope.ended) {
      return;
    }
    scope.ended = true;
    if (scope.queryId > 0) {
      frame.device.endTimestampQuery(scope.queryId);
    }
  }

  private _finishProfileFrame(frame: RGProfileFrameInternal | null): void {
    if (!frame) {
      return;
    }
    this._endProfileScope(frame, frame.root);
    if (frame.scopes.length === 0 || !frame.device) {
      frame.result.status = this._aggregateProfileStatus(frame.result.graph);
      this._publishProfileResult(frame);
      return;
    }
    frame.resolvePromise = Promise.all(
      frame.scopes.map((scope) => frame.device!.resolveTimestampQuery(scope.queryId))
    )
      .then((results) => {
        for (let i = 0; i < results.length; i++) {
          this._applyTimestampResult(frame.scopes[i], results[i]);
        }
        frame.result.status = this._aggregateProfileStatus(frame.result.graph);
        this._publishProfileResult(frame);
        return frame.result;
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        for (const scope of frame.scopes) {
          scope.result.status = 'failed';
          scope.result.message = message;
        }
        frame.result.status = 'failed';
        this._publishProfileResult(frame);
        return frame.result;
      });
    this._trackPendingProfileFrame(frame);
  }

  private _trackPendingProfileFrame(frame: RGProfileFrameInternal): void {
    this._pendingProfileFrames.push(frame);
    while (this._pendingProfileFrames.length > this._profilingOptions.maxPendingFrames) {
      this._pendingProfileFrames.shift();
    }
    RenderGraphExecutor._latestPendingProfileFrame = frame;
  }

  private _publishProfileResult(frame: RGProfileFrameInternal): void {
    this._pendingProfileFrames = this._pendingProfileFrames.filter((pending) => pending !== frame);
    if (frame.serial >= this._latestResolvedProfileSerial) {
      this._latestResolvedProfileSerial = frame.serial;
      this._latestProfileResult = frame.result;
    }
    if (frame.serial >= RenderGraphExecutor._latestResolvedProfileSerial) {
      RenderGraphExecutor._latestResolvedProfileSerial = frame.serial;
      RenderGraphExecutor._latestProfileResult = frame.result;
    }
    if (RenderGraphExecutor._latestPendingProfileFrame === frame) {
      RenderGraphExecutor._latestPendingProfileFrame = null;
    }
  }

  private _applyTimestampResult(scope: RGProfileScopeInternal, result: TimestampQueryResult): void {
    scope.result.queryId = result.id;
    scope.result.durationMs = result.durationMs;
    scope.result.status = result.status;
    scope.result.message = result.message;
  }

  private _aggregateProfileStatus(scope: RGProfileScopeResult): TimestampQueryStatus {
    const statuses: TimestampQueryStatus[] = [];
    const collect = (node: RGProfileScopeResult) => {
      statuses.push(node.status);
      for (const child of node.children) {
        collect(child);
      }
    };
    collect(scope);
    for (const status of ['failed', 'invalid', 'exhausted', 'pending', 'auto-closed'] as const) {
      if (statuses.includes(status)) {
        return status;
      }
    }
    if (statuses.includes('unsupported')) {
      return 'unsupported';
    }
    return 'resolved';
  }

  private _resolveSize(desc: RGTextureDesc): RGResolvedSize {
    const mode = desc.sizeMode ?? 'backbuffer-relative';
    if (mode === 'absolute') {
      return {
        width: desc.width ?? 1,
        height: desc.height ?? 1
      };
    }
    const scaleX = desc.width ?? 1.0;
    const scaleY = desc.height ?? 1.0;
    return {
      width: Math.max(1, Math.floor(this._backbufferWidth * scaleX)),
      height: Math.max(1, Math.floor(this._backbufferHeight * scaleY))
    };
  }

  private _getTextureDescriptorSignature(desc: RGTextureDesc, size: RGResolvedSize): string {
    return JSON.stringify([
      desc.format,
      size.width,
      size.height,
      desc.mipLevels ?? 1,
      desc.arrayLayers ?? null
    ]);
  }

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

  private _createFramebuffer(desc: RGFramebufferDesc, autoCleanup = true): FrameBuffer {
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

  private _releaseFramebuffer(framebuffer: FrameBuffer): void {
    if (!this._allocator.releaseFramebuffer) {
      throw new Error('RenderGraphExecutor: framebuffer release is not supported by this allocator.');
    }
    this._allocator.releaseFramebuffer(framebuffer);
  }

  private _resolveFramebufferDesc(
    desc: RGFramebufferDesc,
    accessScope?: RGPassAccessScope
  ): RGFramebufferDesc {
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
    // Written versions alias the original physical texture.
    const transientAlias = this._transientTextureAliases.get(handle._id);
    if (transientAlias !== undefined) {
      const aliased = this._allocatedTextures.get(transientAlias);
      if (aliased !== undefined) {
        return aliased;
      }
    }
    throw new Error(
      `RenderGraphExecutor: cannot resolve resource "${handle.name}" (id=${handle._id}). ` +
        `It may not have been allocated yet or was already released.`
    );
  }

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

  private _wrapSubpassError(passName: string, subpassName: string, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(
      `RenderGraphExecutor: pass "${passName}" subpass "${subpassName}" failed: ${message}`
    );
    (wrapped as Error & { cause?: unknown }).cause = error;
    return wrapped;
  }

  private _createContext(accessScope: RGPassAccessScope): RGExecuteContext {
    const self = this;
    return {
      getTexture<T>(handle: RGTextureHandle<T>): T {
        self._assertDeclaredAccess(accessScope, handle, 'texture');
        return self._resolveResource(handle) as unknown as T;
      },
      getFramebuffer(handle: RGFramebufferHandle): FrameBuffer {
        self._assertDeclaredAccess(accessScope, handle, 'framebuffer');
        const framebuffer = self._allocatedFramebuffers.get(handle._id);
        if (framebuffer !== undefined) {
          return framebuffer;
        }
        throw new Error(
          `RenderGraphExecutor: cannot resolve framebuffer "${handle.name}" (id=${handle._id}). ` +
            `It may not have been allocated yet or was already released.`
        );
      },
      createFramebuffer(desc: RGFramebufferDesc): FrameBuffer {
        return self._createFramebuffer(self._resolveFramebufferDesc(desc, accessScope));
      },
      deferCleanup(callback: () => void): void {
        self._cleanupCallbacks.push(callback);
      }
    };
  }
}
