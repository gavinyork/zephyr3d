import type {
  AbstractDevice,
  BindGroup,
  GPUProgram,
  RenderStateSet,
  Texture2D,
  TextureSampler
} from '@zephyr3d/device';
import { isFloatTextureFormat } from '@zephyr3d/device';
import { AbstractPostEffect } from './posteffect';
import { decodeNormalizedFloatFromRGBA, encodeNormalizedFloatToRGBA } from '../shaders/misc';
import { Matrix4x4, Vector2, Vector4 } from '@zephyr3d/base';
import { AOBilateralBlurBlitter } from '../blitter/depthlimitedgaussion';
import { CopyBlitter } from '../blitter';
import { TemporalCache, type DrawContext } from '../render';

const NUM_SAMPLES = 7;
const NUM_RINGS = 4;

/**
 * The Scalable Ambient Obscurance (SAO) post effect
 * @public
 */
export class SAO extends AbstractPostEffect {
  private static _nearestSampler: TextureSampler = null;
  private static _program: GPUProgram = null;
  private static _programPacked: GPUProgram = null;
  private static _renderState: RenderStateSet = null;
  private static _renderStateBlend: RenderStateSet = null;
  private _bindgroup: BindGroup;
  private _bindgroupPacked: BindGroup;
  private _saoScale: number;
  private _saoBias: number;
  private _saoIntensity: number;
  private _saoRadius: number;
  private _saoMinResolution: number;
  private _saoRandomSeed: number;
  private _saoBlurDepthCutoff: number;
  private _blitterH: AOBilateralBlurBlitter;
  private _blitterV: AOBilateralBlurBlitter;
  private _copyBlitter: CopyBlitter;
  private _supported: boolean;
  /**
   * Creates an instance of SAO post effect
   */
  constructor() {
    super();
    this._bindgroup = null;
    this._bindgroupPacked = null;
    this._supported = true;
    this._opaque = true;
    this._saoScale = 10;
    this._saoBias = 1;
    this._saoIntensity = 0.025;
    this._saoRadius = 100;
    this._saoMinResolution = 0;
    this._saoRandomSeed = 0;
    this._saoBlurDepthCutoff = 1;
    this._blitterH = new AOBilateralBlurBlitter(false);
    this._blitterH.kernelRadius = 8;
    this._blitterH.stdDev = 10;
    this._blitterV = new AOBilateralBlurBlitter(true);
    this._blitterV.kernelRadius = 8;
    this._blitterV.stdDev = 10;
    this._copyBlitter = new CopyBlitter();
  }
  /** Scale value */
  get scale(): number {
    return this._saoScale;
  }
  set scale(val: number) {
    this._saoScale = val;
  }
  /** Bias value */
  get bias(): number {
    return this._saoBias;
  }
  set bias(val: number) {
    this._saoBias = val;
  }
  /** Radius value */
  get radius(): number {
    return this._saoRadius;
  }
  set radius(val: number) {
    this._saoRadius = val;
  }
  /** SAO intensity */
  get intensity(): number {
    return this._saoIntensity;
  }
  set intensity(val: number) {
    this._saoIntensity = val;
  }
  /** Minimum resolution */
  get minResolution(): number {
    return this._saoMinResolution;
  }
  set minResolution(val: number) {
    this._saoMinResolution = val;
  }
  /** Blur kernel size */
  get blurKernelSize(): number {
    return this._blitterH.kernelRadius;
  }
  set blurKernelSize(val: number) {
    val = Math.min(64, Math.max(0, val >> 0));
    this._blitterH.kernelRadius = val;
    this._blitterV.kernelRadius = val;
  }
  /** Gaussian blur stddev value */
  get blurStdDev(): number {
    return this._blitterH.stdDev;
  }
  set blurStdDev(val: number) {
    this._blitterH.stdDev = val;
    this._blitterV.stdDev = val;
  }
  /** Cutoff of depth limited blur */
  get blurDepthCutoff(): number {
    return this._saoBlurDepthCutoff;
  }
  set blurDepthCutoff(val: number) {
    this._saoBlurDepthCutoff = val;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(): boolean {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    const viewport = device.getViewport();
    this._prepare(device, inputColorTexture);
    this._copyBlitter.srgbOut = srgbOutput;
    this._copyBlitter.blit(inputColorTexture, device.getFramebuffer(), SAO._nearestSampler);
    if (!this._supported) {
      return;
    }
    const fmt = this._getIntermediateTextureFormat(device);
    const depth = device.getFramebuffer().getDepthAttachment() as Texture2D;

    const fbao = ctx.defaultViewport
      ? TemporalCache.getFramebufferVariantSizeWithDepth(depth, 1, fmt, '2d', false)
      : TemporalCache.getFramebufferFixedSizeWithDepth(depth, 1, fmt, '2d', false);
    const fbblur = ctx.defaultViewport
      ? TemporalCache.getFramebufferVariantSizeWithDepth(depth, 1, fmt, '2d', false)
      : TemporalCache.getFramebufferFixedSizeWithDepth(depth, 1, fmt, '2d', false);
    const packed = fbao.getColorAttachments()[0].format === 'rgba8unorm';
    const cameraNearFar = new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());
    device.pushDeviceStates();
    device.setFramebuffer(fbao);
    device.clearFrameBuffer(packed ? new Vector4(0, 0, 0, 1) : new Vector4(1, 0, 0, 1), null, null);
    const bindgroup = packed ? this._bindgroupPacked : this._bindgroup;
    bindgroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    bindgroup.setTexture('depthTex', sceneDepthTexture);
    bindgroup.setValue('scale', this._saoScale);
    bindgroup.setValue('invProj', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    bindgroup.setValue('bias', this._saoBias);
    bindgroup.setValue('cameraNearFar', cameraNearFar);
    bindgroup.setValue('intensity', this._saoIntensity);
    bindgroup.setValue('kernelRadius', this._saoRadius);
    bindgroup.setValue('minResolution', this._saoMinResolution);
    bindgroup.setValue('size', new Vector2(viewport.width, viewport.height));
    bindgroup.setValue('randomSeed', this._saoRandomSeed);
    device.setRenderStates(SAO._renderState);
    device.setProgram(packed ? SAO._programPacked : SAO._program);
    device.setBindGroup(0, bindgroup);
    this.drawFullscreenQuad(SAO._renderState);
    this._blitterH.size = new Vector2(inputColorTexture.width, inputColorTexture.height);
    this._blitterH.depthTex = sceneDepthTexture;
    this._blitterH.depthCutoff = this._saoBlurDepthCutoff / ctx.camera.getFarPlane();
    this._blitterH.nearestSampler = SAO._nearestSampler;
    this._blitterH.cameraNearFar = cameraNearFar;
    this._blitterH.packed = packed;
    this._blitterH.renderStates = SAO._renderState;
    this._blitterV.size = new Vector2(inputColorTexture.width, inputColorTexture.height);
    this._blitterV.depthTex = sceneDepthTexture;
    this._blitterV.depthCutoff = this._saoBlurDepthCutoff / ctx.camera.getFarPlane();
    this._blitterV.nearestSampler = SAO._nearestSampler;
    this._blitterV.cameraNearFar = cameraNearFar;
    this._blitterV.packed = packed;
    this._blitterV.srgbOut = srgbOutput;
    this._blitterV.renderStates = SAO._renderStateBlend;
    this._blitterH.blit(fbao.getColorAttachments()[0] as Texture2D, fbblur);
    device.popDeviceStates();
    this._blitterV.blit(fbblur.getColorAttachments()[0] as Texture2D, device.getFramebuffer());
    TemporalCache.releaseFramebuffer(fbao);
    TemporalCache.releaseFramebuffer(fbblur);
  }
  private _getIntermediateTextureFormat(device: AbstractDevice) {
    const texCaps = device.getDeviceCaps().textureCaps;
    return device.type === 'webgl' ||
      (!texCaps.supportHalfFloatColorBuffer && !texCaps.supportFloatColorBuffer)
      ? 'rgba8unorm'
      : texCaps.supportHalfFloatColorBuffer
      ? 'r16f'
      : 'r32f';
  }
  /** @internal */
  private _prepare(device: AbstractDevice, srcTexture: Texture2D) {
    const fb = device.getFramebuffer();
    const isFloatFramebuffer = fb && isFloatTextureFormat(fb.getColorAttachments()[0].format);
    this._supported = !isFloatFramebuffer || device.getDeviceCaps().framebufferCaps.supportFloatBlending;
    if (this._supported) {
      if (!SAO._nearestSampler) {
        SAO._nearestSampler = device.createSampler({
          magFilter: 'nearest',
          minFilter: 'nearest',
          mipFilter: 'none',
          addressU: 'clamp',
          addressV: 'clamp'
        });
      }
      if (!SAO._renderState) {
        SAO._renderState = device.createRenderStateSet();
        SAO._renderState.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('gt');
        SAO._renderState.useRasterizerState().setCullMode('none');
        SAO._renderStateBlend = device.createRenderStateSet();
        SAO._renderStateBlend.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('gt');
        SAO._renderStateBlend.useRasterizerState().setCullMode('none');
        SAO._renderStateBlend
          .useBlendingState()
          .enable(true)
          .setBlendFuncRGB('zero', 'src-color')
          .setBlendFuncAlpha('zero', 'one');
      }
      function createProgram(packed: boolean) {
        return device.buildRenderProgram({
          vertex(pb) {
            this.flip = pb.int().uniform(0);
            this.$inputs.pos = pb.vec2().attrib('position');
            this.$outputs.uv = pb.vec2();
            pb.main(function () {
              this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
              this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
              this.$if(pb.notEqual(this.flip, 0), function () {
                this.$builtins.position.y = pb.neg(this.$builtins.position.y);
              });
            });
          },
          fragment(pb) {
            this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
            this.scale = pb.float().uniform(0);
            this.invProj = pb.mat4().uniform(0);
            this.cameraNearFar = pb.vec2().uniform(0);
            this.intensity = pb.float().uniform(0);
            this.bias = pb.float().uniform(0);
            this.kernelRadius = pb.float().uniform(0);
            this.minResolution = pb.float().uniform(0);
            this.size = pb.vec2().uniform(0);
            this.randomSeed = pb.float().uniform(0);
            this.$l.scaleDividedByCameraFar = pb.float();
            this.$l.minResolutionMultipliedByCameraFar = pb.float();
            pb.func('rand', [pb.vec2('uv')], function () {
              this.$l.a = 12.9898;
              this.$l.b = 78.233;
              this.$l.c = 43758.5453;
              this.$l.dt = pb.dot(this.uv, pb.vec2(this.a, this.b));
              this.$l.sn = pb.mod(this.dt, Math.PI);
              this.$return(pb.fract(pb.mul(pb.sin(this.sn), this.c)));
            });
            pb.func('getPositionVS', [pb.vec2('uv')], function () {
              this.$l.depthValue = pb.textureSample(this.depthTex, this.uv);
              if (device.type === 'webgl') {
                this.$l.linearDepth = decodeNormalizedFloatFromRGBA(this, this.depthValue);
              } else {
                this.$l.linearDepth = this.depthValue.r;
              }
              this.$l.nonLinearDepth = pb.div(
                pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
                pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
              );
              this.$l.clipSpacePos = pb.vec4(
                pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
                pb.sub(pb.mul(this.nonLinearDepth, 2), 1),
                1
              );
              // this.$l.clipSpacePos = pb.vec4(this.uv, this.nonLinearDepth, 1);
              this.$l.vPos = pb.mul(this.invProj, this.clipSpacePos);
              this.vPos = pb.div(this.vPos, this.vPos.w);
              this.$return(this.vPos.xyz);
            });
            pb.func(
              'getOcclusion',
              [pb.vec3('centerPos'), pb.vec3('centerNormal'), pb.vec3('samplePos')],
              function () {
                this.$l.viewDelta = pb.sub(this.samplePos, this.centerPos);
                this.$l.viewDistance = pb.length(this.viewDelta);
                this.$l.scaledScreenDistance = pb.mul(this.scaleDividedByCameraFar, this.viewDistance);
                this.$return(
                  pb.div(
                    pb.max(
                      0,
                      pb.sub(
                        pb.div(
                          pb.sub(
                            pb.dot(this.centerNormal, this.viewDelta),
                            this.minResolutionMultipliedByCameraFar
                          ),
                          this.scaledScreenDistance
                        ),
                        this.bias
                      )
                    ),
                    pb.add(pb.mul(this.scaledScreenDistance, this.scaledScreenDistance), 1)
                  )
                );
              }
            );
            pb.func('getAO', [pb.vec3('vPos')], function () {
              this.scaleDividedByCameraFar = pb.div(this.scale, this.cameraNearFar.y);
              this.minResolutionMultipliedByCameraFar = pb.mul(this.minResolution, this.cameraNearFar.y);
              this.$l.centerViewNormal = pb.normalize(pb.cross(pb.dpdx(this.vPos), pb.dpdy(this.vPos)));
              this.$l.angle = pb.mul(
                this.rand(pb.add(this.$inputs.uv, pb.vec2(this.randomSeed))),
                Math.PI * 2
              );
              this.$l.radius = pb.div(pb.vec2(pb.mul(this.kernelRadius, 1 / NUM_SAMPLES)), this.size);
              this.$l.radiusStep = this.radius;
              this.$l.occlusionSum = pb.float(0);
              this.$l.weightSum = pb.float(0);
              this.$for(pb.int('i'), 0, NUM_SAMPLES, function () {
                this.$l.sampleUV = pb.add(
                  this.$inputs.uv,
                  pb.mul(pb.vec2(pb.cos(this.angle), pb.sin(this.angle)), this.radius)
                );
                this.radius = pb.add(this.radius, this.radiusStep);
                this.angle = pb.add(this.angle, (Math.PI * NUM_RINGS) / NUM_SAMPLES);
                this.samplePos = this.getPositionVS(this.sampleUV);
                this.occlusionSum = pb.add(
                  this.occlusionSum,
                  this.getOcclusion(this.vPos, this.centerViewNormal, this.samplePos)
                );
                this.weightSum = pb.add(this.weightSum, 1);
              });
              this.$if(pb.equal(this.weightSum, 0), function () {
                pb.discard();
              });
              this.$return(pb.div(pb.mul(this.occlusionSum, this.intensity), this.weightSum));
            });
            pb.main(function () {
              this.$l.vPos = this.getPositionVS(this.$inputs.uv);
              this.$l.ao = pb.clamp(pb.sub(1, this.getAO(this.vPos)), 0, packed ? 0.999 : 1);
              if (packed) {
                this.$outputs.outColor = encodeNormalizedFloatToRGBA(this, this.ao);
              } else {
                this.$outputs.outColor = pb.vec4(this.ao, this.ao, this.ao, 1);
              }
            });
          }
        });
      }
      if (!SAO._program) {
        SAO._program = createProgram(false);
        SAO._programPacked = createProgram(true);
      }
      if (!this._bindgroup) {
        this._bindgroup = device.createBindGroup(SAO._program.bindGroupLayouts[0]);
        this._bindgroupPacked = device.createBindGroup(SAO._programPacked.bindGroupLayouts[0]);
      }
    }
  }
  /** {@inheritDoc AbstractPostEffect.dispose} */
  dispose(): void {
    super.dispose();
    this._bindgroup?.dispose();
    this._bindgroup = null;
  }
}
