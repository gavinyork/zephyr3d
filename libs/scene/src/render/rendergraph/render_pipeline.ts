import type { RenderModule, RenderModuleReadDescriptor } from './render_module';
import type { RenderContext } from './render_context';
import type { FrameResourceRequirements } from './frame_resource_requirements';
import { mergeFrameResourceRequirements } from './frame_resource_requirements';
import type { FrameResourceKey } from './blackboard';

/**
 * Resolve module dependencies with authored order as the stable default.
 * @throws If the declared dependencies form a cycle.
 * @public
 */
export function resolveModuleOrder<T extends RenderModule<any>>(modules: readonly T[]): T[] {
  const n = modules.length;
  const prereqs: Set<number>[] = modules.map(() => new Set<number>());
  const findWriter = (resource: FrameResourceKey, reader: number, version: 'current' | 'final') => {
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
      const read: RenderModuleReadDescriptor = declaredRead;
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
  // Prefer the earliest authored module among ready nodes.
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

/** Ordered, editable collection of uniquely named render modules. @public */
export class RenderPipeline<TCtx extends RenderContext = RenderContext> {
  private static readonly _moduleOwners = new WeakMap<object, RenderPipeline<any>>();
  private static readonly _disposedModules = new WeakSet<object>();
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
      try {
        this.dispose();
      } catch {
        // Preserve the construction error.
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

  /** Whether a module type is present. */
  has(type: string): boolean {
    return this._indexOf(type) >= 0;
  }

  /** Return a module by type, or undefined. */
  get(type: string): RenderModule<TCtx> | undefined {
    const i = this._indexOf(type);
    return i >= 0 ? this._modules[i] : undefined;
  }

  /** Append a module. */
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

  /** Prepend a module. */
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

  /** Insert a module before the named anchor. */
  insertBefore(anchor: string | RenderModule<TCtx>, module: RenderModule<TCtx>): this {
    this._assertMutable();
    this._assertAbsent(module.type);
    const index = this._requireIndex(anchor);
    this._modules.splice(index, 0, module);
    try {
      this._attachModule(module);
    } catch (error) {
      this._modules.splice(index, 1);
      throw error;
    }
    return this;
  }

  /** Insert a module after the named anchor. */
  insertAfter(anchor: string | RenderModule<TCtx>, module: RenderModule<TCtx>): this {
    this._assertMutable();
    this._assertAbsent(module.type);
    const index = this._requireIndex(anchor) + 1;
    this._modules.splice(index, 0, module);
    try {
      this._attachModule(module);
    } catch (error) {
      this._modules.splice(index, 1);
      throw error;
    }
    return this;
  }

  /** Replace a module in place. The previous module is detached but not disposed. */
  replace(anchor: string | RenderModule<TCtx>, module: RenderModule<TCtx>): this {
    this._assertMutable();
    const i = this._requireIndex(anchor);
    if (module.type !== this._modules[i].type) {
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
    this._detachModule(previous);
    return this;
  }

  /** Remove a module by type or instance. The module is detached but not disposed. */
  remove(anchor: string | RenderModule<TCtx>): this {
    this._assertMutable();
    const [module] = this._modules.splice(this._requireIndex(anchor), 1);
    this._detachModule(module);
    return this;
  }

  /** Dispose a detached module explicitly. */
  disposeModule(module: RenderModule<TCtx>): void {
    this._disposeModule(module);
  }

  /** Clone the pipeline; lifecycle-aware modules must implement `clone`. */
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
    return resolveModuleOrder(this._modules.filter((module) => module.prepare(context).enabled));
  }

  /** Collect requirements before module setup. @internal */
  collectRequirements(context: TCtx): FrameResourceRequirements {
    this._assertMutable();
    const requirements: FrameResourceRequirements = {};
    for (const module of this._modules) {
      mergeFrameResourceRequirements(requirements, module.prepare(context).requirements);
    }
    return requirements;
  }

  /** Build enabled modules in dependency order. @internal */
  build(context: TCtx): void {
    this._assertMutable();
    for (const module of this.resolveModules(context)) {
      module.setup(context);
    }
  }

  private _indexOf(type: string): number {
    for (let i = 0; i < this._modules.length; i++) {
      if (this._modules[i].type === type) {
        return i;
      }
    }
    return -1;
  }

  private _requireIndex(anchor: string | RenderModule<TCtx>): number {
    const i = typeof anchor === 'string' ? this._indexOf(anchor) : this._modules.indexOf(anchor);
    if (i < 0) {
      throw new Error(
        `RenderPipeline: no module with type "${typeof anchor === 'string' ? anchor : anchor.type}"`
      );
    }
    return i;
  }

  private _assertAbsent(type: string): void {
    if (this._indexOf(type) >= 0) {
      throw new Error(`RenderPipeline: a module with type "${type}" already exists`);
    }
  }

  private _releaseModule(module: RenderModule<TCtx>): void {
    const errors: unknown[] = [];
    try {
      this._detachModule(module);
    } catch (error) {
      errors.push(error);
    }
    try {
      this._disposeModule(module);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      const error = new Error(`RenderPipeline: module "${module.type}" failed to release`) as Error & {
        errors: unknown[];
      };
      error.errors = errors;
      throw error;
    }
  }

  private _detachModule(module: RenderModule<TCtx>): void {
    if (RenderPipeline._moduleOwners.get(module) === this) {
      RenderPipeline._moduleOwners.delete(module);
    }
    module.detach?.(this);
  }

  private _disposeModule(module: RenderModule<TCtx>): void {
    if (module.dispose && !RenderPipeline._disposedModules.has(module)) {
      RenderPipeline._disposedModules.add(module);
      module.dispose();
    }
  }

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

  private _assertMutable(): void {
    if (this._disposed) {
      throw new Error('RenderPipeline: pipeline has been disposed');
    }
  }
}
