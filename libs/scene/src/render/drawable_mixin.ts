import type { GenericConstructor } from '@zephyr3d/base';
import { Vector2, Vector4 } from '@zephyr3d/base';
import type { AbstractDevice } from '@zephyr3d/device';
import type { BindGroup } from '@zephyr3d/device';
import type { BatchDrawable, DrawContext, Drawable } from './drawable';
import { ShaderHelper } from '../material';
import type { DrawableInstanceInfo, RenderQueue, RenderQueueRef } from './render_queue';
import { Application } from '../app/app';
import type { Mesh, SceneNode } from '../scene';
import { MaterialVaryingFlags } from '../values';

export interface IMixinDrawable {
  readonly objectColor: Vector4;
  getId(): number;
  pushRenderQueueRef(ref: RenderQueueRef): void;
  applyInstanceOffsetAndStride(renderQueue: RenderQueue, stride: number, offset: number): void;
  applyTransformUniforms(renderQueue: RenderQueue): void;
  applyMaterialUniforms(instanceInfo: DrawableInstanceInfo): void;
  applyMaterialUniformsAll(): void;
  getObjectColor(): Vector4;
  bind(ctx: DrawContext): void;
}

let _drawableId = 0;
const boneTextureSize = new Vector2();

const instanceBindGroupTransfromTags = new WeakMap<DrawableInstanceInfo, number>();
const drawableBindGroupTransfromTags = new WeakMap<BindGroup, number>();

const bindGroupCache: Record<string, BindGroup[]> = {};
const usedBindGroups: WeakMap<BindGroup, string> = new WeakMap();

function fetchBindGroup(skinning: boolean, morphing: boolean, instancing: boolean) {
  const hash = `${instancing}:${morphing}:${skinning}`;
  const bindGroups = bindGroupCache[hash];
  let bindGroup: BindGroup = null;
  if (bindGroups && bindGroups.length > 0) {
    bindGroup = bindGroups.pop();
  } else {
    const layout = ShaderHelper.getDrawableBindGroupLayout(skinning, morphing, instancing);
    bindGroup = Application.instance.device.createBindGroup(layout);
  }
  usedBindGroups.set(bindGroup, hash);
  return bindGroup;
}

function releaseBindGroup(bindGroup: BindGroup) {
  const hash = usedBindGroups.get(bindGroup);
  if (hash) {
    usedBindGroups.delete(bindGroup);
    const bindGroups = bindGroupCache[hash];
    if (bindGroups) {
      bindGroups.push(bindGroup);
    } else {
      bindGroupCache[hash] = [bindGroup];
    }
  } else {
    bindGroup.dispose();
  }
}

export function mixinDrawable<
  T extends GenericConstructor<{
    getNode(): SceneNode;
  }>
>(baseCls?: T): T & { new (...args: any[]): IMixinDrawable } {
  const cls = class extends baseCls {
    private _mdRenderQueueRef: RenderQueueRef[];
    private _mdDrawableBindGroup: BindGroup;
    private _mdDrawableBindGroupInstanced: Map<RenderQueue, BindGroup>;
    private _mdDrawableBindGroupSkin: BindGroup;
    private _mdDrawableBindGroupMorph: BindGroup;
    private _mdDrawableBindGroupSkinMorph: BindGroup;
    private _worldMatrixBuffer: Float32Array;
    private _framestampBuffer: Int32Array;
    private _currentWorldMatrixBuffer: Float32Array;
    private _prevWorldMatrixBuffer: Float32Array;
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
      this._worldMatrixBuffer = new Float32Array(4 * 9);
      this._framestampBuffer = new Int32Array(this._worldMatrixBuffer.buffer, 4 * 16);
      this._currentWorldMatrixBuffer = this._worldMatrixBuffer.subarray(0, 16);
      this._prevWorldMatrixBuffer = this._worldMatrixBuffer.subarray(20, 36);
      this._currentWorldMatrixBuffer.set(this.getNode().worldMatrix);
      this._framestampBuffer[0] = Application.instance.device.frameInfo.frameCounter;
      this._framestampBuffer[1] = this._framestampBuffer[0];
      this._prevWorldMatrixBuffer.set(this.getNode().worldMatrix);
      this.getNode().on('transformchanged', () => {
        const frame = Application.instance.device.frameInfo.frameCounter;
        if (frame !== this._framestampBuffer[1]) {
          this._prevWorldMatrixBuffer.set(this._currentWorldMatrixBuffer);
          this._framestampBuffer[0] = frame;
          this._framestampBuffer[1] = frame;
        }
        this._currentWorldMatrixBuffer.set(this.getNode().worldMatrix);
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
      for (let i = this._mdRenderQueueRef.length - 1; i >= 0; i--) {
        const ref = this._mdRenderQueueRef[i].ref;
        if (ref.disposed) {
          this._mdRenderQueueRef.splice(i, 1);
          const bindGroup = this._mdDrawableBindGroupInstanced.get(ref);
          if (bindGroup) {
            releaseBindGroup(bindGroup);
            this._mdDrawableBindGroupInstanced.delete(ref);
          }
        }
      }
    }
    applyInstanceOffsetAndStride(renderQueue: RenderQueue, stride: number, offset: number): void {
      const drawableBindGroup = this.getDrawableBindGroup(Application.instance.device, true, renderQueue);
      drawableBindGroup.setValue(ShaderHelper.getInstanceDataStrideUniformName(), stride >> 2);
      drawableBindGroup.setValue(ShaderHelper.getInstanceDataOffsetUniformName(), offset >> 2);
    }
    applyTransformUniforms(renderQueue: RenderQueue): void {
      const instanceInfo = renderQueue.getInstanceInfo(this as unknown as Drawable);
      const currentTag = this.getNode().transformTag;
      if (instanceInfo) {
        const tag = instanceBindGroupTransfromTags.get(instanceInfo) ?? -1;
        if (tag !== currentTag) {
          instanceInfo.bindGroup.bindGroup.setRawData(
            ShaderHelper.getInstanceDataUniformName(),
            instanceInfo.offset * 4,
            this._worldMatrixBuffer,
            0,
            36
          );
          instanceBindGroupTransfromTags.set(instanceInfo, tag);
        }
      } else {
        const drawableBindGroup = this.getDrawableBindGroup(Application.instance.device, false, renderQueue);
        const tag = drawableBindGroupTransfromTags.get(drawableBindGroup) ?? -1;
        if (tag !== currentTag) {
          drawableBindGroup.setValue(
            ShaderHelper.getWorldMatrixUniformName(),
            this._currentWorldMatrixBuffer
          );
          drawableBindGroup.setValue(
            ShaderHelper.getPrevWorldMatrixUniformName(),
            this._prevWorldMatrixBuffer
          );
          drawableBindGroup.setValue(
            ShaderHelper.getPrevWorldMatrixFrameUniformName(),
            this._framestampBuffer[0]
          );
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
    applyMaterialUniformsAll() {
      for (const ref of this._mdRenderQueueRef) {
        if (ref.ref) {
          const instanceInfo = ref.ref.getInstanceInfo(this as unknown as Drawable);
          if (instanceInfo) {
            this.applyMaterialUniforms(instanceInfo);
          }
        }
      }
    }
    applyMaterialUniforms(instanceInfo: DrawableInstanceInfo) {
      const uniforms = (this as unknown as BatchDrawable).getInstanceUniforms();
      if (uniforms) {
        instanceInfo.bindGroup.bindGroup.setRawData(
          ShaderHelper.getInstanceDataUniformName(),
          (instanceInfo.offset + ShaderHelper.MATERIAL_INSTANCE_DATA_OFFSET * 4) * 4,
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
        boneTextureSize.setXY(boneTexture.width, boneTexture.height);
        drawableBindGroup.setValue(ShaderHelper.getBoneTextureSizeUniformName(), boneTextureSize);
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
        bindGroup = fetchBindGroup(skinning, morphing, instancing);
        if (instancing) {
          this._mdDrawableBindGroupInstanced.set(renderQueue, bindGroup);
        } else if (skinning && morphing) {
          this._mdDrawableBindGroupSkinMorph = bindGroup;
        } else if (skinning) {
          this._mdDrawableBindGroupSkin = bindGroup;
        } else if (morphing) {
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
