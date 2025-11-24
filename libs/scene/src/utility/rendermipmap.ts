import type {
  AbstractDevice,
  BindGroup,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import { fetchSampler } from './misc';
import { drawFullscreenQuad } from '../render/fullscreenquad';
import { DRef } from '@zephyr3d/base';
import { getDevice } from '../app/api';

export abstract class RenderMipmap {
  private readonly _program: DRef<GPUProgram>;
  private readonly _bindGroup: DRef<BindGroup>;
  private _srcSize: Float32Array<ArrayBuffer>;
  private _dstSize: Float32Array<ArrayBuffer>;
  abstract renderPixel(
    scope: PBInsideFunctionScope,
    leftTop: PBShaderExp,
    rightTop: PBShaderExp,
    leftBottom: PBShaderExp,
    rightBottom: PBShaderExp,
    uv: PBShaderExp
  ): PBShaderExp;
  setupUniforms(_scope: PBGlobalScope): void {}
  applyUniformValues(_bindGroup: BindGroup): void {}
  constructor() {
    this._program = new DRef();
    this._bindGroup = new DRef();
    this._srcSize = new Float32Array(2);
    this._dstSize = new Float32Array(2);
  }
  render(srcTex: Texture2D) {
    const device = getDevice();
    this.prepare(device);
    device.pushDeviceStates();
    if (device.type === 'webgpu') {
      for (let i = 0; i < srcTex.mipLevelCount - 1; i++) {
        this.renderLevel(device, i, srcTex, srcTex);
      }
    } else {
      const tmpTexture = device.createTexture2D(srcTex.format, srcTex.width, srcTex.height);
      const tmpFramebuffer = device.createFrameBuffer([tmpTexture], null);
      const dstTex = tmpFramebuffer.getColorAttachments()[0] as Texture2D;
      for (let i = 0; i < srcTex.mipLevelCount - 1; i++) {
        this.renderLevel(device, i, srcTex, dstTex);
      }
      tmpFramebuffer.dispose();
      tmpTexture.dispose();
    }
    device.popDeviceStates();
  }
  private renderLevel(
    device: AbstractDevice,
    miplevel: number,
    srcTexture: Texture2D,
    dstTexture: Texture2D
  ): void {
    const sampler = fetchSampler('clamp_nearest');
    const framebuffer = device.createFrameBuffer([dstTexture], null);
    framebuffer.setColorAttachmentMipLevel(0, miplevel + 1);
    const bindGroup = this._bindGroup.get();
    framebuffer.setColorAttachmentGenerateMipmaps(0, false);
    this._srcSize[0] = Math.max(srcTexture.width >> miplevel, 1);
    this._srcSize[1] = Math.max(srcTexture.height >> miplevel, 1);
    this._dstSize[0] = Math.max(this._srcSize[0] >> 1, 1);
    this._dstSize[1] = Math.max(this._srcSize[1] >> 1, 1);
    bindGroup.setValue('srcSize', this._srcSize);
    bindGroup.setValue('dstSize', this._dstSize);
    if (device.type === 'webgpu') {
      bindGroup.setTextureView('srcTex', srcTexture, miplevel, 0, 1, sampler);
    } else {
      bindGroup.setTexture('srcTex', srcTexture, sampler);
      bindGroup.setValue('srcMipLevel', miplevel);
    }
    this.applyUniformValues(bindGroup);
    device.setProgram(this._program.get());
    device.setBindGroup(0, this._bindGroup.get());
    device.setFramebuffer(framebuffer);
    drawFullscreenQuad();
    if (srcTexture !== dstTexture) {
      device.copyFramebufferToTexture2D(framebuffer, 0, srcTexture, miplevel + 1);
    }
    framebuffer.dispose();
  }
  private prepare(device: AbstractDevice) {
    if (!this._program.get()) {
      const that = this;
      const program = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          that.setupUniforms(this);
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type === 'webgpu') {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            }
          });
        },
        fragment(pb) {
          this.$outputs.color = pb.vec4();
          this.srcTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.srcSize = pb.vec2().uniform(0);
          this.dstSize = pb.vec2().uniform(0);
          that.setupUniforms(this);
          if (device.type !== 'webgpu') {
            this.srcMipLevel = pb.float().uniform(0);
          }
          pb.main(function () {
            const miplevel = device.type === 'webgpu' ? 0 : this.srcMipLevel;
            this.$l.invSize = pb.div(pb.vec2(1), this.srcSize);
            this.$l.uv = pb.div(this.$builtins.fragCoord.xy, this.dstSize);
            this.$l.d0 = pb.textureSampleLevel(
              this.srcTex,
              pb.add(this.uv, pb.mul(pb.vec2(-0.5, -0.5), this.invSize)),
              miplevel
            );
            this.$l.d1 = pb.textureSampleLevel(
              this.srcTex,
              pb.add(this.uv, pb.mul(pb.vec2(0.5, -0.5), this.invSize)),
              miplevel
            );
            this.$l.d2 = pb.textureSampleLevel(
              this.srcTex,
              pb.add(this.uv, pb.mul(pb.vec2(-0.5, 0.5), this.invSize)),
              miplevel
            );
            this.$l.d3 = pb.textureSampleLevel(
              this.srcTex,
              pb.add(this.uv, pb.mul(pb.vec2(0.5, 0.5), this.invSize)),
              miplevel
            );
            this.$outputs.color = that.renderPixel(this, this.d0, this.d1, this.d2, this.d3, this.uv);
          });
        }
      });
      program.name = '@RenderMipmap';
      this._program.set(program);
      this._bindGroup.set(device.createBindGroup(program.bindGroupLayouts[0]));
    }
  }
}
