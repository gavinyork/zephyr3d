import {
  RGHandle,
  RGResource,
  RGPass,
  RGSubpass,
  type RGTextureDesc,
  type RGFramebufferDesc,
  type RGPassBuilder,
  type RGExecuteFn,
  type RGExecuteContext,
  type CompiledRenderGraph,
  type RGResourceLifetime
} from './types';

/**
 * Render Graph — declarative, configurable render pipeline.
 *
 * Usage:
 * ```ts
 * const graph = new RenderGraph();
 * let backbuffer = graph.importTexture('backbuffer');
 *
 * let linearDepth: RGHandle;
 * graph.addPass('DepthPrepass', (builder) => {
 *   linearDepth = builder.createTexture({ format: 'r32f', label: 'linearDepth' });
 *   builder.setExecute(() => { ... });
 * });
 *
 * graph.addPass('LightPass', (builder) => {
 *   builder.read(linearDepth);
 *   backbuffer = builder.write(backbuffer);
 *   builder.setExecute(() => { ... });
 * });
 *
 * const compiled = graph.compile([backbuffer]);
 * graph.execute(compiled);
 * graph.reset();
 * ```
 *
 * @public
 */
export class RenderGraph {
  /** @internal */
  private _nextResourceId = 0;
  /** @internal */
  private _resources: Map<number, RGResource> = new Map();
  /** @internal */
  private _passes: RGPass[] = [];
  /** @internal */
  private _compiled: CompiledRenderGraph | null = null;
  private _lastWriterByPhysicalId = new Map<number, RGPass>();
  /**
   * Pass names already warned about in {@link RenderGraph._cullDeadPasses} for being
   * culled while still referenced by WAR ordering edges. Static so the once-per-name
   * dedup survives the per-frame graph rebuild.
   * @internal
   */
  private static _warnedCulledPasses = new Set<string>();

  // ─── Graph Building ─────────────────────────────────────────────────

  /**
   * Import an external (persistent) texture into the graph.
   *
   * Imported resources are not allocated or released by the graph.
   * Typically used for the backbuffer or any texture that outlives a single frame.
   *
   * @param name - Debug label for the imported resource.
   * @returns A handle referencing the imported resource.
   */
  importTexture(name: string): RGHandle {
    const id = this._nextResourceId++;
    const resource = new RGResource(id, name, 'imported', null);
    this._resources.set(id, resource);
    this._compiled = null;
    return new RGHandle(id, name);
  }

  /**
   * Add a render pass to the graph.
   *
   * The setup callback receives a {@link RGPassBuilder} to declare resource
   * dependencies. Call `builder.setExecute(fn)` inside setup to provide the
   * execution callback.
   *
   * @param name - Debug label for the pass.
   * @param setup - Setup callback that declares resources and sets the execute function.
   */
  addPass<T = void>(name: string, setup: (builder: RGPassBuilder) => T): T {
    const pass = new RGPass(this._passes.length, name);
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
      // Stale-version reads add ordering edges into OTHER passes'
      // warDependencies; remove any that reference the discarded pass.
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

  // ─── Compilation ────────────────────────────────────────────────────

  /**
   * Compile the render graph.
   *
   * Performs dead-pass culling, topological sorting, and resource lifetime analysis.
   *
   * @param outputs - Handles of resources that must be produced (graph sinks).
   *   If a resource was passed to {@link RGPassBuilder.write}, use the returned
   *   post-write handle here, not the original handle.
   *   Passes that do not contribute to these outputs (directly or transitively)
   *   are culled, unless marked as side-effect passes.
   * @returns The compiled graph ready for execution.
   */
  compile(outputs: RGHandle[]): CompiledRenderGraph {
    this._validateOutputs(outputs);
    // 1. Mark alive passes via backward traversal from outputs + side-effect passes
    this._cullDeadPasses(outputs);
    // 2. Topological sort of alive passes
    const ordered = this._topologicalSort();
    // 3. Resource lifetime analysis
    const lifetimes = this._analyzeLifetimes(ordered);

    this._compiled = { orderedPasses: ordered, lifetimes };
    return this._compiled;
  }

  /**
   * Execute a compiled render graph (simple mode, no resource management).
   *
   * For automatic resource allocation/release, use {@link RenderGraphExecutor} instead.
   *
   * @param compiled - The compiled graph from {@link RenderGraph.compile}.
   */
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
      deferCleanup() {
        // No-op in unmanaged execution mode.
      }
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

  /**
   * Reset the graph for the next frame.
   *
   * Clears all passes, transient resources, and compiled state.
   * Imported resources are also cleared — re-import them each frame.
   */
  reset(): void {
    this._passes.length = 0;
    this._resources.clear();
    this._nextResourceId = 0;
    this._compiled = null;
    this._lastWriterByPhysicalId.clear();
  }

  // ─── Accessors (for testing / debugging) ────────────────────────────

  /** @internal */
  getResource(handle: RGHandle): RGResource | undefined {
    return this._resources.get(handle._id);
  }

  /** @internal */
  get passes(): ReadonlyArray<RGPass> {
    return this._passes;
  }

  /** @internal */
  get resources(): ReadonlyMap<number, RGResource> {
    return this._resources;
  }

  // ─── Private: Builder ───────────────────────────────────────────────

  /** @internal */
  private _createBuilder(pass: RGPass): RGPassBuilder {
    const graph = this;
    return {
      read(handle: RGHandle): void {
        const res = graph._resources.get(handle._id);
        if (!res) {
          throw new Error(`RenderGraph: unknown resource "${handle.name}" (id=${handle._id})`);
        }
        // Validate that transient resources have a producer
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
        // Reading a version that has already been superseded by a write is only
        // satisfiable if this pass runs before the overwriting pass. Add the
        // ordering-only WAR edge retroactively; later versions are transitively
        // ordered through the WAW chain.
        if (res.nextWriter && res.nextWriter !== pass && !res.nextWriter.warDependencies.includes(pass)) {
          res.nextWriter.warDependencies.push(pass);
        }
      },
      write(handle: RGHandle): RGHandle {
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
        const previousWriter = graph._lastWriterByPhysicalId.get(res.physicalId);
        if (previousWriter && previousWriter !== pass && !pass.dependencies.includes(previousWriter)) {
          pass.dependencies.push(previousWriter);
        }
        // WAR hazard: readers of the overwritten version must run first, but
        // this pass being alive does not force them to run — ordering-only edge.
        for (const consumer of res.consumers) {
          if (consumer !== pass && !pass.warDependencies.includes(consumer)) {
            pass.warDependencies.push(consumer);
          }
        }
        if (res.producer && res.producer !== pass && !pass.dependencies.includes(res.producer)) {
          pass.dependencies.push(res.producer);
        }
        const id = graph._nextResourceId++;
        const versionName = `${res.name}@${pass.name}`;
        const version = new RGResource(id, versionName, res.kind, res.desc, res.physicalId);
        version.producer = pass;
        // Record the FIRST overwriting pass only: forked writes are serialized
        // by the WAW edge above, so stale readers ordered before the first
        // writer are transitively ordered before all later ones.
        if (!res.nextWriter) {
          res.nextWriter = pass;
        }
        graph._resources.set(id, version);
        graph._lastWriterByPhysicalId.set(res.physicalId, pass);
        if (!pass.writes.includes(version)) {
          pass.writes.push(version);
        }
        return new RGHandle(id, versionName);
      },
      createTexture(desc: RGTextureDesc): RGHandle {
        const id = graph._nextResourceId++;
        const name = desc.label ?? `_tex_${id}`;
        const res = new RGResource(id, name, 'transient', desc);
        res.producer = pass;
        graph._resources.set(id, res);
        graph._lastWriterByPhysicalId.set(res.physicalId, pass);
        pass.writes.push(res);
        return new RGHandle(id, name);
      },
      createToken(name?: string): RGHandle {
        const id = graph._nextResourceId++;
        const tokenName = name ?? `_token_${id}`;
        const res = new RGResource(id, tokenName, 'token', null);
        res.producer = pass;
        graph._resources.set(id, res);
        pass.writes.push(res);
        return new RGHandle(id, tokenName);
      },
      createFramebuffer(desc): RGHandle {
        const id = graph._nextResourceId++;
        const name = desc.label ?? `_fb_${id}`;
        const res = new RGResource(id, name, 'framebuffer', desc);
        res.producer = pass;
        graph._resources.set(id, res);
        graph._lastWriterByPhysicalId.set(res.physicalId, pass);
        pass.writes.push(res);
        graph._declareFramebufferAttachmentDeps(pass, desc);
        return new RGHandle(id, name);
      },
      sideEffect(): void {
        pass.hasSideEffect = true;
      },
      addSubpass<D>(name: string, fn: RGExecuteFn<D>): void {
        if (pass.executeFn) {
          throw new Error(
            `RenderGraph: pass "${pass.name}" cannot use addSubpass() after setExecute(). ` +
              `Use either subpasses or a single execute callback.`
          );
        }
        pass.subpasses.push(new RGSubpass(name, fn as RGExecuteFn<unknown>));
      },
      setExecute<D>(fn: RGExecuteFn<D>): void {
        if (pass.subpasses.length > 0) {
          throw new Error(
            `RenderGraph: pass "${pass.name}" cannot use setExecute() after addSubpass(). ` +
              `Use either subpasses or a single execute callback.`
          );
        }
        pass.executeFn = fn as RGExecuteFn<unknown>;
      }
    };
  }

  // ─── Private: Dead Pass Culling ─────────────────────────────────────

  /** @internal */
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

  /** @internal */
  private _cullDeadPasses(outputs: RGHandle[]): void {
    // Start with all passes marked dead
    for (const pass of this._passes) {
      pass.alive = false;
    }

    // Seed: resources that are requested outputs
    const neededResources = new Set<number>();
    const stack: RGResource[] = [];
    const markResourceNeeded = (res: RGResource) => {
      if (!neededResources.has(res.id)) {
        neededResources.add(res.id);
        stack.push(res);
      }
    };
    const markPassAlive = (pass: RGPass) => {
      if (pass.alive) {
        return;
      }
      pass.alive = true;
      for (const dep of pass.reads) {
        markResourceNeeded(dep);
      }
      // Only liveness-carrying (RAW/WAW) dependencies propagate aliveness.
      // WAR edges (pass.warDependencies) are ordering-only: a reader of an
      // overwritten version need not run just because the writer runs.
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

    // Seed: side-effect passes (always alive) — push their read dependencies
    for (const pass of this._passes) {
      if (pass.hasSideEffect) {
        markPassAlive(pass);
      }
    }

    // Backward traversal: for each needed resource, mark its producer alive
    // and recursively mark the producer's read dependencies as needed
    while (stack.length > 0) {
      const res = stack.pop()!;
      const producer = res.producer;
      if (producer) {
        markPassAlive(producer);
      }
    }

    // Diagnostic: a pass that is only ever referenced through WAR (ordering-only)
    // edges and has no side effect is culled here, which is easy to hit by accident
    // when a pass's work is meant to be observable but it forgot to call
    // sideEffect() or contribute to an output. Warn once per pass name (the graph
    // is rebuilt every frame, so per-instance state cannot dedup across frames).
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

  /** @internal */
  private _declareFramebufferAttachmentDeps(
    pass: RGPass,
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
          if (!pass.reads.includes(res)) {
            pass.reads.push(res);
          }
          if (!res.consumers.includes(pass)) {
            res.consumers.push(pass);
          }
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

  // ─── Private: Topological Sort (Kahn's Algorithm) ───────────────────

  /** @internal */
  private _topologicalSort(): RGPass[] {
    const alivePasses = this._passes.filter((p) => p.alive);
    if (alivePasses.length === 0) {
      return [];
    }

    // Build adjacency: producer -> consumers (only among alive passes)
    const aliveSet = new Set(alivePasses);
    const inDegree = new Map<RGPass, number>();
    const adjacency = new Map<RGPass, RGPass[]>();

    for (const pass of alivePasses) {
      inDegree.set(pass, 0);
      adjacency.set(pass, []);
    }

    const addEdge = (from: RGPass, to: RGPass) => {
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
      // WAR edges constrain ordering among alive passes only; they were
      // deliberately excluded from liveness propagation in _cullDeadPasses.
      for (const dependency of pass.warDependencies) {
        addEdge(dependency, pass);
      }
    }

    // For each resource, its producer has an edge to each of its consumers
    for (const res of this._resources.values()) {
      if (!res.producer || !aliveSet.has(res.producer)) {
        continue;
      }
      for (const consumer of res.consumers) {
        addEdge(res.producer, consumer);
      }
    }

    // Kahn's algorithm
    const queue: RGPass[] = [];
    for (const pass of alivePasses) {
      if (inDegree.get(pass) === 0) {
        queue.push(pass);
      }
    }

    const result: RGPass[] = [];
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
      // Find passes that are part of the cycle (those with non-zero in-degree)
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

  // ─── Private: Resource Lifetime Analysis ────────────────────────────

  /** @internal */
  private _analyzeLifetimes(orderedPasses: RGPass[]): Map<number, RGResourceLifetime> {
    const lifetimes = new Map<number, { resource: RGResource; firstUse: number; lastUse: number }>();

    // Build pass -> order index map
    const orderMap = new Map<RGPass, number>();
    for (let i = 0; i < orderedPasses.length; i++) {
      orderMap.set(orderedPasses[i], i);
    }

    for (const res of this._resources.values()) {
      let first = Infinity;
      let last = -Infinity;

      // Producer
      if (res.producer && orderMap.has(res.producer)) {
        const idx = orderMap.get(res.producer)!;
        first = Math.min(first, idx);
        last = Math.max(last, idx);
      }

      // Consumers
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

    // A pass that reads a framebuffer implicitly reads its attachment textures:
    // extend each RGHandle attachment's lifetime to cover the framebuffer's
    // lifetime so the executor never releases a backing texture while a later
    // pass can still render through the framebuffer. Framebuffers cannot be
    // attachments of other framebuffers, so a single propagation pass suffices.
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
