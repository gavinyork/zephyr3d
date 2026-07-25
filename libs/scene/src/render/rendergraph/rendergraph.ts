import {
  RGHandle,
  type RGTextureHandle,
  type RGFramebufferHandle,
  type RGTokenHandle,
  RGResource,
  RGPass,
  RGSubpass,
  type RGTextureDesc,
  type RGFramebufferDesc,
  type RGPassBuilder,
  type RGExecuteFn,
  type RGExecuteContext,
  type CompiledRenderGraph,
  type RGResourceLifetime,
  type RGWriteOptions
} from './types';

/** Declarative render pass and resource dependency graph. @public */
export class RenderGraph {
  private _nextResourceId = 0;
  private _resources: Map<number, RGResource> = new Map();
  private _passes: RGPass<any>[] = [];
  private _compiled: CompiledRenderGraph | null = null;
  private _lastWriterByPhysicalId = new Map<number, RGPass<any>>();
  /** Deduplicates warnings across per-frame graph instances. */
  private static _warnedCulledPasses = new Set<string>();

  /** Import an external texture that the graph does not own. */
  importTexture<TTexture = unknown>(name: string): RGTextureHandle<TTexture> {
    const id = this._nextResourceId++;
    const resource = new RGResource(id, name, 'imported', null);
    this._resources.set(id, resource);
    this._compiled = null;
    return new RGHandle(id, name, 'texture');
  }

  /**
   * Add a pass. The setup callback declares dependencies and execution.
   */
  addPass<T = void>(name: string, setup: (builder: RGPassBuilder) => T): T {
    let nameOccurrence = 0;
    for (const existing of this._passes) {
      if (existing.name === name) {
        nameOccurrence++;
      }
    }
    const pass = new RGPass<T>(this._passes.length, name, nameOccurrence);
    const builder = this._createBuilder(pass);
    const initialResourceIds = new Set(this._resources.keys());
    try {
      const data = setup(builder);
      pass.data = data;
      this._passes.push(pass);
      this._compiled = null;
      return data;
    } catch (error) {
      for (const id of this._resources.keys()) {
        if (!initialResourceIds.has(id)) {
          this._resources.delete(id);
        }
      }
      for (const resource of this._resources.values()) {
        for (let i = resource.consumers.length - 1; i >= 0; i--) {
          if (resource.consumers[i] === pass) {
            resource.consumers.splice(i, 1);
          }
        }
        if (resource.nextWriter === pass) {
          resource.nextWriter = null;
        }
      }
      // Remove WAR edges added to existing passes before setup failed.
      for (const existing of this._passes) {
        for (let i = existing.warDependencies.length - 1; i >= 0; i--) {
          if (existing.warDependencies[i] === pass) {
            existing.warDependencies.splice(i, 1);
          }
        }
      }
      this._lastWriterByPhysicalId.clear();
      for (const resource of this._resources.values()) {
        if (resource.producer) {
          this._lastWriterByPhysicalId.set(resource.physicalId, resource.producer);
        }
      }
      throw error;
    }
  }

  /**
   * Cull dead passes, sort dependencies, and calculate resource lifetimes.
   * Outputs must be their latest written versions.
   */
  compile(outputs: RGHandle[]): CompiledRenderGraph {
    this._validateOutputs(outputs);
    this._cullDeadPasses(outputs);
    const ordered = this._topologicalSort();
    const lifetimes = this._analyzeLifetimes(ordered);
    this._validateAllocationKeys(lifetimes);

    this._compiled = { orderedPasses: ordered, lifetimes };
    return this._compiled;
  }

  /** @internal Test-only callback runner; resource-managed code uses RenderGraphExecutor. */
  execute(compiled: CompiledRenderGraph): void {
    const noopCtx: RGExecuteContext = {
      getTexture() {
        throw new Error(
          'RenderGraph.execute(): resource resolution not available. Use RenderGraphExecutor for managed execution.'
        );
      },
      getFramebuffer() {
        throw new Error(
          'RenderGraph.execute(): framebuffer resolution not available. Use RenderGraphExecutor for managed execution.'
        );
      },
      createFramebuffer() {
        throw new Error(
          'RenderGraph.execute(): framebuffer allocation not available. Use RenderGraphExecutor for managed execution.'
        );
      },
      deferCleanup() {}
    };
    for (const pass of compiled.orderedPasses) {
      if (pass.subpasses.length > 0) {
        for (const subpass of pass.subpasses) {
          (subpass.executeFn as RGExecuteFn<unknown>)(noopCtx, pass.data);
        }
      } else if (pass.executeFn) {
        (pass.executeFn as RGExecuteFn<unknown>)(noopCtx, pass.data);
      }
    }
  }

  /** Clear all passes, resources, and compiled state. */
  reset(): void {
    this._passes.length = 0;
    this._resources.clear();
    this._nextResourceId = 0;
    this._compiled = null;
    this._lastWriterByPhysicalId.clear();
  }

  /** @internal */
  getResource(handle: RGHandle): RGResource | undefined {
    return this._resources.get(handle._id);
  }

  /** @internal */
  get passes(): ReadonlyArray<RGPass<any>> {
    return this._passes;
  }

  /** @internal */
  get resources(): ReadonlyMap<number, RGResource> {
    return this._resources;
  }

  private _createBuilder<T>(pass: RGPass<T>): RGPassBuilder<T> {
    const graph = this;
    const textureLabelOccurrences = new Map<string, number>();
    return {
      read(handle: RGHandle): void {
        const res = graph._resources.get(handle._id);
        if (!res) {
          throw new Error(`RenderGraph: unknown resource "${handle.name}" (id=${handle._id})`);
        }
        graph._declareRead(pass, res);
      },
      write<TTexture>(
        handle: RGTextureHandle<TTexture> | RGHandle,
        options: RGWriteOptions | undefined
      ): RGTextureHandle<TTexture> {
        const res = graph._resources.get(handle._id);
        if (!res) {
          throw new Error(`RenderGraph: unknown resource "${handle.name}" (id=${handle._id})`);
        }
        if (res.kind === 'token') {
          throw new Error(
            `RenderGraph: pass "${pass.name}" attempts to write token "${res.name}". ` +
              `Use createToken() to produce ordering tokens.`
          );
        }
        if (res.kind === 'framebuffer') {
          throw new Error(
            `RenderGraph: pass "${pass.name}" attempts to write framebuffer "${res.name}". ` +
              `Create a new framebuffer view instead.`
          );
        }
        const discard = options?.load === 'discard';
        const previousWriter = graph._lastWriterByPhysicalId.get(res.physicalId);
        if (previousWriter && previousWriter !== pass) {
          const dependencies = discard ? pass.orderingDependencies : pass.dependencies;
          if (!dependencies.includes(previousWriter)) {
            dependencies.push(previousWriter);
          }
        }
        // WAR orders live readers before the overwrite without retaining them.
        for (const consumer of res.consumers) {
          if (consumer !== pass && !pass.warDependencies.includes(consumer)) {
            pass.warDependencies.push(consumer);
          }
        }
        if (res.producer && res.producer !== pass) {
          const dependencies = discard ? pass.orderingDependencies : pass.dependencies;
          if (!dependencies.includes(res.producer)) {
            dependencies.push(res.producer);
          }
        }
        const id = graph._nextResourceId++;
        const versionName = `${res.name}@${pass.name}`;
        const version = new RGResource(
          id,
          versionName,
          res.kind,
          res.desc,
          res.physicalId,
          res.allocationKey
        );
        version.producer = pass;
        // WAW edges make the first overwrite sufficient for stale readers.
        if (!res.nextWriter) {
          res.nextWriter = pass;
        }
        graph._resources.set(id, version);
        graph._lastWriterByPhysicalId.set(res.physicalId, pass);
        if (!pass.writes.includes(version)) {
          pass.writes.push(version);
        }
        return new RGHandle(id, versionName, 'texture');
      },
      createTexture<TTexture = unknown>(desc: RGTextureDesc): RGTextureHandle<TTexture> {
        if (desc.allocationKey !== undefined && desc.allocationKey.length === 0) {
          throw new Error(`RenderGraph: pass "${pass.name}" specified an empty texture allocationKey.`);
        }
        const id = graph._nextResourceId++;
        const name = desc.label ?? `_tex_${id}`;
        const labelKey = desc.label ?? '<unnamed>';
        const labelOccurrence = textureLabelOccurrences.get(labelKey) ?? 0;
        textureLabelOccurrences.set(labelKey, labelOccurrence + 1);
        const allocationKey =
          desc.allocationKey ??
          `rg:${JSON.stringify([pass.name, pass.nameOccurrence, desc.label ?? null, labelOccurrence])}`;
        const res = new RGResource(id, name, 'transient', desc, id, allocationKey);
        res.producer = pass;
        graph._resources.set(id, res);
        graph._lastWriterByPhysicalId.set(res.physicalId, pass);
        pass.writes.push(res);
        return new RGHandle(id, name, 'texture');
      },
      createToken(name?: string): RGTokenHandle {
        const id = graph._nextResourceId++;
        const tokenName = name ?? `_token_${id}`;
        const res = new RGResource(id, tokenName, 'token', null);
        res.producer = pass;
        graph._resources.set(id, res);
        pass.writes.push(res);
        return new RGHandle(id, tokenName, 'token');
      },
      createFramebuffer<TFramebuffer = unknown>(desc: RGFramebufferDesc): RGFramebufferHandle<TFramebuffer> {
        const id = graph._nextResourceId++;
        const name = desc.label ?? `_fb_${id}`;
        const res = new RGResource(id, name, 'framebuffer', desc);
        res.producer = pass;
        graph._resources.set(id, res);
        graph._lastWriterByPhysicalId.set(res.physicalId, pass);
        pass.writes.push(res);
        graph._declareFramebufferAttachmentDeps(pass, desc);
        return new RGHandle(id, name, 'framebuffer');
      },
      sideEffect(): void {
        pass.hasSideEffect = true;
      },
      addSubpass<D = T>(name: string, fn: RGExecuteFn<D>): void {
        if (pass.executeFn) {
          throw new Error(
            `RenderGraph: pass "${pass.name}" cannot use addSubpass() after setExecute(). ` +
              `Use either subpasses or a single execute callback.`
          );
        }
        pass.subpasses.push(new RGSubpass(name, fn as unknown as RGExecuteFn<T>));
      },
      setExecute<D = T>(fn: RGExecuteFn<D>): void {
        if (pass.subpasses.length > 0) {
          throw new Error(
            `RenderGraph: pass "${pass.name}" cannot use setExecute() after addSubpass(). ` +
              `Use either subpasses or a single execute callback.`
          );
        }
        pass.executeFn = fn as unknown as RGExecuteFn<T>;
      }
    };
  }

  private _validateAllocationKeys(lifetimes: ReadonlyMap<number, RGResourceLifetime>): void {
    const physicalByKey = new Map<string, number>();
    for (const lifetime of lifetimes.values()) {
      const resource = lifetime.resource;
      if (resource.kind !== 'transient' || !resource.allocationKey) {
        continue;
      }
      const existingPhysicalId = physicalByKey.get(resource.allocationKey);
      if (existingPhysicalId !== undefined && existingPhysicalId !== resource.physicalId) {
        throw new Error(
          `RenderGraph: transient allocationKey "${resource.allocationKey}" is used by multiple resources. ` +
            'Use a unique allocationKey for each logical texture.'
        );
      }
      physicalByKey.set(resource.allocationKey, resource.physicalId);
    }
  }

  private _validateOutputs(outputs: RGHandle[]): void {
    const latestVersions = new Map<number, RGResource>();
    for (const res of this._resources.values()) {
      const current = latestVersions.get(res.physicalId);
      if (!current || res.id > current.id) {
        latestVersions.set(res.physicalId, res);
      }
    }

    for (const handle of outputs) {
      const res = this._resources.get(handle._id);
      if (!res) {
        throw new Error(`RenderGraph: unknown output resource "${handle.name}" (id=${handle._id})`);
      }
      const latest = latestVersions.get(res.physicalId);
      if (latest && latest.id !== res.id) {
        throw new Error(
          `RenderGraph: output resource "${res.name}" (id=${res.id}) is not the latest version. ` +
            `Use the handle returned by builder.write(); latest is "${latest.name}" (id=${latest.id}).`
        );
      }
    }
  }

  private _cullDeadPasses(outputs: RGHandle[]): void {
    for (const pass of this._passes) {
      pass.alive = false;
    }

    const neededResources = new Set<number>();
    const stack: RGResource[] = [];
    const markResourceNeeded = (res: RGResource) => {
      if (!neededResources.has(res.id)) {
        neededResources.add(res.id);
        stack.push(res);
      }
    };
    const markPassAlive = (pass: RGPass<any>) => {
      if (pass.alive) {
        return;
      }
      pass.alive = true;
      for (const dep of pass.reads) {
        markResourceNeeded(dep);
      }
      // WAR dependencies order passes but do not propagate liveness.
      for (const dependency of pass.dependencies) {
        markPassAlive(dependency);
      }
    };

    for (const handle of outputs) {
      const res = this._resources.get(handle._id);
      if (!res) {
        throw new Error(`RenderGraph: unknown output resource "${handle.name}" (id=${handle._id})`);
      }
      markResourceNeeded(res);
    }

    for (const pass of this._passes) {
      if (pass.hasSideEffect) {
        markPassAlive(pass);
      }
    }

    while (stack.length > 0) {
      const res = stack.pop()!;
      const producer = res.producer;
      if (producer) {
        markPassAlive(producer);
      }
    }

    // Warn when an ordering-only pass may have omitted sideEffect or an output.
    for (const pass of this._passes) {
      if (
        !pass.alive &&
        !pass.hasSideEffect &&
        pass.warDependencies.length > 0 &&
        !RenderGraph._warnedCulledPasses.has(pass.name)
      ) {
        RenderGraph._warnedCulledPasses.add(pass.name);
        console.warn(
          `RenderGraph: pass "${pass.name}" was culled but is referenced by WAR ` +
            `ordering edges. If its work must run, call sideEffect() or route its ` +
            `output into a compile() sink.`
        );
      }
    }
  }

  private _declareRead(pass: RGPass<any>, res: RGResource): void {
    if (res.kind === 'transient' && !res.producer) {
      throw new Error(
        `RenderGraph: pass "${pass.name}" attempts to read transient resource "${res.name}" ` +
          `which has no producer. Ensure the resource is created before being read.`
      );
    }
    if (!pass.reads.includes(res)) {
      pass.reads.push(res);
    }
    if (!res.consumers.includes(pass)) {
      res.consumers.push(pass);
    }
    // A stale-version read must precede its first overwrite.
    if (res.nextWriter && res.nextWriter !== pass && !res.nextWriter.warDependencies.includes(pass)) {
      res.nextWriter.warDependencies.push(pass);
    }
  }

  private _declareFramebufferAttachmentDeps(
    pass: RGPass<any>,
    desc: { colorAttachments: unknown | unknown[] | null; depthAttachment?: unknown | null }
  ): void {
    const declare = (attachment: unknown) => {
      if (attachment instanceof RGHandle) {
        const res = this._resources.get(attachment._id);
        if (!res) {
          throw new Error(
            `RenderGraph: unknown framebuffer attachment "${attachment.name}" (id=${attachment._id})`
          );
        }
        if (res.kind !== 'transient' && res.kind !== 'imported') {
          throw new Error(
            `RenderGraph: framebuffer attachment "${res.name}" must be a texture resource, got ${res.kind}.`
          );
        }
        if (res.producer !== pass) {
          this._declareRead(pass, res);
        }
      }
    };
    const colors = Array.isArray(desc.colorAttachments)
      ? desc.colorAttachments
      : desc.colorAttachments
        ? [desc.colorAttachments]
        : [];
    for (const attachment of colors) {
      declare(attachment);
    }
    declare(desc.depthAttachment);
  }

  private _topologicalSort(): RGPass<any>[] {
    const alivePasses = this._passes.filter((p) => p.alive);
    if (alivePasses.length === 0) {
      return [];
    }

    const aliveSet = new Set(alivePasses);
    const inDegree = new Map<RGPass<any>, number>();
    const adjacency = new Map<RGPass<any>, RGPass<any>[]>();

    for (const pass of alivePasses) {
      inDegree.set(pass, 0);
      adjacency.set(pass, []);
    }

    const addEdge = (from: RGPass<any>, to: RGPass<any>) => {
      if (from === to || !aliveSet.has(from) || !aliveSet.has(to)) {
        return;
      }
      const neighbors = adjacency.get(from)!;
      if (!neighbors.includes(to)) {
        neighbors.push(to);
        inDegree.set(to, inDegree.get(to)! + 1);
      }
    };

    for (const pass of alivePasses) {
      for (const dependency of pass.dependencies) {
        addEdge(dependency, pass);
      }
      for (const dependency of pass.orderingDependencies) {
        addEdge(dependency, pass);
      }
      for (const dependency of pass.warDependencies) {
        addEdge(dependency, pass);
      }
    }

    for (const res of this._resources.values()) {
      if (!res.producer || !aliveSet.has(res.producer)) {
        continue;
      }
      for (const consumer of res.consumers) {
        addEdge(res.producer, consumer);
      }
    }

    const queue: RGPass<any>[] = [];
    for (const pass of alivePasses) {
      if (inDegree.get(pass) === 0) {
        queue.push(pass);
      }
    }

    const result: RGPass<any>[] = [];
    while (queue.length > 0) {
      const pass = queue.shift()!;
      result.push(pass);
      for (const neighbor of adjacency.get(pass)!) {
        const deg = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (result.length !== alivePasses.length) {
      const cycleParticipants: string[] = [];
      for (const [pass, degree] of inDegree) {
        if (degree > 0) {
          cycleParticipants.push(pass.name);
        }
      }
      throw new Error(
        `RenderGraph: circular dependency detected. ` +
          `Sorted ${result.length} of ${alivePasses.length} alive passes. ` +
          `Passes in cycle: [${cycleParticipants.join(', ')}]`
      );
    }

    return result;
  }

  private _analyzeLifetimes(orderedPasses: RGPass<any>[]): Map<number, RGResourceLifetime> {
    const lifetimes = new Map<number, { resource: RGResource; firstUse: number; lastUse: number }>();

    const orderMap = new Map<RGPass<any>, number>();
    for (let i = 0; i < orderedPasses.length; i++) {
      orderMap.set(orderedPasses[i], i);
    }

    for (const res of this._resources.values()) {
      let first = Infinity;
      let last = -Infinity;

      if (res.producer && orderMap.has(res.producer)) {
        const idx = orderMap.get(res.producer)!;
        first = Math.min(first, idx);
        last = Math.max(last, idx);
      }

      for (const consumer of res.consumers) {
        if (orderMap.has(consumer)) {
          const idx = orderMap.get(consumer)!;
          first = Math.min(first, idx);
          last = Math.max(last, idx);
        }
      }

      if (first !== Infinity) {
        lifetimes.set(res.id, { resource: res, firstUse: first, lastUse: last });
      }
    }

    // Attachment textures must outlive every framebuffer use.
    for (const lifetime of lifetimes.values()) {
      const res = lifetime.resource;
      if (res.kind !== 'framebuffer' || !res.desc) {
        continue;
      }
      const desc = res.desc as RGFramebufferDesc;
      const extend = (attachment: unknown) => {
        if (!(attachment instanceof RGHandle)) {
          return;
        }
        const attachmentLifetime = lifetimes.get(attachment._id);
        if (attachmentLifetime) {
          attachmentLifetime.firstUse = Math.min(attachmentLifetime.firstUse, lifetime.firstUse);
          attachmentLifetime.lastUse = Math.max(attachmentLifetime.lastUse, lifetime.lastUse);
        }
      };
      const colors = Array.isArray(desc.colorAttachments)
        ? desc.colorAttachments
        : desc.colorAttachments
          ? [desc.colorAttachments]
          : [];
      for (const attachment of colors) {
        extend(attachment);
      }
      extend(desc.depthAttachment);
    }

    return lifetimes;
  }
}
