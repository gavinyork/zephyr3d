import type { RenderModule, RenderModuleReadDescriptor } from './render_module';
import type { RenderContext } from './render_context';
import type { FrameResourceRequirements } from './frame_resource_requirements';
import { mergeFrameResourceRequirements } from './frame_resource_requirements';

/**
 * Resolve the setup order of a module list, honouring declared
 * {@link RenderModule.reads} / {@link RenderModule.writes} dependencies while
 * keeping the authored array order as the stable default.
 *
 * Descriptor reads select either the nearest prior writer (`current`) or the
 * last writer in the full pipeline (`final`). Final reads may reorder a module
 * after a later writer; current reads preserve authored dataflow. Required reads
 * reject missing writers. String reads keep the legacy optional-final behavior.
 *
 * @param modules - The pipeline's modules in authored order.
 * @returns A new array in resolved setup order.
 * @throws If the declared dependencies form a cycle.
 * @public
 */
export function resolveModuleOrder<T extends RenderModule<any>>(modules: readonly T[]): T[] {
  const n = modules.length;
  // Edges producer -> reader, keyed by reader index (its set of prerequisite indices).
  const prereqs: Set<number>[] = modules.map(() => new Set<number>());
  const findWriter = (resource: string, reader: number, version: 'current' | 'final') => {
    const start = version === 'current' ? reader - 1 : n - 1;
    for (let i = start; i >= 0; i--) {
      if (i !== reader && modules[i].writes?.includes(resource)) {
        return i;
      }
    }
    return -1;
  };
  for (let reader = 0; reader < n; reader++) {
    const r = modules[reader].reads;
    if (!r) {
      continue;
    }
    for (const declaredRead of r) {
      const read: RenderModuleReadDescriptor =
        typeof declaredRead === 'string'
          ? { resource: declaredRead, version: 'final', optional: true }
          : declaredRead;
      const version = read.version ?? 'current';
      const producer = findWriter(read.resource, reader, version);
      if (producer >= 0) {
        prereqs[reader].add(producer);
      } else if (!read.optional) {
        throw new Error(
          `RenderPipeline: module "${modules[reader].type}" requires ${version} resource ` +
            `"${read.resource}", but no matching enabled writer exists`
        );
      }
    }
  }
  // Stable topological sort: repeatedly emit the lowest authored index whose
  // prerequisites are all already emitted.
  const emitted: boolean[] = new Array(n).fill(false);
  const order: T[] = [];
  for (let placed = 0; placed < n; placed++) {
    let next = -1;
    for (let i = 0; i < n; i++) {
      if (emitted[i]) {
        continue;
      }
      let ready = true;
      for (const p of prereqs[i]) {
        if (!emitted[p]) {
          ready = false;
          break;
        }
      }
      if (ready) {
        next = i;
        break;
      }
    }
    if (next < 0) {
      const stuck = modules
        .filter((_, i) => !emitted[i])
        .map((m) => m.type)
        .join(' -> ');
      throw new Error(`RenderPipeline: cyclic module dependency among [${stuck}]`);
    }
    emitted[next] = true;
    order.push(modules[next]);
  }
  return order;
}

/**
 * An ordered, editable list of {@link RenderModule}s that assembles a render
 * graph for one frame.
 *
 * The Forward+ pipeline is exposed as a default `RenderPipeline` (see
 * `createForwardPlusPipeline` / `getDefaultForwardPlusPipeline`). Applications
 * customize rendering by inserting, replacing or removing modules — anchored by
 * a module's {@link RenderModule.type} — either on a per-camera pipeline
 * (`camera.renderPipeline`) or on the shared default.
 *
 * ```ts
 * camera.renderPipeline = createForwardPlusPipeline()
 *   .insertAfter('SkyPass', myOutlineModule)
 *   .remove('GPUPicking');
 * ```
 *
 * Modules must have unique `type` values within a pipeline. Editing methods are
 * chainable and locate their anchor by `type`, throwing if it is absent.
 *
 * @public
 */
export class RenderPipeline<TCtx extends RenderContext = RenderContext> {
  private static readonly _moduleOwners = new WeakMap<object, RenderPipeline<any>>();
  private static readonly _disposedModules = new WeakSet<object>();
  /** @internal */
  private _modules: RenderModule<TCtx>[];
  private _disposed = false;

  /**
   * @param modules - Initial ordered modules. Copied into the pipeline; the
   *   array is not retained. Duplicate `type` values are rejected.
   */
  constructor(modules?: readonly RenderModule<TCtx>[]) {
    this._modules = [];
    try {
      if (modules) {
        for (const m of modules) {
          this.append(m);
        }
      }
    } catch (error) {
      // A failed constructor has no caller-visible pipeline that could release
      // modules already attached earlier in the list.
      try {
        this.dispose();
      } catch {
        // Preserve the construction error after making a best-effort rollback.
      }
      throw error;
    }
  }

  /** The pipeline's modules in authored order. */
  get modules(): readonly RenderModule<TCtx>[] {
    return this._modules;
  }

  /** Whether this pipeline and its owned modules have been disposed. */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Whether a module with the given type is present.
   * @param type - The {@link RenderModule.type} to look up.
   */
  has(type: string): boolean {
    return this._indexOf(type) >= 0;
  }

  /**
   * Look up a module by type.
   * @param type - The {@link RenderModule.type} to look up.
   * @returns The module, or undefined if absent.
   */
  get(type: string): RenderModule<TCtx> | undefined {
    const i = this._indexOf(type);
    return i >= 0 ? this._modules[i] : undefined;
  }

  /**
   * Append a module to the end of the pipeline.
   * @param module - The module to add.
   */
  append(module: RenderModule<TCtx>): this {
    this._assertMutable();
    this._assertAbsent(module.type);
    this._modules.push(module);
    try {
      this._attachModule(module);
    } catch (error) {
      this._modules.pop();
      throw error;
    }
    return this;
  }

  /**
   * Prepend a module to the front of the pipeline.
   * @param module - The module to add.
   */
  prepend(module: RenderModule<TCtx>): this {
    this._assertMutable();
    this._assertAbsent(module.type);
    this._modules.unshift(module);
    try {
      this._attachModule(module);
    } catch (error) {
      this._modules.shift();
      throw error;
    }
    return this;
  }

  /**
   * Insert a module immediately before the anchor module.
   * @param type - The {@link RenderModule.type} of the existing anchor.
   * @param module - The module to insert.
   */
  insertBefore(type: string, module: RenderModule<TCtx>): this {
    this._assertMutable();
    this._assertAbsent(module.type);
    const index = this._requireIndex(type);
    this._modules.splice(index, 0, module);
    try {
      this._attachModule(module);
    } catch (error) {
      this._modules.splice(index, 1);
      throw error;
    }
    return this;
  }

  /**
   * Insert a module immediately after the anchor module.
   * @param type - The {@link RenderModule.type} of the existing anchor.
   * @param module - The module to insert.
   */
  insertAfter(type: string, module: RenderModule<TCtx>): this {
    this._assertMutable();
    this._assertAbsent(module.type);
    const index = this._requireIndex(type) + 1;
    this._modules.splice(index, 0, module);
    try {
      this._attachModule(module);
    } catch (error) {
      this._modules.splice(index, 1);
      throw error;
    }
    return this;
  }

  /**
   * Replace the module with the given type in place.
   * @param type - The {@link RenderModule.type} of the module to replace.
   * @param module - The replacement module.
   */
  replace(type: string, module: RenderModule<TCtx>): this {
    this._assertMutable();
    const i = this._requireIndex(type);
    if (module.type !== type) {
      this._assertAbsent(module.type);
    }
    const previous = this._modules[i];
    if (previous === module) {
      return this;
    }
    this._modules[i] = module;
    try {
      this._attachModule(module);
    } catch (error) {
      this._modules[i] = previous;
      throw error;
    }
    this._releaseModule(previous);
    return this;
  }

  /**
   * Remove the module with the given type.
   * @param type - The {@link RenderModule.type} of the module to remove.
   */
  remove(type: string): this {
    this._assertMutable();
    const [module] = this._modules.splice(this._requireIndex(type), 1);
    this._releaseModule(module);
    return this;
  }

  /**
   * Create an independent copy of this pipeline. Stateless module objects may
   * be shared; lifecycle-aware modules must provide {@link RenderModule.clone}.
   */
  clone(): RenderPipeline<TCtx> {
    this._assertMutable();
    const modules = this._modules.map((module) => {
      if (module.clone) {
        return module.clone();
      }
      if (module.attach || module.detach || module.dispose) {
        throw new Error(
          `RenderPipeline: stateful module "${module.type}" must implement clone() ` + `to be copied safely`
        );
      }
      return module;
    });
    return new RenderPipeline<TCtx>(modules);
  }

  /** Detach and dispose every owned module. Idempotent. */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    const modules = this._modules.splice(0).reverse();
    const errors: unknown[] = [];
    for (const module of modules) {
      try {
        this._releaseModule(module);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      const error = new Error('RenderPipeline: one or more modules failed to dispose') as Error & {
        errors: unknown[];
      };
      error.errors = errors;
      throw error;
    }
  }

  /** Resolve enabled modules into their setup order for the given context. */
  resolveModules(context: TCtx): readonly RenderModule<TCtx>[] {
    this._assertMutable();
    return resolveModuleOrder(this._modules.filter((module) => module.enabled(context)));
  }

  /**
   * Collect requirements from every module in the authored pipeline.
   * No module setup has run yet, so requirement providers cannot use blackboard
   * resources produced by another module.
   * @internal
   */
  collectRequirements(context: TCtx): FrameResourceRequirements {
    this._assertMutable();
    const requirements: FrameResourceRequirements = {};
    for (const module of this._modules) {
      mergeFrameResourceRequirements(requirements, module.requirements?.(context));
    }
    return requirements;
  }

  /**
   * Run every enabled module's setup against the build context. Enabled modules
   * are filtered before dependency resolution, so disabled writers cannot affect
   * the ordering or blackboard contract of the current frame.
   * @internal
   */
  build(context: TCtx): void {
    this._assertMutable();
    for (const module of this.resolveModules(context)) {
      module.setup(context);
    }
  }

  /** @internal */
  private _indexOf(type: string): number {
    for (let i = 0; i < this._modules.length; i++) {
      if (this._modules[i].type === type) {
        return i;
      }
    }
    return -1;
  }

  /** @internal */
  private _requireIndex(type: string): number {
    const i = this._indexOf(type);
    if (i < 0) {
      throw new Error(`RenderPipeline: no module with type "${type}"`);
    }
    return i;
  }

  /** @internal */
  private _assertAbsent(type: string): void {
    if (this._indexOf(type) >= 0) {
      throw new Error(`RenderPipeline: a module with type "${type}" already exists`);
    }
  }

  /** @internal */
  private _releaseModule(module: RenderModule<TCtx>): void {
    if (RenderPipeline._moduleOwners.get(module) === this) {
      RenderPipeline._moduleOwners.delete(module);
    }
    const errors: unknown[] = [];
    try {
      module.detach?.(this);
    } catch (error) {
      errors.push(error);
    }
    if (module.dispose && !RenderPipeline._disposedModules.has(module)) {
      RenderPipeline._disposedModules.add(module);
      try {
        module.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      const error = new Error(
        `RenderPipeline: module "${module.type}" failed to detach and dispose`
      ) as Error & {
        errors: unknown[];
      };
      error.errors = errors;
      throw error;
    }
  }

  /** @internal */
  private _attachModule(module: RenderModule<TCtx>): void {
    if (module.dispose && RenderPipeline._disposedModules.has(module)) {
      throw new Error(`RenderPipeline: disposed module "${module.type}" cannot be attached again`);
    }
    const stateful = !!(module.attach || module.detach || module.dispose || module.clone);
    if (stateful) {
      const owner = RenderPipeline._moduleOwners.get(module);
      if (owner && owner !== this) {
        throw new Error(
          `RenderPipeline: stateful module "${module.type}" already belongs to another pipeline; ` +
            `use module.clone() or pipeline.clone()`
        );
      }
      RenderPipeline._moduleOwners.set(module, this);
    }
    try {
      module.attach?.(this);
    } catch (error) {
      if (RenderPipeline._moduleOwners.get(module) === this) {
        RenderPipeline._moduleOwners.delete(module);
      }
      throw error;
    }
  }

  /** @internal */
  private _assertMutable(): void {
    if (this._disposed) {
      throw new Error('RenderPipeline: pipeline has been disposed');
    }
  }
}
