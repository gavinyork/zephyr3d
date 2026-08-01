import type { BindGroup, FrameBuffer, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext, Primitive } from '../render';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import type { PostEffectSetupContext } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import { ShaderHelper } from '../material/shader/helper';
import { fetchSampler } from '../utility/misc';
import { BoxShape } from '../shapes';
import { temporalResolve } from '../shaders/temporal';
import type { Nullable } from '@zephyr3d/base';
import { DEPTH_COMPARE_DEFAULT, DEPTH_FARTHEST, Vector2 } from '@zephyr3d/base';
import { RGHistoryResources } from '../render/rendergraph/history_resources';
import { FrameResources } from '../render/rendergraph/blackboard';
import type { RGHandle, RGTextureDesc } from '../render/rendergraph/types';

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
    ctx.device.setRenderStates(AbstractPostEffect.getDefaultRenderState(ctx, DEPTH_COMPARE_DEFAULT));
    ctx.device.setFramebuffer(fb);
    box.draw();
    ctx.device.popDeviceStates();
    ctx.device.pool.releaseFrameBuffer(fb);
  }
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const historyManager = ctx.camera.getHistoryResourceManager();
    const prevColorTex = historyManager!.tryGetPrevious(RGHistoryResources.TAA_COLOR);
    const prevMotionVectorTex = historyManager!.tryGetPrevious(RGHistoryResources.TAA_MOTION_VECTOR);
    if (
      !prevColorTex ||
      !prevMotionVectorTex ||
      prevColorTex.width !== inputColorTexture.width ||
      prevColorTex.height !== inputColorTexture.height
    ) {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
    } else {
      this._resolve(
        ctx,
        inputColorTexture,
        sceneDepthTexture,
        ctx.motionVectorTexture!,
        prevColorTex,
        prevMotionVectorTex,
        srgbOutput
      );
    }
  }
  /** @internal */
  private _resolve(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    motionVectorTexture: Texture2D,
    prevColorTex: Texture2D,
    prevMotionVectorTex: Texture2D,
    srgbOutput: boolean
  ) {
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
    this._bindGroup.setTexture('motionVector', motionVectorTexture, fetchSampler('clamp_nearest_nomip'));
    this._bindGroup.setTexture('prevMotionVector', prevMotionVectorTex, fetchSampler('clamp_nearest_nomip'));
    this._bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    this._bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    TAA._texSize.setXY(sceneDepthTexture.width, sceneDepthTexture.height);
    this._bindGroup.setValue('texSize', TAA._texSize);
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, this._bindGroup);
    this.drawFullscreenQuad();
  }
  /** {@inheritDoc AbstractPostEffect.setup}
   *
   * Native implementation: previous-frame color/motion-vector textures are
   * imported as graph resources at build time and this frame's resolve output
   * and motion vectors are queued as retained history commits, making TAA
   * fully self-describing (no builder-side history plumbing).
   */
  setup(s: PostEffectSetupContext): RGHandle {
    const { graph, ctx, history, blackboard } = s;
    const motionVectorHandle = blackboard.get(FrameResources.MotionVector);
    const linearDepthHandle = blackboard.get(FrameResources.LinearDepth);
    if (!history || !motionVectorHandle || !linearDepthHandle) {
      // No temporal inputs available this frame — the legacy path degrades to
      // a pass-through.
      return this._setupFromApply(s);
    }
    const historySize = { width: s.width, height: s.height };
    const colorDesc: RGTextureDesc = {
      format: s.colorFormat,
      sizeMode: 'absolute',
      width: s.width,
      height: s.height
    };
    const motionVectorDesc: RGTextureDesc = {
      format: 'rgba16f',
      sizeMode: 'absolute',
      width: s.width,
      height: s.height
    };
    const prevColorHandle = history.importPreviousIfCompatible(
      graph,
      RGHistoryResources.TAA_COLOR,
      colorDesc,
      historySize
    );
    const prevMotionVectorHandle = history.importPreviousIfCompatible(
      graph,
      RGHistoryResources.TAA_MOTION_VECTOR,
      motionVectorDesc,
      historySize
    );

    return graph.addPass('PostEffect:TAA', (builder) => {
      builder.read(s.input);
      builder.read(linearDepthHandle);
      builder.read(motionVectorHandle);
      if (prevColorHandle) {
        builder.read(prevColorHandle);
      }
      if (prevMotionVectorHandle) {
        builder.read(prevMotionVectorHandle);
      }
      for (const dep of s.dependencies) {
        builder.read(dep);
      }
      // requireDepthAttachment is true, so this always resolves to an
      // intermediate texture — required anyway for the history commit below.
      const output = s.createOutput(builder, { needDepthAttachment: true });
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          device.setFramebuffer(
            output.framebuffer ? rg.getFramebuffer<FrameBuffer>(output.framebuffer) : null
          );
          const inputTexture = rg.getTexture<Texture2D>(s.input);
          const depthTexture = rg.getTexture<Texture2D>(linearDepthHandle);
          const motionVectorTexture = rg.getTexture<Texture2D>(motionVectorHandle);
          const prevColorTex = prevColorHandle ? rg.getTexture<Texture2D>(prevColorHandle) : null;
          const prevMotionVectorTex = prevMotionVectorHandle
            ? rg.getTexture<Texture2D>(prevMotionVectorHandle)
            : null;
          if (
            !prevColorTex ||
            !prevMotionVectorTex ||
            prevColorTex.width !== inputTexture.width ||
            prevColorTex.height !== inputTexture.height
          ) {
            this.passThrough(ctx, inputTexture, output.srgbOutput);
          } else {
            this._resolve(
              ctx,
              inputTexture,
              depthTexture,
              motionVectorTexture,
              prevColorTex,
              prevMotionVectorTex,
              output.srgbOutput
            );
          }
          // Queue this frame's history: the TAA resolve output and the frame's
          // motion vectors. Commits are applied only after the graph executes
          // successfully (HistoryResourceManager.commitFrame).
          const outputTexture = rg.getTexture<Texture2D>(output.color);
          history.queueRetainedCommit(
            RGHistoryResources.TAA_COLOR,
            {
              format: outputTexture.format,
              sizeMode: 'absolute',
              width: outputTexture.width,
              height: outputTexture.height
            },
            { width: outputTexture.width, height: outputTexture.height },
            outputTexture
          );
          history.queueRetainedCommit(
            RGHistoryResources.TAA_MOTION_VECTOR,
            {
              format: motionVectorTexture.format,
              sizeMode: 'absolute',
              width: motionVectorTexture.width,
              height: motionVectorTexture.height
            },
            { width: motionVectorTexture.width, height: motionVectorTexture.height },
            motionVectorTexture
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return output.color;
    });
  }
  requireLinearDepthTexture(_ctx: DrawContext) {
    return true;
  }
  requireDepthAttachment(_ctx: DrawContext) {
    return true;
  }
  requireMotionVectorTexture(_ctx: DrawContext) {
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
            this.clipPos.z = ShaderHelper.farthestClipZ(this, this.clipPos.w);
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
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
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
