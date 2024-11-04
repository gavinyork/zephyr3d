import type { GenericConstructor } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { AbstractDevice } from '@zephyr3d/device';
import type { BindGroup } from '@zephyr3d/device';
import type { BatchDrawable, DrawContext, Drawable } from './drawable';
import { ShaderHelper } from '../material';
import type { DrawableInstanceInfo, RenderQueue, RenderQueueRef } from './render_queue';
import { Application } from '../app';
import type { Mesh, XForm } from '../scene';
import { MaterialVaryingFlags } from '../values';

export interface IMixinDrawable {
  readonly objectColor: Vector4;
  getId(): number;
  pushRenderQueueRef(ref: RenderQueueRef): void;
  applyInstanceOffsetAndStride(renderQueue: RenderQueue, stride: number, offset: number): void;
  applyTransformUniforms(renderQueue: RenderQueue): void;
  applyMaterialUniforms(instanceInfo: DrawableInstanceInfo): void;
  getObjectColor(): Vector4;
  bind(ctx: DrawContext): void;
}

let _drawableId = 0;

const instanceBindGroupTransfromTags = new WeakMap<DrawableInstanceInfo, number>();
const drawableBindGroupTransfromTags = new WeakMap<BindGroup, number>();

export function mixinDrawable<
  T extends GenericConstructor<{
    getXForm(): XForm;
  }>
>(baseCls?: T): T & { new (...args: any[]): IMixinDrawable } {
  const cls = class extends baseCls {
    private _mdRenderQueueRef: RenderQueueRef[];
    private _mdDrawableBindGroup: BindGroup;
    private _mdDrawableBindGroupInstanced: Map<RenderQueue, BindGroup>;
    private _mdDrawableBindGroupSkin: BindGroup;
    private _mdDrawableBindGroupMorph: BindGroup;
    private _mdDrawableBindGroupSkinMorph: BindGroup;
    private _id: number;
    private _objectColor: Vector4;
    constructor(...args: any[]) {
      super(...args);
      this._id = ++_drawableId;
      this._objectColor = null;
      this._mdRenderQueueRef = [];
      this._mdDrawableBindGroup = null;
      this._mdDrawableBindGroupInstanced = new Map();
      this._mdDrawableBindGroupSkin = null;
      this._mdDrawableBindGroupMorph = null;
      this._mdDrawableBindGroupSkinMorph = null;
      this.getXForm().on('transformchanged', (node) => {
        for (const ref of this._mdRenderQueueRef) {
          if (ref.ref) {
            this.applyTransformUniforms(ref.ref);
          }
        }
      });
    }
    getId(): number {
      return this._id;
    }
    getObjectColor(): Vector4 {
      if (!this._objectColor) {
        const a = (this._id & 0xff) / 255;
        const b = ((this._id >>> 8) & 0xff) / 255;
        const g = ((this._id >>> 16) & 0xff) / 255;
        const r = ((this._id >>> 24) & 0xff) / 255;
        this._objectColor = new Vector4(r, g, b, a);
      }
      return this._objectColor;
    }
    pushRenderQueueRef(ref: RenderQueueRef): void {
      this.renderQueueRefPrune();
      this._mdRenderQueueRef.push(ref);
    }
    renderQueueRefPrune() {
      while (this._mdRenderQueueRef.length > 0) {
        const ref = this._mdRenderQueueRef[this._mdRenderQueueRef.length - 1].ref;
        if (!ref) {
          this._mdRenderQueueRef.pop();
        } else {
          return ref;
        }
      }
      return null;
    }
    applyInstanceOffsetAndStride(renderQueue: RenderQueue, stride: number, offset: number): void {
      const drawableBindGroup = this.getDrawableBindGroup(Application.instance.device, true, renderQueue);
      drawableBindGroup.setValue(ShaderHelper.getInstanceDataStrideUniformName(), stride >> 2);
      drawableBindGroup.setValue(ShaderHelper.getInstanceDataOffsetUniformName(), offset >> 2);
    }
    applyTransformUniforms(renderQueue: RenderQueue): void {
      const instanceInfo = renderQueue.getInstanceInfo(this as unknown as Drawable);
      const currentTag = this.getXForm().transformTag;
      if (instanceInfo) {
        const tag = instanceBindGroupTransfromTags.get(instanceInfo) ?? -1;
        if (tag !== currentTag) {
          instanceInfo.bindGroup.bindGroup.setRawData(
            ShaderHelper.getInstanceDataUniformName(),
            instanceInfo.offset * 4,
            this.getXForm().worldMatrix,
            0,
            16
          );
          instanceBindGroupTransfromTags.set(instanceInfo, tag);
        }
      } else {
        const drawableBindGroup = this.getDrawableBindGroup(Application.instance.device, false, renderQueue);
        const tag = drawableBindGroupTransfromTags.get(drawableBindGroup) ?? -1;
        if (tag !== currentTag) {
          drawableBindGroup.setValue(ShaderHelper.getWorldMatrixUniformName(), this.getXForm().worldMatrix);
          if ((this as unknown as Drawable).getBoneMatrices()) {
            drawableBindGroup.setValue(
              ShaderHelper.getBoneInvBindMatrixUniformName(),
              (this as unknown as Mesh).invWorldMatrix
            );
          }
          drawableBindGroupTransfromTags.set(drawableBindGroup, tag);
        }
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
    bind(ctx: DrawContext): void {
      const device = ctx.device;
      const drawableBindGroup = this.getDrawableBindGroup(device, !!ctx.instanceData, ctx.renderQueue);
      device.setBindGroup(1, drawableBindGroup);
      device.setBindGroup(3, ctx.instanceData ? ctx.instanceData.bindGroup.bindGroup : null);
      if (ctx.materialFlags & MaterialVaryingFlags.SKIN_ANIMATION) {
        const boneTexture = (this as unknown as Mesh).getBoneMatrices();
        drawableBindGroup.setTexture(ShaderHelper.getBoneMatricesUniformName(), boneTexture);
        drawableBindGroup.setValue(
          ShaderHelper.getBoneInvBindMatrixUniformName(),
          (this as unknown as Mesh).invWorldMatrix
        );
        drawableBindGroup.setValue(ShaderHelper.getBoneTextureSizeUniformName(), boneTexture.width);
      }
      if (ctx.materialFlags & MaterialVaryingFlags.MORPH_ANIMATION) {
        const morphData = (this as unknown as Mesh).getMorphData();
        const morphInfo = (this as unknown as Mesh).getMorphInfo();
        drawableBindGroup.setTexture(ShaderHelper.getMorphDataUniformName(), morphData);
        drawableBindGroup.setBuffer(ShaderHelper.getMorphInfoUniformName(), morphInfo);
      }
    }
    /** @internal */
    getDrawableBindGroup(device: AbstractDevice, instancing: boolean, renderQueue: RenderQueue): BindGroup {
      const skinning = !!(this as unknown as Drawable).getBoneMatrices();
      const morphing = !!(this as unknown as Drawable).getMorphData();
      let bindGroup = instancing
        ? this._mdDrawableBindGroupInstanced.get(renderQueue)
        : skinning && morphing
        ? this._mdDrawableBindGroupSkinMorph
        : skinning
        ? this._mdDrawableBindGroupSkin
        : morphing
        ? this._mdDrawableBindGroupMorph
        : this._mdDrawableBindGroup;
      if (!bindGroup) {
        const layout = ShaderHelper.getDrawableBindGroupLayout(skinning, morphing, instancing);
        bindGroup = device.createBindGroup(layout);
        if (instancing) {
          this._mdDrawableBindGroupInstanced.set(renderQueue, bindGroup);
        } else if (skinning && morphing) {
          this._mdDrawableBindGroupSkinMorph = bindGroup;
        } else if (skinning) {
          this._mdDrawableBindGroupSkin = bindGroup;
        } else if (morphing) {
          const bindName =
            layout.nameMap?.[ShaderHelper.getMorphInfoUniformName()] ??
            ShaderHelper.getMorphInfoUniformName();
          for (let binding = 0; binding < layout.entries.length; binding++) {
            const bindingPoint = layout.entries[binding];
            if (bindingPoint.name === bindName) {
              console.log(bindingPoint.type);
              break;
            }
          }
          this._mdDrawableBindGroupMorph = bindGroup;
        } else {
          this._mdDrawableBindGroup = bindGroup;
        }
      }
      return bindGroup;
    }
  };
  return cls as unknown as T & { new (...args: any[]): IMixinDrawable };
}
