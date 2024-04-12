import type { AbstractDevice, BindGroup, GPUDataBuffer, GPUProgram, PBGlobalScope, PBInsideFunctionScope, PBShaderExp, RenderStateSet, Texture2D } from "@zephyr3d/device";
import { OIT } from "./oit";
import { DrawContext } from "./drawable";
import { Application } from "../app";
import { drawFullscreenQuad } from "./fullscreenquad";

export class ABufferOIT extends OIT {
  public static readonly type = 'ab';
  private static _compositeProgram: GPUProgram;
  private static _compositeBindGroup: BindGroup;
  private static _compositeRenderStates: RenderStateSet;
  private _nodeBuffer: GPUDataBuffer;
  private _counterBuffer: GPUDataBuffer;
  private _numLayers: number;
  constructor() {
    super();
    this._nodeBuffer = null;
    this._counterBuffer = null;
    this._numLayers = 10;
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
    scope.Z_AB_headImage = pb.texStorage2D.r32uint().storage(2);
    scope.Z_AB_counter = pb.atomic_uint().storageBuffer(2);
    scope.$outputs.outColor = pb.vec4();
  }
  begin(ctx: DrawContext, pass: number) {
    const device = Application.instance.device;
    const counterBuffer = this.getCounterBuffer(device);
    counterBuffer.bufferSubData(0, new Uint8Array(16));
  }
  end(ctx: DrawContext, pass: number) {
    //const device = Application.instance.device;
    //this.composite(ctx, device, accumTargets[0] as Texture2D, accumTargets[1] as Texture2D);
  }
  calculateHash(): string {
    return this.getType();
  }
  outputFragmentColor(scope: PBInsideFunctionScope, color: PBShaderExp) {
    const pb = scope.$builder;
    pb.func('Z_WBOIT_depthWeight', [pb.float('z'), pb.float('a')], function(){
      this.$return(pb.clamp(pb.mul(pb.pow(pb.add(pb.min(1, pb.mul(this.a, 10)), 0.01), 3), 1e8, pb.pow(pb.sub(1, pb.mul(this.z, 0.9)), 2)), 1e-2, 3e3));
    });
    pb.func('Z_WBOIT_output', [pb.vec4('color')], function(){
      this.$l.w = this.Z_WBOIT_depthWeight(this.$builtins.fragCoord.z, this.color.a);
      this.$outputs[0] = pb.vec4(pb.mul(this.color.rgb, this.w), this.color.a);
      this.$outputs[1] = pb.getDevice().type === 'webgl' ? pb.vec4(pb.mul(this.color.a, this.w)) : pb.mul(this.color.a, this.w);
    });
    scope.Z_WBOIT_output(color);
    scope.$l.Z_AB_nodeIndex = pb.atomicAdd(scope.Z_AB_counter, 1);
  }
  setRenderStates(rs: RenderStateSet) {
    const blendingState = rs.useBlendingState();
    blendingState.enable(true);
    blendingState.setBlendEquation('add', 'add');
    blendingState.setBlendFuncRGB('one', 'one');
    blendingState.setBlendFuncAlpha('zero', 'inv-src-alpha');
    const depthState = rs.useDepthState();
    depthState.enableWrite(false).enableTest(true);
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
