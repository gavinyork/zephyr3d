import { MeshMaterial } from './meshmaterial';
import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags } from '../values';
import type { Clonable } from '@zephyr3d/base';
import { Vector4, Vector2 } from '@zephyr3d/base';
import type { DrawContext } from '../render';

/**
 * Sprite3D material
 * @public
 */
export class Sprite3DMaterial extends MeshMaterial implements Clonable<Sprite3DMaterial> {
  static UVINFO = this.defineInstanceUniform('uvinfo', 'vec4');
  static ANCHOR = this.defineInstanceUniform('anchor', 'vec2');
  private _uvinfo: Vector4;
  private _anchor: Vector2;
  constructor() {
    super();
    this._uvinfo = new Vector4(0, 0, 1, 1);
    this._anchor = new Vector2(0.5, 0.5);
    this.cullMode = 'none';
  }
  get uvinfo(): Vector4 {
    return this._uvinfo;
  }
  set uvinfo(value: Vector4) {
    if (!value.equalsTo(this.uvinfo)) {
      this._uvinfo.set(value);
      this.uniformChanged();
    }
  }
  setUVInfo(uvx0: number, uvy0: number, uvx1: number, uvy1: number): void {
    this.uvinfo = new Vector4(uvx0, uvy0, uvx1, uvy1);
  }
  get anchor(): Vector2 {
    return this._anchor;
  }
  set anchor(value: Vector2) {
    if (!value.equalsTo(this._anchor)) {
      this._anchor.setXY(value.x, value.y);
      this.uniformChanged();
    }
  }
  get anchorX(): number {
    return this._anchor.x;
  }
  set anchorX(value: number) {
    if (this._anchor.x !== value) {
      this.anchor = new Vector2(value, this._anchor.y);
    }
  }
  get anchorY(): number {
    return this._anchor.y;
  }
  set anchorY(value: number) {
    if (this._anchor.y !== value) {
      this.anchor = new Vector2(this._anchor.x, value);
    }
  }
  setAnchor(anchorX: number, anchorY: number): void {
    if (this._anchor.x !== anchorX || this._anchor.y !== anchorY) {
      this.anchor = new Vector2(anchorX, anchorY);
    }
  }
  clone(): Sprite3DMaterial {
    const other = new Sprite3DMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this): void {
    super.copyFrom(other);
    this.uvinfo = other.uvinfo;
    this.anchor = other.anchor;
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.vertexId = pb.float().attrib('position');
    if (this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING) {
      scope.$l.uvinfo = this.getInstancedUniform(scope, Sprite3DMaterial.UVINFO);
      scope.$l.anchor = this.getInstancedUniform(scope, Sprite3DMaterial.ANCHOR);
    } else {
      scope.uvinfo = pb.vec4().uniform(2);
      scope.anchor = pb.vec2().uniform(2);
    }
    this.internalSetupUniforms(scope);
    scope.$l.worldPos = ShaderHelper.getWorldMatrix(scope)[3].xyz;
    scope.$l.width = pb.sqrt(
      pb.dot(ShaderHelper.getWorldMatrix(scope)[0].xyz, ShaderHelper.getWorldMatrix(scope)[0].xyz)
    );
    scope.$l.height = pb.sqrt(
      pb.dot(ShaderHelper.getWorldMatrix(scope)[1].xyz, ShaderHelper.getWorldMatrix(scope)[1].xyz)
    );
    const viewMatrix = ShaderHelper.getViewMatrix(scope);
    scope.$l.forward = pb.vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z);
    scope.$l.axis = scope.$choice(
      pb.lessThan(pb.abs(scope.forward.y), 0.999),
      pb.vec3(0, 1, 0),
      pb.vec3(1, 0, 0)
    );
    scope.$l.right = pb.normalize(pb.cross(scope.axis, scope.forward));
    scope.$l.up = pb.normalize(pb.cross(scope.forward, scope.right));
    scope.$l.v = pb.vec2();
    scope.$l.uv = pb.vec2();
    scope
      .$if(pb.equal(scope.$inputs.vertexId, 0), function () {
        scope.v = pb.neg(scope.anchor);
        scope.uv = pb.vec2(scope.uvinfo.x, pb.sub(1, scope.uvinfo.y));
      })
      .$elseif(pb.equal(scope.$inputs.vertexId, 1), function () {
        scope.v = pb.sub(pb.vec2(1, 0), scope.anchor);
        scope.uv = pb.vec2(scope.uvinfo.z, pb.sub(1, scope.uvinfo.y));
      })
      .$elseif(pb.equal(scope.$inputs.vertexId, 2), function () {
        scope.v = pb.sub(pb.vec2(0, 1), scope.anchor);
        scope.uv = pb.vec2(scope.uvinfo.x, pb.sub(1, scope.uvinfo.w));
      })
      .$else(function () {
        scope.v = pb.sub(pb.vec2(1), scope.anchor);
        scope.uv = pb.vec2(scope.uvinfo.z, pb.sub(1, scope.uvinfo.w));
      });
    scope.v = pb.mul(scope.v, pb.vec2(scope.width, scope.height));
    scope.$outputs.zWorldPos = pb.add(
      scope.worldPos,
      pb.mul(scope.right, scope.v.x),
      pb.mul(scope.up, scope.v.y)
    );
    scope.$outputs.zVertexUV = scope.uv;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.zWorldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    this.internalSetupUniforms(scope);
    if (this.needFragmentColor()) {
      scope.$l.color = this.calcFragmentColor(scope);
      this.outputFragmentColor(scope, scope.$inputs.zWorldPos, scope.color);
    } else {
      this.outputFragmentColor(scope, scope.$inputs.zWorldPos, null);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (!(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)) {
      bindGroup.setValue('uvinfo', this._uvinfo);
      bindGroup.setValue('anchor', this._anchor);
    }
    this.internalApplyUniforms(bindGroup, ctx, pass);
  }
  protected internalSetupUniforms(_scope: PBInsideFunctionScope) {}
  protected internalApplyUniforms(_bindGroup: BindGroup, _ctx: DrawContext, _pass: number) {}
  protected calcFragmentColor(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$builder.vec4(scope.$inputs.zVertexUV, 0, 1);
  }
}
