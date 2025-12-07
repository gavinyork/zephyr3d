import { MeshMaterial } from './meshmaterial';
import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags } from '../values';
import type { Clonable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { DrawContext } from '../render';

/**
 * Sprite3D material
 * @public
 */
export class Sprite3DMaterial extends MeshMaterial implements Clonable<Sprite3DMaterial> {
  static UVINFO = this.defineInstanceUniform('uvinfo', 'vec4');
  static SIZEANCHOR = this.defineInstanceUniform('sizeAnchor', 'vec4');
  private _uvinfo: Vector4;
  private _sizeAnchor: Vector4;
  constructor() {
    super();
    this._uvinfo = new Vector4(0, 0, 1, 1);
    this._sizeAnchor = new Vector4(1, 1, 0.5, 0.5);
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
  get sizeAnchor(): Vector4 {
    return this._sizeAnchor;
  }
  set sizeAnchor(value: Vector4) {
    if (!value.equalsTo(this.sizeAnchor)) {
      this._sizeAnchor.set(value);
      this.uniformChanged();
    }
  }
  get width(): number {
    return this._sizeAnchor.x;
  }
  set width(value: number) {
    if (this.width !== value) {
      this.sizeAnchor = new Vector4(value, this._sizeAnchor.y, this._sizeAnchor.z, this._sizeAnchor.w);
    }
  }
  get height(): number {
    return this._sizeAnchor.y;
  }
  set height(value: number) {
    if (this.height !== value) {
      this.sizeAnchor = new Vector4(this._sizeAnchor.x, value, this._sizeAnchor.z, this._sizeAnchor.w);
    }
  }
  setSize(width: number, height: number): void {
    if (this.width !== width || this.height !== height) {
      this.sizeAnchor = new Vector4(width, height, this._sizeAnchor.z, this._sizeAnchor.w);
    }
  }
  get anchorX(): number {
    return this._sizeAnchor.z;
  }
  set anchorX(value: number) {
    if (this.anchorX !== value) {
      this.sizeAnchor = new Vector4(this._sizeAnchor.x, this._sizeAnchor.y, value, this._sizeAnchor.w);
    }
  }
  get anchorY(): number {
    return this._sizeAnchor.w;
  }
  set anchorY(value: number) {
    if (this.anchorY !== value) {
      this.sizeAnchor = new Vector4(this._sizeAnchor.x, this._sizeAnchor.y, this._sizeAnchor.z, value);
    }
  }
  setAnchor(anchorX: number, anchorY: number): void {
    if (this.anchorX !== anchorX || this.anchorY !== anchorY) {
      this.sizeAnchor = new Vector4(this._sizeAnchor.x, this._sizeAnchor.y, anchorX, anchorY);
    }
  }
  clone(): Sprite3DMaterial {
    const other = new Sprite3DMaterial();
    other.copyFrom(this);
    return other;
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.vertexId = pb.float().attrib('position');
    if (this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING) {
      scope.$l.uvinfo = this.getInstancedUniform(scope, Sprite3DMaterial.UVINFO);
      scope.$l.sizeAnchor = this.getInstancedUniform(scope, Sprite3DMaterial.SIZEANCHOR);
    } else {
      scope.uvinfo = pb.vec4().uniform(2);
      scope.sizeAnchor = pb.vec4().uniform(2);
    }
    scope.$l.worldPos = ShaderHelper.getWorldMatrix(scope)[3].xyz;
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
    scope.$l.anchor = scope.sizeAnchor.zw;
    scope.$l.uv = pb.vec2();
    scope
      .$if(pb.equal(scope.$inputs.vertexId, 0), function () {
        scope.v = pb.neg(scope.anchor);
        scope.uv = scope.uvinfo.xy;
      })
      .$elseif(pb.equal(scope.$inputs.vertexId, 1), function () {
        scope.v = pb.sub(pb.vec2(1, 0), scope.anchor);
        scope.uv = scope.uvinfo.zy;
      })
      .$elseif(pb.equal(scope.$inputs.vertexId, 2), function () {
        scope.v = pb.sub(pb.vec2(0, 1), scope.anchor);
        scope.uv = scope.uvinfo.xw;
      })
      .$else(function () {
        scope.v = pb.sub(pb.vec2(1), scope.anchor);
        scope.uv = scope.uvinfo.zw;
      });
    scope.v = pb.mul(scope.v, scope.sizeAnchor.xy);
    scope.$outputs.worldPos = pb.add(
      scope.worldPos,
      pb.mul(scope.right, scope.v.x),
      pb.mul(scope.up, scope.v.y)
    );
    scope.$outputs.uv = scope.uv;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    if (this.needFragmentColor()) {
      scope.$l.color = this.calcFragmentColor(scope);
      this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.color);
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (!(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)) {
      bindGroup.setValue('uvinfo', this._uvinfo);
      bindGroup.setValue('sizeAnchor', this._sizeAnchor);
    }
  }
  protected calcFragmentColor(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$builder.vec4(scope.$inputs.uv, 0, 1);
  }
}
