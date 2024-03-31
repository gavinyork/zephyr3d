import { GenericConstructor } from "@zephyr3d/base";
import { ProgramBuilder, type BindGroup, AbstractDevice } from "@zephyr3d/device";
import { BatchDrawable, DrawContext, Drawable } from "./drawable";
import { ShaderHelper } from "../material";
import type { DrawableInstanceInfo, RenderQueueRef } from "./render_queue";
import { Application } from "../app";
import { Mesh, XForm } from "../scene";

export interface IMixinDrawable {
  pushRenderQueueRef(ref: RenderQueueRef): void;
  applyInstanceOffsetAndStride(stride: number, offset: number): void;
  applyTransformUniforms(instanceInfo?: DrawableInstanceInfo): void;
  applyMaterialUniforms(instanceInfo: DrawableInstanceInfo): void;
  bind(device: AbstractDevice, ctx: DrawContext): void;
}

export function mixinDrawable<T extends GenericConstructor<{
  getXForm(): XForm
}>>(baseCls?: T):  T & { new (...args: any[]): IMixinDrawable } {
  const cls = class extends baseCls {
    private _mdRenderQueueRef: RenderQueueRef[];
    private _mdDrawableBindGroup: BindGroup;
    private _mdDrawableBindGroupInstanced: BindGroup;
    private _mdDrawableBindGroupSkin: BindGroup;
    constructor(...args: any[]) {
      super(...args);
      this._mdRenderQueueRef = [];
      this._mdDrawableBindGroup = null;
      this._mdDrawableBindGroupSkin = null;
      this.getXForm().on('transformchanged', node => {
        for (const ref of this._mdRenderQueueRef) {
          if (ref.ref) {
            this.applyTransformUniforms(ref.ref.getInstanceInfo(this as unknown as Drawable));
          }
        }
      });
    }
    pushRenderQueueRef(ref: RenderQueueRef): void {
      this.renderQueueRefPrune();
      this._mdRenderQueueRef.push(ref);
    }
    renderQueueRefPrune() {
      while(this._mdRenderQueueRef.length > 0) {
        const ref = this._mdRenderQueueRef[this._mdRenderQueueRef.length - 1].ref;
        if (!ref) {
          this._mdRenderQueueRef.pop();
        } else {
          return ref;
        }
      }
      return null;
    }
    applyInstanceOffsetAndStride(stride: number, offset: number): void {
      const drawableBindGroup = this.getDrawableBindGroup(Application.instance.device, true);
      drawableBindGroup.setValue(ShaderHelper.getInstanceDataStrideUniformName(), stride >> 2);
      drawableBindGroup.setValue(ShaderHelper.getInstanceDataOffsetUniformName(), offset >> 2);
    }
    applyTransformUniforms(instanceInfo?: DrawableInstanceInfo): void {
      const drawableBindGroup = this.getDrawableBindGroup(Application.instance.device, !!instanceInfo);
      if (instanceInfo) {
        instanceInfo.bindGroup.bindGroup.setRawData(
          ShaderHelper.getInstanceDataUniformName(),
          instanceInfo.offset * 4,
          this.getXForm().worldMatrix,
          0,
          16
        );
      } else {
        drawableBindGroup.setValue(ShaderHelper.getWorldMatrixUniformName(), this.getXForm().worldMatrix);
      }
    }
    applyMaterialUniforms(instanceInfo: DrawableInstanceInfo): void {
      const uniforms = (this as unknown as BatchDrawable).getInstanceUniforms();
      if (uniforms) {
        instanceInfo.bindGroup.bindGroup.setRawData(
          ShaderHelper.getInstanceDataUniformName(),
          (instanceInfo.offset + 16) * 4,
          uniforms,
          0,
          uniforms.length
        );
      }
    }
    /** @internal */
    bind(device: AbstractDevice, ctx: DrawContext): void {
      const instanceInfo = ctx.renderQueue.getInstanceInfo(this as unknown as Drawable);
      const drawableBindGroup = this.getDrawableBindGroup(device, !!instanceInfo);
      device.setBindGroup(1, drawableBindGroup);
      device.setBindGroup(3, instanceInfo?.bindGroup.bindGroup ?? null);
      if (ctx.skinAnimation) {
        const boneTexture = (this as unknown as Mesh).getBoneMatrices();
        drawableBindGroup.setTexture(ShaderHelper.getBoneMatricesUniformName(), boneTexture);
        drawableBindGroup.setValue(ShaderHelper.getBoneInvBindMatrixUniformName(), (this as unknown as Mesh).getInvBindMatrix());
        drawableBindGroup.setValue(ShaderHelper.getBoneTextureSizeUniformName(), boneTexture.width);
      }
    }
    /** @internal */
    getDrawableBindGroup(device: AbstractDevice, instancing: boolean): BindGroup {
      const skinning = !!(this as unknown as Drawable).getBoneMatrices();
      let bindGroup = skinning ? this._mdDrawableBindGroupSkin : instancing ? this._mdDrawableBindGroupInstanced : this._mdDrawableBindGroup;
      if (!bindGroup) {
        const buildInfo = new ProgramBuilder(device).buildRender({
          vertex(pb) {
            ShaderHelper.vertexShaderDrawableStuff(this, skinning, instancing);
            pb.main(function () {});
          },
          fragment(pb) {
            pb.main(function () {});
          }
        });
        bindGroup = device.createBindGroup(buildInfo[2][1]);
        if (skinning) {
          this._mdDrawableBindGroupSkin = bindGroup;
        } else if (instancing) {
          this._mdDrawableBindGroupInstanced = bindGroup;
        } else {
          this._mdDrawableBindGroup = bindGroup;
        }
      }
      return bindGroup;
    }
  };
  return cls as unknown as T & { new (...args: any[]): IMixinDrawable };
}
