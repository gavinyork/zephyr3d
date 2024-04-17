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
import type { WebGPUBaseTexture } from './basetexture_webgpu';
import type { WebGPUDevice } from './device';
import type { WebGPUFrameBuffer } from './framebuffer_webgpu';
import type { WebGPUVertexLayout } from './vertexlayout_webgpu';
import type { WebGPUIndexBuffer } from './indexbuffer_webgpu';
import type { FrameBufferInfo } from './pipeline_cache';
import { textureFormatInvMap } from './constants_webgpu';
import { WebGPUClearQuad } from './utils_webgpu';

const VALIDATION_NEED_NEW_PASS = 1 << 0;
const VALIDATION_FAILED = 1 << 1;

const typeU16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);

export class WebGPURenderPass {
  private _device: WebGPUDevice;
  private _renderCommandEncoder: GPUCommandEncoder;
  private _renderPassEncoder: GPURenderPassEncoder;
  private _fbBindFlag: number;
  private _currentViewport: DeviceViewport;
  private _currentScissor: DeviceViewport;
  private _frameBufferInfo: FrameBufferInfo;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._renderCommandEncoder = this._device.device.createCommandEncoder();
    this._renderPassEncoder = null;
    this._fbBindFlag = null;
    this._currentViewport = null;
    this._currentScissor = null;
    this._frameBufferInfo = this.createFrameBufferInfo(null);
  }
  get active(): boolean {
    return !!this._renderPassEncoder;
  }
  private createFrameBufferInfo(fb: WebGPUFrameBuffer): FrameBufferInfo {
    const info: FrameBufferInfo = !fb ? {
      frameBuffer: null,
      colorFormats: [this._device.backbufferFormat],
      depthFormat: this._device.backbufferDepthFormat,
      sampleCount: this._device.sampleCount,
      hash: null,
      clearHash: 'f'
    } : {
      frameBuffer: fb,
      colorFormats: fb.getColorAttachments().map((val) => (val as WebGPUBaseTexture).gpuFormat),
      depthFormat: (fb.getDepthAttachment() as WebGPUBaseTexture)?.gpuFormat,
      sampleCount: fb.getOptions().sampleCount,
      hash: null,
      clearHash: fb.getColorAttachments()
        .map((val) => {
          const fmt = textureFormatInvMap[(val as WebGPUBaseTexture).gpuFormat];
          return isIntegerTextureFormat(fmt) ? (isSignedTextureFormat(fmt) ? 'i' : 'u') : 'f';
        })
        .join('')
    };
    info.hash = `${info.colorFormats.join('-')}:${info.depthFormat}:${info.sampleCount}`;
    return info;
  }
  setFramebuffer(fb: WebGPUFrameBuffer): void {
    if (this._frameBufferInfo.frameBuffer !== fb) {
      this.end();
      this._frameBufferInfo = this.createFrameBufferInfo(fb);
      this.setViewport(null);
      this.setScissor(null);
    }
  }
  getFramebuffer(): WebGPUFrameBuffer {
    return this._frameBufferInfo.frameBuffer;
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
  executeRenderBundle(renderBundle: GPURenderBundle) {
    if (!this.active) {
      this.begin();
    }
    this._renderPassEncoder.executeBundles([renderBundle]);
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
    const validation = this.validateDraw(program, bindGroups);
    if (validation & VALIDATION_FAILED) {
      return;
    }
    if (validation & VALIDATION_NEED_NEW_PASS) {
      this.end();
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
    const frameBuffer = this._frameBufferInfo.frameBuffer;
    if (!frameBuffer) {
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
      const depthAttachmentTexture = frameBuffer.getDepthAttachment() as WebGPUBaseTexture;
      let depthTextureView: GPUTextureView;
      if (depthAttachmentTexture) {
        depthAttachmentTexture._markAsCurrentFB(true);
        const attachment = frameBuffer.getOptions().depthAttachment;
        const layer =
          depthAttachmentTexture.isTexture2DArray() || depthAttachmentTexture.isTexture3D()
            ? attachment.layer
            : depthAttachmentTexture.isTextureCube()
            ? attachment.face
            : 0;
        depthTextureView = depthAttachmentTexture.getView(0, layer ?? 0, 1);
      }
      this._fbBindFlag = frameBuffer.bindFlag;

      const passDesc: GPURenderPassDescriptor = {
        label: `customRenderPass:${this._frameBufferInfo.hash}`,
        colorAttachments:
          frameBuffer.getOptions().colorAttachments?.map((attachment, index) => {
            const tex = attachment.texture as WebGPUBaseTexture;
            if (tex) {
              tex._markAsCurrentFB(true);
              const layer =
                tex.isTexture2DArray() || tex.isTexture3D()
                  ? attachment.layer
                  : tex.isTextureCube()
                  ? attachment.face
                  : 0;
              if (frameBuffer.getOptions().sampleCount === 1) {
                return {
                  view: tex.getView(attachment.level ?? 0, layer ?? 0, 1),
                  loadOp: color ? 'clear' : 'load',
                  clearValue: color,
                  storeOp: 'store'
                } as GPURenderPassColorAttachment;
              } else {
                const msaaTexture = frameBuffer.getMSAAColorAttacments()[index];
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
          ? frameBuffer.getOptions().sampleCount === 1
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
                view: frameBuffer.getMSAADepthAttachment().createView(),
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
    // finish current render pass command
    if (this._renderPassEncoder) {
      this._renderPassEncoder.end();
      this._renderPassEncoder = null;
    }
    // render commands
    if (this._renderCommandEncoder) {
      this._device.device.queue.submit([
        this._renderCommandEncoder.finish()
      ]);
      this._renderCommandEncoder = null;
    }
  // unmark render target flags and generate render target mipmaps if needed
    if (this._frameBufferInfo.frameBuffer) {
      const options = this._frameBufferInfo.frameBuffer.getOptions();
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
  capture(
    renderBundleEncoder: GPURenderBundleEncoder,
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
      numInstances,
      renderBundleEncoder
    );
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
    numInstances: number,
    renderBundleEncoder?: GPURenderBundleEncoder
  ): void {
    if (this.setBindGroupsForRender(renderPassEncoder, program, bindGroups, bindGroupOffsets, renderBundleEncoder)) {
      const pipeline = this._device.pipelineCache.fetchRenderPipeline(
        program,
        vertexData,
        stateSet,
        primitiveType,
        this._frameBufferInfo
      );
      if (pipeline) {
        renderPassEncoder.setPipeline(pipeline);
        renderBundleEncoder?.setPipeline(pipeline);
        const stencilState = stateSet?.stencilState;
        if (stencilState) {
          renderPassEncoder.setStencilReference(stencilState.ref);
        }
        if (vertexData) {
          const vertexBuffers = vertexData.getLayouts(program.vertexAttributes)?.buffers;
          vertexBuffers?.forEach((val, index) => {
            renderPassEncoder.setVertexBuffer(index, val.buffer.object as GPUBuffer, val.drawOffset);
            renderBundleEncoder?.setVertexBuffer(index, val.buffer.object as GPUBuffer, val.drawOffset);
          });
          const indexBuffer = vertexData.getIndexBuffer() as WebGPUIndexBuffer;
          if (indexBuffer) {
            renderPassEncoder.setIndexBuffer(
              indexBuffer.object,
              indexBuffer.indexType === typeU16 ? 'uint16' : 'uint32'
            );
            renderBundleEncoder?.setIndexBuffer(
              indexBuffer.object,
              indexBuffer.indexType === typeU16 ? 'uint16' : 'uint32'
            )
            renderPassEncoder.drawIndexed(count, numInstances, first);
            renderBundleEncoder?.drawIndexed(count, numInstances, first);
          } else {
            renderPassEncoder.draw(count, numInstances, first);
            renderBundleEncoder?.draw(count, numInstances, first);
          }
        } else {
          renderPassEncoder.draw(count, numInstances, first);
          renderBundleEncoder?.draw(count, numInstances, first);
        }
      }
    }
  }
  private validateDraw(
    program: WebGPUProgram,
    bindGroups: WebGPUBindGroup[]
  ): number {
    let validation = 0;
    if (bindGroups) {
      for (let i = 0; i < program.bindGroupLayouts.length; i++) {
        const bindGroup = bindGroups[i];
        if (bindGroup) {
          if (bindGroup.bindGroup) {
            for (const ubo of bindGroup.bufferList) {
              if (ubo.disposed) {
                validation |= VALIDATION_FAILED;
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
            }
          }
        } else {
          console.error(`Missing bind group (${i}) when drawing with program '${program.name}'`);
          return VALIDATION_FAILED;
        }
      }
    }
    if (this._frameBufferInfo.frameBuffer && this._frameBufferInfo.frameBuffer.bindFlag !== this._fbBindFlag) {
      validation |= VALIDATION_NEED_NEW_PASS;
    }
    return validation;
  }
  private setBindGroupsForRender(
    renderPassEncoder: GPURenderPassEncoder,
    program: WebGPUProgram,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Iterable<number>[],
    renderBundleEncoder?: GPURenderBundleEncoder
  ): boolean {
    if (bindGroups) {
      for (let i = 0; i < 4; i++) {
        if (i < program.bindGroupLayouts.length) {
          const bindGroup = bindGroups[i].bindGroup;
          if (!bindGroup) {
            return false;
          }
          const bindGroupOffset = bindGroups[i].getDynamicOffsets() ?? bindGroupOffsets?.[i];
          if (bindGroupOffset) {
            renderPassEncoder.setBindGroup(i, bindGroup, bindGroupOffset);
            renderBundleEncoder?.setBindGroup(i, bindGroup, bindGroupOffset);
          } else {
            renderPassEncoder.setBindGroup(i, bindGroup);
            renderBundleEncoder?.setBindGroup(i, bindGroup);
          }
        } else {
          renderPassEncoder.setBindGroup(i, this._device.emptyBindGroup);
          renderBundleEncoder?.setBindGroup(i, this._device.emptyBindGroup);
        }
      }
    }
    return true;
  }
}
