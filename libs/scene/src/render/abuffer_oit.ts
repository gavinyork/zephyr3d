/*
// Under operator blending

function mix(t) {
  let c_dst = t[0].c * t[0].a;
  let a_dst = 1 - t[0].a;
  for (let i = 1; i < t.length; i++) {
    let c_src = t[i].c;
    let a_src = t[i].a;
    c_dst = c_src * a_src * a_dst + c_dst;
    a_dst = a_dst * (1 - a_src);
  }
  return { c: c_dst, a: a_dst };
}

function under(t, d) {
  const x = mix(t);
  return x.a * d + x.c;
}

function over(t, d) {
  let c = d;
  for (let i = t.length - 1; i >= 0; i--) {
    const s = t[i];
    c = s.c * s.a + c * (1 - s.a);
  }
  return c;
}
*/

import type { AbstractDevice, BindGroup, GPUDataBuffer, GPUProgram, PBGlobalScope, PBInsideFunctionScope, PBShaderExp, RenderStateSet, Texture2D } from "@zephyr3d/device";
import { OIT } from "./oit";
import { DrawContext } from "./drawable";
import { Application } from "../app";
import { drawFullscreenQuad } from "./fullscreenquad";
import { ShaderHelper } from "../material";

export class ABufferOIT extends OIT {
  public static readonly type = 'ab';
  private static _clearProgram: GPUProgram;
  private static _clearBindGroup: BindGroup;
  private static _clearRenderStates: RenderStateSet;
  private static _compositeProgram: GPUProgram;
  private static _compositeBindGroup: BindGroup;
  private static _compositeRenderStates: RenderStateSet;
  private _nodeBuffer: GPUDataBuffer;
  private _counterBuffer: GPUDataBuffer;
  private _nodeHeadImage: GPUDataBuffer;
  private _numLayers: number;
  private _screenSize: Uint32Array;
  private _hash: string;
  constructor() {
    super();
    this._nodeBuffer = null;
    this._counterBuffer = null;
    this._nodeHeadImage = null;
    this._numLayers = 10;
    this._screenSize = new Uint32Array([0xffffffff, 0xffffffff]);
    this._hash = null;
  }
  getType(): string {
    return ABufferOIT.type;
  }
  getNumPasses(): number {
    return 1;
  }
  setupFragmentOutput(scope: PBGlobalScope) {
    const pb = scope.$builder;
    scope.Z_AB_nodeBuffer = pb.uvec4[0]().storageBuffer(2);
    scope.Z_AB_headImage = pb.atomic_uint[0]().storageBuffer(2);
    scope.Z_AB_counter = pb.atomic_uint().storageBuffer(2);
    scope.Z_AB_screenSize = pb.vec2().storage(2);
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
  begin(ctx: DrawContext, pass: number) {
    const device = Application.instance.device;
    const viewport = device.getViewport();
    const screenWidth = device.screenToDevice(viewport.width);
    const screenHeight = device.screenToDevice(viewport.height);
    if (screenWidth !== this._screenSize[0] || screenHeight !== this._screenSize[1]) {
      this._screenSize[0] = screenWidth;
      this._screenSize[1] = screenHeight;
      this._nodeBuffer?.dispose();
      const size = screenWidth * screenHeight * 4;
      this._nodeBuffer = device.createBuffer(size * 4 * this._numLayers, { storage: true, usage: 'uniform' });
      this._nodeHeadImage?.dispose();
      this._nodeHeadImage = device.createBuffer(size, { storage: true, usage: 'uniform' });
      this._hash = `${this.getType()}#${this._nodeBuffer.uid}#${this._nodeHeadImage.uid}`;
    }
    if (!this._counterBuffer) {
      this._counterBuffer = device.createBuffer(4, { storage: true, usage: 'uniform' });
    }
    this._counterBuffer.bufferSubData(0, new Uint8Array(4));
    this.clearHeadBuffer(device);
  }
  end(ctx: DrawContext, pass: number) {
    //const device = Application.instance.device;
    //this.composite(ctx, device, accumTargets[0] as Texture2D, accumTargets[1] as Texture2D);
  }
  calculateHash(): string {
    return this._hash;
  }
  applyUniforms(ctx: DrawContext, bindGroup: BindGroup) {
    bindGroup.setBuffer('Z_AB_nodeBuffer', this._nodeBuffer);
    bindGroup.setBuffer('Z_AB_counter', this._counterBuffer);
    bindGroup.setBuffer('Z_AB_headImage', this._nodeHeadImage);
    bindGroup.setValue('Z_AB_screenSize', this._screenSize);
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
      scope.$l.Z_AB_pixelCount = pb.atomicAdd(scope.Z_AB_counter, 1);
      scope.$l.Z_AB_nodeOffset = pb.mul(scope.Z_AB_pixelCount, 4);
      // save if index not exceeded
      scope.$if(pb.lessThan(scope.Z_AB_nodeOffset, pb.arrayLength(scope.Z_AB_nodeBuffer)), function(){
        scope.$l.Z_AB_headOffset = pb.add(pb.mul(scope.Z_AB_screenSize.x, pb.uint(scope.$builtins.fragCoord.y)), pb.uint(scope.$builtins.fragCoord.x));
        scope.$l.Z_AB_oldHead = pb.atomicExchange(scope.Z_AB_headImage.at(scope.Z_AB_headOffset), scope.Z_AB_nodeOffset);
        scope.$l.Z_AB_colorScale = pb.floatBitsToUint(pb.length(color));
        scope.$l.Z_AB_color = pb.pack4x8unorm(pb.normalize(color));
        scope.$l.Z_AB_depth = pb.floatBitsToUint(scope.fragDepth);
        scope.Z_AB_nodeBuffer.setAt(scope.Z_AB_nodeOffset, scope.Z_AB_color);
        scope.Z_AB_nodeBuffer.setAt(pb.add(scope.Z_AB_nodeOffset, 1), scope.Z_AB_colorScale);
        scope.Z_AB_nodeBuffer.setAt(pb.add(scope.Z_AB_nodeOffset, 2), scope.Z_AB_depth);
        scope.Z_AB_nodeBuffer.setAt(pb.add(scope.Z_AB_nodeOffset, 3), scope.oldHead);
        pb.discard;
      });
    });
  }
  setRenderStates(rs: RenderStateSet) {
  }
  private composite(ctx: DrawContext, device: AbstractDevice, accumColor: Texture2D, accumAlpha: Texture2D) {
    device.setProgram(ABufferOIT.getCompositeProgram(device))
    ABufferOIT._compositeBindGroup.setTexture('accumColorTex', accumColor);
    ABufferOIT._compositeBindGroup.setTexture('accumAlphaTex', accumAlpha);
    device.setBindGroup(0, ABufferOIT._compositeBindGroup);
    drawFullscreenQuad(ABufferOIT._compositeRenderStates);
  }
  getCounterBuffer(device: AbstractDevice) {
    if (!this._counterBuffer) {
      this._counterBuffer = device.createBuffer(16, { storage: true, usage: 'uniform' });
    }
    return this._counterBuffer;
  }
  getNodeBuffer(device: AbstractDevice) {
    const vp = device.getViewport();
    const width = device.screenToDevice(vp.width);
    const height = device.screenToDevice(vp.height);
    const size = width * height * 4 * 4 * this._numLayers;
    if (this._nodeBuffer) {
      if (this._nodeBuffer.byteLength < size) {
        this._nodeBuffer.dispose();
        this._nodeBuffer = null;
      }
    }
    if (!this._nodeBuffer) {
      this._nodeBuffer = device.createBuffer(size, { storage: true, usage: 'uniform' });
    }
    return this._nodeBuffer;
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
            pb.atomicExchange(this.headBuffer.at(this.offset), 0);
            pb.discard();
          });
        }
      });
      this._clearBindGroup = device.createBindGroup(this._clearProgram.bindGroupLayouts[0]);
      this._clearRenderStates = device.createRenderStateSet();
      this._clearRenderStates.useDepthState().enableTest(false).enableWrite(false);
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
          this.accumColorTex = pb.tex2D().uniform(0);
          this.accumAlphaTex = pb.tex2D().uniform(0);
          pb.main(function () {
            this.$l.accumColor = pb.textureSample(this.accumColorTex, this.$inputs.uv);
            this.$l.accumAlpha = pb.textureSample(this.accumAlphaTex, this.$inputs.uv);
            this.$l.r = this.accumColor.a;
            this.accumColor.a = this.accumAlpha.r;
            this.$outputs.outColor = pb.vec4(pb.div(this.accumColor.rgb, pb.clamp(this.accumColor.a, 0.0001, 50000)), this.r);
          });
        }
      });
      this._compositeBindGroup = device.createBindGroup(this._compositeProgram.bindGroupLayouts[0]);
      this._compositeRenderStates = device.createRenderStateSet();
      this._compositeRenderStates.useBlendingState().enable(true).setBlendFuncRGB('inv-src-alpha', 'src-alpha').setBlendFuncAlpha('zero', 'one');
      this._compositeRenderStates.useDepthState().enableTest(false).enableWrite(false);
    }
    return this._compositeProgram;
  }
}
