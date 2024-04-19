import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import { OIT } from './oit';
import type { DrawContext } from './drawable';
import { drawFullscreenQuad } from './fullscreenquad';
import { Vector4 } from '@zephyr3d/base';

/**
 * Weighted-blended OIT renderer.
 *
 * @remarks
 * The weighed-blended OIT renderer supports both WebGL, WebGL2 and WebGPU device.
 *
 * @public
 */
export class WeightedBlendedOIT extends OIT {
  /** Type name of WeightedBlendedOIT */
  public static readonly type = 'wb';
  private static _compositeProgram: GPUProgram;
  private static _compositeBindGroup: BindGroup;
  private static _compositeRenderStates: RenderStateSet;
  private _accumBuffer: FrameBuffer;
  /**
   * Creates an instance of WeightedBlendedOIT class.
   */
  constructor() {
    super();
    this._accumBuffer = null;
  }
  /**
   * {@inheritDoc OIT.getType}
   */
  getType(): string {
    return WeightedBlendedOIT.type;
  }
  /**
   * {@inheritDoc OIT.supportDevice}
   */
  supportDevice(deviceType: string): boolean {
    return true;
  }
  /**
   * {@inheritDoc OIT.dispose}
   */
  dispose() {
    return;
  }
  /**
   * {@inheritDoc OIT.begin}
   */
  begin(ctx: DrawContext): number {
    return 1;
  }
  /**
   * {@inheritDoc OIT.end}
   */
  end(ctx: DrawContext) {
    return;
  }
  /**
   * {@inheritDoc OIT.setupFragmentOutput}
   */
  setupFragmentOutput(scope: PBGlobalScope) {
    const pb = scope.$builder;
    scope.$outputs.outColor = pb.vec4();
    scope.$outputs.outAlpha = pb.getDevice().type === 'webgl' ? pb.vec4() : pb.float();
  }
  /**
   * {@inheritDoc OIT.beginPass}
   */
  beginPass(ctx: DrawContext, pass: number): boolean {
    const device = ctx.device;
    const accumBuffer = this.getAccumFramebuffer(ctx, device);
    device.pushDeviceStates();
    device.setFramebuffer(accumBuffer);
    device.clearFrameBuffer(new Vector4(0, 0, 0, 1), null, null);
    return true;
  }
  /**
   * {@inheritDoc OIT.endPass}
   */
  endPass(ctx: DrawContext, pass: number) {
    const device = ctx.device;
    const accumBuffer = device.getFramebuffer();
    device.popDeviceStates();
    const accumTargets = accumBuffer.getColorAttachments();
    this.composite(ctx, device, accumTargets[0] as Texture2D, accumTargets[1] as Texture2D);
  }
  /**
   * {@inheritDoc OIT.calculateHash}
   */
  calculateHash(): string {
    return this.getType();
  }
  /**
   * {@inheritDoc OIT.applyUniforms}
   */
  applyUniforms(ctx: DrawContext, bindGroup: BindGroup) {
    return;
  }
  /**
   * {@inheritDoc OIT.outputFragmentColor}
   */
  outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp) {
    const pb = scope.$builder;
    pb.func('Z_WBOIT_depthWeight', [pb.float('z'), pb.float('a')], function () {
      this.$return(
        pb.clamp(
          pb.mul(
            pb.pow(pb.add(pb.min(1, pb.mul(this.a, 10)), 0.01), 3),
            1e8,
            pb.pow(pb.sub(1, pb.mul(this.z, 0.9)), 2)
          ),
          1e-2,
          3e3
        )
      );
    });
    pb.func('Z_WBOIT_output', [pb.vec4('color')], function () {
      this.$l.w = this.Z_WBOIT_depthWeight(this.$builtins.fragCoord.z, this.color.a);
      this.$outputs[0] = pb.vec4(pb.mul(this.color.rgb, this.w), this.color.a);
      this.$outputs[1] =
        pb.getDevice().type === 'webgl'
          ? pb.vec4(pb.mul(this.color.a, this.w))
          : pb.mul(this.color.a, this.w);
    });
    scope.Z_WBOIT_output(color);
    return true;
  }
  /**
   * {@inheritDoc OIT.setRenderStates}
   */
  setRenderStates(rs: RenderStateSet) {
    const blendingState = rs.useBlendingState();
    blendingState.enable(true);
    blendingState.setBlendEquation('add', 'add');
    blendingState.setBlendFuncRGB('one', 'one');
    blendingState.setBlendFuncAlpha('zero', 'inv-src-alpha');
    const depthState = rs.useDepthState();
    depthState.enableWrite(false).enableTest(true);
  }
  /** @internal */
  private composite(ctx: DrawContext, device: AbstractDevice, accumColor: Texture2D, accumAlpha: Texture2D) {
    device.setProgram(WeightedBlendedOIT.getCompositeProgram(device));
    WeightedBlendedOIT._compositeBindGroup.setTexture('accumColorTex', accumColor);
    WeightedBlendedOIT._compositeBindGroup.setTexture('accumAlphaTex', accumAlpha);
    device.setBindGroup(0, WeightedBlendedOIT._compositeBindGroup);
    drawFullscreenQuad(WeightedBlendedOIT._compositeRenderStates);
  }
  /** @internal */
  private getAccumFramebuffer(ctx: DrawContext, device: AbstractDevice) {
    const vp = device.getViewport();
    const width = device.screenToDevice(vp.width);
    const height = device.screenToDevice(vp.height);
    if (this._accumBuffer) {
      if (
        this._accumBuffer.getWidth() !== width ||
        this._accumBuffer.getHeight() !== height ||
        this._accumBuffer.getDepthAttachment() !== ctx.depthTexture
      ) {
        this._accumBuffer.dispose();
        this._accumBuffer = null;
      }
    }
    if (!this._accumBuffer) {
      const accumColor = device.createTexture2D('rgba16f', width, height, {
        samplerOptions: { mipFilter: 'none' }
      });
      const accumAlpha = device.createTexture2D(device.type === 'webgl' ? 'rgba16f' : 'r16f', width, height, {
        samplerOptions: { mipFilter: 'none' }
      });
      this._accumBuffer = device.createFrameBuffer([accumColor, accumAlpha], ctx.depthTexture);
    }
    return this._accumBuffer;
  }
  /** @internal */
  private static getCompositeProgram(device: AbstractDevice) {
    if (!this._compositeProgram) {
      this._compositeProgram = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type === 'webgpu') {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            }
          });
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.accumColorTex = pb.tex2D().uniform(0);
          this.accumAlphaTex = pb.tex2D().uniform(0);
          pb.main(function () {
            this.$l.accumColor = pb.textureSample(this.accumColorTex, this.$inputs.uv);
            this.$l.accumAlpha = pb.textureSample(this.accumAlphaTex, this.$inputs.uv);
            this.$l.r = this.accumColor.a;
            this.accumColor.a = this.accumAlpha.r;
            this.$outputs.outColor = pb.vec4(
              pb.div(this.accumColor.rgb, pb.clamp(this.accumColor.a, 0.0001, 50000)),
              this.r
            );
          });
        }
      });
      this._compositeBindGroup = device.createBindGroup(this._compositeProgram.bindGroupLayouts[0]);
      this._compositeRenderStates = device.createRenderStateSet();
      this._compositeRenderStates
        .useBlendingState()
        .enable(true)
        .setBlendFuncRGB('inv-src-alpha', 'src-alpha')
        .setBlendFuncAlpha('zero', 'one');
      this._compositeRenderStates.useDepthState().enableTest(false).enableWrite(false);
    }
    return this._compositeProgram;
  }
}
