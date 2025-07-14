import { Vector3 } from '@zephyr3d/base';
import type { PBInsideFunctionScope, PBShaderExp, ProgramBuilder } from '@zephyr3d/device';

export type HeightFogParams = {
  fogColor: Vector3;
  globalDensity: number;
  heightFalloff: number;
  startDistance: number;
  startHeight: number;
  maxOpacity: number;
  dirInscatteringExponent: number;
  dirInscatteringColor: Vector3;
  dirInscatteringStartDistance: number;
  lightDir: Vector3;
};

export function getDefaultHeightFogParams(): HeightFogParams {
  return {
    globalDensity: 0.04,
    heightFalloff: 0.2,
    startDistance: 0,
    startHeight: 0,
    maxOpacity: 1,
    dirInscatteringExponent: 4,
    dirInscatteringStartDistance: 0,
    fogColor: new Vector3(0, 0, 0),
    dirInscatteringColor: new Vector3(1, 1, 1),
    lightDir: new Vector3(0, 1, 0)
  };
}

export function getHeightFogParamsStruct(pb: ProgramBuilder) {
  return pb.defineStruct([
    pb.float('globalDensity'),
    pb.float('heightFalloff'),
    pb.float('startDistance'),
    pb.float('startHeight'),
    pb.float('maxOpacity'),
    pb.float('dirInscatteringExponent'),
    pb.float('dirInscatteringStartDistance'),
    pb.vec3('fogColor'),
    pb.vec3('dirInscatteringColor'),
    pb.vec3('lightDir')
  ]);
}

export function combineAerialPerspectiveFog(
  scope: PBInsideFunctionScope,
  fogging: PBShaderExp,
  aerialPerspectiveFog: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_combineAerialPerspectiveFog';
  pb.func(funcName, [pb.vec4('fogging'), pb.vec4('aerialPerspectiveFog')], function () {
    this.$l.rgb = pb.add(
      this.fogging.rgb,
      pb.mul(this.aerialPerspectiveFog.rgb, pb.sub(1, this.fogging.rgb.a))
    );
    this.$l.a = pb.mul(pb.sub(1, this.fogging.a), pb.sub(1, this.aerialPerspectiveFog.a));
    this.$return(pb.vec4(this.rgb, pb.sub(1, this.a)));
  });
  return scope[funcName](fogging, aerialPerspectiveFog);
}

export function calculateHeightFog(
  scope: PBInsideFunctionScope,
  params: PBShaderExp,
  cameraPos: PBShaderExp,
  worldPos: PBShaderExp,
  skyDistantColorLut?: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_calcHeightFog';
  const Params = getHeightFogParamsStruct(pb);
  pb.func(funcName, [Params('params'), pb.vec3('cameraPos'), pb.vec3('worldPos')], function () {
    this.$l.ray = pb.normalize(pb.sub(this.worldPos, this.cameraPos));
    this.$l.origin = pb.add(this.cameraPos, pb.mul(this.ray, this.params.startDistance));
    this.$l.height = pb.sub(this.cameraPos.y, this.params.startHeight);
    this.$l.term = pb.mul(
      this.params.globalDensity,
      pb.exp(pb.neg(pb.mul(this.params.heightFalloff, this.height)))
    );

    this.$l.falloff = pb.mul(this.params.heightFalloff, pb.sub(this.worldPos.y, this.origin.y));
    this.$l.factor = pb.div(pb.sub(1, pb.exp2(pb.neg(this.falloff))), this.falloff);
    this.factor = pb.mul(this.term, this.factor);
    this.$l.rayLength = pb.distance(this.origin, this.worldPos);
    this.$l.factor = pb.mul(this.factor, this.rayLength);
    /*
    this.$l.directionalInscattering = pb.mul(
      this.params.dirInscatteringColor.rgb,
      pb.pow(pb.clamp(pb.dot(this.ray, this.params.lightDir), 0, 1), this.params.dirInscatteringExponent)
    );
    this.$l.dirLineIntegral = pb.mul(
      this.lineIntegral,
      pb.max(0, pb.sub(this.rayLength, this.params.dirInscatteringStartDistance))
    );
    this.$l.dirFactor = pb.clamp(pb.exp2(pb.neg(this.dirLineIntegral)), 0, 1);
    this.$l.directionalInscattering = pb.mul(this.$l.directionalInscattering, pb.sub(1, this.dirFactor));
    */
    this.$l.fogFactor = pb.min(
      pb.sub(1, pb.clamp(pb.exp2(pb.neg(this.factor)), 0, 1)),
      this.params.maxOpacity
    );
    //this.fogFactor = this.term;
    //this.$l.invFogFactor = pb.sub(1, this.term /*this.fogFactor*/);
    this.$l.fogColor = this.params.fogColor;
    if (skyDistantColorLut) {
      this.fogColor = pb.add(this.fogColor, pb.textureSampleLevel(skyDistantColorLut, pb.vec2(0.5), 0).rgb);
    }
    this.$l.fogColor = pb.add(
      pb.mul(this.fogColor, this.fogFactor),
      pb.vec3(0) /*this.directionalInscattering*/
    );
    //this.$return(pb.vec4(this.fogFactor, this.fogFactor, this.fogFactor, 1));
    this.$return(pb.vec4(this.fogColor, this.fogFactor));
  });
  return scope[funcName](params, cameraPos, worldPos);
}
