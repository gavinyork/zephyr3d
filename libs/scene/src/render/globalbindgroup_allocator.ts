import type { BindGroup, BindGroupLayout } from '@zephyr3d/device';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material';

export class GlobalBindGroupAllocator {
  static _layouts: Record<string, BindGroupLayout> = {};
  static _allocators: GlobalBindGroupAllocator[] = [];
  private _bindGroups: Record<string, BindGroup>;
  constructor() {
    this._bindGroups = {};
  }
  static get() {
    return this._allocators.pop() ?? new GlobalBindGroupAllocator();
  }
  static release(allocator: GlobalBindGroupAllocator) {
    this._allocators.push(allocator);
  }
  /**
   * Allocate global bind group according to current draw context
   * @param ctx - Draw context
   * @returns Global bind group
   */
  getGlobalBindGroup(ctx: DrawContext) {
    const hash = ctx.renderPassHash!;
    let bindGroup = this._bindGroups[hash];
    if (!bindGroup) {
      let layout = GlobalBindGroupAllocator._layouts[hash];
      if (!layout) {
        const ret = ctx.device.programBuilder.buildRender({
          vertex(pb) {
            ShaderHelper.prepareVertexShader(pb, ctx);
            pb.main(function () {});
          },
          fragment(pb) {
            ShaderHelper.prepareFragmentShader(pb, ctx);
            pb.main(function () {});
          }
        });
        layout = ret[2][0];
        GlobalBindGroupAllocator._layouts[hash] = layout;
      }
      bindGroup = ctx.device.createBindGroup(layout);
      this._bindGroups[hash] = bindGroup;
    }
    return bindGroup;
  }
}
