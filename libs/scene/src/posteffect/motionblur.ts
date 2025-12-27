import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { AbstractDevice, BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { fetchSampler } from '../utility/misc';
import type { Nullable } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';

/**
 * The motion blur post effect
 * @public
 */
export class MotionBlur extends AbstractPostEffect {
  private static _programMotionBlur: Nullable<GPUProgram> = null;
  private static _bindgroupMotionBlur: Nullable<BindGroup> = null;
  /** @internal */
  private _intensity: number;
  /** @internal */
  private _aspect: Vector2;
  /**
   * Creates an instance of tonemap post effect
   */
  constructor() {
    super();
    this._intensity = 1;
    this._aspect = new Vector2();
    this._layer = PostEffectLayer.transparent;
  }
  /** Motion blur strength */
  get strength() {
    return this._intensity;
  }
  set strength(val: number) {
    this._intensity = val;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(): boolean {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    this._prepare(device);
    this._aspect.setXY(inputColorTexture.width / inputColorTexture.height, 1);
    MotionBlur._bindgroupMotionBlur!.setTexture(
      'inputTexture',
      inputColorTexture,
      fetchSampler('clamp_nearest_nomip')
    );
    MotionBlur._bindgroupMotionBlur!.setTexture(
      'motionVectorTexture',
      ctx.motionVectorTexture!,
      fetchSampler('clamp_nearest_nomip')
    );
    MotionBlur._bindgroupMotionBlur!.setValue('flip', this.needFlip(device) ? 1 : 0);
    MotionBlur._bindgroupMotionBlur!.setValue('srgbOut', srgbOutput ? 1 : 0);
    MotionBlur._bindgroupMotionBlur!.setValue('frameDeltaTime', device.frameInfo.elapsedFrame);
    MotionBlur._bindgroupMotionBlur!.setValue('intensity', this._intensity);
    MotionBlur._bindgroupMotionBlur!.setValue('aspect', this._aspect);
    device.setProgram(MotionBlur._programMotionBlur);
    device.setBindGroup(0, MotionBlur._bindgroupMotionBlur!);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _prepare(device: AbstractDevice) {
    if (!MotionBlur._programMotionBlur) {
      MotionBlur._programMotionBlur = device.buildRenderProgram({
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
          this.srgbOut = pb.int().uniform(0);
          this.frameDeltaTime = pb.float().uniform(0);
          this.inputTexture = pb.tex2D().uniform(0);
          this.motionVectorTexture = pb.tex2D().uniform(0);
          this.intensity = pb.float().uniform(0);
          this.aspect = pb.vec2().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.color = pb.vec3();
            this.$l.velocity = pb.textureSampleLevel(this.motionVectorTexture, this.$inputs.uv, 0).xy;
            this.velocity = pb.div(pb.mul(this.velocity, 0.5), this.aspect);
            this.$l.sourceSample = pb.textureSampleLevel(this.inputTexture, this.$inputs.uv, 0);
            this.$l.color = this.sourceSample.rgb;
            this.$if(pb.greaterThan(pb.dot(this.velocity, this.velocity), 1e-7), function () {
              this.velocity = pb.mul(this.velocity, this.intensity, this.frameDeltaTime);
              this.$l.uv0 = pb.clamp(pb.sub(this.$inputs.uv, this.velocity), pb.vec2(0), pb.vec2(1));
              this.$l.uv1 = pb.clamp(pb.add(this.$inputs.uv, this.velocity), pb.vec2(0), pb.vec2(1));
              const NUM_SAMPLES = 17;
              this.$for(pb.float('i'), 0, NUM_SAMPLES, function () {
                this.$l.t = pb.div(this.i, NUM_SAMPLES - 1);
                this.color = pb.add(
                  this.color,
                  pb.textureSampleLevel(this.inputTexture, pb.mix(this.uv0, this.uv1, this.t), 0).rgb
                );
              });
              this.color = pb.mul(this.color, 1 / NUM_SAMPLES);
            });
            //this.color = pb.vec3(this.velocity, 0);
            this.$if(pb.notEqual(this.srgbOut, 0), function () {
              this.color = linearToGamma(this, this.color);
            });
            this.$outputs.outColor = pb.vec4(this.color, this.sourceSample.a);
          });
        }
      })!;
      MotionBlur._programMotionBlur.name = '@MotionBlur';
      MotionBlur._bindgroupMotionBlur = device.createBindGroup(
        MotionBlur._programMotionBlur.bindGroupLayouts[0]
      );
      console.log(MotionBlur._programMotionBlur.getShaderSource('fragment'));
    }
  }
}
