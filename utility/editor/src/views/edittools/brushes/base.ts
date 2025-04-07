import { Vector2, Vector4 } from '@zephyr3d/base';
import {
  AbstractDevice,
  BindGroup,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import { Application, DRef, Primitive } from '@zephyr3d/scene';

export class BaseTerrainBrush {
  private static _brushPrimitive: Primitive = null;
  private static _defaultMask: Texture2D = null;
  protected _brushProgram: DRef<GPUProgram>;
  protected _brushBindGroup: DRef<BindGroup>;
  protected _brushRenderStates: RenderStateSet;
  constructor() {
    this._brushProgram = new DRef();
    this._brushBindGroup = new DRef();
    this._brushRenderStates = null;
  }
  brush(
    target: Texture2D,
    mask: Texture2D,
    region: Vector4,
    pos: Vector2,
    brushSize: number,
    angle: number,
    strength: number,
    clearColor: Vector4
  ) {
    const device = Application.instance.device;
    this.prepareBrush(device);
    const program = this._brushProgram.get();
    const bindGroup = this._brushBindGroup.get();
    const framebuffer = device.pool.fetchTemporalFramebuffer(false, 0, 0, target, null, false);
    bindGroup.setValue('params', new Vector4(pos.x, pos.y, brushSize, angle));
    bindGroup.setValue('region', region);
    bindGroup.setValue('strength', strength);
    bindGroup.setTexture('mask', mask ?? BaseTerrainBrush._defaultMask);
    device.pushDeviceStates();
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    device.setRenderStates(this._brushRenderStates);
    device.setFramebuffer(framebuffer);
    if (clearColor) {
      device.clearFrameBuffer(clearColor, 1, 0);
    }
    BaseTerrainBrush._brushPrimitive.draw();
    device.popDeviceStates();
  }
  protected brushFragment(
    scope: PBInsideFunctionScope,
    mask: PBShaderExp,
    strength: PBShaderExp,
    heightMapUV: PBShaderExp,
    brushUV: PBShaderExp
  ) {
    const pb = scope.$builder;
    const maskValue = pb.textureSampleLevel(mask, brushUV, 0).r;
    return pb.vec4(pb.vec3(pb.mul(maskValue, strength)), 1);
  }
  protected setupBrushUniforms(scope: PBGlobalScope) {}
  protected createBrushProgram(device: AbstractDevice) {
    const that = this;
    return device.buildRenderProgram({
      vertex(pb) {
        this.params = pb.vec4().uniform(0);
        this.region = pb.vec4().uniform(0);
        that.setupBrushUniforms(this);
        this.$inputs.position = pb.float().attrib('position');
        this.axis = [pb.vec2(-1, -1), pb.vec2(1, -1), pb.vec2(-1, 1), pb.vec2(1, 1)];
        pb.main(function () {
          this.$l.worldPos = this.params.xy;
          this.$l.size = this.params.z;
          this.$l.angle = this.params.w;
          this.$l.s = pb.sin(this.angle);
          this.$l.c = pb.cos(this.angle);
          this.$l.rotMat = pb.mat2(this.c, this.s, pb.neg(this.s), this.c);
          this.$l.vertexAxis = this.axis.at(this.$builtins.vertexIndex);
          this.$l.axisRot = pb.mul(this.rotMat, this.vertexAxis);
          this.$l.pos = pb.add(this.worldPos, pb.mul(pb.normalize(this.axisRot), this.size));
          this.$l.uv = pb.div(pb.sub(this.pos, this.region.xy), pb.sub(this.region.zw, this.region.xy));
          this.$l.cs = pb.sub(pb.mul(this.uv, 2), pb.vec2(1));
          this.$outputs.uv = this.uv;
          this.$outputs.brushUV = pb.add(pb.mul(this.vertexAxis, 0.5), pb.vec2(0.5));
          this.$builtins.position = pb.vec4(this.cs.x, pb.neg(this.cs.y), 0, 1);
        });
      },
      fragment(pb) {
        this.strength = pb.float().uniform(0);
        this.mask = pb.tex2D().uniform(0);
        that.setupBrushUniforms(this);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = that.brushFragment(
            this,
            this.mask,
            this.strength,
            this.$inputs.uv,
            this.$inputs.brushUV
          );
        });
      }
    });
  }
  protected createRenderStates(device: AbstractDevice) {
    const renderStates = device.createRenderStateSet();
    renderStates.useDepthState().enableTest(false).enableWrite(false);
    renderStates.useRasterizerState().setCullMode('none');
    renderStates
      .useBlendingState()
      .enable(true)
      .setBlendFuncRGB('one', 'one')
      .setBlendFuncAlpha('zero', 'one');
    return renderStates;
  }
  protected prepareBrush(device: AbstractDevice) {
    if (!BaseTerrainBrush._brushPrimitive) {
      BaseTerrainBrush._brushPrimitive = new Primitive();
      BaseTerrainBrush._brushPrimitive.createAndSetVertexBuffer(
        'position_f32',
        new Float32Array([0, 1, 2, 3])
      );
      BaseTerrainBrush._brushPrimitive.indexCount = 4;
      BaseTerrainBrush._brushPrimitive.indexStart = 0;
      BaseTerrainBrush._brushPrimitive.primitiveType = 'triangle-strip';
    }
    if (!BaseTerrainBrush._defaultMask) {
      BaseTerrainBrush._defaultMask = device.createTexture2D('rgba8unorm', 1, 1);
      BaseTerrainBrush._defaultMask.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1);
    }
    if (!this._brushRenderStates) {
      this._brushRenderStates = this.createRenderStates(device);
    }
    if (!this._brushProgram.get()) {
      this._brushProgram.set(this.createBrushProgram(device));
    }
    if (!this._brushBindGroup.get()) {
      this._brushBindGroup.set(device.createBindGroup(this._brushProgram.get().bindGroupLayouts[0]));
    }
  }
}
