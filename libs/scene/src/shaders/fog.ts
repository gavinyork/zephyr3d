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
  atmosphereEffectStrength: number;
  rayOriginTerm: number;
  lightDir: Vector3;
  limitCameraHeight: number;
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
    atmosphereEffectStrength: 1,
    rayOriginTerm: 0,
    lightDir: new Vector3(0, 1, 0),
    limitCameraHeight: 600
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
    pb.float('atmosphereEffectStrength'),
    pb.vec3('fogColor'),
    pb.float('limitCameraHeight'),
    pb.vec3('dirInscatteringColor'),
    pb.float('rayOriginTerm'),
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
  skyDistantColorLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_calcHeightFog';
  const Params = getHeightFogParamsStruct(pb);
  pb.func(funcName, [Params('params'), pb.vec3('cameraPos'), pb.vec3('worldPos')], function () {
    this.$l.ray = pb.sub(this.worldPos, this.cameraPos);
    this.$l.d = pb.length(this.ray);
    this.$l.rayNorm = pb.div(this.ray, this.d);
    this.$l.offset = pb.clamp(
      pb.sub(
        1,
        pb.div(
          this.params.limitCameraHeight,
          pb.max(0.000001, pb.sub(this.cameraPos.y, this.params.startHeight))
        )
      ),
      0,
      1
    );
    this.$l.startDistance = pb.max(
      pb.clamp(this.params.startDistance, 0, this.d),
      pb.mul(this.offset, this.d)
    );
    this.$l.origin = pb.add(this.cameraPos, pb.mul(this.rayNorm, this.startDistance));
    this.$l.height = pb.sub(this.origin.y, this.params.startHeight);
    this.$l.term = this.params.rayOriginTerm;

    this.$l.falloff = pb.clamp(
      pb.mul(this.params.heightFalloff, pb.sub(this.worldPos.y, this.origin.y)),
      -125,
      126
    );
    this.$l.factor = this.$choice(
      pb.greaterThan(pb.abs(this.falloff), 0.01),
      pb.div(pb.sub(1, pb.exp2(pb.neg(this.falloff))), this.falloff),
      pb.sub(Math.log(2), pb.mul(0.5 * Math.log(2) * Math.log(2), this.falloff))
    );
    this.fogFactor = pb.mul(this.term, this.factor);
    this.$l.rayLength = pb.distance(this.origin, this.worldPos);
    this.$l.fogFactor = pb.clamp(pb.mul(this.fogFactor, this.rayLength), -125, 126);
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
      pb.sub(1, pb.clamp(pb.exp2(pb.neg(this.fogFactor)), 0, 1)),
      this.params.maxOpacity
    );
    this.$l.fogColor = this.params.fogColor;
    this.$if(pb.greaterThan(this.params.atmosphereEffectStrength, 0), function () {
      this.$l.skyContrib = pb.textureSampleLevel(skyDistantColorLut, pb.vec2(0.5), 0).rgb;
      this.fogColor = pb.add(this.fogColor, pb.mul(this.skyContrib, this.params.atmosphereEffectStrength));
    });
    this.$l.fogColor = pb.add(
      pb.mul(this.fogColor, this.fogFactor),
      pb.vec3(0) /*this.directionalInscattering*/
    );
    this.$return(pb.vec4(this.fogColor, this.fogFactor));
  });
  return scope[funcName](params, cameraPos, worldPos);
}
