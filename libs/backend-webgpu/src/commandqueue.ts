import type { Immutable, Nullable } from '@zephyr3d/base';
import { WebGPURenderPass } from './renderpass_webgpu';
import type { WebGPUIndirectDrawParams } from './renderpass_webgpu';
import { WebGPUComputePass } from './computepass_webgpu';
import type { PrimitiveType, DeviceViewport, FrameBufferClearColors } from '@zephyr3d/device';
import type { WebGPUDevice } from './device';
import type { WebGPUProgram } from './gpuprogram_webgpu';
import type { WebGPUVertexLayout } from './vertexlayout_webgpu';
import type { WebGPURenderStateSet } from './renderstates_webgpu';
import type { WebGPUBindGroup } from './bindgroup_webgpu';
import type { WebGPUFrameBuffer } from './framebuffer_webgpu';
import type { WebGPUBuffer } from './buffer_webgpu';
import type { WebGPUBaseTexture } from './basetexture_webgpu';
import { WebGPUMipmapGenerator } from './utils_webgpu';

/**
 * Records a frame into one command encoder, submitted at the end of the frame.
 *
 * Uploads are written to staging memory at once and copied to their buffers and textures later,
 * just before the next command that may read them: the copies of the uploads made since the last
 * command are recorded in one go, the pass open at the upload having been ended, so commands
 * recorded before an upload read the old contents and those after it the new ones. Several uploads
 * to a buffer between two commands merge into one copy.
 */
export class CommandQueueImmediate {
  protected _renderPass: WebGPURenderPass;
  protected _computePass: WebGPUComputePass;
  /** The encoder of the frame, made by the first command recorded */
  private _encoder: Nullable<GPUCommandEncoder>;
  /** Buffers and textures uploaded since the last command, copied before the next one */
  private _pendingBuffers: WebGPUBuffer[];
  private _pendingTextures: WebGPUBaseTexture[];
  private _buffersAwaitingSyncEnd: WebGPUBuffer[];
  private _texturesAwaitingSyncEnd: WebGPUBaseTexture[];
  private readonly _device: WebGPUDevice;
  private _drawcallCounter: number;
  private _readbackTempBuffers: GPUBuffer[];
  private _submitWaiters: Array<() => void>;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._encoder = null;
    this._pendingBuffers = [];
    this._pendingTextures = [];
    this._buffersAwaitingSyncEnd = [];
    this._texturesAwaitingSyncEnd = [];
    this._renderPass = new WebGPURenderPass(device);
    this._computePass = new WebGPUComputePass(device);
    this._drawcallCounter = 0;
    this._readbackTempBuffers = [];
    this._submitWaiters = [];
  }
  isBufferUploading(_buffer: WebGPUBuffer) {
    return false;
  }
  isTextureUploading(_tex: WebGPUBaseTexture) {
    return false;
  }
  hasActiveWork() {
    return (
      !!this._encoder ||
      this._pendingBuffers.length > 0 ||
      this._pendingTextures.length > 0 ||
      this._renderPass.active ||
      this._computePass.active ||
      this._drawcallCounter > 0
    );
  }
  getDrawcallCounter() {
    return this._drawcallCounter;
  }
  /** The encoder of the frame, to record a command into, with the uploads made so far copied */
  getEncoder() {
    this.flushPendingUploads();
    return this.getOrCreateEncoder();
  }
  flushUploads() {
    this.flushPendingUploads();
  }
  get currentPass(): Nullable<WebGPURenderPass | WebGPUComputePass> {
    return this._renderPass.active ? this._renderPass : this._computePass.active ? this._computePass : null;
  }
  beginFrame() {}
  endFrame() {
    this.submit();
  }
  flush() {
    this.submit();
  }
  setFramebuffer(fb: WebGPUFrameBuffer) {
    this._renderPass.setFramebuffer(fb);
  }
  getFramebuffer() {
    return this._renderPass.getFramebuffer();
  }
  getFramebufferInfo() {
    return this._renderPass.getFrameBufferInfo();
  }
  executeRenderBundle(renderBundle: GPURenderBundle) {
    this.flushPendingUploads();
    this.ensureRenderBodyReady();
    this._drawcallCounter++;
    this._renderPass.executeRenderBundle(renderBundle);
  }
  /**
   * Called before the staging memory of a buffer is written: the commands recorded so far must not
   * see the upload, so the open pass ends here, and the copy goes before the next command
   */
  bufferUpload(buffer: WebGPUBuffer, _offset: number, _size: number) {
    this.endAllBodyPasses();
    if (this._pendingBuffers.indexOf(buffer) < 0) {
      this._pendingBuffers.push(buffer);
    }
  }
  textureUpload(tex: WebGPUBaseTexture) {
    this.endAllBodyPasses();
    if (this._pendingTextures.indexOf(tex) < 0) {
      this._pendingTextures.push(tex);
    }
  }
  copyBuffer(
    srcBuffer: WebGPUBuffer,
    dstBuffer: WebGPUBuffer,
    srcOffset: number,
    dstOffset: number,
    bytes: number
  ) {
    this.endAllBodyPasses();
    const encoder = this.getEncoder();
    encoder.copyBufferToBuffer(srcBuffer.object!, srcOffset, dstBuffer.object!, dstOffset, bytes);
  }
  copyTexture(
    srcTexture: GPUTexture,
    dstTexture: GPUTexture,
    srcLevel: number,
    dstLevel: number,
    width: number,
    height: number,
    depthOrArrayLayers: number
  ) {
    this.endAllBodyPasses();
    const encoder = this.getEncoder();
    encoder.copyTextureToTexture(
      {
        texture: srcTexture,
        mipLevel: srcLevel,
        origin: { x: 0, y: 0, z: 0 }
      },
      {
        texture: dstTexture,
        mipLevel: dstLevel,
        origin: { x: 0, y: 0, z: 0 }
      },
      {
        width,
        height,
        depthOrArrayLayers
      }
    );
  }
  /**
   * Encode a texture/buffer readback copy into the current command stream so it is
   * submitted together with the rest of the frame instead of forcing an immediate,
   * standalone `queue.submit()`. Temporary buffers are destroyed after the next submit.
   */
  encodeReadback(encode: (encoder: GPUCommandEncoder) => void, tempBuffers?: GPUBuffer[]): void {
    this.endAllBodyPasses();
    const encoder = this.getEncoder();
    encode(encoder);
    if (tempBuffers) {
      for (const buffer of tempBuffers) {
        this._readbackTempBuffers.push(buffer);
      }
    }
  }
  /**
   * Resolve once everything recorded so far has been submitted. Used by readbacks
   * to guarantee the copy that fills a staging buffer has reached the GPU before
   * it is mapped.
   *
   * If nothing is pending the copy has already gone out with an earlier submit and
   * this resolves at once. That case is the normal one for a readback issued from a
   * frame-start callback: the caller records its copy, awaits, and the await's
   * continuation only runs after the frame's end-of-frame submit, so by the time
   * this is called the copy is long submitted. Waiting for the *next* submit here
   * would mean waiting for the following frame's end, which costs a whole frame
   * of readback latency for nothing.
   */
  onNextSubmit(): Promise<void> {
    if (!this.hasActiveWork()) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this._submitWaiters.push(resolve);
    });
  }
  compute(
    program: WebGPUProgram,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Nullable<Iterable<number>>[],
    workgroupCountX: number,
    workgroupCountY: number,
    workgroupCountZ: number
  ) {
    this.flushPendingUploads();
    this._drawcallCounter++;
    this.ensureComputeBodyReady();
    this._computePass.compute(
      program,
      bindGroups,
      bindGroupOffsets,
      workgroupCountX,
      workgroupCountY,
      workgroupCountZ
    );
  }
  computeIndirect(
    program: WebGPUProgram,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Nullable<Iterable<number>>[],
    indirectBuffer: WebGPUBuffer,
    indirectOffset: number
  ) {
    this.flushPendingUploads();
    this._drawcallCounter++;
    this.ensureComputeBodyReady();
    this._computePass.computeIndirect(program, bindGroups, bindGroupOffsets, indirectBuffer, indirectOffset);
  }
  draw(
    program: WebGPUProgram,
    vertexData: Nullable<WebGPUVertexLayout>,
    stateSet: WebGPURenderStateSet,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Nullable<Nullable<Iterable<number>>[]>,
    primitiveType: PrimitiveType,
    first: number,
    count: number,
    numInstances: number
  ) {
    this.flushPendingUploads();
    this.ensureRenderBodyReady();
    this._drawcallCounter++;
    this._renderPass.draw(
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
  drawIndirect(
    program: WebGPUProgram,
    vertexData: Nullable<WebGPUVertexLayout>,
    stateSet: WebGPURenderStateSet,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Nullable<Nullable<Iterable<number>>[]>,
    primitiveType: PrimitiveType,
    indirect: WebGPUIndirectDrawParams
  ) {
    this.flushPendingUploads();
    this.ensureRenderBodyReady();
    this._drawcallCounter++;
    this._renderPass.drawIndirect(
      program,
      vertexData,
      stateSet,
      bindGroups,
      bindGroupOffsets,
      primitiveType,
      indirect
    );
  }
  capture(
    renderBundleEncoder: GPURenderBundleEncoder,
    program: WebGPUProgram,
    vertexData: WebGPUVertexLayout,
    stateSet: WebGPURenderStateSet,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Nullable<Iterable<number>>[],
    primitiveType: PrimitiveType,
    first: number,
    count: number,
    numInstances: number
  ) {
    this.ensureRenderBodyReady();
    this._renderPass.capture(
      renderBundleEncoder,
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
  captureIndirect(
    renderBundleEncoder: GPURenderBundleEncoder,
    program: WebGPUProgram,
    vertexData: Nullable<WebGPUVertexLayout>,
    stateSet: WebGPURenderStateSet,
    bindGroups: WebGPUBindGroup[],
    bindGroupOffsets: Nullable<Nullable<Iterable<number>>[]>,
    primitiveType: PrimitiveType,
    indirect: WebGPUIndirectDrawParams
  ) {
    this.ensureRenderBodyReady();
    this._renderPass.captureIndirect(
      renderBundleEncoder,
      program,
      vertexData,
      stateSet,
      bindGroups,
      bindGroupOffsets,
      primitiveType,
      indirect
    );
  }
  setViewport(vp: Nullable<Immutable<number[] | DeviceViewport>>) {
    this._renderPass.setViewport(vp);
  }
  getViewport() {
    return this._renderPass.getViewport();
  }
  setScissor(scissor: Nullable<Immutable<number[] | DeviceViewport>>) {
    this._renderPass.setScissor(scissor);
  }
  getScissor() {
    return this._renderPass.getScissor();
  }
  clear(color: FrameBufferClearColors, depth: Nullable<number>, stencil: Nullable<number>) {
    this.flushPendingUploads();
    this.ensureRenderBodyReady();
    this._renderPass.clear(color, depth, stencil);
  }
  finish() {
    this.submit();
    return this._device.device.queue.onSubmittedWorkDone();
  }
  insertTimestampMarker(querySet: GPUQuerySet, queryIndex: number, includePendingUploads: boolean): void {
    this.endAllBodyPasses(false);
    // Without the pending uploads, the marker goes before their copies
    const encoder = includePendingUploads ? this.getEncoder() : this.getOrCreateEncoder();
    this.encodeTimestampMarker(encoder, querySet, queryIndex);
  }
  private getOrCreateEncoder() {
    if (!this._encoder) {
      this._encoder = this._device.device.createCommandEncoder();
    }
    return this._encoder;
  }
  private ensureRenderBodyReady() {
    if (this._computePass.active) {
      this._computePass.end();
    }
  }
  private ensureComputeBodyReady() {
    if (this._renderPass.active) {
      this._renderPass.end();
    }
  }
  flushDeferredMipmapsForBindGroups(bindGroups: WebGPUBindGroup[]): void {
    this._renderPass.flushDeferredMipmapsForBindGroups(bindGroups);
  }
  hasDeferredMipmapsForBindGroups(bindGroups: WebGPUBindGroup[]): boolean {
    return this._renderPass.hasDeferredMipmapsForBindGroups(bindGroups);
  }
  private endAllBodyPasses(generateMipmaps = true) {
    if (this._renderPass.active) {
      this._renderPass.end(generateMipmaps);
    }
    if (this._computePass.active) {
      this._computePass.end();
    }
  }
  private submit() {
    this.endAllBodyPasses();
    this._renderPass.flushDeferredMipmaps();
    this.flushPendingUploads();
    const commandBuffers: GPUCommandBuffer[] = [];
    if (this._encoder) {
      commandBuffers.push(this._encoder.finish());
      this._encoder = null;
    }
    const timestampResolveCommandBuffer = this._device.createTimestampResolveCommandBuffer();
    if (timestampResolveCommandBuffer) {
      commandBuffers.push(timestampResolveCommandBuffer);
    }
    if (commandBuffers.length > 0) {
      this._device.device.queue.submit(commandBuffers);
      this._device.onTimestampCommandBuffersSubmitted();
    }
    // Destroy readback staging buffers now that the copy commands referencing them have
    // been submitted (WebGPU keeps them alive until the GPU work completes).
    if (this._readbackTempBuffers.length > 0) {
      for (const buffer of this._readbackTempBuffers) {
        buffer.destroy();
      }
      this._readbackTempBuffers.length = 0;
    }
    // Notify readbacks waiting for their copy to be submitted before mapping.
    if (this._submitWaiters.length > 0) {
      const waiters = this._submitWaiters.splice(0);
      for (const resolve of waiters) {
        resolve();
      }
    }
    for (const buffer of this._buffersAwaitingSyncEnd) {
      buffer.endSyncChanges();
    }
    this._buffersAwaitingSyncEnd.length = 0;
    for (const texture of this._texturesAwaitingSyncEnd) {
      texture.endSyncChanges();
    }
    this._texturesAwaitingSyncEnd.length = 0;
    this._drawcallCounter = 0;
  }
  private encodeTimestampMarker(encoder: GPUCommandEncoder, querySet: GPUQuerySet, queryIndex: number): void {
    const pass = encoder.beginComputePass({
      label: `timestamp-marker:${queryIndex}`,
      timestampWrites: {
        querySet,
        beginningOfPassWriteIndex: queryIndex
      }
    } as GPUComputePassDescriptor);
    pass.end();
  }
  private markBufferAwaitingSyncEnd(buffer: WebGPUBuffer) {
    if (this._buffersAwaitingSyncEnd.indexOf(buffer) < 0) {
      this._buffersAwaitingSyncEnd.push(buffer);
    }
  }
  private markTextureAwaitingSyncEnd(texture: WebGPUBaseTexture) {
    if (this._texturesAwaitingSyncEnd.indexOf(texture) < 0) {
      this._texturesAwaitingSyncEnd.push(texture);
    }
  }
  /** Records the copies of the uploads made since the last command */
  private flushPendingUploads() {
    if (this._pendingBuffers.length === 0 && this._pendingTextures.length === 0) {
      return;
    }
    // Taken first: ending a pass may generate mipmaps, which records commands and comes back here
    const buffers = this._pendingBuffers.splice(0);
    const textures = this._pendingTextures.splice(0);
    this.endAllBodyPasses();
    const encoder = this.getOrCreateEncoder();
    for (const buffer of buffers) {
      buffer.beginSyncChanges(encoder);
      this.markBufferAwaitingSyncEnd(buffer);
    }
    for (const texture of textures) {
      texture.beginSyncChanges(encoder);
      if (!texture.disposed && texture.isMipmapDirty()) {
        WebGPUMipmapGenerator.generateMipmap(this._device, texture, encoder);
      }
      this.markTextureAwaitingSyncEnd(texture);
    }
  }
}
