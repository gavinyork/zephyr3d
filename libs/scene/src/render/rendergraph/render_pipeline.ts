import type { RenderModule } from './render_module';
import type { RenderContext } from './render_context';

/**
 * Resolve the setup order of a module list, honouring declared
 * {@link RenderModule.reads} / {@link RenderModule.writes} dependencies while
 * keeping the authored array order as the stable default.
 *
 * A module that declares no `reads` has no incoming edge and never moves — its
 * authored index is preserved exactly. A module that declares `reads` is ordered
 * after every module (of lower-or-any authored index) that declares it `writes`
 * one of those resources; when a resource is written by several modules, the
 * last authored writer wins (matching the blackboard's last-write-wins lookup).
 * A read whose resource no module writes is skipped (lenient): the consumer is
 * expected to gate on it in {@link RenderModule.enabled} if it is required.
 *
 * @param modules - The pipeline's modules in authored order.
 * @returns A new array in resolved setup order.
 * @throws If the declared dependencies form a cycle.
 * @public
 */
export function resolveModuleOrder<T extends RenderModule<any>>(modules: readonly T[]): T[] {
  const n = modules.length;
  // Producer map: resource name -> authored index of its last declared writer.
  const lastWriter = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const w = modules[i].writes;
    if (w) {
      for (const res of w) {
        lastWriter.set(res, i);
      }
    }
  }
  // Edges producer -> reader, keyed by reader index (its set of prerequisite indices).
  const prereqs: Set<number>[] = modules.map(() => new Set<number>());
  for (let reader = 0; reader < n; reader++) {
    const r = modules[reader].reads;
    if (!r) {
      continue;
    }
    for (const res of r) {
      const producer = lastWriter.get(res);
      // Skip self-edges and absent producers (lenient semantics).
      if (producer !== undefined && producer !== reader) {
        prereqs[reader].add(producer);
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
 *   .insertAfter('LightPass', myOutlineModule)
 *   .remove('GPUPicking');
 * ```
 *
 * Modules must have unique `type` values within a pipeline. Editing methods are
 * chainable and locate their anchor by `type`, throwing if it is absent.
 *
 * @public
 */
export class RenderPipeline<TCtx extends RenderContext = RenderContext> {
  /** @internal */
  private _modules: RenderModule<TCtx>[];

  /**
   * @param modules - Initial ordered modules. Copied into the pipeline; the
   *   array is not retained. Duplicate `type` values are rejected.
   */
  constructor(modules?: readonly RenderModule<TCtx>[]) {
    this._modules = [];
    if (modules) {
      for (const m of modules) {
        this.append(m);
      }
    }
  }

  /** The pipeline's modules in execution order. */
  get modules(): readonly RenderModule<TCtx>[] {
    return this._modules;
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
    this._assertAbsent(module.type);
    this._modules.push(module);
    return this;
  }

  /**
   * Prepend a module to the front of the pipeline.
   * @param module - The module to add.
   */
  prepend(module: RenderModule<TCtx>): this {
    this._assertAbsent(module.type);
    this._modules.unshift(module);
    return this;
  }

  /**
   * Insert a module immediately before the anchor module.
   * @param type - The {@link RenderModule.type} of the existing anchor.
   * @param module - The module to insert.
   */
  insertBefore(type: string, module: RenderModule<TCtx>): this {
    this._assertAbsent(module.type);
    this._modules.splice(this._requireIndex(type), 0, module);
    return this;
  }

  /**
   * Insert a module immediately after the anchor module.
   * @param type - The {@link RenderModule.type} of the existing anchor.
   * @param module - The module to insert.
   */
  insertAfter(type: string, module: RenderModule<TCtx>): this {
    this._assertAbsent(module.type);
    this._modules.splice(this._requireIndex(type) + 1, 0, module);
    return this;
  }

  /**
   * Replace the module with the given type in place.
   * @param type - The {@link RenderModule.type} of the module to replace.
   * @param module - The replacement module.
   */
  replace(type: string, module: RenderModule<TCtx>): this {
    const i = this._requireIndex(type);
    if (module.type !== type) {
      this._assertAbsent(module.type);
    }
    this._modules[i] = module;
    return this;
  }

  /**
   * Remove the module with the given type.
   * @param type - The {@link RenderModule.type} of the module to remove.
   */
  remove(type: string): this {
    this._modules.splice(this._requireIndex(type), 1);
    return this;
  }

  /**
   * Create an independent copy of this pipeline (shallow — module instances are
   * shared). Use to derive a per-camera pipeline from the default without
   * mutating the shared one.
   */
  clone(): RenderPipeline<TCtx> {
    return new RenderPipeline<TCtx>(this._modules);
  }

  /**
   * Run every enabled module's setup against the build context, in the order
   * resolved by {@link resolveModuleOrder} (authored order, adjusted for any
   * declared reads/writes dependencies).
   * @internal
   */
  build(context: TCtx): void {
    for (const module of resolveModuleOrder(this._modules)) {
      if (module.enabled(context)) {
        module.setup(context);
      }
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
}
