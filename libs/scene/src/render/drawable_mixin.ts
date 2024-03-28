import { GenericConstructor } from "@zephyr3d/base";
import { ProgramBuilder, type BindGroup, AbstractDevice } from "@zephyr3d/device";
import { DrawContext, Drawable } from "./drawable";
import { ShaderHelper } from "../material";
import { CachedBindGroup } from "./render_queue";

export interface IMixinDrawable {

}

export function mixinDrawable<T extends GenericConstructor<Drawable>>(baseCls: T):  T & { new (...args: any[]): IMixinDrawable } {
  type BindGroupInfo = { bindGroup: BindGroup, transformTag: number };
  const cls = class extends baseCls {
    private _md_bindGroupSlot1: BindGroupInfo;
    private _md_bindGroupSlot1Instanced: BindGroupInfo;
    private _md_bindGroupSlot1Skin: BindGroupInfo;
    private _md_inQueue: boolean;
    private _md_instanceBindGroupInfo: CachedBindGroup;
    private _md_
    constructor(...args: any[]) {
      super(...args);
      this._md_bindGroupSlot1 = null;
      this._md_bindGroupSlot1Skin = null;
    }
    applyDrawableBindGroup(device: AbstractDevice, ctx: DrawContext) {
      const bindGroupInfo = this.getDrawableBindGroup(device, ctx);
      if (this.getXForm().getTag() !== bindGroupInfo.transformTag) {

      }
    }
    /** @internal */
    getDrawableBindGroup(device: AbstractDevice, ctx: DrawContext): BindGroupInfo {
      const skinning = !!this.getBoneMatrices();
      const instancing = !!ctx.instanceData;
      let bindGroup = skinning ? this._md_bindGroupSlot1Skin : instancing ? this._md_bindGroupSlot1Instanced : this._md_bindGroupSlot1;
      if (!bindGroup) {
        const webgl1 = device.type === 'webgl';
        const buildInfo = new ProgramBuilder(device).buildRender({
          vertex(pb) {
            ShaderHelper.vertexShaderDrawableStuff(this, skinning, !webgl1);
            pb.main(function () {});
          },
          fragment(pb) {
            ShaderHelper.fragmentShaderDrawableStuff(this, !webgl1);
            pb.main(function () {});
          }
        });
        bindGroup = {
          bindGroup: device.createBindGroup(buildInfo[2][1]),
          transformTag: -1
        };
        if (skinning) {
          this._md_bindGroupSlot1Skin = bindGroup;
        } else {
          this._md_bindGroupSlot1 = bindGroup;
        }
      }
      return bindGroup;
    }
  };
  return cls as unknown as T & { new (...args: any[]): IMixinDrawable };
}
