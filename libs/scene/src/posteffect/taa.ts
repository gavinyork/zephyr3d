import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext, Primitive } from '../render';
import { AbstractPostEffect } from './posteffect';
import { linearToGamma } from '../shaders';
import { fetchSampler } from '../utility/misc';
import { BoxShape } from '../shapes';

export class TAA extends AbstractPostEffect<'TAA'> {
  static readonly className = 'TAA' as const;
  private static _resolveProgram: GPUProgram = null;
  private static _skyMotionVectorProgram: GPUProgram = null;
  private static _box: Primitive;
  private _bindGroup: BindGroup;
  private _skyMotionVectorBindGroup: BindGroup;
  constructor() {
    super();
    this._bindGroup = null;
    this._skyMotionVectorBindGroup = null;
  }
  renderSkyMotionVectors(ctx: DrawContext) {
    const fb = ctx.device.pool.fetchTemporalFramebuffer(
      false,
      0,
      0,
      ctx.motionVectorTexture,
      ctx.depthTexture
    );
    const program = TAA._getSkyMotionVectorProgram(ctx);
    if (!this._skyMotionVectorBindGroup) {
      this._skyMotionVectorBindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
    }
    const box = TAA._getBox(ctx);
    this._skyMotionVectorBindGroup.setValue('VPMatrix', ctx.TAA.VPMatrix);
    this._skyMotionVectorBindGroup.setValue('prevVPMatrix', ctx.TAA.prevVPMatrix);
    this._skyMotionVectorBindGroup.setValue('cameraPos', ctx.TAA.position);
    this._skyMotionVectorBindGroup.setValue('prevCameraPos', ctx.TAA.prevPosition);
    ctx.device.pushDeviceStates();
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, this._skyMotionVectorBindGroup);
    ctx.device.setRenderStates(AbstractPostEffect.getDefaultRenderState(ctx, 'le'));
    ctx.device.setFramebuffer(fb);
    box.draw();
    ctx.device.popDeviceStates();
    ctx.device.pool.releaseFrameBuffer(fb);
  }
  apply(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    srgbOutput: boolean
  ): void {
    if (
      !ctx.TAA.prevColorTexture ||
      !ctx.TAA.prevDepthTexture ||
      !ctx.motionVectorTexture ||
      ctx.TAA.prevColorTexture.width !== inputColorTexture.width ||
      ctx.TAA.prevColorTexture.height !== inputColorTexture.height
    ) {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
    } else {
      this.renderSkyMotionVectors(ctx);
      const program = TAA._getResolveProgram(ctx);
      if (!this._bindGroup) {
        this._bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
      }
      this._bindGroup.setTexture(
        'historyColor',
        ctx.TAA.prevColorTexture,
        fetchSampler('clamp_nearest_nomip')
      );
      this._bindGroup.setTexture(
        'historyDepth',
        ctx.TAA.prevDepthTexture,
        fetchSampler('clamp_nearest_nomip')
      );
      this._bindGroup.setTexture('currentColor', inputColorTexture, fetchSampler('clamp_nearest_nomip'));
      this._bindGroup.setTexture('currentDepth', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
      this._bindGroup.setTexture(
        'motionVector',
        ctx.motionVectorTexture,
        fetchSampler('clamp_nearest_nomip')
      );
      this._bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
      this._bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
      //this.passThrough(ctx, inputColorTexture, srgbOutput, AbstractPostEffect.getZTestEqualRenderState(ctx));
      ctx.device.setProgram(program);
      ctx.device.setBindGroup(0, this._bindGroup);
      this.drawFullscreenQuad();
    }
    if (ctx.TAA.prevDepthTexture) {
      ctx.device.pool.releaseTexture(ctx.TAA.prevDepthTexture);
    }
    ctx.device.pool.retainTexture(sceneDepthTexture);
    ctx.TAA.prevDepthTexture = sceneDepthTexture;
    if (ctx.TAA.prevColorTexture) {
      ctx.device.pool.releaseTexture(ctx.TAA.prevColorTexture);
    }
    const currentColorTex = ctx.device.getFramebuffer().getColorAttachments()[0];
    ctx.device.pool.retainTexture(currentColorTex);
    ctx.TAA.prevColorTexture = currentColorTex;
  }
  requireLinearDepthTexture(ctx: DrawContext): boolean {
    return true;
  }
  requireDepthAttachment(ctx: DrawContext): boolean {
    return true;
  }
  private static _getSkyMotionVectorProgram(ctx: DrawContext): GPUProgram {
    if (!this._skyMotionVectorProgram) {
      this._skyMotionVectorProgram = ctx.device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec3().attrib('position');
          this.VPMatrix = pb.mat4().uniform(0);
          this.prevVPMatrix = pb.mat4().uniform(0);
          this.cameraPos = pb.vec3().uniform(0);
          this.prevCameraPos = pb.vec3().uniform(0);
          pb.main(function () {
            this.$l.worldPos = pb.add(this.$inputs.pos, this.cameraPos);
            this.$l.prevWorldPos = pb.add(this.$inputs.pos, this.prevCameraPos);
            this.$l.clipPos = pb.mul(this.VPMatrix, pb.vec4(this.worldPos, 1));
            this.$l.prevClipPos = pb.mul(this.prevVPMatrix, pb.vec4(this.prevWorldPos, 1));
            if (ctx.device.type === 'webgpu') {
              this.clipPos.y = pb.neg(this.clipPos.y);
              this.prevClipPos.y = pb.neg(this.prevClipPos.y);
            }
            this.clipPos.z = this.clipPos.w;
            this.$builtins.position = this.clipPos;
            this.$outputs.currentPos = this.clipPos;
            this.$outputs.prevPos = this.prevClipPos;
          });
        },
        fragment(pb) {
          this.$outputs.color = pb.vec4();
          pb.main(function () {
            this.$l.motionVector = pb.mul(
              pb.sub(
                pb.div(this.$inputs.currentPos.xy, this.$inputs.currentPos.w),
                pb.div(this.$inputs.prevPos.xy, this.$inputs.prevPos.w)
              ),
              0.5
            );
            this.$outputs.color = pb.vec4(this.motionVector, 0, 1);
          });
        }
      });
    }
    return this._skyMotionVectorProgram;
  }
  private static _getBox(ctx: DrawContext) {
    if (!this._box) {
      this._box = new BoxShape({
        size: 2,
        needNormal: false,
        needUV: false,
        needTangent: false
      });
    }
    return this._box;
  }
  private static _getResolveProgram(ctx: DrawContext): GPUProgram {
    if (!this._resolveProgram) {
      this._resolveProgram = ctx.device.buildRenderProgram({
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
          this.historyColor = pb.tex2D().uniform(0);
          this.historyDepth = pb.tex2D().uniform(0);
          this.currentColor = pb.tex2D().uniform(0);
          this.currentDepth = pb.tex2D().uniform(0);
          this.motionVector = pb.tex2D().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.screenUV = pb.div(
              pb.vec2(this.$builtins.fragCoord.xy),
              pb.vec2(pb.textureDimensions(this.currentColor, 0))
            );
            this.$l.velocity = pb.textureSampleLevel(this.motionVector, this.screenUV, 0);
            this.$l.reprojectedUV = pb.sub(this.screenUV, pb.mul(this.velocity.xy, pb.vec2(1, -1)));
            this.$l.prevColor = pb.textureSampleLevel(this.historyColor, this.reprojectedUV, 0);
            this.$l.currentColor = pb.textureSampleLevel(this.currentColor, this.screenUV, 0);
            this.$l.edgeTest = pb.or(
              pb.any(pb.lessThan(this.reprojectedUV, pb.vec2(0))),
              pb.any(pb.greaterThan(this.reprojectedUV, pb.vec2(1)))
            );
            this.$l.alpha = pb.max(0.05, this.$choice(this.edgeTest, pb.float(1), pb.float(0)));
            this.$l.resolvedColor = pb.mix(this.prevColor.rgb, this.currentColor.rgb, this.alpha);
            //this.$l.resolvedColor = pb.abs(pb.sub(this.prevColor.rgb, this.currentColor.rgb)); //pb.textureSampleLevel(this.historyColor, this.screenUV, 0).rgb;
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.resolvedColor, 1);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.resolvedColor), 1);
            });
          });
        }
      });
    }
    return this._resolveProgram;
  }
}
