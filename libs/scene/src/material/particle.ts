import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinAlbedoColor } from './mixins/albedocolor';
import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import { DrawContext } from '../render';

/**
 * Particle material
 * @public
 */
export class ParticleMaterial extends applyMaterialMixins(MeshMaterial, mixinAlbedoColor) {
  private _jitterPower: number;
  constructor(poolId?: string | symbol) {
    super(poolId);
    this.cullMode = 'none';
    this._jitterPower = 0;
  }
  get jitterPower() {
    return this._jitterPower;
  }
  set jitterPower(val: number) {
    if (val !== this._jitterPower) {
      this._jitterPower = val;
      this.uniformChanged();
    }
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    pb.func('rotation2d', [pb.float('t'), pb.vec2('v')], function () {
      this.$l.s = pb.sin(this.t);
      this.$l.c = pb.cos(this.t);
      this.$l.rc1 = pb.vec3(this.c, this.s, pb.mul(pb.sub(pb.sub(1, this.c), this.s), 0.5));
      this.$l.rc2 = pb.vec3(pb.neg(this.s), this.c, pb.mul(pb.add(pb.sub(1, this.c), this.s), 0.5));
      this.$l.uv = pb.vec3(this.v, 1);
      this.$return(pb.vec2(pb.dot(this.rc1, this.uv), pb.dot(this.rc2, this.uv)));
    });
    pb.func('rotation3d', [pb.float('t'), pb.vec3('v')], function () {
      this.$l.s = pb.sin(this.t);
      this.$l.c = pb.cos(this.t);
      this.$l.rot = pb.mat3(pb.vec3(this.c, pb.neg(this.s), 0), pb.vec3(this.s, this.c, 0), pb.vec3(0, 0, 1));
      this.$return(pb.mul(this.rot, this.v));
    });
    scope.$inputs.pos = pb.vec4().attrib('position');
    scope.$inputs.particlePos = pb.vec3().attrib('texCoord0');
    scope.$inputs.particleParams = pb.vec4().attrib('texCoord1');
    scope.$inputs.particleVelocity = pb.vec3().attrib('texCoord2');
    scope.jitterPower = pb.float().uniform(2);
    scope.$l.vertexID = pb.int(scope.$inputs.pos.w);
    scope.$l.z = pb.normalize(scope.$inputs.particleVelocity);
    scope.$l.x = pb.vec3(pb.neg(scope.z.y), scope.z.x, 0);
    scope.$l.y = pb.cross(scope.z, scope.x);
    scope.$l.offset = pb.add(
      pb.mul(pb.sin(scope.$inputs.particleParams.z), scope.x),
      pb.mul(pb.cos(scope.$inputs.particleParams.z), scope.y)
    );
    scope.$l.centerPosWS = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(pb.add(scope.$inputs.particlePos, pb.mul(scope.offset, scope.jitterPower)), 1)
    ).xyz;
    scope.$l.forward = pb.normalize(pb.sub(ShaderHelper.getCameraPosition(scope), scope.centerPosWS));
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
      .$if(pb.equal(scope.vertexID, 0), function () {
        scope.pos = pb.vec2(-0.5, -0.5);
        scope.uv = pb.vec2(0, 0);
      })
      .$elseif(pb.equal(scope.vertexID, 1), function () {
        scope.pos = pb.vec2(0.5, -0.5);
        scope.uv = pb.vec2(1, 0);
      })
      .$elseif(pb.equal(scope.vertexID, 2), function () {
        scope.pos = pb.vec2(-0.5, 0.5);
        scope.uv = pb.vec2(0, 1);
      })
      .$else(function () {
        scope.pos = pb.vec2(0.5, 0.5);
        scope.uv = pb.vec2(1, 1);
      });
    scope.pos = pb.mul(scope.pos, scope.$inputs.particleParams.x);
    scope.centerPosWS = pb.add(
      scope.centerPosWS,
      pb.mul(scope.right, scope.pos.x),
      pb.mul(scope.up, scope.pos.y)
    );
    scope.$outputs.uv = scope.uv;
    scope.$outputs.worldPos = scope.centerPosWS;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.centerPosWS, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    if (this.needFragmentColor()) {
      //const color = this.calculateAlbedoColor(scope);
      this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.$builder.vec4(scope.$inputs.uv, 1, 1));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('jitterPower', this._jitterPower);
  }
}
