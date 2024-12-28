import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinAlbedoColor } from './mixins/albedocolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';

/**
 * Particle material
 * @public
 */
export class ParticleMaterial extends applyMaterialMixins(MeshMaterial, mixinAlbedoColor) {
  constructor(poolId?: string | symbol) {
    super(poolId);
    this.cullMode = 'none';
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.pos = pb.vec4().attrib('position');
    scope.$inputs.particlePos = pb.vec3().attrib('texCoord0');
    scope.$inputs.particleParams = pb.vec4().attrib('texCoord1');
    scope.$inputs.particleVelocity = pb.vec3().attrib('texCoord2');
    scope.$l.vertexID = pb.int(scope.$inputs.pos.w);
    scope.$l.centerPosWS = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.$inputs.particlePos, 1)
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
}
