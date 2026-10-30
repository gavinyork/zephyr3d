import { primitiveTypeMap } from './constants_webgpu';
import type { PipelineCacheStats, PrimitiveType } from '@zephyr3d/device';
import { PBPrimitiveTypeInfo, PBPrimitiveType } from '@zephyr3d/device';
import * as rs from './renderstates_webgpu';
import type { WebGPUVertexLayout } from './vertexlayout_webgpu';
import type { WebGPUProgram } from './gpuprogram_webgpu';
import type { WebGPUDevice } from './device';
import type { WebGPURenderStateSet } from './renderstates_webgpu';
import type { WebGPUFrameBuffer } from './framebuffer_webgpu';
import type { Nullable } from '@zephyr3d/base';
import { hashString } from './content_hash';

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
  /** Whether the target is the canvas, whose formats differ between devices */
  backbuffer?: boolean;
};

/**
 * A render pipeline as stored in a pipeline cache file: the parts of its key that are
 * the same in every session, and the descriptor without the objects of this session
 * @internal
 */
export type WebGPURenderPipelineRecord = {
  /** Content hash of the program */
  program: string;
  /** Source hashes of the vertex and fragment stages */
  vs: string;
  fs: string;
  /** Hashes of the bind group layouts */
  layouts: string[];
  /** Vertex buffer layouts, empty for pipelines without vertex buffers */
  vertex: string;
  colors: GPUTextureFormat[];
  /** Depth format, empty for targets without depth */
  depth: string;
  samples: number;
  /** Drawn to the canvas: formats and sample count are those of the device it is compiled on */
  backbuffer: boolean;
  primitiveType: PrimitiveType;
  /** Content of the render states */
  state: string;
  winding: number;
  vertexBuffers: Nullable<GPUVertexBufferLayout[]>;
  primitive: GPUPrimitiveState;
  depthStencil?: GPUDepthStencilState;
  multisample: GPUMultisampleState;
  targets: GPUColorTargetState[];
};

/** @internal */
export type WebGPUComputePipelineRecord = {
  /** Content hash of the program */
  program: string;
  /** Source hash of the compute stage */
  cs: string;
  /** Hashes of the bind group layouts */
  layouts: string[];
};

type RenderPipelineEntry = {
  pipeline: GPURenderPipeline;
  /** Key of the pipeline in every session */
  key: string;
  record: WebGPURenderPipelineRecord;
  /** Compiled ahead of time; used once a draw asked for it */
  precompiled?: boolean;
  used?: boolean;
};

type ComputePipelineEntry = {
  pipeline: GPUComputePipeline;
  key: string;
  record: WebGPUComputePipelineRecord;
  precompiled?: boolean;
  used?: boolean;
};

/** Programs of pipelines compiled on demand that the stats keep */
const MAX_ON_DEMAND_PROGRAMS = 256;

/** @internal */
export function getFrameBufferContentHash(
  colors: GPUTextureFormat[],
  depth: Nullable<string> | undefined,
  samples: number
) {
  return `${colors.join('-')}:${depth ?? ''}:${samples}`;
}

/** @internal */
export function getRenderPipelineContentHash(
  program: string,
  vertex: string,
  frameBuffer: string,
  primitiveType: PrimitiveType,
  stripIndexFormat: Nullable<string> | undefined,
  state: string,
  winding: number
) {
  return `${program}:${vertex}:${frameBuffer}:${primitiveType}${stripIndexFormat ? `/${stripIndexFormat}` : ''}:${state}:${winding}`;
}

/**
 * Index format a pipeline has to name: an indexed draw with a strip topology fails
 * unless the pipeline names the format of the index buffer it draws with, which comes
 * with the vertex data whether or not the program reads vertex attributes
 */
function getStripIndexFormat(
  vertexData: Nullable<WebGPUVertexLayout>,
  primitiveType: PrimitiveType
): GPUIndexFormat | undefined {
  const topology = primitiveTypeMap[primitiveType];
  if (topology !== 'triangle-strip' && topology !== 'line-strip') {
    return undefined;
  }
  const indexBuffer = vertexData?.getIndexBuffer();
  return indexBuffer ? (indexBuffer.indexType === typeU16 ? 'uint16' : 'uint32') : undefined;
}

/**
 * Caches the pipelines draws and dispatches ask for.
 *
 * @remarks
 * Each pipeline is looked up by a key built from objects of this session, cheap to
 * build on every draw but different in every session, and the first time a key is
 * seen by a key built from what the objects contain: pipelines are only created when
 * that second key is new too, so programs or states that are made again, or a
 * pipeline compiled ahead of time from a recording, are shared.
 */
export class PipelineCache {
  private readonly _device: WebGPUDevice;
  private _renderPipelines: Record<string, RenderPipelineEntry>;
  private _computePipelines: Record<string, ComputePipelineEntry>;
  private _renderPipelinesByContent: Map<string, RenderPipelineEntry>;
  private _computePipelinesByContent: Map<string, ComputePipelineEntry>;
  private readonly _stats: PipelineCacheStats;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._renderPipelines = {};
    this._computePipelines = {};
    this._renderPipelinesByContent = new Map();
    this._computePipelinesByContent = new Map();
    this._stats = { precompiled: 0, precompiledUsed: 0, onDemand: 0, onDemandPrograms: [] };
  }
  wipeCache() {
    this._renderPipelines = {};
    this._computePipelines = {};
    this._renderPipelinesByContent = new Map();
    this._computePipelinesByContent = new Map();
  }
  getStats(): PipelineCacheStats {
    return { ...this._stats, onDemandPrograms: [...this._stats.onDemandPrograms] };
  }
  /** Whether a render pipeline of a content key is compiled */
  hasRenderPipeline(key: string) {
    return this._renderPipelinesByContent.has(key);
  }
  hasComputePipeline(key: string) {
    return this._computePipelinesByContent.has(key);
  }
  /** Adds a pipeline compiled ahead of time, unless a draw compiled it meanwhile */
  addPrecompiledRenderPipeline(key: string, pipeline: GPURenderPipeline, record: WebGPURenderPipelineRecord) {
    if (!this._renderPipelinesByContent.has(key)) {
      this._renderPipelinesByContent.set(key, { pipeline, key, record, precompiled: true, used: false });
      this._stats.precompiled++;
    }
  }
  addPrecompiledComputePipeline(
    key: string,
    pipeline: GPUComputePipeline,
    record: WebGPUComputePipelineRecord
  ) {
    if (!this._computePipelinesByContent.has(key)) {
      this._computePipelinesByContent.set(key, { pipeline, key, record, precompiled: true, used: false });
      this._stats.precompiled++;
    }
  }
  private markUsed(entry: RenderPipelineEntry | ComputePipelineEntry) {
    if (entry.precompiled && !entry.used) {
      entry.used = true;
      this._stats.precompiledUsed++;
    }
  }
  private countOnDemand(program: WebGPUProgram) {
    this._stats.onDemand++;
    const programs = this._stats.onDemandPrograms;
    programs.push(program.name || program.label);
    if (programs.length > MAX_ON_DEMAND_PROGRAMS) {
      programs.shift();
    }
  }
  fetchComputePipeline(program: WebGPUProgram) {
    const hash = this.getComputePipelineHash(program);
    let entry = this._computePipelines[hash];
    if (entry === undefined) {
      entry = this.resolveComputePipeline(program);
      this._computePipelines[hash] = entry;
    }
    const recorder = this._device.pipelineRecorder;
    if (recorder.recording) {
      recorder.recordCompute(entry.key, entry.record, program);
    }
    return entry.pipeline;
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
    const stripIndexFormat = getStripIndexFormat(vertexData, primitiveType);
    const hash = this.getRenderPipelineHash(
      frameBufferInfo.hash,
      program,
      vertexLayout,
      stateSet,
      primitiveType,
      stripIndexFormat
    );
    let entry = this._renderPipelines[hash];
    if (entry === undefined) {
      entry = this.resolveRenderPipeline(
        program,
        vertexLayout,
        stateSet,
        primitiveType,
        stripIndexFormat,
        frameBufferInfo
      );
      this._renderPipelines[hash] = entry;
    }
    const recorder = this._device.pipelineRecorder;
    if (recorder.recording) {
      recorder.recordRender(entry.key, entry.record, program);
    }
    return entry.pipeline;
  }
  private resolveComputePipeline(program: WebGPUProgram): ComputePipelineEntry {
    const content = program.getContent();
    const key = content.hash;
    let entry = this._computePipelinesByContent.get(key);
    if (entry) {
      this.markUsed(entry);
    } else {
      this.countOnDemand(program);
      const shaderModule = program.getShaderModule();
      const desc: GPUComputePipelineDescriptor = {
        layout: shaderModule.pipelineLayout,
        compute: {
          module: shaderModule.csModule,
          entryPoint: 'main'
        }
      };
      entry = {
        pipeline: this._device.gpuCreateComputePipeline(desc),
        key,
        record: {
          program: content.hash,
          cs: content.cs,
          layouts: content.layouts.map((layout) => hashString(layout))
        }
      };
      this._computePipelinesByContent.set(key, entry);
    }
    return entry;
  }
  private resolveRenderPipeline(
    program: WebGPUProgram,
    vertexLayout: Nullable<WebGPUVertexLayout>,
    stateSet: WebGPURenderStateSet,
    primitiveType: PrimitiveType,
    stripIndexFormat: GPUIndexFormat | undefined,
    frameBufferInfo: FrameBufferInfo
  ): RenderPipelineEntry {
    const content = program.getContent();
    const vertexHash = vertexLayout?.getLayouts(program.vertexAttributes)?.layoutHash || '';
    const stateHash = stateSet?.contentHash || '';
    const winding = Number(this._device.isWindingOrderReversed());
    const key = getRenderPipelineContentHash(
      content.hash,
      vertexHash,
      getFrameBufferContentHash(
        frameBufferInfo.colorFormats,
        frameBufferInfo.depthFormat,
        frameBufferInfo.sampleCount
      ),
      primitiveType,
      stripIndexFormat,
      stateHash,
      winding
    );
    let entry = this._renderPipelinesByContent.get(key);
    if (entry) {
      this.markUsed(entry);
    } else {
      this.countOnDemand(program);
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
      const primitiveState = this.createPrimitiveState(stateSet, primitiveType, stripIndexFormat);
      const depthStencilState = this.createDepthStencilState(frameBufferInfo.depthFormat, stateSet);
      const colorTargetStates = frameBufferInfo.colorFormats.map((val, index) =>
        this.createColorTargetState(stateSet, val, index)
      );
      const multisampleState = this.createMultisampleState(frameBufferInfo.sampleCount, stateSet);
      const desc: GPURenderPipelineDescriptor = {
        label: key,
        layout: shaderModule.pipelineLayout,
        vertex,
        primitive: primitiveState,
        depthStencil: depthStencilState,
        multisample: multisampleState,
        fragment: {
          module: shaderModule.fsModule,
          entryPoint: 'main',
          targets: colorTargetStates
        }
      };
      // The states are shared and may change later: the record keeps a copy
      const parts = JSON.parse(
        JSON.stringify({
          vertexBuffers: bufferLayouts ?? null,
          primitive: primitiveState,
          depthStencil: depthStencilState,
          multisample: multisampleState,
          targets: colorTargetStates
        })
      );
      entry = {
        pipeline: this._device.gpuCreateRenderPipeline(desc),
        key,
        record: {
          program: content.hash,
          vs: content.vs,
          fs: content.fs,
          layouts: content.layouts.map((layout) => hashString(layout)),
          vertex: vertexHash,
          colors: [...frameBufferInfo.colorFormats],
          depth: frameBufferInfo.depthFormat ?? '',
          samples: frameBufferInfo.sampleCount,
          backbuffer: !!frameBufferInfo.backbuffer,
          primitiveType,
          state: stateHash,
          winding,
          ...parts
        }
      };
      this._renderPipelinesByContent.set(key, entry);
    }
    return entry;
  }
  private createPrimitiveState(
    stateSet: WebGPURenderStateSet,
    primitiveType: PrimitiveType,
    stripIndexFormat: GPUIndexFormat | undefined
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
    if (stripIndexFormat) {
      state.stripIndexFormat = stripIndexFormat;
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
    primitiveType: PrimitiveType,
    stripIndexFormat: GPUIndexFormat | undefined
  ) {
    const programHash = program.hash;
    const vertexHash = vertexData?.getLayouts(program.vertexAttributes)?.layoutHash || '';
    const stateHash = stateSet?.hash || '';
    return `${programHash}:${vertexHash}:${fbHash}:${primitiveType}${
      stripIndexFormat ? `/${stripIndexFormat}` : ''
    }:${stateHash}:${Number(this._device.isWindingOrderReversed())}`;
  }
  private getComputePipelineHash(program: WebGPUProgram) {
    return program.hash;
  }
}
