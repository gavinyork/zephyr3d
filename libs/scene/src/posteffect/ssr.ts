import { AbstractPostEffect } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { BindGroup, GPUProgram, Texture2D, TextureSampler } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import {
  sampleLinearDepth,
  screenSpaceRayTracing_HiZ2,
  screenSpaceRayTracing_Linear,
  screenSpaceRayTracing_Linear2D,
  screenSpaceRayTracing_VS
} from '../shaders/ssr';
import { Matrix4x4, Vector2, Vector4 } from '@zephyr3d/base';

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
  private static _samplerNearest: TextureSampler = undefined;
  private static _samplerLinear: TextureSampler = undefined;
  private _roughnessTex: Texture2D;
  private _normalTex: Texture2D;
  private _bindgroups: Record<string, BindGroup>;
  /**
   * Creates an instance of SSR post effect
   */
  constructor() {
    super();
    this._opaque = true;
    this._bindgroups = {};
    this._roughnessTex = null;
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
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    const hash = `${ctx.env.light.envLight ? ctx.env.light.getHash() : ''}:${!!ctx.HiZTexture}`;
    let program = SSR._programs[hash];
    if (program === undefined) {
      program = this._createProgram(ctx);
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
    if (!SSR._samplerNearest) {
      SSR._samplerNearest = device.createSampler({
        minFilter: 'nearest',
        magFilter: 'nearest',
        mipFilter: 'nearest'
      });
    }
    if (!SSR._samplerLinear) {
      SSR._samplerLinear = device.createSampler({
        minFilter: 'linear',
        magFilter: 'linear',
        mipFilter: 'linear'
      });
    }
    if (!program || !bindGroup) {
      device.clearFrameBuffer(new Vector4(1, 1, 0, 1), null, null);
      return;
    }
    bindGroup.setTexture('colorTex', inputColorTexture, SSR._samplerLinear);
    bindGroup.setValue('colorTexMiplevels', inputColorTexture.mipLevelCount - 1);
    bindGroup.setTexture('roughnessTex', this._roughnessTex, SSR._samplerNearest);
    bindGroup.setTexture('normalTex', this._normalTex, SSR._samplerNearest);
    bindGroup.setTexture('depthTex', sceneDepthTexture, SSR._samplerNearest);
    bindGroup.setValue('cameraNearFar', new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane()));
    bindGroup.setValue('cameraPos', ctx.camera.getWorldPosition());
    bindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    bindGroup.setValue('projMatrix', ctx.camera.getProjectionMatrix());
    bindGroup.setValue('viewMatrix', ctx.camera.viewMatrix);
    bindGroup.setValue('invViewMatrix', ctx.camera.worldMatrix);
    bindGroup.setValue('ssrParams', ctx.camera.ssrParams);
    bindGroup.setValue('ssrIntensity', ctx.camera.ssrIntensity);
    if (ctx.HiZTexture) {
      bindGroup.setTexture('hizTex', ctx.HiZTexture, SSR._samplerNearest);
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
    bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    if (ctx.env.light.envLight) {
      bindGroup.setValue('envLightStrength', ctx.env.light.strength);
      ctx.env.light.envLight.updateBindGroup(bindGroup);
    }
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _createProgram(ctx: DrawContext): GPUProgram {
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
        this.colorTexMiplevels = pb.float().uniform(0);
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
        this.ssrIntensity = pb.float().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        if (ctx.env.light.envLight) {
          this.envLightStrength = pb.float().uniform(0);
          ctx.env.light.envLight.initShaderBindings(pb);
        }
        if (ctx.HiZTexture) {
          this.hizTex = pb.tex2D().uniform(0);
          this.depthMipLevels = pb.int().uniform(0);
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
          this.$l.sceneColor = pb.textureSampleLevel(this.colorTex, this.screenUV, 0).rgb;
          this.$l.roughnessFactor = pb.textureSampleLevel(this.roughnessTex, this.screenUV, 0);
          this.$l.pos = this.getPosition(this.screenUV, this.invProjMatrix);
          this.$l.viewPos = this.pos.xyz;
          this.$l.linearDepth = this.pos.w;
          this.$l.worldNormal = pb.sub(
            pb.mul(pb.textureSampleLevel(this.normalTex, this.screenUV, 0).rgb, 2),
            pb.vec3(1)
          );
          this.$l.viewNormal = pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz;
          //this.$l.viewNormal = pb.normalize(pb.cross(pb.dpdx(this.viewPos), pb.dpdy(this.viewPos)));
          this.$l.incidentVec = pb.normalize(this.viewPos);
          this.$l.reflectVec = pb.reflect(this.incidentVec, this.viewNormal);
          this.$l.hitInfo = pb.vec4(0);
          this.$l.thickness = this.ssrParams.z;
          /*
          this.$l.thicknessFactor = pb.sub(1, this.linearDepth);
          this.$l.thickness = pb.mul(this.thicknessFactor, this.ssrParams.z);
          */
          this.viewPos = pb.add(this.viewPos, pb.mul(this.reflectVec, 0.1));
          this.$if(pb.lessThan(this.roughnessFactor.a, 1), function () {
            this.hitInfo = ctx.HiZTexture
              ? screenSpaceRayTracing_HiZ2(
                  this,
                  this.viewPos,
                  this.reflectVec,
                  this.viewMatrix,
                  this.projMatrix,
                  this.invProjMatrix,
                  pb.int(this.ssrParams.y),
                  this.ssrParams.z,
                  this.targetSize,
                  this.hizTex,
                  this.normalTex
                )
              : false
              ? screenSpaceRayTracing_Linear(
                  this,
                  this.viewPos,
                  this.reflectVec,
                  this.viewMatrix,
                  this.projMatrix,
                  this.invProjMatrix,
                  this.cameraNearFar.y,
                  this.ssrParams.x,
                  this.ssrParams.y,
                  this.thickness,
                  pb.int(this.ssrParams.w),
                  this.targetSize,
                  this.depthTex,
                  this.normalTex
                )
              : true
              ? screenSpaceRayTracing_Linear2D(
                  this,
                  this.viewPos,
                  this.reflectVec,
                  this.viewMatrix,
                  this.projMatrix,
                  this.invProjMatrix,
                  this.cameraNearFar,
                  this.ssrParams.x,
                  this.ssrParams.y,
                  this.thickness,
                  this.ssrParams.w,
                  this.targetSize,
                  this.depthTex,
                  this.normalTex
                )
              : screenSpaceRayTracing_VS(
                  this,
                  this.viewPos,
                  this.reflectVec,
                  this.viewMatrix,
                  this.projMatrix,
                  this.invProjMatrix,
                  this.cameraNearFar.y,
                  this.ssrParams.x,
                  this.ssrParams.y,
                  this.thickness,
                  pb.int(this.ssrParams.w),
                  this.targetSize,
                  this.depthTex,
                  this.normalTex
                );
          });
          this.$l.refl = pb.mul(this.invViewMatrix, pb.vec4(this.reflectVec, 0)).xyz;
          this.$l.env = ctx.env.light.envLight
            ? pb.mul(
                ctx.env.light.envLight.getRadiance(this, this.refl, this.roughnessFactor.a),
                this.envLightStrength
              )
            : pb.vec3(0);
          this.reflectance = pb.mix(
            this.env,
            pb.textureSampleLevel(
              this.colorTex,
              this.hitInfo.xy,
              pb.min(4, pb.mul(this.colorTexMiplevels, this.roughnessFactor.a))
            ).rgb,
            this.hitInfo.w
          );
          this.$l.color = pb.add(
            pb.mul(this.roughnessFactor.xyz, pb.mul(this.reflectance, this.ssrIntensity)),
            this.sceneColor
          );
          /*
          this.$l.color = this.hitInfo.xyz; // pb.add(pb.mul(this.roughnessFactor.xyz, this.reflectance), this.sceneColor);
          this.$l.color = pb.add(
            pb.mul(pb.mul(this.invViewMatrix, pb.vec4(this.viewNormal, 0)).xyz, 0.5),
            pb.vec3(0.5)
          );
          */

          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.color, 1);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), 1);
          });
        });
      }
    });
  }
}
