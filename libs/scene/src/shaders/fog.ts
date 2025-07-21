import { Vector3, Vector4 } from '@zephyr3d/base';
import type { PBInsideFunctionScope, PBShaderExp, ProgramBuilder } from '@zephyr3d/device';

export type HeightFogParams = {
  parameter1: Vector4; // [rgb=fogColor a=heightFalloff]
  parameter2: Vector4; // [r=density g=startHeight b=startDistance a=maxHeight]
  parameter3: Vector4; // [r=maxOpacity g=atmosphereStrength b=rayOriginTerm a=dirInscatteringExponent]
  parameter4: Vector4; // [rgb=directionalInscatteringColor a=UNUSED]
  lightDir: Vector3;
  lightColor: Vector3;
};

export function getDefaultHeightFogParams(): HeightFogParams {
  return {
    parameter1: new Vector4(0, 0, 0, 0.2),
    parameter2: new Vector4(0.04, 0, 0, 100),
    parameter3: new Vector4(1, 1, 0, 4),
    parameter4: new Vector4(0, 0, 0, 0),
    lightDir: new Vector3(0, 1, 0),
    lightColor: new Vector3(0, 0, 0)
  };
}

export function getHeightFogParamsStruct(pb: ProgramBuilder) {
  return pb.defineStruct([
    pb.vec4('parameter1'),
    pb.vec4('parameter2'),
    pb.vec4('parameter3'),
    pb.vec4('parameter4'),
    pb.float('dirInscatteringStartDistance'),
    pb.vec3('dirInscatteringColor'),
    pb.vec3('lightDir'),
    pb.vec3('lightColor')
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
    this.$l.rgb = pb.add(this.fogging.rgb, pb.mul(this.aerialPerspectiveFog.rgb, this.fogging.rgb.a));
    this.$l.a = pb.mul(this.fogging.a, this.aerialPerspectiveFog.a);
    this.$return(pb.vec4(this.rgb, pb.sub(1, this.a)));
  });
  return scope[funcName](fogging, aerialPerspectiveFog);
}

export function calculateHeightFog(
  scope: PBInsideFunctionScope,
  params: PBShaderExp,
  cameraPos: PBShaderExp,
  worldPos: PBShaderExp,
  isSky: PBShaderExp,
  skyDistantColorLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_calcHeightFog';
  const Params = getHeightFogParamsStruct(pb);
  pb.func(
    funcName,
    [Params('params'), pb.vec3('cameraPosition'), pb.vec3('worldPosition'), pb.bool('isSky')],
    function () {
      this.$l.cameraPos = this.$choice(
        this.isSky,
        this.cameraPosition,
        pb.vec3(
          this.cameraPosition.x,
          pb.min(this.cameraPosition.y, pb.add(this.params.parameter2.y, this.params.parameter2.w)),
          this.cameraPosition.z
        )
      );
      this.$l.ray = pb.sub(this.worldPosition, this.cameraPos);
      this.$l.d = pb.length(this.ray);
      this.$l.rayNorm = pb.div(this.ray, this.d);
      this.$l.origin = pb.add(this.cameraPos, pb.mul(this.rayNorm, this.params.parameter2.z));
      this.$l.term = this.params.parameter3.z;
      this.$l.worldPos = this.$choice(
        this.isSky,
        pb.add(this.cameraPosition, pb.mul(this.rayNorm, 1e8)),
        this.worldPosition
      );
      this.$l.falloff = pb.clamp(
        pb.mul(this.params.parameter1.w, pb.sub(this.worldPos.y, this.origin.y)),
        -125,
        this.$choice(this.isSky, pb.float(1e8), pb.float(126))
      );
      this.$l.fading = this.$choice(this.isSky, pb.smoothStep(3e7, 0, this.worldPos.y), 0);
      this.$l.factor = this.$choice(
        pb.greaterThan(pb.abs(this.falloff), 0.01),
        pb.div(pb.sub(1, pb.exp2(pb.neg(this.falloff))), this.falloff),
        pb.sub(Math.log(2), pb.mul(0.5 * Math.log(2) * Math.log(2), this.falloff))
      );
      this.$l.lineIntegral = pb.mul(this.term, this.factor, pb.distance(this.origin, this.worldPos));

      this.$l.directionalInscattering = pb.mul(
        pb.add(this.params.parameter4.rgb, pb.mul(this.params.lightColor, this.params.parameter3.y)),
        pb.pow(pb.clamp(pb.dot(this.rayNorm, this.params.lightDir), 0, 1), this.params.parameter3.w)
      );
      this.$l.fogFactor = pb.sub(1, pb.clamp(pb.exp2(pb.neg(this.lineIntegral)), 0, 1));
      this.$l.directionalInscattering = pb.mul(
        this.$l.directionalInscattering,
        pb.max(this.fogFactor, this.fading)
      );

      this.$l.fogColor = this.params.parameter1.rgb;
      this.$if(pb.greaterThan(this.params.parameter3.y, 0), function () {
        this.$l.skyContrib = pb.textureSampleLevel(skyDistantColorLut, pb.vec2(0.5), 0).rgb;
        this.fogColor = pb.add(this.fogColor, pb.mul(this.skyContrib, this.params.parameter3.y));
      });
      this.$l.fogFactor = pb.max(pb.min(this.fogFactor, this.params.parameter3.x), this.fading);
      this.$l.fogColor = pb.add(pb.mul(this.fogColor, this.fogFactor), this.directionalInscattering);
      this.$return(pb.vec4(this.fogColor, pb.sub(1, this.fogFactor)));
    }
  );
  return scope[funcName](params, cameraPos, worldPos, isSky);
}
