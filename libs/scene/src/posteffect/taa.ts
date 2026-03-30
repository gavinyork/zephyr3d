import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext, Primitive } from '../render';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import { fetchSampler } from '../utility/misc';
import { BoxShape } from '../shapes';
import { temporalResolve } from '../shaders/temporal';
import type { Nullable } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';

/** Resource names for TAA history buffers */
const TAA_RESOURCES = {
  COLOR: 'taaColor',
  MOTION_VECTOR: 'taaMotionVector'
} as const;

/** @internal */
export class TAA extends AbstractPostEffect {
  private static _resolveProgram: GPUProgram[] = [];
  private static _skyMotionVectorProgram: Nullable<GPUProgram> = null;
  private static _box: Primitive;
  private static readonly _texSize = new Vector2();
  private _bindGroup: Nullable<BindGroup>;
  private _skyMotionVectorBindGroup: Nullable<BindGroup>;
  constructor() {
    super();
    this._bindGroup = null;
    this._layer = PostEffectLayer.end;
    this._skyMotionVectorBindGroup = null;
  }
  renderSkyMotionVectors(ctx: DrawContext) {
    const fb = ctx.device.pool.fetchTemporalFramebuffer(
      false,
      0,
      0,
      ctx.motionVectorTexture!,
      ctx.depthTexture
    );
    const program = TAA._getSkyMotionVectorProgram(ctx);
    if (!this._skyMotionVectorBindGroup) {
      this._skyMotionVectorBindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
    }
    const box = TAA._getBox(ctx);
    this._skyMotionVectorBindGroup.setValue('VPMatrix', ctx.camera.viewProjectionMatrix);
    this._skyMotionVectorBindGroup.setValue('prevVPMatrix', ctx.camera.prevVPMatrix!);
    this._skyMotionVectorBindGroup.setValue('cameraPos', ctx.camera.getWorldPosition());
    this._skyMotionVectorBindGroup.setValue('prevCameraPos', ctx.camera.prevPosition!);
    ctx.device.pushDeviceStates();
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, this._skyMotionVectorBindGroup);
    ctx.device.setRenderStates(AbstractPostEffect.getDefaultRenderState(ctx, 'le'));
    ctx.device.setFramebuffer(fb);
    box.draw();
    ctx.device.popDeviceStates();
    ctx.device.pool.releaseFrameBuffer(fb);
  }
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const historyMgr = ctx.historyResourceManager!;

    // Check if this is the first frame (no history yet)
    const isFirstFrame = !historyMgr.has(TAA_RESOURCES.COLOR);

    if (isFirstFrame) {
      // First frame: just pass through
      this.passThrough(ctx, inputColorTexture, srgbOutput);

      // Register and update history resources (zero-copy)
      const currentColorTex = ctx.device.getFramebuffer()!.getColorAttachments()[0] as Texture2D;
      ctx.device.pool.retainTexture(currentColorTex);

      historyMgr.registerWithTexture(
        TAA_RESOURCES.COLOR,
        {
          format: inputColorTexture.format,
          sizeMode: 'absolute',
          width: inputColorTexture.width,
          height: inputColorTexture.height
        },
        { width: inputColorTexture.width, height: inputColorTexture.height },
        currentColorTex
      );

      ctx.device.pool.retainTexture(ctx.motionVectorTexture!);
      historyMgr.registerWithTexture(
        TAA_RESOURCES.MOTION_VECTOR,
        {
          format: ctx.motionVectorTexture!.format,
          sizeMode: 'absolute',
          width: ctx.motionVectorTexture!.width,
          height: ctx.motionVectorTexture!.height
        },
        { width: ctx.motionVectorTexture!.width, height: ctx.motionVectorTexture!.height },
        ctx.motionVectorTexture!
      );

      return;
    }

    // Get history textures
    const prevColorTex = historyMgr.getPrevious(TAA_RESOURCES.COLOR);

    // Check if resolution changed
    if (prevColorTex.width !== inputColorTexture.width || prevColorTex.height !== inputColorTexture.height) {
      // Resolution changed, unregister old resources and restart
      historyMgr.unregister(TAA_RESOURCES.COLOR);
      historyMgr.unregister(TAA_RESOURCES.MOTION_VECTOR);
      this.passThrough(ctx, inputColorTexture, srgbOutput);
      return;
    }

    const prevMotionVectorTex = historyMgr.getPrevious(TAA_RESOURCES.MOTION_VECTOR);

    // Render TAA
    let program = TAA._resolveProgram[ctx.camera.TAADebug];
    if (!program) {
      program = TAA._getResolveProgram(ctx, ctx.camera.TAADebug);
      TAA._resolveProgram[ctx.camera.TAADebug] = program;
    }
    if (!this._bindGroup) {
      this._bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
    }
    this._bindGroup.setTexture('historyColorTex', prevColorTex, fetchSampler('clamp_linear_nomip'));
    this._bindGroup.setTexture('currentColorTex', inputColorTexture, fetchSampler('clamp_nearest_nomip'));
    this._bindGroup.setTexture('currentDepthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    this._bindGroup.setTexture('motionVector', ctx.motionVectorTexture!, fetchSampler('clamp_nearest_nomip'));
    this._bindGroup.setTexture('prevMotionVector', prevMotionVectorTex, fetchSampler('clamp_nearest_nomip'));
    this._bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    this._bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    TAA._texSize.setXY(sceneDepthTexture.width, sceneDepthTexture.height);
    this._bindGroup.setValue('texSize', TAA._texSize);

    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, this._bindGroup);
    this.drawFullscreenQuad();

    // Update history with current framebuffer output (zero-copy)
    const currentColorTex = ctx.device.getFramebuffer()!.getColorAttachments()[0] as Texture2D;
    ctx.device.pool.retainTexture(currentColorTex);
    historyMgr.updateCurrent(TAA_RESOURCES.COLOR, currentColorTex);

    ctx.device.pool.retainTexture(ctx.motionVectorTexture!);
    historyMgr.updateCurrent(TAA_RESOURCES.MOTION_VECTOR, ctx.motionVectorTexture!);

    // Note: History swap happens automatically in executeForwardPlusGraph
  }
  requireLinearDepthTexture(_ctx: DrawContext) {
    return true;
  }
  requireDepthAttachment(_ctx: DrawContext) {
    return true;
  }
  private static _getSkyMotionVectorProgram(ctx: DrawContext) {
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
      })!;
      this._skyMotionVectorProgram.name = '@TAA_SkyMotionVector';
    }
    return this._skyMotionVectorProgram;
  }
  private static _getBox(_ctx: DrawContext) {
    if (!this._box) {
      this._box = new BoxShape({
        size: 2,
        needNormal: false,
        needUV: false
      });
    }
    return this._box;
  }
  private static _getResolveProgram(ctx: DrawContext, debug: number) {
    const program = ctx.device.buildRenderProgram({
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
        this.historyColorTex = pb.tex2D().uniform(0);
        this.currentColorTex = pb.tex2D().uniform(0);
        this.currentDepthTex = pb.tex2D().uniform(0);
        this.motionVector = pb.tex2D().uniform(0);
        this.prevMotionVector = pb.tex2D().uniform(0);
        this.texSize = pb.vec2().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.texSize);
          this.$l.resolvedColor = temporalResolve(
            this,
            this.currentColorTex,
            this.historyColorTex,
            this.currentDepthTex,
            this.motionVector,
            this.prevMotionVector,
            this.screenUV,
            this.texSize,
            debug
          );
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.resolvedColor, 1);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.resolvedColor), 1);
          });
        });
      }
    })!;
    program.name = '@TAA_Resolve';
    return program;
  }
}
