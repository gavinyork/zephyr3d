import type { BindGroup, GPUProgram, RenderStateSet, Texture2D } from '@zephyr3d/device';
import type { DrawContext, Primitive, SceneNode } from '@zephyr3d/scene';
import {
  AbstractPostEffect,
  decodeNormalizedFloatFromRGBA,
  fetchSampler,
  linearToGamma,
  ShaderHelper
} from '@zephyr3d/scene';
import { createAxisPrimitive } from './misc';
import { Matrix4x4, Vector2 } from '@zephyr3d/base';

/**
 * The post water effect
 * @public
 */
export class PostGizmoRenderer extends AbstractPostEffect<'PostGizmoRenderer'> {
  static readonly className = 'PostGizmoRenderer' as const;
  static _gizmoProgram: GPUProgram = null;
  static _gizmoRenderState: RenderStateSet = null;
  static _axis: Primitive = null;
  static _mvpMatrix: Matrix4x4 = new Matrix4x4();
  static _texSize: Vector2 = new Vector2();
  static _cameraNearFar: Vector2 = new Vector2();
  private _axisBinding: SceneNode;
  private _bindGroup: BindGroup;
  /**
   * Creates an instance of PostGizmoRenderer.
   */
  constructor(binding: SceneNode) {
    super();
    this._axisBinding = binding;
    this._bindGroup = null;
  }
  get axisBinding(): SceneNode {
    return this._axisBinding;
  }
  set axisBinding(node: SceneNode) {
    this._axisBinding = node;
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
    this.passThrough(ctx, inputColorTexture, srgbOutput);
    if (!PostGizmoRenderer._axis) {
      PostGizmoRenderer._axis = createAxisPrimitive(10, 0.1, 5, 0.2);
    }
    if (!PostGizmoRenderer._gizmoProgram) {
      PostGizmoRenderer._gizmoProgram = this._createAxisProgram(ctx);
    }
    if (!PostGizmoRenderer._gizmoRenderState) {
      PostGizmoRenderer._gizmoRenderState = this._createRenderStates(ctx);
    }
    if (!this._bindGroup) {
      this._bindGroup = ctx.device.createBindGroup(PostGizmoRenderer._gizmoProgram.bindGroupLayouts[0]);
    }
    if (this._axisBinding) {
      PostGizmoRenderer._mvpMatrix.set(this._axisBinding.worldMatrix);
    } else {
      PostGizmoRenderer._mvpMatrix.identity();
    }
    PostGizmoRenderer._mvpMatrix.multiplyLeft(ctx.camera.viewProjectionMatrix);
    PostGizmoRenderer._texSize.setXY(inputColorTexture.width, inputColorTexture.height);
    PostGizmoRenderer._cameraNearFar.setXY(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());
    this._bindGroup.setValue('mvpMatrix', PostGizmoRenderer._mvpMatrix);
    this._bindGroup.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
    this._bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    this._bindGroup.setValue('texSize', PostGizmoRenderer._texSize);
    this._bindGroup.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
    this._bindGroup.setTexture('inputColor', inputColorTexture, fetchSampler('clamp_nearest_nomip'));
    this._bindGroup.setTexture('linearDepthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    ctx.device.setProgram(PostGizmoRenderer._gizmoProgram);
    ctx.device.setBindGroup(0, this._bindGroup);
    ctx.device.setRenderStates(PostGizmoRenderer._gizmoRenderState);
    PostGizmoRenderer._axis.draw();
  }
  private _createRenderStates(ctx: DrawContext) {
    const rs = ctx.device.createRenderStateSet();
    rs.useDepthState().enableTest(false).enableWrite(false);
    return rs;
  }
  private _createAxisProgram(ctx: DrawContext) {
    return ctx.device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$inputs.color = pb.vec4().attrib('diffuse');
        this.mvpMatrix = pb.mat4().uniform(0);
        this.flip = pb.float().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          this.$outputs.color = this.$inputs.color;
          this.$builtins.position = pb.mul(this.$builtins.position, pb.vec4(1, this.flip, 1, 1));
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        this.inputColor = pb.tex2D().uniform(0);
        this.linearDepthTex = pb.tex2D().uniform(0);
        this.texSize = pb.vec2().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.texSize);
          this.$l.depth = ShaderHelper.nonLinearDepthToLinearNormalized(
            this,
            this.$builtins.fragCoord.z,
            this.cameraNearFar
          );
          this.$l.sceneDepthSample = pb.textureSampleLevel(this.linearDepthTex, this.screenUV, 0);
          this.$l.sceneDepth =
            pb.getDevice().type === 'webgl'
              ? decodeNormalizedFloatFromRGBA(this, this.sceneDepthSample)
              : this.sceneDepthSample.r;
          this.$l.alpha = this.$choice(
            pb.greaterThan(this.depth, this.sceneDepth),
            pb.float(0.3),
            pb.float(1)
          );
          this.$l.sceneColor = pb.textureSampleLevel(this.inputColor, this.screenUV, 0);
          this.$l.outColor = pb.mix(this.sceneColor.rgb, this.$inputs.color.rgb, this.alpha);
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.color = pb.vec4(this.outColor, 1);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.outColor), 1);
          });
        });
      }
    });
  }
}
