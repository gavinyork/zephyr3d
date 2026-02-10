import type {
  AbstractDevice,
  BindGroup,
  DeviceViewport,
  GPUDataBuffer,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet
} from '@zephyr3d/device';
import type { OIT } from './oit';
import type { DrawContext } from './drawable';
import { drawFullscreenQuad } from './fullscreenquad';
import { ShaderHelper } from '../material';
import type { Nullable } from '@zephyr3d/base';
import { Disposable } from '@zephyr3d/base';

/**
 * per-pixel linked list OIT renderer using ABuffer.
 *
 * @remarks
 * The ABuffer OIT renderer only supports WebGPU device.
 *
 * @public
 */
export class ABufferOIT extends Disposable implements OIT {
  /** Type name of ABufferOIT */
  public static readonly type = 'ab';
  public static readonly usePremultipliedAlpha = true;
  private static readonly MAX_FRAGMENT_LAYERS = 75;
  private static _compositeProgram: Nullable<GPUProgram> = null;
  private static _compositeBindGroup: Nullable<BindGroup> = null;
  private static _compositeRenderStates: Nullable<RenderStateSet> = null;
  private static _ubAlignment = 0;
  private _nodeBuffer: Nullable<GPUDataBuffer>;
  private _headStagingBuffer: Nullable<GPUDataBuffer>;
  private _headBuffer: Nullable<GPUDataBuffer>;
  private _scissorOffsetBuffer: Nullable<GPUDataBuffer>;
  private readonly _numLayers: number;
  private _screenSize: Uint32Array<ArrayBuffer>;
  private _hash: Nullable<string>;
  private readonly _debug: boolean;
  private _scissorSlices: number;
  private _scissorHeight: number;
  private _currentPass: number;
  private _savedScissor: Nullable<DeviceViewport>;
  /**
   * Creates an instance of ABufferOIT class
   *
   * @param numLayers - How many transparent layers, default is 16
   */
  constructor(numLayers = 16) {
    super();
    this._nodeBuffer = null;
    this._headStagingBuffer = null;
    this._headBuffer = null;
    this._scissorOffsetBuffer = null;
    this._numLayers = numLayers;
    this._screenSize = new Uint32Array([0xffffffff, 0xffffffff]);
    this._hash = null;
    this._debug = false;
    this._scissorSlices = 0;
    this._scissorHeight = 0;
    this._savedScissor = null;
    this._currentPass = 0;
  }
  /**
   * {@inheritDoc OIT.getType}
   */
  getType() {
    return ABufferOIT.type;
  }
  /**
   * {@inheritDoc OIT.supportDevice}
   */
  supportDevice(deviceType: string) {
    return deviceType === 'webgpu';
  }
  /**
   * {@inheritDoc OIT.wantsPremultipliedAlpha}
   */
  wantsPremultipliedAlpha() {
    return ABufferOIT.usePremultipliedAlpha;
  }
  /**
   * {@inheritDoc OIT.begin}
   */
  begin(ctx: DrawContext) {
    const device = ctx.device;
    this._savedScissor = device.getScissor();
    const ubAlignment = (ABufferOIT._ubAlignment =
      device.getDeviceCaps().shaderCaps.uniformBufferOffsetAlignment);
    const viewport = device.getViewport();
    const screenWidth = device.screenXToDevice(viewport.width);
    const screenHeight = device.screenYToDevice(Math.max(viewport.height, 1));
    if (screenWidth !== this._screenSize[0] || screenHeight !== this._screenSize[1]) {
      // Resize buffers if viewport was changed
      this._screenSize[0] = screenWidth;
      this._screenSize[1] = screenHeight;
      // compute scissor slices
      const maxBufferSize = device.getDeviceCaps().shaderCaps.maxStorageBufferSize;
      const bytesPerLine = screenWidth * 4 * 4 * this._numLayers;
      this._scissorHeight = (maxBufferSize / bytesPerLine) >> 0;
      this._scissorSlices = Math.ceil(screenHeight / this._scissorHeight);
      const offsetBufferSize = ubAlignment * this._scissorSlices;
      const offsetBuffer = new Uint32Array(offsetBufferSize >> 2);
      for (let i = 0; i < this._scissorSlices; i++) {
        offsetBuffer[i * (ubAlignment >> 2)] = i * this._scissorHeight;
      }
      if (!this._scissorOffsetBuffer || this._scissorOffsetBuffer.byteLength < offsetBuffer.byteLength) {
        this._scissorOffsetBuffer?.dispose();
        this._scissorOffsetBuffer = device.createBuffer(offsetBuffer.byteLength, { usage: 'uniform' });
      }
      this._scissorOffsetBuffer.bufferSubData(0, offsetBuffer);
      // resize node buffer
      const size = screenWidth * this._scissorHeight * 4;
      const nodeBufferSize = size * 4 * this._numLayers;
      if (!this._nodeBuffer || nodeBufferSize > this._nodeBuffer.byteLength) {
        this._nodeBuffer?.dispose();
        this._nodeBuffer = device.createBuffer(nodeBufferSize, { storage: true, usage: 'uniform' });
      }
      // resize head buffer
      const headBufferSize = size + 4;
      if (!this._headBuffer || headBufferSize > this._headBuffer.byteLength) {
        this._headBuffer?.dispose();
        this._headBuffer = device.createBuffer(headBufferSize, { storage: true, usage: 'uniform' });
        this._headStagingBuffer?.dispose();
        this._headStagingBuffer = device.createBuffer(headBufferSize, { storage: true, usage: 'uniform' });
        const tmpArray = new Uint32Array(headBufferSize >> 2);
        tmpArray.fill(0xffffffff);
        this._headStagingBuffer.bufferSubData(0, tmpArray);
      }
    }
    return this._scissorSlices;
  }
  /**
   * {@inheritDoc OIT.end}
   */
  end(ctx: DrawContext) {
    // Restore scissor rect
    ctx.device.setScissor(this._savedScissor);
  }
  /**
   * {@inheritDoc OIT.setupFragmentOutput}
   */
  setupFragmentOutput(scope: PBGlobalScope) {
    const pb = scope.$builder;
    scope.Z_AB_scissorOffset = pb.uint().uniformBuffer(2);
    scope.Z_AB_nodeBuffer = pb.uvec4[0]().storageBuffer(2);
    scope.Z_AB_headImage = pb.atomic_uint[0]().storageBuffer(2);
    scope.Z_AB_screenSize = pb.uint().uniform(2);
    scope.Z_AB_depthTexture = pb.tex2D().uniform(2);
    scope.$outputs.outColor = pb.vec4();
  }
  /**
   * {@inheritDoc OIT.beginPass}
   */
  beginPass(ctx: DrawContext, pass: number) {
    this._currentPass = pass;
    const device = ctx.device;
    const scissorY = pass * this._scissorHeight;
    const scissorH =
      Math.min((pass + 1) * this._scissorHeight, this._screenSize[1]) - pass * this._scissorHeight;
    device.setScissor([
      0,
      device.deviceYToScreen(this._screenSize[1] - scissorY - scissorH),
      device.deviceXToScreen(this._screenSize[0]),
      device.deviceYToScreen(scissorH)
    ]);
    device.copyBuffer(this._headStagingBuffer!, this._headBuffer!, 0, 0, this._headStagingBuffer!.byteLength);
    // Update render hash
    this._hash = `${this.getType()}#${this._nodeBuffer!.uid}#${this._headBuffer!.uid}#${
      this._scissorOffsetBuffer!.uid
    }#${pass}`;
    if (this._debug) {
      const data = new Uint8Array(this._headBuffer!.byteLength);
      const readBuffer = device.createBuffer(this._headBuffer!.byteLength, { usage: 'read' });
      device.copyBuffer(this._headBuffer!, readBuffer, 0, 0, this._headBuffer!.byteLength);
      readBuffer.getBufferSubData(data).then(() => {
        const uint = new Uint32Array(data.buffer);
        for (let i = 0; i < uint.length; i++) {
          if (uint[i] !== 0) {
            console.error('Clear head buffer failed');
            break;
          }
        }
        readBuffer.dispose();
      });
    }
    return true;
  }
  /**
   * {@inheritDoc OIT.endPass}
   */
  endPass(ctx: DrawContext, pass: number) {
    const device = ctx.device;
    ABufferOIT.getCompositeProgram(device);
    const lastBindGroup = device.getBindGroup(0);
    device.setProgram(ABufferOIT.getCompositeProgram(device));
    const bindGroup = ABufferOIT._compositeBindGroup!;
    bindGroup.setBuffer(
      'scissorOffset',
      this._scissorOffsetBuffer!,
      0,
      pass * ABufferOIT._ubAlignment,
      ABufferOIT._ubAlignment
    );
    bindGroup.setBuffer('headBuffer', this._headBuffer!);
    bindGroup.setBuffer('nodeBuffer', this._nodeBuffer!);
    bindGroup.setValue('screenWidth', this._screenSize[0]);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad(ABufferOIT._compositeRenderStates!);
    device.setBindGroup(0, lastBindGroup[0], lastBindGroup[1]);
  }
  /**
   * {@inheritDoc OIT.calculateHash}
   */
  calculateHash() {
    return this._hash!;
  }
  /**
   * {@inheritDoc OIT.applyUniforms}
   */
  applyUniforms(ctx: DrawContext, bindGroup: BindGroup) {
    bindGroup.setBuffer('Z_AB_nodeBuffer', this._nodeBuffer!);
    bindGroup.setBuffer(
      'Z_AB_scissorOffset',
      this._scissorOffsetBuffer!,
      0,
      this._currentPass * ABufferOIT._ubAlignment,
      ABufferOIT._ubAlignment
    );
    bindGroup.setBuffer('Z_AB_headImage', this._headBuffer!);
    bindGroup.setValue('Z_AB_screenSize', this._screenSize[0]);
    bindGroup.setTexture('Z_AB_depthTexture', ctx.linearDepthTexture!);
  }
  /**
   * {@inheritDoc OIT.outputFragmentColor}
   */
  outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp) {
    const pb = scope.$builder;
    // linear depth of current fragment
    scope.$l.fragDepth = ShaderHelper.nonLinearDepthToLinearNormalized(scope, scope.$builtins.fragCoord.z);
    // linear depth in depth texture
    scope.$l.linearDepth = pb.textureLoad(
      scope.Z_AB_depthTexture,
      pb.ivec2(scope.$builtins.fragCoord.xy),
      0
    ).r;
    // saved to buffer only if nothing is infront
    scope.$if(pb.lessThan(scope.fragDepth, scope.linearDepth), function () {
      this.$l.Z_AB_pixelCount = pb.atomicAdd(this.Z_AB_headImage.at(0), 1);
      this.$l.Z_AB_nodeOffset = this.Z_AB_pixelCount;
      // save if index not exceeded
      this.$if(pb.lessThan(this.Z_AB_nodeOffset, pb.arrayLength(this.Z_AB_nodeBuffer)), function () {
        this.$l.Z_AB_headOffset = pb.add(
          pb.mul(this.Z_AB_screenSize, pb.sub(pb.uint(this.$builtins.fragCoord.y), this.Z_AB_scissorOffset)),
          pb.uint(this.$builtins.fragCoord.x)
        );
        this.$l.Z_AB_oldHead = pb.atomicExchange(
          this.Z_AB_headImage.at(pb.add(this.Z_AB_headOffset, 1)),
          this.Z_AB_nodeOffset
        );
        this.$l.Z_AB_colorScale = pb.floatBitsToUint(pb.length(color.rgb));
        this.$l.Z_AB_color = pb.pack4x8unorm(pb.vec4(pb.normalize(color.rgb), pb.clamp(color.a, 0, 1)));
        this.$l.Z_AB_depth = pb.floatBitsToUint(this.fragDepth);
        this.Z_AB_nodeBuffer.setAt(
          this.Z_AB_nodeOffset,
          pb.uvec4(this.Z_AB_color, this.Z_AB_colorScale, this.Z_AB_depth, this.Z_AB_oldHead)
        );
        pb.discard();
      });
    });
    return true;
  }
  /**
   * {@inheritDoc OIT.setRenderStates}
   */
  setRenderStates(rs: RenderStateSet) {
    const stencilStates = rs.useStencilState();
    stencilStates.enable(true);
    stencilStates.setFrontCompareFunc('always');
    stencilStates.setBackCompareFunc('always');
    stencilStates.setFrontOp('keep', 'keep', 'replace');
    stencilStates.setBackOp('keep', 'keep', 'replace');
    stencilStates.setReference(1);
    stencilStates.setReadMask(0xff);
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
          this.scissorOffset = pb.uint().uniformBuffer(0);
          this.headBuffer = pb.uint[0]().storageBuffer(0);
          this.nodeBuffer = pb.uvec4[0]().storageBuffer(0);
          this.screenWidth = pb.uint().uniform(0);
          pb.func('unpackColor', [pb.uvec4('x')], function () {
            this.$l.colorNorm = pb.unpack4x8unorm(this.x.x);
            this.$l.colorScale = pb.uintBitsToFloat(this.x.y);
            this.$return(pb.vec4(pb.mul(this.colorNorm.rgb, this.colorScale), this.colorNorm.a));
          });
          pb.main(function () {
            this.$l.fragmentArray = pb.uvec4[ABufferOIT.MAX_FRAGMENT_LAYERS]();
            this.$l.fragmentArrayLen = pb.uint(0);
            this.$l.offset = pb.add(
              pb.mul(this.screenWidth, pb.sub(pb.uint(this.$builtins.fragCoord.y), this.scissorOffset)),
              pb.uint(this.$builtins.fragCoord.x)
            );
            //this.$l.head = this.headBuffer.at(this.offset);
            this.$l.head = this.headBuffer.at(pb.add(this.offset, 1));
            this.$while(
              pb.and(
                pb.lessThan(this.fragmentArrayLen, ABufferOIT.MAX_FRAGMENT_LAYERS),
                pb.notEqual(this.head, 0xffffffff)
              ),
              function () {
                this.fragmentArray.setAt(this.fragmentArrayLen, this.nodeBuffer.at(this.head));
                this.head = this.fragmentArray.at(this.fragmentArrayLen).w;
                this.fragmentArrayLen = pb.add(this.fragmentArrayLen, 1);
              }
            );
            this.$if(pb.equal(this.fragmentArrayLen, 0), function () {
              this.$outputs.outColor = pb.vec4(0, 0, 0, 1);
            }).$else(function () {
              // bubble sort
              this.$for(pb.uint('i'), 0, pb.sub(this.fragmentArrayLen, 1), function () {
                this.$for(pb.uint('j'), 0, pb.sub(pb.sub(this.fragmentArrayLen, 1), this.i), function () {
                  this.$l.a = this.fragmentArray.at(this.j);
                  this.$l.b = this.fragmentArray.at(pb.add(this.j, 1));
                  this.$if(pb.greaterThan(this.a.z, this.b.z), function () {
                    this.fragmentArray.setAt(this.j, this.b);
                    this.fragmentArray.setAt(pb.add(this.j, 1), this.a);
                  });
                });
              });
              // under operator blending
              this.$l.c0 = this.unpackColor(this.fragmentArray[0]);
              this.$l.c_dst = ABufferOIT.usePremultipliedAlpha ? this.c0.rgb : pb.mul(this.c0.rgb, this.c0.a);
              this.$l.a_dst = pb.sub(1, this.c0.a);
              this.$for(pb.uint('i'), 1, this.fragmentArrayLen, function () {
                this.$l.c = this.unpackColor(this.fragmentArray.at(this.i));
                if (ABufferOIT.usePremultipliedAlpha) {
                  this.c_dst = pb.add(this.c_dst, pb.mul(this.c.rgb, this.a_dst));
                } else {
                  this.c_dst = pb.add(this.c_dst, pb.mul(this.c.rgb, this.c.a, this.a_dst));
                }
                this.a_dst = pb.mul(this.a_dst, pb.sub(1, this.c.a));
              });
              this.$outputs.outColor = pb.vec4(this.c_dst, this.a_dst);
            });
          });
        }
      })!;
      this._compositeProgram.name = '@ABufferOIT_Composite';
      this._compositeBindGroup = device.createBindGroup(this._compositeProgram.bindGroupLayouts[0]);
      this._compositeRenderStates = device.createRenderStateSet();
      this._compositeRenderStates
        .useBlendingState()
        .enable(true)
        .setBlendFuncRGB('one', 'src-alpha')
        .setBlendFuncAlpha('zero', 'one');
      this._compositeRenderStates.useDepthState().enableTest(false).enableWrite(false);
      const stencilStates = this._compositeRenderStates.useStencilState();
      stencilStates.enable(false);
      stencilStates.setFrontCompareFunc('always');
      stencilStates.setBackCompareFunc('always');
      stencilStates.setFrontOp('keep', 'keep', 'replace');
      stencilStates.setBackOp('keep', 'keep', 'replace');
      stencilStates.setReference(0);
      stencilStates.setReadMask(0xff);
    }
    return this._compositeProgram;
  }
  protected onDispose() {
    super.onDispose();
    this._nodeBuffer?.dispose();
    this._nodeBuffer = null;
    this._headStagingBuffer?.dispose();
    this._headStagingBuffer = null;
    this._headBuffer?.dispose();
    this._headBuffer = null;
    this._scissorOffsetBuffer?.dispose();
    this._scissorOffsetBuffer = null;
    this._hash = null;
    this._savedScissor = null;
  }
}
