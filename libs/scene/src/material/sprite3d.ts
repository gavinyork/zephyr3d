import { MeshMaterial } from './meshmaterial';
import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import { MaterialVaryingFlags } from '../values';
import type { Clonable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { DrawContext } from '../render';

/**
 * Lambert material
 * @public
 */
export class Sprite3DMaterial extends MeshMaterial implements Clonable<Sprite3DMaterial> {
  static UVINFO = this.defineInstanceUniform('uvinfo', 'vec4');
  private _uvinfo: Vector4;
  constructor() {
    super();
    this._uvinfo = new Vector4(0, 0, 1, 1);
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
    } else {
      scope.uvinfo = pb.vec4().uniform(2);
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
    scope.$l.pos = pb.vec2();
    scope.$l.uv = pb.vec2();
    scope
      .$if(pb.equal(scope.$inputs.vertexId, 0), function () {
        scope.pos = pb.vec2(-0.5, -0.5);
        scope.uv = scope.uvinfo.xy;
      })
      .$elseif(pb.equal(scope.$inputs.vertexId, 1), function () {
        scope.pos = pb.vec2(0.5, -0.5);
        scope.uv = scope.uvinfo.xw;
      })
      .$elseif(pb.equal(scope.$inputs.vertexId, 2), function () {
        scope.pos = pb.vec2(-0.5, 0.5);
        scope.uv = scope.uvinfo.zy;
      })
      .$else(function () {
        scope.pos = pb.vec2(0.5, 0.5);
        scope.uv = scope.uvinfo.zw;
      });
    scope.$outputs.worldPos = pb.add(pb.mul(scope.right, scope.pos.x), pb.mul(scope.up, scope.pos.y));
    scope.$outputs.uv = scope.uv;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.$l.color = pb.vec3(scope.$inputs.uv, 0);
      this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.color);
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (!(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)) {
      bindGroup.setValue('uvinfo', this._uvinfo);
    }
  }
}
