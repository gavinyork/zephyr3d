import { primitiveTypeMap } from './constants_webgpu';
import type { PrimitiveType } from '@zephyr3d/device';
import { PBPrimitiveTypeInfo, PBPrimitiveType } from '@zephyr3d/device';
import * as rs from './renderstates_webgpu';
import type { WebGPUVertexLayout } from './vertexlayout_webgpu';
import type { WebGPUProgram } from './gpuprogram_webgpu';
import type { WebGPUDevice } from './device';
import type { WebGPURenderStateSet } from './renderstates_webgpu';
import type { WebGPUFrameBuffer } from './framebuffer_webgpu';
import type { Nullable } from '@zephyr3d/base';

const typeU16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
const stencilFormats = ['stencil8', 'depth24plus-stencil8', 'depth24unorm-stencil8', 'depth32float-stencil8'];
const depthFormats = [
  'depth16unorm',
  'depth24plus',
  'depth24plus-stencil8',
  'depth32float',
  'depth24unorm-stencil8',
  'depth32float-stencil8'
];
export type FrameBufferInfo = {
  frameBuffer: Nullable<WebGPUFrameBuffer>;
  colorFormats: GPUTextureFormat[];
  depthFormat?: GPUTextureFormat;
  sampleCount: number;
  hash: Nullable<string>;
  clearHash: string;
};

export class PipelineCache {
  private readonly _device: WebGPUDevice;
  private _renderPipelines: Record<string, GPURenderPipeline>;
  private _computePipelines: Record<string, GPUComputePipeline>;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._renderPipelines = {};
    this._computePipelines = {};
  }
  wipeCache() {
    this._renderPipelines = {};
    this._computePipelines = {};
  }
  fetchComputePipeline(program: WebGPUProgram) {
    const hash = this.getComputePipelineHash(program);
    let pipeline = this._computePipelines[hash];
    if (pipeline === undefined) {
      const shaderModule = program.getShaderModule();
      const desc: GPUComputePipelineDescriptor = {
        layout: shaderModule.pipelineLayout,
        compute: {
          module: shaderModule.csModule,
          entryPoint: 'main'
        }
      };
      pipeline = this._device.gpuCreateComputePipeline(desc);
      this._computePipelines[hash] = pipeline;
    }
    return pipeline;
  }
  fetchRenderPipeline(
    program: WebGPUProgram,
    vertexData: Nullable<WebGPUVertexLayout>,
    stateSet: WebGPURenderStateSet,
    primitiveType: PrimitiveType,
    frameBufferInfo: FrameBufferInfo
  ) {
    if (!frameBufferInfo.hash) {
      return null;
    }
    const vertexLayout = program.vertexAttributes ? vertexData : null;
    const hash = this.getRenderPipelineHash(
      frameBufferInfo.hash,
      program,
      vertexLayout,
      stateSet,
      primitiveType
    );
    let pipeline = this._renderPipelines[hash];
    if (pipeline === undefined) {
      const bufferLayouts = vertexLayout
        ? this._device.fetchVertexLayout(vertexLayout.getLayouts(program.vertexAttributes)!.layoutHash)
        : null;
      const shaderModule = program.getShaderModule();
      const vertex: GPUVertexState = {
        module: shaderModule.vsModule,
        entryPoint: 'main'
      };
      if (bufferLayouts) {
        vertex.buffers = bufferLayouts;
      }
      const primitiveState = this.createPrimitiveState(vertexLayout, stateSet, primitiveType);
      const depthStencilState = this.createDepthStencilState(frameBufferInfo.depthFormat, stateSet);
      const colorTargetStates = frameBufferInfo.colorFormats.map((val, index) =>
        this.createColorTargetState(stateSet, val, index)
      );
      const desc: GPURenderPipelineDescriptor = {
        label: hash,
        layout: shaderModule.pipelineLayout,
        vertex,
        primitive: primitiveState,
        depthStencil: depthStencilState,
        multisample: this.createMultisampleState(frameBufferInfo.sampleCount, stateSet),
        fragment: {
          module: shaderModule.fsModule,
          entryPoint: 'main',
          targets: colorTargetStates
        }
      };
      pipeline = this._device.gpuCreateRenderPipeline(desc);
      this._renderPipelines[hash] = pipeline;
    }
    return pipeline;
  }
  private createPrimitiveState(
    vertexData: Nullable<WebGPUVertexLayout>,
    stateSet: WebGPURenderStateSet,
    primitiveType: PrimitiveType
  ) {
    const topology = primitiveTypeMap[primitiveType];
    if (!topology) {
      throw new Error(`createPrimitiveState() failed: invalid primitive type: ${primitiveType}`);
    }
    const rasterizerState = (
      stateSet?.rasterizerState || (rs.WebGPURasterizerState.defaultState as rs.WebGPURasterizerState)
    ).internalState.internal;
    const frontFace = this._device.isWindingOrderReversed() ? 'cw' : 'ccw';
    const state: GPUPrimitiveState = {
      topology,
      frontFace,
      cullMode: rasterizerState.cullMode
    };
    if (this._device.device.features.has('depth-clip-control')) {
      state.unclippedDepth = rasterizerState.unclippedDepth;
    }
    if (topology === 'triangle-strip' || topology === 'line-strip') {
      state.stripIndexFormat = vertexData?.getIndexBuffer()?.indexType === typeU16 ? 'uint16' : 'uint32';
    }
    return state;
  }
  private createMultisampleState(sampleCount: number, stateSet: WebGPURenderStateSet) {
    return {
      count: sampleCount,
      alphaToCoverageEnabled: sampleCount > 1 && !!stateSet?.alphaToCoverageEnabled
    };
  }
  private createDepthStencilState(depthFormat: GPUTextureFormat | undefined, stateSet: WebGPURenderStateSet) {
    if (!depthFormat) {
      return undefined;
    }
    const depthState = (stateSet?.depthState ?? (rs.WebGPUDepthState.defaultState as rs.WebGPUDepthState))
      .internalState.internal;
    const stencilState = (
      stateSet?.stencilState ?? (rs.WebGPUStencilState.defaultState as rs.WebGPUStencilState)
    ).internalState.internal;
    const hasStencil = stencilFormats.indexOf(depthFormat) >= 0;
    const hasDepth = depthFormats.indexOf(depthFormat) >= 0;
    const depthWriteEnabled = hasDepth ? depthState.depthWriteEnabled : false;
    const depthCompare: GPUCompareFunction = hasDepth ? depthState.depthCompare! : 'always';
    const state: GPUDepthStencilState = {
      format: depthFormat,
      depthWriteEnabled,
      depthCompare,
      depthBias: depthState.depthBias,
      depthBiasSlopeScale: depthState.depthBiasSlopeScale
    };
    if (hasStencil) {
      state.stencilFront = stencilState.stencilFront;
      state.stencilBack = stencilState.stencilBack;
      state.stencilReadMask = stencilState.stencilReadMask;
      state.stencilWriteMask = stencilState.stencilWriteMask;
    }
    return state;
  }
  private createColorTargetState(
    stateSet: WebGPURenderStateSet,
    format: GPUTextureFormat,
    targetIndex: number
  ) {
    const blendingState = (
      stateSet?.getBlendingStateForTarget(targetIndex) ??
      (rs.WebGPUBlendingState.defaultState as rs.WebGPUBlendingState)
    ).internalState.internal;
    const colorState = (
      stateSet?.getColorStateForTarget(targetIndex) ??
      (rs.WebGPUColorState.defaultState as rs.WebGPUColorState)
    ).internalState.internal;
    const state: GPUColorTargetState = {
      format: format,
      writeMask: colorState,
      blend: blendingState
    };
    return state;
  }
  private getRenderPipelineHash(
    fbHash: string,
    program: WebGPUProgram,
    vertexData: Nullable<WebGPUVertexLayout>,
    stateSet: WebGPURenderStateSet,
    primitiveType: PrimitiveType
  ) {
    const programHash = program.hash;
    const vertexHash = vertexData?.getLayouts(program.vertexAttributes)?.layoutHash || '';
    const stateHash = stateSet?.hash || '';
    return `${programHash}:${vertexHash}:${fbHash}:${primitiveType}:${stateHash}:${Number(
      this._device.isWindingOrderReversed()
    )}`;
  }
  private getComputePipelineHash(program: WebGPUProgram) {
    return program.hash;
  }
}
