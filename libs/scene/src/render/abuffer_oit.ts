// FIXME:
// consider devicePixelRatio

import type { AbstractDevice, BindGroup, DeviceViewport, GPUDataBuffer, GPUProgram, PBGlobalScope, PBInsideFunctionScope, PBShaderExp, RenderStateSet } from "@zephyr3d/device";
import { OIT } from "./oit";
import { DrawContext } from "./drawable";
import { Application } from "../app";
import { drawFullscreenQuad } from "./fullscreenquad";
import { ShaderHelper } from "../material";

export class ABufferOIT extends OIT {
  public static readonly type = 'ab';
  private static MAX_FRAGMENT_LAYERS = 75;
  private static _clearProgram: GPUProgram = null;
  private static _clearBindGroup: BindGroup = null;
  private static _clearRenderStates: RenderStateSet = null;
  private static _compositeProgram: GPUProgram = null;
  private static _compositeBindGroup: BindGroup = null;
  private static _compositeRenderStates: RenderStateSet = null;
  private static _ubAlignment = 0;
  private static _sbAlignment = 0;
  private _nodeBuffer: GPUDataBuffer;
  private _counterBuffer: GPUDataBuffer;
  private _nodeHeadImage: GPUDataBuffer;
  private _scissorOffsetBuffer: GPUDataBuffer;
  private _numLayers: number;
  private _screenSize: Uint32Array;
  private _offsetBuffer: Uint32Array;
  private _clearBuffer: Uint32Array;
  private _hash: string;
  private _debug: boolean;
  private _scissorSlices: number;
  private _scissorHeight: number;
  private _currentPass: number;
  private _savedScissor: DeviceViewport;
  constructor(numLayers = 16) {
    super();
    this._nodeBuffer = null;
    this._counterBuffer = null;
    this._nodeHeadImage = null;
    this._scissorOffsetBuffer = null;
    this._offsetBuffer = null;
    this._clearBuffer = null;
    this._numLayers = numLayers;
    this._screenSize = new Uint32Array([0xffffffff, 0xffffffff]);
    this._hash = null;
    this._debug = false;
    this._scissorSlices = 0;
    this._scissorHeight = 0;
    this._savedScissor = null;
    this._currentPass = 0;
  }
  getType(): string {
    return ABufferOIT.type;
  }
  supportDevice(deviceType: string): boolean {
    return deviceType === 'webgpu';
  }
  begin(ctx: DrawContext): number {
    const device = Application.instance.device;
    this._savedScissor = device.getScissor();
    const ubAlignment = ABufferOIT._ubAlignment = device.getDeviceCaps().shaderCaps.uniformBufferOffsetAlignment;
    const sbAlignment = ABufferOIT._sbAlignment = device.getDeviceCaps().shaderCaps.storageBufferOffsetAlignment;
    const viewport = device.getViewport();
    const screenWidth = device.screenToDevice(viewport.width);
    const screenHeight = device.screenToDevice(Math.max(viewport.height, 1));
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
        this._nodeBuffer = device.createBuffer(nodeBufferSize, { storage: true, usage: 'uniform', });
      }
      if (!this._clearBuffer || this._clearBuffer.byteLength < (size >> 2)) {
        this._clearBuffer = new Uint32Array(size >> 2);
        this._clearBuffer.fill(0xffffffff);
      }
      // resize head buffer and clear
      if (!this._nodeHeadImage || size > this._nodeHeadImage.byteLength) {
        this._nodeHeadImage?.dispose();
        this._nodeHeadImage = device.createBuffer(size, { storage: true, usage: 'uniform' });
      }
      // resize counter buffer if needed
      const counterBufferSize = sbAlignment * this._scissorSlices;
      if (!this._offsetBuffer || this._offsetBuffer.byteLength < counterBufferSize) {
        this._offsetBuffer = new Uint32Array(counterBufferSize >> 2);
      }
      if (!this._counterBuffer || this._counterBuffer.byteLength < counterBufferSize) {
        this._counterBuffer?.dispose();
        this._counterBuffer = device.createBuffer(counterBufferSize, { storage: true, usage: 'uniform' });
      }
    }
    return this._scissorSlices;
  }
  end(ctx: DrawContext) {
    // Restore scissor rect
    Application.instance.device.setScissor(this._savedScissor);
  }
  setupFragmentOutput(scope: PBGlobalScope) {
    const pb = scope.$builder;
    scope.Z_AB_scissorOffset = pb.uint().uniformBuffer(2);
    scope.Z_AB_nodeBuffer = pb.uvec4[0]().storageBuffer(2);
    scope.Z_AB_headImage = pb.atomic_uint[0]().storageBuffer(2);
    scope.Z_AB_counter = pb.atomic_uint().storageBuffer(2);
    scope.Z_AB_screenSize = pb.uint().uniform(2);
    scope.Z_AB_depthTexture = pb.tex2D().uniform(2);
    scope.$outputs.outColor = pb.vec4();
  }
  clearHeadBuffer(device: AbstractDevice) {
    const program = ABufferOIT.getClearProgram(device);
    const bindGroup = ABufferOIT._clearBindGroup;
    bindGroup.setValue('screenWidth', this._screenSize[0]);
    bindGroup.setBuffer('headBuffer', this._nodeHeadImage);
    const lastBindGroup = device.getBindGroup(0);
    device.pushDeviceStates();
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad(ABufferOIT._clearRenderStates);
    device.popDeviceStates();
    device.setBindGroup(0, lastBindGroup[0], lastBindGroup[1]);
  }
  beginPass(ctx: DrawContext, pass: number) {
    this._currentPass = pass;
    const device = Application.instance.device;
    const scissorY = pass * this._scissorHeight;
    const scissorH = Math.min((pass + 1) * this._scissorHeight, this._screenSize[1]) - pass * this._scissorHeight;
    device.setScissor([0, device.deviceToScreen(this._screenSize[1] - scissorY - scissorH), device.deviceToScreen(this._screenSize[0]), device.deviceToScreen(scissorH)])
    this._nodeHeadImage.bufferSubData(0, this._clearBuffer);
    this._counterBuffer.bufferSubData(0, this._offsetBuffer);
    //this.clearHeadBuffer(device);
    // Update render hash
    this._hash = `${this.getType()}#${this._nodeBuffer.uid}#${this._nodeHeadImage.uid}#${this._scissorOffsetBuffer.uid}#${pass}`;
    if (this._debug) {
      const data = new Uint8Array(this._nodeHeadImage.byteLength);
      const readBuffer = device.createBuffer(this._nodeHeadImage.byteLength, { usage: 'read' });
      device.copyBuffer(this._nodeHeadImage, readBuffer, 0, 0, this._nodeHeadImage.byteLength);
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
  endPass(ctx: DrawContext, pass: number) {
    const device = Application.instance.device;
    ABufferOIT.getCompositeProgram(device);
    const lastBindGroup = device.getBindGroup(0);
    device.setProgram(ABufferOIT.getCompositeProgram(device))
    const bindGroup = ABufferOIT._compositeBindGroup;
    bindGroup.setBuffer('scissorOffset', this._scissorOffsetBuffer, 0, pass * ABufferOIT._ubAlignment, ABufferOIT._ubAlignment);
    bindGroup.setBuffer('headBuffer', this._nodeHeadImage);
    bindGroup.setBuffer('nodeBuffer', this._nodeBuffer);
    bindGroup.setValue('screenWidth', this._screenSize[0]);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad(ABufferOIT._compositeRenderStates);
    device.setBindGroup(0, lastBindGroup[0], lastBindGroup[1]);
  }
  calculateHash(): string {
    return this._hash;
  }
  applyUniforms(ctx: DrawContext, bindGroup: BindGroup) {
    bindGroup.setBuffer('Z_AB_nodeBuffer', this._nodeBuffer);
    bindGroup.setBuffer('Z_AB_counter', this._counterBuffer, 0, this._currentPass * ABufferOIT._sbAlignment, ABufferOIT._sbAlignment);
    bindGroup.setBuffer('Z_AB_scissorOffset', this._scissorOffsetBuffer, 0, this._currentPass * ABufferOIT._ubAlignment, ABufferOIT._ubAlignment);
    bindGroup.setBuffer('Z_AB_headImage', this._nodeHeadImage);
    bindGroup.setValue('Z_AB_screenSize', this._screenSize[0]);
    bindGroup.setTexture('Z_AB_depthTexture', ctx.linearDepthTexture);
  }
  outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp) {
    const pb = scope.$builder;
    // linear depth of current fragment
    scope.$l.fragDepth = ShaderHelper.nonLinearDepthToLinearNormalized(scope, scope.$builtins.fragCoord.z) ;
    // linear depth in depth texture
    scope.$l.linearDepth = pb.textureLoad(scope.Z_AB_depthTexture, pb.ivec2(scope.$builtins.fragCoord.xy), 0).r;
    // saved to buffer only if nothing is infront
    scope.$if(pb.lessThan(scope.fragDepth, scope.linearDepth), function(){
      this.$l.Z_AB_pixelCount = pb.atomicAdd(this.Z_AB_counter, 1);
      this.$l.Z_AB_nodeOffset = this.Z_AB_pixelCount;
      // save if index not exceeded
      this.$if(pb.lessThan(this.Z_AB_nodeOffset, pb.arrayLength(this.Z_AB_nodeBuffer)), function(){
        this.$l.Z_AB_headOffset = pb.add(pb.mul(this.Z_AB_screenSize, pb.sub(pb.uint(this.$builtins.fragCoord.y), this.Z_AB_scissorOffset)), pb.uint(this.$builtins.fragCoord.x));
        this.$l.Z_AB_oldHead = pb.atomicExchange(this.Z_AB_headImage.at(this.Z_AB_headOffset), this.Z_AB_nodeOffset);
        this.$l.Z_AB_colorScale = pb.floatBitsToUint(pb.length(color.rgb));
        this.$l.Z_AB_color = pb.pack4x8unorm(pb.vec4(pb.normalize(color.rgb), pb.clamp(color.a, 0, 1)));
        this.$l.Z_AB_depth = pb.floatBitsToUint(this.fragDepth);
        this.Z_AB_nodeBuffer.setAt(this.Z_AB_nodeOffset, pb.uvec4(this.Z_AB_color, this.Z_AB_colorScale, this.Z_AB_depth, this.Z_AB_oldHead));
        pb.discard;
      });
    });
    return true;
  }
  setRenderStates(rs: RenderStateSet) {
    const stencilStates = rs.useStencilState();
    stencilStates.enable(true);
    stencilStates.setFrontCompareFunc('always');
    stencilStates.setBackCompareFunc('always');
    stencilStates.setFrontOp('keep', 'keep', 'replace');
    stencilStates.setBackOp('keep', 'keep', 'replace');
    stencilStates.setReference(1);
    stencilStates.setReadMask(0xFF);
  }
  private static getClearProgram(device: AbstractDevice) {
    if (!this._clearProgram) {
      this._clearProgram = device.buildRenderProgram({
        vertex(pb){
          this.$inputs.pos = pb.vec2().attrib('position');
          pb.main(function() {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
          });
        },
        fragment(pb){
          this.$outputs.color = pb.vec4();
          this.screenWidth = pb.uint().uniform(0);
          this.headBuffer = pb.atomic_uint[0]().storageBuffer(0);
          pb.main(function(){
            this.$l.offset = pb.add(pb.mul(pb.uint(this.$builtins.fragCoord.y), this.screenWidth), pb.uint(this.$builtins.fragCoord.x));
            pb.atomicExchange(this.headBuffer.at(this.offset), 0xffffffff);
            pb.discard();
          });
        }
      });
      this._clearBindGroup = device.createBindGroup(this._clearProgram.bindGroupLayouts[0]);
      this._clearRenderStates = device.createRenderStateSet();
      this._clearRenderStates.useDepthState().enableTest(false).enableWrite(false);
      this._clearRenderStates.useRasterizerState().setCullMode('none');
    }
    return this._clearProgram;
  }
  private static getCompositeProgram(device: AbstractDevice) {
    if (!this._compositeProgram) {
      this._compositeProgram = device.buildRenderProgram({
        vertex(pb){
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
        fragment(pb){
          this.$outputs.outColor = pb.vec4();
          this.scissorOffset = pb.uint().uniformBuffer(0);
          this.headBuffer = pb.atomic_uint[0]().storageBuffer(0);
          this.nodeBuffer = pb.uvec4[0]().storageBuffer(0);
          this.screenWidth = pb.uint().uniform(0);
          pb.func('unpackColor', [pb.uvec4('x')], function(){
            this.$l.colorNorm = pb.unpack4x8unorm(this.x.x);
            this.$l.colorScale = pb.uintBitsToFloat(this.x.y);
            this.$return(pb.vec4(pb.mul(this.colorNorm.rgb, this.colorScale), this.colorNorm.a));
          });
          pb.main(function () {
            this.$l.fragmentArray = pb.uvec4[ABufferOIT.MAX_FRAGMENT_LAYERS]();
            this.$l.fragmentArrayLen = pb.uint(0);
            this.$l.offset = pb.add(pb.mul(this.screenWidth, pb.sub(pb.uint(this.$builtins.fragCoord.y), this.scissorOffset)), pb.uint(this.$builtins.fragCoord.x));
            //this.$l.head = this.headBuffer.at(this.offset);
            this.$l.head = pb.atomicExchange(this.headBuffer.at(this.offset), 0xffffffff);
            this.$while(pb.and(pb.lessThan(this.fragmentArrayLen, ABufferOIT.MAX_FRAGMENT_LAYERS), pb.notEqual(this.head, 0xffffffff)), function(){
              this.fragmentArray.setAt(this.fragmentArrayLen, this.nodeBuffer.at(this.head));
              this.head = this.fragmentArray.at(this.fragmentArrayLen).w;
              this.fragmentArrayLen = pb.add(this.fragmentArrayLen, 1);
            });
            /*
            this.$if(pb.equal(this.fragmentArrayLen, 0), function(){
              this.$if(pb.greaterThan(this.scissorOffset, 0), function(){
                this.$outputs.outColor = pb.vec4(0, 1, 0, 0);
              }).$else(function(){
                this.$outputs.outColor = pb.vec4(0, 0, 1, 0);
              })
            }).$else(function() {
              this.$outputs.outColor = pb.vec4(pb.div(pb.float(this.fragmentArrayLen), pb.float(100)), 0, 0, 0);
            });
            return;
            */
            this.$if(pb.equal(this.fragmentArrayLen, 0), function(){
              this.$outputs.outColor = pb.vec4(0, 0, 0, 1);
            }).$else(function(){
              // bubble sort
              this.$for(pb.uint('i'), 0, pb.sub(this.fragmentArrayLen, 1), function(){
                this.$for(pb.uint('j'), 0, pb.sub(pb.sub(this.fragmentArrayLen, 1), this.i), function(){
                  this.$l.a = this.fragmentArray.at(this.j);
                  this.$l.b = this.fragmentArray.at(pb.add(this.j, 1));
                  this.$if(pb.greaterThan(this.a.z, this.b.z), function(){
                    this.fragmentArray.setAt(this.j, this.b);
                    this.fragmentArray.setAt(pb.add(this.j, 1), this.a);
                  });
                });
              });
              // under operator blending
              this.$l.c0 = this.unpackColor(this.fragmentArray[0]);
              this.$l.c_dst = pb.mul(this.c0.rgb, this.c0.a);
              this.$l.a_dst = pb.sub(1, this.c0.a);
              this.$for(pb.uint('i'), 1, this.fragmentArrayLen, function(){
                this.$l.c = this.unpackColor(this.fragmentArray.at(this.i));
                this.c_dst = pb.add(pb.mul(this.c.rgb, this.c.a, this.a_dst), this.c_dst);
                this.a_dst = pb.mul(this.a_dst, pb.sub(1, this.c.a));
              });
              this.$outputs.outColor = pb.vec4(this.c_dst, this.a_dst);
            });
          });
        }
      });
      this._compositeBindGroup = device.createBindGroup(this._compositeProgram.bindGroupLayouts[0]);
      this._compositeRenderStates = device.createRenderStateSet();
      this._compositeRenderStates.useBlendingState().enable(true).setBlendFuncRGB('one', 'src-alpha').setBlendFuncAlpha('zero', 'one');
      this._compositeRenderStates.useDepthState().enableTest(false).enableWrite(false);
      const stencilStates = this._compositeRenderStates.useStencilState();
      stencilStates.enable(false);
      stencilStates.setFrontCompareFunc('always');
      stencilStates.setBackCompareFunc('always');
      stencilStates.setFrontOp('keep', 'keep', 'replace');
      stencilStates.setBackOp('keep', 'keep', 'replace');
      stencilStates.setReference(0);
      stencilStates.setReadMask(0xFF);
      console.log(this._compositeProgram.getShaderSource('fragment'));
    }
    return this._compositeProgram;
  }
}
