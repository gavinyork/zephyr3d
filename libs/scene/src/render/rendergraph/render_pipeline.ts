import type { RenderModule } from './render_module';
import type { FrameGraphContext } from './frame_graph_context';

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
export class RenderPipeline {
  /** @internal */
  private _modules: RenderModule[];

  /**
   * @param modules - Initial ordered modules. Copied into the pipeline; the
   *   array is not retained. Duplicate `type` values are rejected.
   */
  constructor(modules?: readonly RenderModule[]) {
    this._modules = [];
    if (modules) {
      for (const m of modules) {
        this.append(m);
      }
    }
  }

  /** The pipeline's modules in execution order. */
  get modules(): readonly RenderModule[] {
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
  get(type: string): RenderModule | undefined {
    const i = this._indexOf(type);
    return i >= 0 ? this._modules[i] : undefined;
  }

  /**
   * Append a module to the end of the pipeline.
   * @param module - The module to add.
   */
  append(module: RenderModule): this {
    this._assertAbsent(module.type);
    this._modules.push(module);
    return this;
  }

  /**
   * Prepend a module to the front of the pipeline.
   * @param module - The module to add.
   */
  prepend(module: RenderModule): this {
    this._assertAbsent(module.type);
    this._modules.unshift(module);
    return this;
  }

  /**
   * Insert a module immediately before the anchor module.
   * @param type - The {@link RenderModule.type} of the existing anchor.
   * @param module - The module to insert.
   */
  insertBefore(type: string, module: RenderModule): this {
    this._assertAbsent(module.type);
    this._modules.splice(this._requireIndex(type), 0, module);
    return this;
  }

  /**
   * Insert a module immediately after the anchor module.
   * @param type - The {@link RenderModule.type} of the existing anchor.
   * @param module - The module to insert.
   */
  insertAfter(type: string, module: RenderModule): this {
    this._assertAbsent(module.type);
    this._modules.splice(this._requireIndex(type) + 1, 0, module);
    return this;
  }

  /**
   * Replace the module with the given type in place.
   * @param type - The {@link RenderModule.type} of the module to replace.
   * @param module - The replacement module.
   */
  replace(type: string, module: RenderModule): this {
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
  clone(): RenderPipeline {
    return new RenderPipeline(this._modules);
  }

  /**
   * Run every enabled module's setup, in order, against the build context.
   * @internal
   */
  build(context: FrameGraphContext): void {
    for (const module of this._modules) {
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
