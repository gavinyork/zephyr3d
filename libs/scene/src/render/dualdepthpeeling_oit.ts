import type {
  AbstractDevice,
  BindGroup,
  DeviceCaps,
  FrameBuffer,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D,
  TextureFormat
} from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { DEPTH_FARTHEST, Disposable, Vector4 } from '@zephyr3d/base';
import type { OIT } from './oit';
import type { DrawContext } from './drawable';
import { drawFullscreenQuad } from './fullscreenquad';
import { tryGetApp } from '../app/api';

const DEPTH_FORMAT: TextureFormat = 'rg32f';
const ACCUM_FORMAT: TextureFormat = 'rgba16f';
const COLOR_ATTACHMENT_BYTES_PER_SAMPLE = 4 + 8 + 8;

/**
 * Dual depth peeling OIT renderer.
 *
 * @remarks
 * This implementation follows the official dual depth peeling pass structure:
 * an initialization pass writes the nearest/farthest transparent depth pair, then
 * each peel pass ping-pongs the depth pair while accumulating front and back colors.
 *
 * It requires MRT, per-target blending, min/max blend equations and blendable
 * floating-point color targets. If those capabilities are missing, supportDevice()
 * returns false and the transparent pass falls back to sorted alpha blending.
 *
 * @public
 */
export class DualDepthPeelingOIT extends Disposable implements OIT {
  /** Type name of DualDepthPeelingOIT */
  public static readonly type = 'ddp';
  private static readonly DEPTH_CLEAR = new Vector4(-1, -1, -1, -1);
  private static readonly FRONT_CLEAR = new Vector4(0, 0, 0, 1);
  private static readonly BACK_CLEAR = new Vector4(0, 0, 0, 0);
  private static _compositeProgram: Nullable<GPUProgram> = null;
  private static _compositeBindGroup: Nullable<BindGroup> = null;
  private static _compositeRenderStates: Nullable<RenderStateSet> = null;
  private _numPeels: number;
  private _currentPass: number;
  private _hash: string;
  private _depthTargets: [Nullable<Texture2D>, Nullable<Texture2D>];
  private _frontTarget: Nullable<Texture2D>;
  private _backTarget: Nullable<Texture2D>;
  private _framebuffers: [Nullable<FrameBuffer>, Nullable<FrameBuffer>];
  private _device: Nullable<AbstractDevice>;

  /**
   * Creates an instance of DualDepthPeelingOIT.
   *
   * @param numPeels - Number of peel iterations after the initialization pass.
   */
  constructor(numPeels = 8) {
    super();
    this._numPeels = Math.max(1, Math.floor(numPeels || 0));
    this._currentPass = 0;
    this._hash = DualDepthPeelingOIT.type;
    this._depthTargets = [null, null];
    this._frontTarget = null;
    this._backTarget = null;
    this._framebuffers = [null, null];
    this._device = null;
  }

  /** Number of front/back peel iterations after the initialization pass. */
  get numPeels() {
    return this._numPeels;
  }
  set numPeels(val: number) {
    this._numPeels = Math.max(1, Math.floor(val || 0));
  }

  /**
   * Checks whether dual depth peeling can run with a capability snapshot.
   *
   * @param deviceType - The device type.
   * @param caps - The device capabilities.
   * @returns True if dual depth peeling is supported.
   */
  static supportDeviceCaps(deviceType: string, caps: DeviceCaps) {
    const framebufferCaps = caps.framebufferCaps;
    const textureCaps = caps.textureCaps;
    const shaderCaps = caps.shaderCaps;
    const miscCaps = caps.miscCaps;
    const webgl2OrBetter = deviceType !== 'webgl' || shaderCaps.maxUniformBufferSize > 0;
    return (
      webgl2OrBetter &&
      framebufferCaps.maxDrawBuffers >= 3 &&
      framebufferCaps.supportPerTargetBlending &&
      framebufferCaps.maxColorAttachmentBytesPerSample >= COLOR_ATTACHMENT_BYTES_PER_SAMPLE &&
      miscCaps.supportBlendMinMax &&
      textureCaps.supportHalfFloatColorBuffer &&
      textureCaps.supportFloatColorBuffer &&
      textureCaps.supportFloatBlending
    );
  }

  /**
   * {@inheritDoc OIT.getType}
   */
  getType() {
    return DualDepthPeelingOIT.type;
  }

  /**
   * {@inheritDoc OIT.supportDevice}
   */
  supportDevice(deviceType: string) {
    const device = tryGetApp()?.device;
    return (
      !!device &&
      device.type === deviceType &&
      DualDepthPeelingOIT.supportDeviceCaps(deviceType, device.getDeviceCaps())
    );
  }

  /**
   * {@inheritDoc OIT.wantsPremultipliedAlpha}
   */
  wantsPremultipliedAlpha() {
    return true;
  }

  /**
   * {@inheritDoc OIT.wantsAdditiveLightPassAlpha}
   */
  wantsAdditiveLightPassAlpha() {
    return true;
  }

  /**
   * {@inheritDoc OIT.begin}
   */
  begin(ctx: DrawContext) {
    this.releaseFramebuffers();
    if (!ctx.depthTexture) {
      return 0;
    }
    this._device = ctx.device;
    this.createFramebuffers(ctx);
    return this._numPeels + 1;
  }

  /**
   * {@inheritDoc OIT.end}
   */
  end(ctx: DrawContext) {
    try {
      if (this._frontTarget && this._backTarget) {
        this.composite(ctx, ctx.device, this._frontTarget, this._backTarget);
      }
    } finally {
      this.releaseFramebuffers();
      this._hash = DualDepthPeelingOIT.type;
    }
  }

  /**
   * {@inheritDoc OIT.beginPass}
   */
  beginPass(ctx: DrawContext, pass: number) {
    this._currentPass = pass;
    const targetIndex = pass & 1;
    const currentDepthTarget = this._depthTargets[targetIndex];
    const previousDepthTarget = this._depthTargets[targetIndex ^ 1];
    const framebuffer = this._framebuffers[targetIndex];
    if (!currentDepthTarget || !framebuffer || (pass > 0 && !previousDepthTarget)) {
      return false;
    }
    this._hash =
      pass === 0
        ? `${this.getType()}#init#${currentDepthTarget.uid}`
        : `${this.getType()}#peel#${previousDepthTarget!.uid}`;
    ctx.device.pushDeviceStates();
    ctx.device.setFramebuffer(framebuffer);
    ctx.device.clearFrameBuffer(
      pass === 0
        ? [DualDepthPeelingOIT.DEPTH_CLEAR, DualDepthPeelingOIT.FRONT_CLEAR, DualDepthPeelingOIT.BACK_CLEAR]
        : [DualDepthPeelingOIT.DEPTH_CLEAR, null, null],
      null,
      null
    );
    return true;
  }

  /**
   * {@inheritDoc OIT.endPass}
   */
  endPass(ctx: DrawContext, _pass: number) {
    ctx.device.popDeviceStates();
  }

  /**
   * {@inheritDoc OIT.setupFragmentOutput}
   */
  setupFragmentOutput(scope: PBGlobalScope) {
    const pb = scope.$builder;
    scope.$outputs.Z_DDP_depth = pb.vec2();
    scope.$outputs.Z_DDP_frontColor = pb.vec4();
    scope.$outputs.Z_DDP_backColor = pb.vec4();
    if (this._currentPass > 0) {
      scope.Z_DDP_depthTexture = pb.tex2D().uniform(2).noSampler();
    }
  }

  /**
   * {@inheritDoc OIT.outputFragmentColor}
   */
  outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp, ctx: DrawContext) {
    const pb = scope.$builder;
    scope.$outputs.Z_DDP_depth = pb.vec2(-1, -1);
    scope.$outputs.Z_DDP_frontColor = pb.vec4(0, 0, 0, 0);
    scope.$outputs.Z_DDP_backColor = pb.vec4(0, 0, 0, 0);
    if (this._currentPass === 0) {
      scope.$outputs.Z_DDP_depth = pb.vec2(pb.neg(scope.$builtins.fragCoord.z), scope.$builtins.fragCoord.z);
    } else {
      scope.$l.Z_DDP_prevDepth = pb.textureLoad(
        scope.Z_DDP_depthTexture,
        pb.ivec2(scope.$builtins.fragCoord.xy),
        0
      ).xy;
      scope.$l.Z_DDP_frontDepth = pb.neg(scope.Z_DDP_prevDepth.x);
      scope.$l.Z_DDP_backDepth = scope.Z_DDP_prevDepth.y;
      scope.$l.Z_DDP_curDepth = scope.$builtins.fragCoord.z;
      scope.$l.Z_DDP_outputColor = pb.vec4(color.rgb, ctx.lightBlending ? pb.float(0) : color.a);
      scope
        .$if(
          pb.or(
            pb.lessThan(pb.add(scope.Z_DDP_curDepth, 0.000001), scope.Z_DDP_frontDepth),
            pb.greaterThan(pb.sub(scope.Z_DDP_curDepth, 0.000001), scope.Z_DDP_backDepth)
          ),
          function () {
            pb.discard();
          }
        )
        .$elseif(
          pb.and(
            pb.greaterThan(pb.sub(scope.Z_DDP_curDepth, 0.000001), scope.Z_DDP_frontDepth),
            pb.lessThan(pb.add(scope.Z_DDP_curDepth, 0.000001), scope.Z_DDP_backDepth)
          ),
          function () {
            this.$outputs.Z_DDP_depth = pb.vec2(
              pb.neg(this.$builtins.fragCoord.z),
              this.$builtins.fragCoord.z
            );
          }
        )
        .$elseif(
          pb.and(
            pb.lessThan(scope.Z_DDP_curDepth, pb.add(scope.Z_DDP_frontDepth, 0.000001)),
            pb.greaterThan(scope.Z_DDP_curDepth, pb.sub(scope.Z_DDP_frontDepth, 0.000001))
          ),
          function () {
            this.$outputs.Z_DDP_frontColor = this.Z_DDP_outputColor;
          }
        )
        .$else(function () {
          this.$outputs.Z_DDP_backColor = this.Z_DDP_outputColor;
        });
    }
    return true;
  }

  /**
   * {@inheritDoc OIT.applyUniforms}
   */
  applyUniforms(_ctx: DrawContext, bindGroup: BindGroup) {
    if (this._currentPass > 0) {
      bindGroup.setTexture('Z_DDP_depthTexture', this._depthTargets[(this._currentPass & 1) ^ 1]!);
    }
  }

  /**
   * {@inheritDoc OIT.calculateHash}
   */
  calculateHash() {
    return this._hash;
  }

  /**
   * {@inheritDoc OIT.setRenderStates}
   */
  setRenderStates(rs: RenderStateSet) {
    rs.useBlendingState().enable(false).enableAlphaToCoverage(false);
    rs.useDepthState().enableTest(true).enableWrite(false);

    rs.useTargetBlendingState(0)
      .enable(true)
      .enableAlphaToCoverage(false)
      .setBlendEquation('max', 'max')
      .setBlendFunc('one', 'one');

    rs.useTargetBlendingState(1)
      .enable(true)
      .enableAlphaToCoverage(false)
      .setBlendEquation('add', 'add')
      .setBlendFuncRGB('dst-alpha', 'one')
      .setBlendFuncAlpha('zero', 'inv-src-alpha');

    rs.useTargetBlendingState(2)
      .enable(true)
      .enableAlphaToCoverage(false)
      .setBlendEquation('add', 'add')
      .setBlendFuncRGB('one', 'inv-src-alpha')
      .setBlendFuncAlpha('one', 'inv-src-alpha');
  }

  /** @internal */
  private createFramebuffers(ctx: DrawContext) {
    const device = ctx.device;
    const width = ctx.depthTexture!.width;
    const height = ctx.depthTexture!.height;
    const depthTarget0 = device.pool.fetchTemporalTexture2D(false, DEPTH_FORMAT, width, height, false);
    const depthTarget1 = device.pool.fetchTemporalTexture2D(false, DEPTH_FORMAT, width, height, false);
    const frontTarget = device.pool.fetchTemporalTexture2D(false, ACCUM_FORMAT, width, height, false);
    const backTarget = device.pool.fetchTemporalTexture2D(false, ACCUM_FORMAT, width, height, false);
    const framebuffer0 = device.pool.createTemporalFramebuffer(
      false,
      [depthTarget0, frontTarget, backTarget],
      ctx.depthTexture
    );
    const framebuffer1 = device.pool.createTemporalFramebuffer(
      false,
      [depthTarget1, frontTarget, backTarget],
      ctx.depthTexture
    );
    device.pool.releaseTexture(depthTarget0);
    device.pool.releaseTexture(depthTarget1);
    device.pool.releaseTexture(frontTarget);
    device.pool.releaseTexture(backTarget);
    this._depthTargets = [depthTarget0, depthTarget1];
    this._frontTarget = frontTarget;
    this._backTarget = backTarget;
    this._framebuffers = [framebuffer0, framebuffer1];
  }

  /** @internal */
  private composite(ctx: DrawContext, device: AbstractDevice, frontTarget: Texture2D, backTarget: Texture2D) {
    const currentFramebuffer = device.getFramebuffer();
    const colorAttachment = currentFramebuffer?.getColorAttachments()[0] ?? null;
    const singleColorFramebuffer =
      currentFramebuffer && currentFramebuffer.getColorAttachments().length > 1 && colorAttachment
        ? device.pool.fetchTemporalFramebuffer(
            false,
            0,
            0,
            colorAttachment,
            currentFramebuffer.getDepthAttachment(),
            false
          )
        : null;
    if (singleColorFramebuffer) {
      const viewport = device.getViewport();
      const scissor = device.getScissor();
      device.pushDeviceStates();
      device.setFramebuffer(singleColorFramebuffer);
      device.setViewport(viewport);
      device.setScissor(scissor);
    }
    try {
      device.setProgram(DualDepthPeelingOIT.getCompositeProgram(device));
      DualDepthPeelingOIT._compositeBindGroup!.setTexture('frontTex', frontTarget);
      DualDepthPeelingOIT._compositeBindGroup!.setTexture('backTex', backTarget);
      device.setBindGroup(0, DualDepthPeelingOIT._compositeBindGroup!);
      drawFullscreenQuad(DualDepthPeelingOIT._compositeRenderStates!);
    } finally {
      if (singleColorFramebuffer) {
        device.popDeviceStates();
        device.pool.releaseFrameBuffer(singleColorFramebuffer);
      }
    }
  }

  /** @internal */
  private releaseFramebuffers() {
    if (this._device) {
      if (this._framebuffers[0]) {
        this._device.pool.releaseFrameBuffer(this._framebuffers[0]);
      }
      if (this._framebuffers[1]) {
        this._device.pool.releaseFrameBuffer(this._framebuffers[1]);
      }
    }
    this._depthTargets = [null, null];
    this._frontTarget = null;
    this._backTarget = null;
    this._framebuffers = [null, null];
    this._device = null;
  }

  /** @internal */
  private static getCompositeProgram(device: AbstractDevice) {
    if (!this._compositeProgram) {
      this._compositeProgram = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type === 'webgpu') {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            }
          });
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.frontTex = pb.tex2D().uniform(0);
          this.backTex = pb.tex2D().uniform(0);
          pb.main(function () {
            this.$l.frontColor = pb.textureSample(this.frontTex, this.$inputs.uv);
            this.$l.backColor = pb.textureSample(this.backTex, this.$inputs.uv);
            this.$l.remainingAlpha = pb.clamp(pb.mul(this.frontColor.a, pb.sub(1, this.backColor.a)), 0, 1);
            this.$outputs.outColor = pb.vec4(
              pb.add(this.frontColor.rgb, pb.mul(this.frontColor.a, this.backColor.rgb)),
              this.remainingAlpha
            );
          });
        }
      })!;
      this._compositeProgram.name = '@DualDepthPeelingOIT_Composite';
      this._compositeBindGroup = device.createBindGroup(this._compositeProgram.bindGroupLayouts[0]);
      this._compositeRenderStates = device.createRenderStateSet();
      this._compositeRenderStates
        .useBlendingState()
        .enable(true)
        .setBlendFuncRGB('one', 'src-alpha')
        .setBlendFuncAlpha('zero', 'one');
      this._compositeRenderStates.useDepthState().enableTest(false).enableWrite(false);
    }
    return this._compositeProgram;
  }

  protected onDispose() {
    super.onDispose();
    this.releaseFramebuffers();
  }
}
