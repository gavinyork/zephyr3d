import { AbstractPostEffect } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { BindGroup, FrameBuffer, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import {
  sampleLinearDepth,
  screenSpaceRayTracing_HiZ,
  screenSpaceRayTracing_Linear2D,
  SSR_calcJitter
} from '../shaders/ssr';
import { Matrix4x4, Vector2, Vector4 } from '@zephyr3d/base';
import { CopyBlitter } from '../blitter';
import { fetchSampler } from '../utility/misc';
import { BilateralBlurBlitter } from '../blitter/depthlimitedgaussion';

/**
 * SSR post effect
 *
 * @remarks
 * Internal used in light pass
 *
 * @internal
 */
export class SSR extends AbstractPostEffect {
  private static _programs: Record<string, GPUProgram> = {};
  private static _resolveProgram: GPUProgram = undefined;
  private static _combineProgram: GPUProgram = undefined;
  private static _blurBlitterH: BilateralBlurBlitter = null;
  private static _blurBlitterV: BilateralBlurBlitter = null;
  private static _weights = [
    0.1847392078702266, 0.16595854345772326, 0.12031364177766891, 0.07038755277896766, 0.03322925565155569,
    0.012657819729901945, 0.0038903040680094217, 0.0009646503390864025, 0.00019297087402915717,
    0.000031139936308099136, 0.000004053309048174758, 4.255228059965837e-7, 3.602517634249573e-8,
    2.4592560765896795e-9, 1.3534945386863618e-10, 0
  ];

  private _roughnessTex: Texture2D;
  private _normalTex: Texture2D;
  private _bindgroups: Record<string, BindGroup>;
  private _resolveBindGroup: BindGroup;
  private _combineBindGroup: BindGroup;

  private _debugFrameBuffer: Record<string, FrameBuffer>;
  /**
   * Creates an instance of SSR post effect
   */
  constructor() {
    super();
    this._opaque = true;
    this._bindgroups = {};
    this._resolveBindGroup = null;
    this._combineBindGroup = null;
    this._roughnessTex = null;
    this._debugFrameBuffer = {};
  }
  get roughnessTexture() {
    return this._roughnessTex;
  }
  set roughnessTexture(tex: Texture2D) {
    this._roughnessTex = tex;
  }
  get normalTexture() {
    return this._normalTex;
  }
  set normalTexture(tex: Texture2D) {
    this._normalTex = tex;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(): boolean {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
    return false;
  }
  /** @internal */
  blurPass(
    ctx: DrawContext,
    blitter: BilateralBlurBlitter,
    blurSizeTex: Texture2D,
    blurSizeIndex: number,
    blurSizeScale: number,
    kernelRadius: number,
    stdDev: number,
    depthCutoff: number,
    fbFrom: FrameBuffer,
    fbTo: FrameBuffer
  ) {
    const size = new Vector2(fbFrom.getWidth(), fbFrom.getHeight());
    blitter.kernelRadius = kernelRadius;
    blitter.stdDev = stdDev;
    blitter.size = size;
    blitter.depthTex = ctx.linearDepthTexture;
    blitter.depthCutoff = depthCutoff;
    blitter.blurSizeTex = blurSizeTex;
    blitter.blurSizeIndex = blurSizeIndex;
    blitter.blurSizeScale = blurSizeScale;
    blitter.sampler = fetchSampler('clamp_nearest_nomip');
    blitter.cameraNearFar.setXY(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());
    blitter.srgbOut = false;
    blitter.blit(fbFrom.getColorAttachments()[0] as Texture2D, fbTo, fetchSampler('clamp_linear_nomip'));
  }
  /** @internal */
  combine(ctx: DrawContext, inputColorTexture: Texture2D, reflectanceTex: Texture2D) {
    const device = ctx.device;
    let program = SSR._combineProgram;
    if (program === undefined) {
      program = this._createCombineProgrm(ctx);
      SSR._combineProgram = program;
    }
    if (!program) {
      return;
    }
    if (!this._combineBindGroup) {
      this._combineBindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
    }
    const linearSampler = fetchSampler('clamp_linear');
    this._combineBindGroup.setTexture('colorTex', inputColorTexture, linearSampler);
    this._combineBindGroup.setTexture('reflectanceTex', reflectanceTex, linearSampler);
    this._combineBindGroup.setTexture('roughnessTex', this._roughnessTex, linearSampler);
    this._combineBindGroup.setValue('ssrIntensity', ctx.camera.ssrIntensity);
    this._combineBindGroup.setValue('ssrFalloff', ctx.camera.ssrFalloff);
    this._combineBindGroup.setValue(
      'targetSize',
      new Vector4(
        device.getDrawingBufferWidth(),
        device.getDrawingBufferHeight(),
        device.getDrawingBufferWidth(),
        device.getDrawingBufferHeight()
      )
    );
    device.setProgram(program);
    device.setBindGroup(0, this._combineBindGroup);
    this.drawFullscreenQuad();
  }
  /** @internal */
  resolve(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    intersectTexture: Texture2D
  ) {
    const device = ctx.device;
    let program = SSR._resolveProgram;
    if (program === undefined) {
      program = this._createResolveProgram(ctx);
      SSR._resolveProgram = program;
    }
    if (!program) {
      return;
    }
    if (!this._resolveBindGroup) {
      this._resolveBindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
    }
    const nearestSampler = fetchSampler('clamp_nearest');
    const linearSampler = fetchSampler('clamp_linear');
    this._resolveBindGroup.setTexture('colorTex', inputColorTexture, linearSampler);
    this._resolveBindGroup.setTexture('intersectTex', intersectTexture, nearestSampler);
    this._resolveBindGroup.setTexture('roughnessTex', this._roughnessTex, nearestSampler);
    this._resolveBindGroup.setTexture('normalTex', this._normalTex, nearestSampler);
    this._resolveBindGroup.setTexture('depthTex', sceneDepthTexture, nearestSampler);
    this._resolveBindGroup.setValue(
      'cameraNearFar',
      new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane())
    );
    this._resolveBindGroup.setValue(
      'targetSize',
      new Vector4(
        device.getDrawingBufferWidth(),
        device.getDrawingBufferHeight(),
        sceneDepthTexture.width,
        sceneDepthTexture.height
      )
    );
    this._resolveBindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    this._resolveBindGroup.setValue('viewMatrix', ctx.camera.viewMatrix);
    this._resolveBindGroup.setValue('invViewMatrix', ctx.camera.worldMatrix);
    this._resolveBindGroup.setValue('ssrRoughnessFactor', ctx.camera.ssrRoughnessFactor);
    this._resolveBindGroup.setValue('ssrIntensity', ctx.camera.ssrIntensity);
    this._resolveBindGroup.setValue('ssrFalloff', ctx.camera.ssrFalloff);
    if (ctx.env.light.envLight) {
      this._resolveBindGroup.setValue('envLightStrength', ctx.env.light.strength);
      ctx.env.light.envLight.updateBindGroup(this._resolveBindGroup);
    }
    this._resolveBindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    device.setProgram(program);
    device.setBindGroup(0, this._resolveBindGroup);
    this.drawFullscreenQuad();
  }
  /** @internal */
  intersect(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    blur: boolean,
    srgbOut: boolean
  ) {
    const device = ctx.device;
    const hash = `${Number(blur)}:${blur ? '' : ctx.primaryCamera.ssrDebug}:${
      ctx.env.light.envLight ? ctx.env.light.getHash() : ''
    }:${!!ctx.HiZTexture}:${!!ctx.primaryCamera.ssrCalcThickness}`;
    let program = SSR._programs[hash];
    if (program === undefined) {
      program = this._createIntersectProgram(ctx, blur);
      SSR._programs[hash] = program;
    }
    if (!program) {
      return;
    }
    let bindGroup = this._bindgroups[hash];
    if (!bindGroup) {
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      this._bindgroups[hash] = bindGroup;
    }
    const nearestSampler = fetchSampler('clamp_nearest');
    const linearSampler = fetchSampler('clamp_linear');
    if (!program || !bindGroup) {
      device.clearFrameBuffer(new Vector4(1, 1, 0, 1), null, null);
      return;
    }
    if (!blur) {
      bindGroup.setTexture('colorTex', inputColorTexture, linearSampler);
      bindGroup.setValue('ssrIntensity', ctx.camera.ssrIntensity);
      bindGroup.setValue('ssrFalloff', ctx.camera.ssrFalloff);
      if (ctx.env.light.envLight) {
        bindGroup.setValue('envLightStrength', ctx.env.light.strength);
        ctx.env.light.envLight.updateBindGroup(bindGroup);
      }
    }
    bindGroup.setTexture('roughnessTex', this._roughnessTex, nearestSampler);
    bindGroup.setTexture('normalTex', this._normalTex, nearestSampler);
    bindGroup.setTexture('depthTex', sceneDepthTexture, nearestSampler);
    bindGroup.setValue('cameraNearFar', new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane()));
    bindGroup.setValue('cameraPos', ctx.camera.getWorldPosition());
    bindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    bindGroup.setValue('projMatrix', ctx.camera.getProjectionMatrix());
    bindGroup.setValue('viewMatrix', ctx.camera.viewMatrix);
    bindGroup.setValue('invViewMatrix', ctx.camera.worldMatrix);
    bindGroup.setValue('ssrParams', ctx.camera.ssrParams);
    bindGroup.setValue('ssrMaxRoughness', ctx.camera.ssrMaxRoughness);
    bindGroup.setValue('ssrRoughnessFactor', ctx.camera.ssrRoughnessFactor);
    if (ctx.HiZTexture) {
      bindGroup.setTexture('hizTex', ctx.HiZTexture, nearestSampler);
      bindGroup.setValue('depthMipLevels', ctx.HiZTexture.mipLevelCount);
      bindGroup.setValue(
        'targetSize',
        new Vector4(
          device.getDrawingBufferWidth(),
          device.getDrawingBufferHeight(),
          ctx.HiZTexture.width,
          ctx.HiZTexture.height
        )
      );
    } else {
      bindGroup.setValue('ssrStride', ctx.camera.ssrStride);
      bindGroup.setValue(
        'targetSize',
        new Vector4(
          device.getDrawingBufferWidth(),
          device.getDrawingBufferHeight(),
          sceneDepthTexture.width,
          sceneDepthTexture.height
        )
      );
    }
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    bindGroup.setValue('srgbOut', srgbOut ? 1 : 0);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad();
  }
  /** @internal */
  debugTexture(tex: Texture2D, label: string) {
    let fb = this._debugFrameBuffer[label];
    if (!fb || fb.getWidth() !== tex.width || fb.getHeight() !== tex.height) {
      fb?.getColorAttachments()[0]?.dispose();
      fb?.dispose();
      fb = tex.device.createFrameBuffer(
        [
          tex.device.createTexture2D(tex.format, tex.width, tex.height, {
            samplerOptions: {
              mipFilter: 'none'
            }
          })
        ],
        null
      );
      fb.getColorAttachments()[0].name = label ?? 'SSR_Debug';
      this._debugFrameBuffer[label] = fb;
    }
    const blitter = new CopyBlitter();
    blitter.blit(tex, fb, fetchSampler('clamp_nearest_nomip'));
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    const fb = device.getFramebuffer();
    device.pushDeviceStates();
    const intersectFramebuffer = device.pool.fetchTemporalFramebuffer(
      false,
      inputColorTexture.width,
      inputColorTexture.height,
      'rgba16f',
      null,
      false
    );
    const pingpongFramebuffer = [
      device.pool.fetchTemporalFramebuffer(
        false,
        inputColorTexture.width,
        inputColorTexture.height,
        'rgba16f',
        null,
        false
      ),
      device.pool.fetchTemporalFramebuffer(
        false,
        inputColorTexture.width,
        inputColorTexture.height,
        'rgba16f',
        null,
        false
      )
    ];
    device.setFramebuffer(intersectFramebuffer);
    this.intersect(ctx, inputColorTexture, sceneDepthTexture, true, false);
    const intersectTex = intersectFramebuffer.getColorAttachments()[0] as Texture2D;
    this.debugTexture(intersectTex, 'SSR_Debug_intersect');
    device.setFramebuffer(pingpongFramebuffer[0]);
    this.resolve(ctx, inputColorTexture, sceneDepthTexture, intersectTex);
    this.debugTexture(pingpongFramebuffer[0].getColorAttachments()[0] as Texture2D, 'SSR_Debug_resolve');
    if (ctx.camera.ssrBlurriness > 0 && ctx.camera.ssrBlurKernelRadius > 0) {
      const blurSizeScale = 255 * ctx.camera.ssrBlurriness;
      const kernelRadius = ctx.camera.ssrBlurKernelRadius;
      const stdDev = ctx.camera.ssrBlurStdDev;
      const blitterH = (SSR._blurBlitterH = SSR._blurBlitterH ?? new BilateralBlurBlitter(false));
      this.blurPass(
        ctx,
        blitterH,
        intersectTex,
        2,
        blurSizeScale,
        kernelRadius,
        stdDev,
        0.001,
        pingpongFramebuffer[0],
        pingpongFramebuffer[1]
      );
      this.debugTexture(pingpongFramebuffer[1].getColorAttachments()[0] as Texture2D, 'SSR_Debug_blurH');
      const blitterV = (SSR._blurBlitterV = SSR._blurBlitterV ?? new BilateralBlurBlitter(true));
      this.blurPass(
        ctx,
        blitterV,
        intersectTex,
        2,
        blurSizeScale,
        kernelRadius,
        stdDev,
        0.001,
        pingpongFramebuffer[1],
        pingpongFramebuffer[0]
      );
    }
    this.debugTexture(pingpongFramebuffer[0].getColorAttachments()[0] as Texture2D, 'SSR_Debug_blurV');
    device.popDeviceStates();
    if (true) {
      this.combine(ctx, inputColorTexture, pingpongFramebuffer[0].getColorAttachments()[0] as Texture2D);
    } else {
      const blitter = new CopyBlitter();
      const nearestSampler = device.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
        mipFilter: 'none'
      });
      blitter.blit(pingpongFramebuffer[0].getColorAttachments()[0] as Texture2D, fb, nearestSampler);
    }
    device.pool.releaseFrameBuffer(intersectFramebuffer);
    device.pool.releaseFrameBuffer(pingpongFramebuffer[0]);
    device.pool.releaseFrameBuffer(pingpongFramebuffer[1]);
  }
  /** @internal */
  private _createCombineProgrm(ctx: DrawContext): GPUProgram {
    return ctx.device.buildRenderProgram({
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        if (ctx.env.light.envLight) {
          ctx.env.light.envLight.initShaderBindings(pb);
        }
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.colorTex = pb.tex2D().uniform(0);
        this.reflectanceTex = pb.tex2D().uniform(0);
        this.roughnessTex = pb.tex2D().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.ssrIntensity = pb.float().uniform(0);
        this.ssrFalloff = pb.float().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func(
          'resolveSample',
          [pb.vec3('sceneColor'), pb.vec3('reflectance'), pb.vec4('roughnessValue')],
          function () {
            this.$l.r = pb.div(this.reflectance, pb.add(this.reflectance, pb.vec3(1)));
            this.$l.strength = pb.clamp(
              pb.pow(pb.mul(this.roughnessValue.rgb, this.ssrIntensity), pb.vec3(this.ssrFalloff)),
              pb.vec3(0),
              pb.vec3(1)
            );
            this.color = pb.add(
              pb.mul(this.r, this.strength),
              pb.mul(this.sceneColor, pb.sub(pb.vec3(1), this.strength))
            );
            this.$return(this.color);
          }
        );
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.reflectance = pb.textureSampleLevel(this.reflectanceTex, this.screenUV, 0).rgb;
          this.$l.sceneColor = pb.textureSampleLevel(this.colorTex, this.screenUV, 0).rgb;
          this.$l.roughnessInfo = pb.textureSampleLevel(this.roughnessTex, this.screenUV, 0);
          this.combined = this.resolveSample(this.sceneColor, this.reflectance, this.roughnessInfo);
          this.$outputs.outColor = pb.vec4(this.combined, 1);
        });
      }
    });
  }
  /** @internal */
  private _createResolveProgram(ctx: DrawContext): GPUProgram {
    return ctx.device.buildRenderProgram({
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        if (ctx.env.light.envLight) {
          ctx.env.light.envLight.initShaderBindings(pb);
        }
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.colorTex = pb.tex2D().uniform(0);
        this.intersectTex = pb.tex2D().uniform(0);
        this.roughnessTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.viewMatrix = pb.mat4().uniform(0);
        this.invViewMatrix = pb.mat4().uniform(0);
        this.invProjMatrix = pb.mat4().uniform(0);
        this.ssrRoughnessFactor = pb.float().uniform(0);
        this.ssrIntensity = pb.float().uniform(0);
        this.ssrFalloff = pb.float().uniform(0);
        if (ctx.env.light.envLight) {
          this.envLightStrength = pb.float().uniform(0);
          ctx.env.light.envLight.initShaderBindings(pb);
        }
        this.$outputs.outColor = pb.vec4();
        pb.func('getPosition', [pb.vec2('uv'), pb.mat4('mat')], function () {
          this.$l.linearDepth = sampleLinearDepth(this, this.depthTex, this.uv, 0);
          this.$l.nonLinearDepth = pb.div(
            pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
            pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
          );
          this.$l.clipSpacePos = pb.vec4(
            pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
            pb.sub(pb.mul(pb.clamp(this.nonLinearDepth, 0, 1), 2), 1),
            1
          );
          this.$l.wPos = pb.mul(this.mat, this.clipSpacePos);
          this.$return(pb.vec4(pb.div(this.wPos.xyz, this.wPos.w), this.linearDepth));
        });
        pb.func(
          'resolveSample',
          [pb.vec3('sceneColor'), pb.vec3('reflectance'), pb.vec4('roughnessValue')],
          function () {
            this.$l.r = pb.div(this.reflectance, pb.add(this.reflectance, pb.vec3(1)));
            this.$l.strength = pb.clamp(
              pb.pow(pb.mul(this.roughnessValue.rgb, this.ssrIntensity), pb.vec3(this.ssrFalloff)),
              pb.vec3(0),
              pb.vec3(1)
            );
            this.color = pb.add(
              pb.mul(this.r, this.strength),
              pb.mul(this.sceneColor, pb.sub(pb.vec3(1), this.strength))
            );
            this.$return(this.color);
          }
        );
        pb.func('resolveEnvRadiance', [pb.vec2('uv'), pb.vec4('roughnessInfo')], function () {
          if (!ctx.env.light.envLight) {
            this.$return(pb.vec3(0));
            return;
          }
          this.$l.pos = this.getPosition(this.uv, this.invProjMatrix);
          this.$if(pb.greaterThanEqual(this.pos.w, 1), function () {
            this.$return(pb.vec3(0));
          });
          this.$l.roughness = pb.mul(this.roughnessInfo.a, this.ssrRoughnessFactor);
          this.$l.viewPos = this.pos.xyz;
          this.$l.worldNormal = pb.sub(
            pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2),
            pb.vec3(1)
          );
          this.$l.viewVec = pb.normalize(this.viewPos);
          this.$l.viewNormal = pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz;
          this.$l.reflectVec = pb.add(
            pb.reflect(this.viewVec, this.viewNormal),
            SSR_calcJitter(this, this.viewPos, this.roughness)
          );
          this.$l.reflectVecW = pb.mul(this.invViewMatrix, pb.vec4(this.reflectVec, 0)).xyz;
          this.$l.roughness2 = pb.float(0);
          this.$l.env = pb.mul(
            ctx.env.light.envLight.getRadiance(this, this.reflectVecW, this.roughness2),
            this.envLightStrength
          );
          this.$return(pb.min(this.env, pb.vec3(1)));
        });
        pb.func(
          'resolveReflectance',
          [pb.vec2('uv'), pb.vec3('reflectSceneColor'), pb.vec4('roughnessInfo'), pb.float('alpha')],
          function () {
            this.$l.env = this.resolveEnvRadiance(this.uv, this.roughnessInfo);
            this.$l.reflectance = pb.mix(this.env, this.reflectSceneColor, this.alpha);
            this.$return(this.reflectance);
          }
        );
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.intersectSample = pb.textureSampleLevel(this.intersectTex, this.screenUV, 0);
          this.$l.roughnessInfo = pb.textureSampleLevel(this.roughnessTex, this.screenUV, 0);
          this.$l.reflectance = pb.vec3();
          this.$if(pb.greaterThan(this.intersectSample.w, 0), function () {
            this.$l.indirectIntersectSample = pb.textureSampleLevel(
              this.intersectTex,
              this.intersectSample.xy,
              0
            );
            this.$l.indirectRoughnessInfo = pb.textureSampleLevel(
              this.roughnessTex,
              this.intersectSample.xy,
              0
            );
            this.$l.indirectReflectance = pb.vec3();
            this.$if(pb.greaterThan(this.indirectIntersectSample.w, 0), function () {
              this.$l.indirectReflectSceneColor = pb.textureSampleLevel(
                this.colorTex,
                this.indirectIntersectSample.xy,
                0
              ).rgb;
              this.indirectReflectance = this.resolveReflectance(
                this.intersectSample.xy,
                this.indirectReflectSceneColor,
                this.indirectRoughnessInfo,
                this.indirectIntersectSample.w
              );
            }).$else(function () {
              this.indirectReflectance = this.resolveEnvRadiance(
                this.intersectSample.xy,
                this.indirectRoughnessInfo
              );
            });
            this.$l.reflectSceneColor = pb.textureSampleLevel(this.colorTex, this.intersectSample.xy, 0).rgb;
            this.$l.reflectSceneColor = this.resolveSample(
              this.reflectSceneColor,
              this.indirectReflectance,
              this.indirectRoughnessInfo
            );
            this.reflectance = this.resolveReflectance(
              this.screenUV,
              this.reflectSceneColor,
              this.roughnessInfo,
              this.intersectSample.w
            );
          }).$else(function () {
            this.reflectance = this.resolveEnvRadiance(this.screenUV, this.roughnessInfo);
          });
          //this.$l.sceneColor = pb.textureSampleLevel(this.colorTex, this.screenUV, 0).rgb;
          //this.reflectance = this.resolveSample(this.sceneColor, this.reflectance, this.roughnessInfo);
          this.$outputs.outColor = pb.vec4(this.reflectance, this.intersectSample.z);
        });
      }
    });
  }
  /** @internal */
  private _createBlurProgram(ctx: DrawContext): GPUProgram {
    return ctx.device.buildRenderProgram({
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.srcTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.blurRadiusTex = pb.tex2D().uniform(0);
        this.step = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        if (pb.getDevice().type !== 'webgl') {
          this.weights = [...SSR._weights.map((val) => pb.float(val))];
        }
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          this.$l.centerTexel = pb.textureSampleLevel(this.srcTex, this.screenUV, 0);
        });
      }
    });
  }
  /** @internal */
  private _createIntersectProgram(ctx: DrawContext, blur: boolean): GPUProgram {
    return ctx.device.buildRenderProgram({
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        if (!blur && ctx.env.light.envLight) {
          ctx.env.light.envLight.initShaderBindings(pb);
        }
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        if (!blur) {
          this.colorTex = pb.tex2D().uniform(0);
          this.ssrIntensity = pb.float().uniform(0);
          this.ssrFalloff = pb.float().uniform(0);
          if (ctx.env.light.envLight) {
            this.envLightStrength = pb.float().uniform(0);
            ctx.env.light.envLight.initShaderBindings(pb);
          }
        }
        this.roughnessTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.cameraPos = pb.vec3().uniform(0);
        this.invProjMatrix = pb.mat4().uniform(0);
        this.projMatrix = pb.mat4().uniform(0);
        this.viewMatrix = pb.mat4().uniform(0);
        this.invViewMatrix = pb.mat4().uniform(0);
        this.ssrParams = pb.vec4().uniform(0);
        this.ssrMaxRoughness = pb.float().uniform(0);
        this.ssrRoughnessFactor = pb.float().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        if (ctx.HiZTexture) {
          this.hizTex = pb.tex2D().uniform(0);
          this.depthMipLevels = pb.int().uniform(0);
        } else {
          this.ssrStride = pb.float().uniform(0);
        }
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('getPosition', [pb.vec2('uv'), pb.mat4('mat')], function () {
          this.$l.linearDepth = sampleLinearDepth(this, this.depthTex, this.uv, 0);
          this.$l.nonLinearDepth = pb.div(
            pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
            pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
          );
          this.$l.clipSpacePos = pb.vec4(
            pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
            pb.sub(pb.mul(pb.clamp(this.nonLinearDepth, 0, 1), 2), 1),
            1
          );
          this.$l.wPos = pb.mul(this.mat, this.clipSpacePos);
          this.$return(pb.vec4(pb.div(this.wPos.xyz, this.wPos.w), this.linearDepth));
        });
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
          if (!blur) {
            this.$l.sceneColor = pb.textureSampleLevel(this.colorTex, this.screenUV, 0).rgb;
          }
          this.$l.roughnessValue = pb.textureSampleLevel(this.roughnessTex, this.screenUV, 0);
          this.$l.pos = this.getPosition(this.screenUV, this.invProjMatrix);
          this.$l.linearDepth = this.pos.w;
          this.$l.roughness = pb.mul(this.roughnessValue.a, this.ssrRoughnessFactor);
          this.$l.color = pb.vec3(0);
          this.$l.a = pb.float();
          this.$if(pb.greaterThanEqual(this.linearDepth, 1), function () {
            if (!blur) {
              this.color = this.sceneColor;
              this.a = 1;
            }
          }).$else(function () {
            this.$l.viewPos = this.pos.xyz;
            this.$l.worldNormal = pb.sub(
              pb.mul(pb.textureSampleLevel(this.normalTex, this.screenUV, 0).rgb, 2),
              pb.vec3(1)
            );
            this.$l.viewVec = pb.normalize(this.viewPos);
            this.$l.viewNormal = pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz;
            this.$l.reflectVec = pb.add(
              pb.reflect(this.viewVec, this.viewNormal),
              SSR_calcJitter(this, this.viewPos, this.roughness)
            );
            this.$l.hitInfo = pb.vec4(0);
            this.$if(pb.lessThan(this.roughness, this.ssrMaxRoughness), function () {
              this.hitInfo = ctx.HiZTexture
                ? screenSpaceRayTracing_HiZ(
                    this,
                    this.viewPos,
                    this.reflectVec,
                    this.viewMatrix,
                    this.projMatrix,
                    this.invProjMatrix,
                    this.cameraNearFar,
                    this.depthMipLevels,
                    this.ssrParams.y,
                    this.ssrParams.z,
                    this.targetSize,
                    this.hizTex,
                    this.normalTex
                  )
                : screenSpaceRayTracing_Linear2D(
                    this,
                    this.viewPos,
                    this.reflectVec,
                    this.viewMatrix,
                    this.projMatrix,
                    this.invProjMatrix,
                    this.cameraNearFar,
                    this.ssrParams.x,
                    this.ssrParams.y,
                    this.ssrParams.z,
                    this.ssrStride,
                    this.targetSize,
                    this.depthTex,
                    this.normalTex,
                    !!ctx.primaryCamera.ssrCalcThickness
                  );
            });
            if (blur) {
              this.blurRadius = pb.float(0);
              this.$if(pb.greaterThan(this.roughness, 0.001), function () {
                this.$l.coneAngle = pb.mul(pb.min(this.roughness, 0.999), Math.PI * 0.5);
                this.$l.coneLen = this.$choice(
                  pb.greaterThan(this.hitInfo.w, 0),
                  this.hitInfo.z,
                  pb.min(this.targetSize.z, this.targetSize.w)
                );
                this.$l.opLen = pb.mul(pb.tan(this.coneAngle), this.coneLen, 2);
                this.$l.a2 = pb.mul(this.opLen, this.opLen);
                this.$l.fh2 = pb.mul(this.coneLen, this.coneLen, 4);
                this.blurRadius = pb.div(
                  pb.mul(this.opLen, pb.sub(pb.sqrt(pb.add(this.a2, this.fh2)), this.opLen)),
                  pb.mul(this.coneLen, 4)
                );
              });
              this.a = this.hitInfo.w;
              this.color = pb.vec3(this.hitInfo.xy, pb.clamp(pb.div(this.blurRadius, 255), 0, 1));
            } else {
              if (ctx.env.light.envLight) {
                this.$l.reflectVecW = pb.mul(this.invViewMatrix, pb.vec4(this.reflectVec, 0)).xyz;
                this.$l.env = pb.mul(
                  ctx.env.light.envLight.getRadiance(this, this.reflectVecW, this.roughness),
                  this.envLightStrength
                );
              } else {
                this.$l.env = pb.vec3(0);
              }
              this.$l.reflectance = pb.mix(
                this.env,
                pb.textureSampleLevel(this.colorTex, this.hitInfo.xy, 0).rgb,
                this.hitInfo.w
              );
              this.reflectance = pb.div(this.reflectance, pb.add(this.reflectance, pb.vec3(1)));
              this.$l.strength = pb.clamp(
                pb.pow(pb.mul(this.roughnessValue.rgb, this.ssrIntensity), pb.vec3(this.ssrFalloff)),
                pb.vec3(0),
                pb.vec3(1)
              );
              if (ctx.primaryCamera.ssrDebug === 'none') {
                this.color = pb.add(
                  pb.mul(this.reflectance, this.strength),
                  pb.mul(this.sceneColor, pb.sub(pb.vec3(1), this.strength))
                );
              } else if (ctx.primaryCamera.ssrDebug === 'reflectBRDF') {
                this.color = this.roughnessValue.rgb;
              } else if (ctx.primaryCamera.ssrDebug === 'roughness') {
                this.color = pb.vec3(this.roughness);
              } else if (ctx.primaryCamera.ssrDebug === 'reflectance') {
                this.color = this.reflectance;
              } else if (ctx.primaryCamera.ssrDebug === 'strength') {
                this.color = this.strength;
              } else {
                this.color = pb.vec3(0);
              }
            }
          });
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.color, this.a);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), this.a);
          });
        });
      }
    });
  }
}
