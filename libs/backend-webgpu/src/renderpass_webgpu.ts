import type { TypedArray, Vector4 } from '@zephyr3d/base';
import type { PrimitiveType, DeviceViewport } from '@zephyr3d/device';
import {
  hasStencilChannel,
  PBPrimitiveTypeInfo,
  PBPrimitiveType,
  isIntegerTextureFormat,
  isSignedTextureFormat
} from '@zephyr3d/device';
import type { WebGPUProgram } from './gpuprogram_webgpu';
import type { WebGPURenderStateSet } from './renderstates_webgpu';
import type { WebGPUBindGroup } from './bindgroup_webgpu';
import { WebGPUMipmapGenerator, WebGPUClearQuad } from './utils_webgpu';
import type { WebGPUBaseTexture } from './basetexture_webgpu';
import type { WebGPUBuffer } from './buffer_webgpu';
import type { WebGPUDevice } from './device';
import type { WebGPUFrameBuffer } from './framebuffer_webgpu';
import type { WebGPUVertexLayout } from './vertexlayout_webgpu';
import type { WebGPUIndexBuffer } from './indexbuffer_webgpu';
import type { FrameBufferInfo } from './pipeline_cache';
import type { WebGPUStructuredBuffer } from './structuredbuffer_webgpu';
import { textureFormatInvMap } from './constants_webgpu';

const VALIDATION_NEED_NEW_PASS = 1 << 0;
const VALIDATION_NEED_GENERATE_MIPMAP = 1 << 1;
const VALIDATION_FAILED = 1 << 2;

const typeU16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);

export class WebGPURenderPass {
  private _device: WebGPUDevice;
  private _frameBuffer: WebGPUFrameBuffer;
  private _bufferUploads: Set<WebGPUBuffer>;
  private _textureUploads: Set<WebGPUBaseTexture>;
  private _bufferUploadsNext: Set<WebGPUBuffer>;
  private _textureUploadsNext: Set<WebGPUBaseTexture>;
  private _renderCommandEncoder: GPUCommandEncoder;
  private _renderPassEncoder: GPURenderPassEncoder;
  private _fbBindFlag: number;
  private _currentViewport: DeviceViewport;
  private _currentScissor: DeviceViewport;
  private _frameBufferInfo: FrameBufferInfo;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._bufferUploads = new Set();
    this._textureUploads = new Set();
    this._bufferUploadsNext = new Set();
    this._textureUploadsNext = new Set();
    this._renderCommandEncoder = this._device.device.createCommandEncoder();
    this._renderPassEncoder = null;
    this._frameBuffer = null;
    this._fbBindFlag = null;
    this._currentViewport = null;
    this._currentScissor = null;
    this._frameBufferInfo = null;
  }
  get active(): boolean {
    return !!this._renderPassEncoder;
  }
  isBufferUploading(buffer: WebGPUBuffer): boolean {
    return !!this._bufferUploads.has(buffer);
  }
  isTextureUploading(tex: WebGPUBaseTexture): boolean {
    return !!this._textureUploads.has(tex);
  }
  setFramebuffer(fb: WebGPUFrameBuffer): void {
    if (this._frameBuffer !== fb) {
      this.end();
      this._frameBuffer = fb;
      this.setViewport(null);
      this.setScissor(null);
    }
  }
  getFramebuffer(): WebGPUFrameBuffer {
    return this._frameBuffer;
  }
  setViewport(vp?: number[] | DeviceViewport) {
    if (!vp || (!Array.isArray(vp) && vp.default)) {
      this._currentViewport = {
        x: 0,
        y: 0,
        width: this._device.deviceToScreen(this._device.drawingBufferWidth),
        height: this._device.deviceToScreen(this._device.drawingBufferHeight),
        default: true
      };
    } else {
      if (Array.isArray(vp)) {
        this._currentViewport = {
          x: vp[0],
          y: vp[1],
          width: vp[2],
          height: vp[3],
          default: false
        };
      } else {
        this._currentViewport = Object.assign({ default: false }, vp);
      }
    }
    const vx = this._device.screenToDevice(this._currentViewport.x);
    const vy = this._device.screenToDevice(this._currentViewport.y);
    const vw = this._device.screenToDevice(this._currentViewport.width);
    const vh = this._device.screenToDevice(this._currentViewport.height);
    if (vx < 0 || vy < 0 || vw > this._device.drawingBufferWidth || vh > this._device.drawingBufferHeight) {
      console.log(
        `** VIEWPORT ERROR **: (${vx}, ${vy}, ${vw}, ${vh}) => (0, 0, ${this._device.drawingBufferWidth}, ${this._device.drawingBufferHeight})`
      );
    }
    if (this._renderPassEncoder) {
      this._renderPassEncoder.setViewport(vx, this._device.drawingBufferHeight - vy - vh, vw, vh, 0, 1);
    }
  }
  getViewport(): DeviceViewport {
    return Object.assign({}, this._currentViewport);
  }
  setScissor(scissor?: number[] | DeviceViewport) {
    const backBufferWidth = this._device.deviceToScreen(this._device.drawingBufferWidth);
    const backBufferHeight = this._device.deviceToScreen(this._device.drawingBufferHeight);
    if (scissor === null || scissor === undefined || (!Array.isArray(scissor) && scissor.default)) {
      this._currentScissor = {
        x: 0,
        y: 0,
        width: backBufferWidth,
        height: backBufferHeight,
        default: true
      };
    } else {
      if (Array.isArray(scissor)) {
        this._currentScissor = {
          x: scissor[0],
          y: scissor[1],
          width: scissor[2],
          height: scissor[3],
          default: false
        };
      } else {
        this._currentScissor = Object.assign({ default: false }, scissor);
      }
    }
    let vx = this._device.screenToDevice(this._currentScissor.x);
    let vy = this._device.screenToDevice(this._currentScissor.y);
    let vw = this._device.screenToDevice(this._currentScissor.width);
    let vh = this._device.screenToDevice(this._currentScissor.height);
    // Clip scissor region to screen
    if (vx < 0) {
      vw += vx;
      vx = 0;
    }
    if (vy < 0) {
      vh += vy;
      vy = 0;
    }
    vw = Math.min(this._device.screenToDevice(backBufferWidth) - vx, vw);
    vh = Math.min(this._device.screenToDevice(backBufferHeight) - vy, vh);
    if (vw < 0 || vh < 0) {
      vx = 0;
      vy = 0;
      vw = 0;
      vh = 0;
    }
    if (this._renderPassEncoder) {
      this._renderPassEncoder.setScissorRect(vx, this._device.drawingBufferHeight - vy - vh, vw, vh);
    }
  }
  getScissor(): DeviceViewport {
    return Object.assign({}, this._currentScissor);
  }
  draw(
    program: WebGPUProgram,
    vertexData: WebGPUVertexLayout,
    stateSet: WebGPURenderStateSet,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Iterable<number>[],
    primitiveType: PrimitiveType,
    first: number,
    count: number,
    numInstances: number
  ): void {
    const validation = this.validateDraw(program, vertexData, bindGroups);
    if (validation & VALIDATION_FAILED) {
      return;
    }
    if (validation & VALIDATION_NEED_NEW_PASS || validation & VALIDATION_NEED_GENERATE_MIPMAP) {
      this.end();
    }
    if (validation & VALIDATION_NEED_GENERATE_MIPMAP) {
      WebGPUMipmapGenerator.generateMipmapsForBindGroups(this._device, bindGroups);
    }
    if (!this.active) {
      this.begin();
    }
    this.drawInternal(
      this._renderPassEncoder,
      program,
      vertexData,
      stateSet,
      bindGroups,
      bindGroupOffsets,
      primitiveType,
      first,
      count,
      numInstances
    );
  }
  clear(color: Vector4, depth: number, stencil: number): void {
    if (!this._currentScissor) {
      this.end();
      this.begin(color, depth, stencil);
    } else {
      if (!this._renderPassEncoder) {
        this.begin();
      }
      this._renderPassEncoder.insertDebugMarker('clear');
      WebGPUClearQuad.drawClearQuad(this, color, depth, stencil);
      this._renderPassEncoder.insertDebugMarker('end clear');
    }
  }
  getDevice(): WebGPUDevice {
    return this._device;
  }
  getFrameBufferInfo(): FrameBufferInfo {
    return this._frameBufferInfo;
  }
  begin(color?: TypedArray, depth?: number, stencil?: number): void {
    if (this.active) {
      console.error('WebGPURenderPass.begin() failed: begin() has already been called');
      return;
    }
    this._renderCommandEncoder = this._device.device.createCommandEncoder();
    if (!this._frameBuffer) {
      const fmt = textureFormatInvMap[this._device.backbufferFormat];
      this._frameBufferInfo = {
        colorFormats: [this._device.backbufferFormat],
        depthFormat: this._device.backbufferDepthFormat,
        sampleCount: this._device.sampleCount,
        hash: `${this._device.backbufferFormat}:${this._device.backbufferDepthFormat}:${this._device.sampleCount}`,
        clearHash: isIntegerTextureFormat(fmt) ? (isSignedTextureFormat(fmt) ? 'i' : 'u') : 'f'
      };
      const mainPassDesc = this._device.defaultRenderPassDesc;
      const colorAttachmentDesc = this._device.defaultRenderPassDesc.colorAttachments[0];
      if (this._frameBufferInfo.sampleCount > 1) {
        colorAttachmentDesc.resolveTarget = this._device.context.getCurrentTexture().createView();
      } else {
        colorAttachmentDesc.view = this._device.context.getCurrentTexture().createView();
      }
      colorAttachmentDesc.loadOp = color ? 'clear' : 'load';
      colorAttachmentDesc.clearValue = color;
      const depthAttachmentDesc = this._device.defaultRenderPassDesc.depthStencilAttachment;
      depthAttachmentDesc.depthLoadOp = typeof depth === 'number' ? 'clear' : 'load';
      depthAttachmentDesc.depthClearValue = depth;
      depthAttachmentDesc.stencilLoadOp = typeof stencil === 'number' ? 'clear' : 'load';
      depthAttachmentDesc.stencilClearValue = stencil;
      this._renderPassEncoder = this._renderCommandEncoder.beginRenderPass(mainPassDesc);
    } else {
      const colorAttachmentTextures = this._frameBuffer.getColorAttachments() as WebGPUBaseTexture[];
      const depthAttachmentTexture = this._frameBuffer.getDepthAttachment() as WebGPUBaseTexture;
      let depthTextureView: GPUTextureView;
      if (depthAttachmentTexture) {
        depthAttachmentTexture._markAsCurrentFB(true);
        const attachment = this._frameBuffer.getOptions().depthAttachment;
        const layer =
          depthAttachmentTexture.isTexture2DArray() || depthAttachmentTexture.isTexture3D()
            ? attachment.layer
            : depthAttachmentTexture.isTextureCube()
            ? attachment.face
            : 0;
        depthTextureView = depthAttachmentTexture.getView(0, layer ?? 0, 1);
      }
      this._frameBufferInfo = {
        colorFormats: colorAttachmentTextures.map((val) => val.gpuFormat),
        depthFormat: depthAttachmentTexture?.gpuFormat,
        sampleCount: this._frameBuffer.getOptions().sampleCount,
        hash: null,
        clearHash: colorAttachmentTextures
          .map((val) => {
            const fmt = textureFormatInvMap[val.gpuFormat];
            return isIntegerTextureFormat(fmt) ? (isSignedTextureFormat(fmt) ? 'i' : 'u') : 'f';
          })
          .join('')
      };
      this._frameBufferInfo.hash = `${this._frameBufferInfo.colorFormats.join('-')}:${
        this._frameBufferInfo.depthFormat
      }:${this._frameBufferInfo.sampleCount}`;
      this._fbBindFlag = this._frameBuffer.bindFlag;

      const passDesc: GPURenderPassDescriptor = {
        label: `customRenderPass:${this._frameBufferInfo.hash}`,
        colorAttachments:
          this._frameBuffer.getOptions().colorAttachments?.map((attachment, index) => {
            const tex = attachment.texture as WebGPUBaseTexture;
            if (tex) {
              tex._markAsCurrentFB(true);
              const layer =
                tex.isTexture2DArray() || tex.isTexture3D()
                  ? attachment.layer
                  : tex.isTextureCube()
                  ? attachment.face
                  : 0;
              if (this._frameBuffer.getOptions().sampleCount === 1) {
                return {
                  view: tex.getView(attachment.level ?? 0, layer ?? 0, 1),
                  loadOp: color ? 'clear' : 'load',
                  clearValue: color,
                  storeOp: 'store'
                } as GPURenderPassColorAttachment;
              } else {
                const msaaTexture = this._frameBuffer.getMSAAColorAttacments()[index];
                const msaaView = this._device.gpuCreateTextureView(msaaTexture, {
                  dimension: '2d',
                  baseMipLevel: attachment.level ?? 0,
                  mipLevelCount: 1,
                  baseArrayLayer: 0,
                  arrayLayerCount: 1
                });
                return {
                  view: msaaView,
                  resolveTarget: tex.getView(attachment.level ?? 0, layer ?? 0, 1),
                  loadOp: color ? 'clear' : 'load',
                  clearValue: color,
                  storeOp: 'store'
                } as GPURenderPassColorAttachment;
              }
            } else {
              return null;
            }
          }) ?? [],
        depthStencilAttachment: depthAttachmentTexture
          ? this._frameBuffer.getOptions().sampleCount === 1
            ? {
                view: depthTextureView,
                depthLoadOp: typeof depth === 'number' ? 'clear' : 'load',
                depthClearValue: depth,
                depthStoreOp: 'store',
                stencilLoadOp: hasStencilChannel(depthAttachmentTexture.format)
                  ? typeof stencil === 'number'
                    ? 'clear'
                    : 'load'
                  : undefined,
                stencilClearValue: stencil,
                stencilStoreOp: hasStencilChannel(depthAttachmentTexture.format) ? 'store' : undefined
              }
            : {
                view: this._frameBuffer.getMSAADepthAttachment().createView(),
                depthLoadOp: typeof depth === 'number' ? 'clear' : 'load',
                depthClearValue: depth,
                depthStoreOp: 'store',
                stencilLoadOp: hasStencilChannel(depthAttachmentTexture.format)
                  ? typeof stencil === 'number'
                    ? 'clear'
                    : 'load'
                  : undefined,
                stencilClearValue: stencil,
                stencilStoreOp: hasStencilChannel(depthAttachmentTexture.format) ? 'store' : undefined
              }
          : undefined
      };
      this._renderPassEncoder = this._renderCommandEncoder.beginRenderPass(passDesc);
    }
    this.setViewport(this._currentViewport);
    this.setScissor(this._currentScissor);
  }
  end() {
    const commands: GPUCommandBuffer[] = [];
    // upload the resources needed for this rendering pass
    if (this._bufferUploads.size > 0 || this._textureUploads.size > 0) {
      const uploadCommandEncoder = this._device.device.createCommandEncoder();
      this._bufferUploads.forEach((buffer) => buffer.beginSyncChanges(uploadCommandEncoder));
      this._textureUploads.forEach((tex) => tex.beginSyncChanges(uploadCommandEncoder));
      commands.push(uploadCommandEncoder.finish());
    }
    // finish current render pass command
    if (this._renderPassEncoder) {
      this._renderPassEncoder.end();
      this._renderPassEncoder = null;
    }
    // render commands
    if (this._renderCommandEncoder) {
      commands.push(this._renderCommandEncoder.finish());
      this._renderCommandEncoder = null;
    }
    // submit to GPU
    if (commands.length > 0) {
      this._device.device.queue.submit(commands);
    }
    // free up resource upload buffers
    this._bufferUploads.forEach((buffer) => buffer.endSyncChanges());
    this._textureUploads.forEach((tex) => tex.endSyncChanges());
    this._bufferUploads.clear();
    this._textureUploads.clear();

    // next pass uploading becomes current pass uploading
    [this._bufferUploads, this._bufferUploadsNext] = [this._bufferUploadsNext, this._bufferUploads];
    [this._textureUploads, this._textureUploadsNext] = [this._textureUploadsNext, this._textureUploads];

    // unmark render target flags and generate render target mipmaps if needed
    if (this._frameBuffer) {
      const options = this._frameBuffer.getOptions();
      if (options.colorAttachments) {
        for (const attachment of options.colorAttachments) {
          (attachment.texture as WebGPUBaseTexture)._markAsCurrentFB(false);
          if (attachment.generateMipmaps && attachment.texture.mipLevelCount > 1) {
            attachment.texture.generateMipmaps();
          }
        }
      }
      (options.depthAttachment?.texture as WebGPUBaseTexture)?._markAsCurrentFB(false);
    }
  }
  private drawInternal(
    renderPassEncoder: GPURenderPassEncoder,
    program: WebGPUProgram,
    vertexData: WebGPUVertexLayout,
    stateSet: WebGPURenderStateSet,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Iterable<number>[],
    primitiveType: PrimitiveType,
    first: number,
    count: number,
    numInstances: number
  ): void {
    if (this.setBindGroupsForRender(renderPassEncoder, program, vertexData, bindGroups, bindGroupOffsets)) {
      const pipeline = this._device.pipelineCache.fetchRenderPipeline(
        program,
        vertexData,
        stateSet,
        primitiveType,
        this._frameBufferInfo
      );
      if (pipeline) {
        renderPassEncoder.setPipeline(pipeline);
        const stencilState = stateSet?.stencilState;
        if (stencilState) {
          renderPassEncoder.setStencilReference(stencilState.ref);
        }
        if (vertexData) {
          const vertexBuffers = vertexData.getLayouts(program.vertexAttributes)?.buffers;
          vertexBuffers?.forEach((val, index) => {
            renderPassEncoder.setVertexBuffer(index, val.buffer.object as GPUBuffer, val.drawOffset);
          });
          const indexBuffer = vertexData.getIndexBuffer() as WebGPUIndexBuffer;
          if (indexBuffer) {
            renderPassEncoder.setIndexBuffer(
              indexBuffer.object,
              indexBuffer.indexType === typeU16 ? 'uint16' : 'uint32'
            );
            renderPassEncoder.drawIndexed(count, numInstances, first);
          } else {
            renderPassEncoder.draw(count, numInstances, first);
          }
        } else {
          renderPassEncoder.draw(count, numInstances, first);
        }
      }
    }
  }
  private validateDraw(
    program: WebGPUProgram,
    vertexData: WebGPUVertexLayout,
    bindGroups: WebGPUBindGroup[]
  ): number {
    let validation = 0;
    const bufferUploads: WebGPUBuffer[] = [];
    const textureUploads: WebGPUBaseTexture[] = [];
    if (bindGroups) {
      for (let i = 0; i < program.bindGroupLayouts.length; i++) {
        const bindGroup = bindGroups[i];
        if (bindGroup) {
          if (bindGroup.bindGroup) {
            for (const ubo of bindGroup.bufferList) {
              if (ubo.disposed) {
                validation |= VALIDATION_FAILED;
              }
              if (ubo.getPendingUploads().length > 0) {
                bufferUploads.push(ubo);
              }
            }
            for (const tex of bindGroup.textureList) {
              if (tex.disposed) {
                validation |= VALIDATION_FAILED;
              }
              if (tex._isMarkedAsCurrentFB()) {
                console.error('bind resource texture can not be current render target');
                validation |= VALIDATION_FAILED;
              }
              if (tex.isMipmapDirty()) {
                validation |= VALIDATION_NEED_GENERATE_MIPMAP;
              }
              if (tex.getPendingUploads().length > 0) {
                if (tex.isMipmapDirty()) {
                  this._textureUploads.add(tex);
                } else {
                  textureUploads.push(tex);
                }
              }
            }
          }
        } else {
          console.error(`Missing bind group (${i}) when drawing with program '${program.name}'`);
          return VALIDATION_FAILED;
        }
      }
    }
    const vertexBuffers = vertexData?.getLayouts(program.vertexAttributes)?.buffers;
    if (vertexBuffers) {
      for (const buffer of vertexBuffers) {
        if ((buffer.buffer as WebGPUStructuredBuffer).getPendingUploads().length > 0) {
          bufferUploads.push(buffer.buffer as WebGPUStructuredBuffer);
        }
      }
    }
    const indexBuffer = vertexData?.getIndexBuffer() as unknown as WebGPUBuffer;
    if (indexBuffer?.getPendingUploads().length > 0) {
      bufferUploads.push(indexBuffer);
    }
    if (this._frameBuffer && this._frameBuffer.bindFlag !== this._fbBindFlag) {
      validation |= VALIDATION_NEED_NEW_PASS;
    }
    const needNewPass = validation & VALIDATION_NEED_NEW_PASS || validation & VALIDATION_NEED_GENERATE_MIPMAP;
    if (bufferUploads.length > 0) {
      const bu = needNewPass ? this._bufferUploadsNext : this._bufferUploads;
      for (const buffer of bufferUploads) {
        bu.add(buffer);
      }
    }
    if (textureUploads.length > 0) {
      const tu = needNewPass ? this._textureUploadsNext : this._textureUploads;
      for (const tex of textureUploads) {
        tu.add(tex);
      }
    }
    return validation;
  }
  private setBindGroupsForRender(
    renderPassEncoder: GPURenderPassEncoder,
    program: WebGPUProgram,
    vertexData: WebGPUVertexLayout,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Iterable<number>[]
  ): boolean {
    if (bindGroups) {
      for (let i = 0; i < 4; i++) {
        if (i < program.bindGroupLayouts.length) {
          bindGroups[i].updateVideoTextures();
          const bindGroup = bindGroups[i].bindGroup;
          if (!bindGroup) {
            return false;
          }
          renderPassEncoder.setBindGroup(i, bindGroup, bindGroupOffsets?.[i] || undefined);
        } else {
          renderPassEncoder.setBindGroup(i, null);
        }
      }
    }
    return true;
  }
}
