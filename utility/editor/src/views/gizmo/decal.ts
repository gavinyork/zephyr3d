import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '@zephyr3d/scene';
import { DRef, fetchSampler, linearToGamma, PostEffectLayer, ShaderHelper } from '@zephyr3d/scene';
import { AbstractPostEffect, Application } from '@zephyr3d/scene';
import { Vector2, Vector4 } from '@zephyr3d/base';

export class PostDecalRenderer extends AbstractPostEffect {
  static _defaultDecalTexture: DRef<Texture2D> = new DRef();
  static _decalProgram: GPUProgram = null;
  static _decalBindGroup: BindGroup = null;
  private readonly _decalTexture: DRef<Texture2D>;
  private readonly _decalColor: Vector4;
  private _params: Vector4;
  private readonly _cameraNearFar: Vector2;
  /**
   * Creates an instance of PostDecalRenderer.
   */
  constructor() {
    super();
    this._decalTexture = new DRef();
    this._params = new Vector4(-10, -10, 20, 20);
    this._decalColor = new Vector4(0.5, 1, 0.5, 1);
    this._cameraNearFar = new Vector2();
    this._layer = PostEffectLayer.opaque;
  }
  get rect() {
    return this._params;
  }
  set rect(val: Vector4) {
    this._params = val;
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
    this.prepare();
    this._cameraNearFar.setXY(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());
    PostDecalRenderer._decalBindGroup.setTexture(
      'srcTex',
      inputColorTexture,
      fetchSampler('clamp_nearest_nomip')
    );
    PostDecalRenderer._decalBindGroup.setTexture(
      'depthTex',
      sceneDepthTexture,
      fetchSampler('clamp_nearest_nomip')
    );
    PostDecalRenderer._decalBindGroup.setTexture(
      'decalTex',
      this._decalTexture.get() ?? PostDecalRenderer._defaultDecalTexture.get(),
      fetchSampler('clamp_linear_nomip')
    );
    PostDecalRenderer._decalBindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
    PostDecalRenderer._decalBindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    PostDecalRenderer._decalBindGroup.setValue('params', this._params);
    PostDecalRenderer._decalBindGroup.setValue('cameraNearFar', this._cameraNearFar);
    PostDecalRenderer._decalBindGroup.setValue('decalColor', this._decalColor);
    PostDecalRenderer._decalBindGroup.setValue('invViewProjMatrix', ctx.camera.invViewProjectionMatrix);
    ctx.device.setProgram(PostDecalRenderer._decalProgram);
    ctx.device.setBindGroup(0, PostDecalRenderer._decalBindGroup);
    this.drawFullscreenQuad();
  }
  private prepare() {
    if (!PostDecalRenderer._defaultDecalTexture.get()) {
      const tex = Application.instance.device.createTexture2D('rgba8unorm', 1, 1);
      tex.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1);
      PostDecalRenderer._defaultDecalTexture.set(tex);
    }
    if (!PostDecalRenderer._decalProgram) {
      PostDecalRenderer._decalProgram = Application.instance.device.buildRenderProgram({
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
          this.srcTex = pb.tex2D().uniform(0);
          this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.decalTex = pb.tex2D().uniform(0);
          this.params = pb.vec4().uniform(0);
          this.invViewProjMatrix = pb.mat4().uniform(0);
          this.cameraNearFar = pb.vec2().uniform(0);
          this.decalColor = pb.vec4().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.screenUV = this.$inputs.uv;
            this.$l.srcColor = pb.textureSample(this.srcTex, this.screenUV);
            this.$l.wPos = ShaderHelper.samplePositionFromDepth(
              this,
              this.depthTex,
              this.screenUV,
              this.invViewProjMatrix,
              this.cameraNearFar
            );
            this.$l.decalUV = pb.div(pb.sub(this.wPos.xz, this.params.xy), this.params.zw);
            this.$if(
              pb.and(
                pb.all(pb.lessThan(this.decalUV, pb.vec2(1))),
                pb.all(pb.greaterThan(this.decalUV, pb.vec2(0)))
              ),
              function () {
                this.$l.decal = pb.textureSampleLevel(this.decalTex, this.decalUV, 0).r;
                this.$l.color = pb.mix(pb.vec3(1), this.decalColor.rgb, this.decal);
                this.srcColor = pb.vec4(pb.mul(this.srcColor.rgb, this.color), this.srcColor.a);
              }
            );
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = this.srcColor;
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.srcColor.rgb), this.srcColor.a);
            });
          });
        }
      });
      PostDecalRenderer._decalBindGroup = Application.instance.device.createBindGroup(
        PostDecalRenderer._decalProgram.bindGroupLayouts[0]
      );
    }
  }
}
