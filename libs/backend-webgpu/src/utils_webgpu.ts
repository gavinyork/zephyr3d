import { Vector4 } from '@zephyr3d/base';
import type { WebGPUProgram } from './gpuprogram_webgpu';
import type { WebGPUBaseTexture } from './basetexture_webgpu';
import type { WebGPUBindGroup } from './bindgroup_webgpu';
import type { WebGPURenderStateSet } from './renderstates_webgpu';
import type { WebGPUDevice } from './device';
import type { FrameBufferInfo } from './pipeline_cache';
import type { WebGPURenderPass } from './renderpass_webgpu';

export class WebGPUClearQuad {
  private static _clearPrograms: { [hash: string]: { program: WebGPUProgram; bindGroup: WebGPUBindGroup } } =
    {};
  private static readonly _clearBindGroup: WebGPUBindGroup = null;
  private static _clearStateSet: WebGPURenderStateSet = null;
  private static readonly _defaultClearColor = new Vector4(0, 0, 0, 1);

  static drawClearQuad(
    renderPass: WebGPURenderPass,
    clearColor: Float32Array<ArrayBuffer>,
    clearDepth: number,
    clearStencil: number
  ) {
    if (!this._clearBindGroup) {
      this.initClearQuad(renderPass);
    }
    const hash = renderPass.getFrameBufferInfo().clearHash;
    const program = this.getClearProgram(renderPass.getDevice(), hash);
    const bClearColor = !!clearColor;
    const bClearDepth = !(clearDepth === null || clearDepth === undefined);
    const bClearStencil = !(clearStencil === null || clearStencil === undefined);
    program.bindGroup.setValue('clearDepth', clearDepth ?? 1);
    program.bindGroup.setValue('clearColor', clearColor ?? this._defaultClearColor);
    this._clearStateSet.useDepthState().enableWrite(bClearDepth);
    this._clearStateSet.useColorState().setColorMask(bClearColor, bClearColor, bClearColor, bClearColor);
    this._clearStateSet
      .useStencilState()
      .enable(bClearStencil)
      .setReference(bClearStencil ? clearStencil : 0);
    renderPass
      .getDevice()
      .commandQueue.draw(
        program.program,
        null,
        this._clearStateSet,
        [program.bindGroup],
        null,
        'triangle-strip',
        0,
        4,
        1
      );
  }
  private static getClearProgram(
    device: WebGPUDevice,
    hash: string
  ): { program: WebGPUProgram; bindGroup: WebGPUBindGroup } {
    let programInfo = this._clearPrograms[hash];
    if (!programInfo) {
      const colorAttachments = hash.split('');
      const program = device.buildRenderProgram({
        label: `ClearQuad-${hash}`,
        vertex(pb) {
          this.clearDepth = pb.float().uniform(0);
          this.coords = [pb.vec2(-1, 1), pb.vec2(1, 1), pb.vec2(-1, -1), pb.vec2(1, -1)];
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.coords.at(this.$builtins.vertexIndex), this.clearDepth, 1);
          });
        },
        fragment(pb) {
          this.clearColor = pb.vec4().uniform(0);
          if (colorAttachments.length === 0) {
            this.$outputs.outColor = pb.vec4();
            pb.main(function () {
              this.$outputs.outColor = this.clearColor;
            });
          } else {
            for (let i = 0; i < colorAttachments.length; i++) {
              this.$outputs[`outColor${i}`] =
                colorAttachments[i] === 'f'
                  ? pb.vec4()
                  : colorAttachments[i] === 'i'
                  ? pb.ivec4()
                  : pb.uvec4();
            }
            pb.main(function () {
              for (let i = 0; i < colorAttachments.length; i++) {
                this.$outputs[`outColor${i}`] =
                  colorAttachments[i] === 'f'
                    ? this.clearColor
                    : colorAttachments[i] === 'i'
                    ? pb.ivec4(this.clearColor)
                    : pb.uvec4(this.clearColor);
              }
            });
          }
        }
      }) as WebGPUProgram;
      const bindGroup = device.createBindGroup(program.bindGroupLayouts[0]) as WebGPUBindGroup;
      programInfo = {
        program,
        bindGroup
      };
      this._clearPrograms[hash] = programInfo;
    }
    return programInfo;
  }
  private static initClearQuad(renderPass: WebGPURenderPass): void {
    this._clearStateSet = renderPass.getDevice().createRenderStateSet() as unknown as WebGPURenderStateSet;
    this._clearStateSet.useDepthState().enableTest(false);
    this._clearStateSet.useRasterizerState().setCullMode('none');
    this._clearStateSet
      .useStencilState()
      .enable(true)
      .setFrontOp('replace', 'replace', 'replace')
      .setBackOp('replace', 'replace', 'replace')
      .setFrontCompareFunc('always')
      .setBackCompareFunc('always');
  }
}

export class WebGPUMipmapGenerator {
  static _frameBufferInfo: FrameBufferInfo = null;
  static _mipmapGenerationProgram: WebGPUProgram = null;
  static _mipmapGenerationStateSet: WebGPURenderStateSet = null;
  static getMipmapGenerationBindGroupLayout(device: WebGPUDevice) {
    if (!this._mipmapGenerationProgram) {
      this.initMipmapGeneration(device);
    }
    return this._mipmapGenerationProgram.bindGroupLayouts[0];
  }
  static generateMipmap(device: WebGPUDevice, tex: WebGPUBaseTexture, cmdEncoder?: GPUCommandEncoder) {
    if (!tex.isRenderable()) {
      return;
    }
    if (!this._mipmapGenerationProgram) {
      this.initMipmapGeneration(device);
    }
    const encoder = cmdEncoder ?? device.device.createCommandEncoder();
    const miplevels = tex.mipLevelCount;
    const numLayers = tex.isTextureCube() ? 6 : tex.isTexture2DArray() ? tex.depth : 1;
    tex.setMipmapDirty(false);
    for (let face = 0; face < numLayers; face++) {
      for (let level = 1; level < miplevels; level++) {
        this.generateMiplevel(device, encoder, tex, tex.object, tex.gpuFormat, level, level, face);
      }
    }
    if (!cmdEncoder) {
      device.device.queue.submit([encoder.finish()]);
    }
  }
  static generateMipmapsForBindGroups(device: WebGPUDevice, bindGroups: WebGPUBindGroup[]) {
    for (const bindGroup of bindGroups) {
      if (bindGroup) {
        for (const tex of bindGroup.textureList) {
          if (!tex.disposed && tex.isMipmapDirty()) {
            WebGPUMipmapGenerator.generateMipmap(device, tex);
          }
        }
      }
    }
  }
  private static generateMiplevel(
    device: WebGPUDevice,
    commandEncoder: GPUCommandEncoder,
    srcTex: WebGPUBaseTexture,
    dstTex: GPUTexture,
    format: GPUTextureFormat,
    dstLevel: number,
    srcLevel: number,
    face: number
  ) {
    const renderPassEncoder = this.beginMipmapGenerationPass(commandEncoder, dstTex, format, dstLevel, face);
    renderPassEncoder.setBindGroup(0, srcTex.getMipmapGenerationBindGroup(srcLevel, face).bindGroup);
    const pipeline = device.pipelineCache.fetchRenderPipeline(
      this._mipmapGenerationProgram,
      null,
      this._mipmapGenerationStateSet,
      'triangle-strip',
      this._frameBufferInfo
    );
    if (pipeline) {
      renderPassEncoder.setPipeline(pipeline);
      renderPassEncoder.draw(4, 1, 0);
    }
    renderPassEncoder.end();
  }
  private static beginMipmapGenerationPass(
    encoder: GPUCommandEncoder,
    texture: GPUTexture,
    format: GPUTextureFormat,
    level: number,
    face: number
  ): GPURenderPassEncoder {
    const passDesc: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: texture.createView({
            dimension: '2d',
            baseMipLevel: level || 0,
            mipLevelCount: 1,
            baseArrayLayer: face || 0,
            arrayLayerCount: 1
          }),
          loadOp: 'clear',
          clearValue: [0, 0, 0, 0],
          storeOp: 'store'
        }
      ]
    };
    this._frameBufferInfo = {
      frameBuffer: null,
      colorFormats: [format],
      depthFormat: null,
      sampleCount: 1,
      hash: null,
      clearHash: null
    };
    this._frameBufferInfo.hash = `${this._frameBufferInfo.colorFormats.join('-')}:${
      this._frameBufferInfo.depthFormat
    }:${this._frameBufferInfo.sampleCount}`;
    const renderPassEncoder = encoder.beginRenderPass(passDesc);
    renderPassEncoder.insertDebugMarker('MipmapGeneration');
    return renderPassEncoder;
  }
  private static initMipmapGeneration(device: WebGPUDevice): void {
    this._mipmapGenerationProgram = device.buildRenderProgram({
      label: 'MipmapGeneration',
      vertex(pb) {
        this.$outputs.outUV = pb.vec2();
        this.coords = [pb.vec2(-1, 1), pb.vec2(1, 1), pb.vec2(-1, -1), pb.vec2(1, -1)];
        this.uv = [pb.vec2(0, 0), pb.vec2(1, 0), pb.vec2(0, 1), pb.vec2(1, 1)];
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.coords.at(this.$builtins.vertexIndex), 0, 1);
          this.$outputs.outUV = this.uv.at(this.$builtins.vertexIndex);
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        this.tex = pb.tex2D().uniform(0);
        pb.main(function () {
          this.$outputs.color = pb.textureSampleLevel(this.tex, this.$inputs.outUV, 0);
        });
      }
    }) as WebGPUProgram;
    this._mipmapGenerationStateSet = device.createRenderStateSet() as WebGPURenderStateSet;
    this._mipmapGenerationStateSet.useDepthState().enableTest(false).enableWrite(false);
    this._mipmapGenerationStateSet.useRasterizerState().setCullMode('none');
  }
}
