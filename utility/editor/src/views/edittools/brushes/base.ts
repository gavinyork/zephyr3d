import type { Vector2 } from '@zephyr3d/base';
import type { TerrainEditTool } from '../terrain';
import { Vector4, DRef } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import { Application, Primitive } from '@zephyr3d/scene';

export abstract class BaseTerrainBrush {
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
  abstract getName(): string;
  brush(mask: Texture2D, region: Vector4, pos: Vector2, brushSize: number, angle: number, strength: number) {
    const device = Application.instance.device;
    this.prepareBrush(device);

    const program = this._brushProgram.get();
    const bindGroup = this._brushBindGroup.get();
    bindGroup.setValue('params', new Vector4(pos.x, pos.y, brushSize, angle));
    bindGroup.setValue('region', region);
    bindGroup.setValue('strength', strength);
    bindGroup.setValue('brushSize', brushSize);
    bindGroup.setTexture('mask', mask ?? BaseTerrainBrush._defaultMask);
    this.applyUniformValues(bindGroup, region);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    device.setRenderStates(this._brushRenderStates);
    BaseTerrainBrush._brushPrimitive.draw();
  }
  renderSettings(_tool: TerrainEditTool) {}
  protected abstract brushFragment(
    scope: PBInsideFunctionScope,
    mask: PBShaderExp,
    strength: PBShaderExp,
    heightMapUV: PBShaderExp,
    centerUV: PBShaderExp
  ): void;
  protected setupBrushUniforms(_scope: PBGlobalScope) {}
  protected applyUniformValues(_bindGroup: BindGroup, _region: Vector4) {}
  protected createBrushProgram(device: AbstractDevice) {
    const that = this;
    return device.buildRenderProgram({
      vertex(pb) {
        this.params = pb.vec4().uniform(0);
        this.region = pb.vec4().uniform(0);
        that.setupBrushUniforms(this);
        this.$inputs.position = pb.float().attrib('position');
        if (device.type !== 'webgl') {
          this.axis = [pb.vec2(-1, -1), pb.vec2(1, -1), pb.vec2(-1, 1), pb.vec2(1, 1)];
        } else {
          pb.func('getAxis', [pb.int('index')], function () {
            this.$if(pb.equal(this.index, 0), function () {
              this.$return(pb.vec2(-1, -1));
            });
            this.$if(pb.equal(this.index, 1), function () {
              this.$return(pb.vec2(1, -1));
            });
            this.$if(pb.equal(this.index, 2), function () {
              this.$return(pb.vec2(-1, 1));
            });
            this.$return(pb.vec2(1, 1));
          });
        }
        pb.main(function () {
          this.$l.worldPos = this.params.xy;
          this.$l.size = this.params.z;
          this.$l.angle = this.params.w;
          this.$l.s = pb.sin(this.angle);
          this.$l.c = pb.cos(this.angle);
          this.$l.rotMat = pb.mat2(this.c, this.s, pb.neg(this.s), this.c);
          this.$l.vertexAxis =
            device.type === 'webgl'
              ? this.getAxis(pb.int(this.$inputs.position))
              : this.axis.at(this.$builtins.vertexIndex);
          this.$l.axisRot = pb.mul(this.rotMat, this.vertexAxis);
          this.$l.pos = pb.add(this.worldPos, pb.mul(pb.normalize(this.axisRot), this.size));
          this.$l.uv = pb.div(pb.sub(this.pos, this.region.xy), pb.sub(this.region.zw, this.region.xy));
          this.$l.cs = pb.sub(pb.mul(this.uv, 2), pb.vec2(1));
          this.$outputs.uv = this.uv;
          this.$outputs.centerUV = pb.div(
            pb.sub(this.worldPos, this.region.xy),
            pb.sub(this.region.zw, this.region.xy)
          );
          this.$outputs.brushUV = pb.add(pb.mul(this.vertexAxis, 0.5), pb.vec2(0.5));
          this.$builtins.position =
            pb.getDevice().type === 'webgpu'
              ? pb.vec4(this.cs.x, pb.neg(this.cs.y), 0, 1)
              : pb.vec4(this.cs.x, this.cs.y, 0, 1);
        });
      },
      fragment(pb) {
        this.strength = pb.float().uniform(0);
        this.mask = pb.tex2D().uniform(0);
        this.brushSize = pb.float().uniform(0);
        that.setupBrushUniforms(this);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$l.mask = pb.textureSampleLevel(this.mask, this.$inputs.brushUV, 0).r;
          this.$outputs.color = that.brushFragment(
            this,
            this.mask,
            this.strength,
            this.$inputs.uv,
            this.$inputs.centerUV
          );
        });
      }
    });
  }
  protected createRenderStates(device: AbstractDevice) {
    const renderStates = device.createRenderStateSet();
    renderStates.useDepthState().enableTest(false).enableWrite(false);
    renderStates.useRasterizerState().setCullMode('none');
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
      console.log(this._brushProgram.get().getShaderSource('vertex'));
      console.log(this._brushProgram.get().getShaderSource('fragment'));
    }
    if (!this._brushBindGroup.get()) {
      this._brushBindGroup.set(device.createBindGroup(this._brushProgram.get().bindGroupLayouts[0]));
    }
  }
}
