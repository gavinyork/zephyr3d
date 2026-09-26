import { Vector3, Vector4 } from '@zephyr3d/base';
import type { PBInsideFunctionScope, PBShaderExp, ProgramBuilder } from '@zephyr3d/device';
import {
  AP_LUT_DEPTH_SLICES,
  AP_LUT_SLICE_SIZE,
  aerialPerspective,
  getAtmosphereParamsStruct
} from './atmosphere';
import { Fog } from '../values';

/**
 * @internal
 * How far above the fog height the observer is clamped for the fog density at the ray origin (UE:
 * FogHeight + 65536 world units, i.e. 655.36 m).
 */
export const MAX_FOG_HEIGHT = 655.36;

/** @internal */
export type HeightFogParams = {
  parameter1: Vector4; // [rgb=fogColor a=heightFalloff]
  parameter2: Vector4; // [r=density g=startHeight b=startDistance a=endDistance]
  parameter3: Vector4; // [r=maxOpacity g=atmosphereStrength b=rayOriginTerm a=dirInscatteringExponent]
  parameter4: Vector4; // [rgb=directionalInscatteringColor a=UNUSED]
  lightDir: Vector3;
  lightColor: Vector3;
  /**
   * Camera pre-exposure applied to the atmosphere-derived LUT samples (distant sky, aerial
   * perspective). Those LUTs are baked exposure-independently, unlike the authored fog colors which
   * are already pre-exposed on upload. 1 in legacy.
   */
  preExposure: number;
  /**
   * How much the in-scattering color is replaced by the environment radiance map sampled along the
   * view ray (UE: SkyLightCaptureAffectsHeightFogStrength). 0 disables it.
   */
  skyLightStrength: number;
  /** Roughness selecting the radiance map mip (UE: SkyLightCaptureAffectsHeightFogRoughness). */
  skyLightRoughness: number;
  /**
   * Converts radiance map samples to pre-exposed radiance, 0 when no radiance map is available.
   * Updated every frame by SkyRenderer.
   */
  skyLightScale: number;
  /** Max LOD of the radiance map. Updated every frame by SkyRenderer. */
  skyLightMaxLod: number;
};

/** @internal */
export function getDefaultHeightFogParams() {
  return {
    parameter1: new Vector4(0, 0, 0, 0.1),
    parameter2: new Vector4(0.01, 0, 0, 10000),
    parameter3: new Vector4(0.8, 1, 0, 4),
    parameter4: new Vector4(0, 0, 0, 0),
    lightDir: new Vector3(0, 1, 0),
    lightColor: new Vector3(0, 0, 0),
    preExposure: 1,
    skyLightStrength: 0,
    skyLightRoughness: 0.15,
    skyLightScale: 0,
    skyLightMaxLod: 0
  } as HeightFogParams;
}

/** @internal */
export function getHeightFogParamsStruct(pb: ProgramBuilder) {
  return pb.defineStruct([
    pb.vec4('parameter1'),
    pb.vec4('parameter2'),
    pb.vec4('parameter3'),
    pb.vec4('parameter4'),
    pb.vec3('lightDir'),
    pb.vec3('lightColor'),
    pb.float('preExposure'),
    pb.float('skyLightStrength'),
    pb.float('skyLightRoughness'),
    pb.float('skyLightScale'),
    pb.float('skyLightMaxLod')
  ]);
}

export function calculateFog(
  scope: PBInsideFunctionScope,
  aerialperspective: PBShaderExp,
  fogType: PBShaderExp,
  atmosphereParams: PBShaderExp,
  heightFogParams: PBShaderExp,
  uv: PBShaderExp,
  isSky: PBShaderExp | boolean,
  cameraPos: PBShaderExp,
  worldPos: PBShaderExp,
  additive: PBShaderExp | number,
  apLut: PBShaderExp,
  distantLightLut: PBShaderExp,
  skyLightCubemap: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_calculateFog';
  const AtmosphereParams = getAtmosphereParamsStruct(pb);
  const HeightFogParams = getHeightFogParamsStruct(pb);
  pb.func(
    funcName,
    [
      pb.int('withAerialPerspective'),
      pb.int('fogType'),
      AtmosphereParams('atmosphereParams'),
      HeightFogParams('heightFogParams'),
      pb.bool('isSky'),
      pb.vec2('uv'),
      pb.vec3('cameraPos'),
      pb.vec3('worldPos'),
      pb.int('additive')
    ],
    function () {
      this.$l.fogging = pb.vec4(0, 0, 0, 1);
      this.$if(pb.equal(this.fogType, Fog.FOG_TYPE_HEIGHT), function () {
        this.fogging = calculateHeightFog(
          this,
          this.heightFogParams,
          this.cameraPos,
          this.worldPos,
          this.isSky,
          distantLightLut,
          skyLightCubemap
        );
      });
      this.$if(pb.and(pb.notEqual(this.withAerialPerspective, 0), pb.not(this.isSky)), function () {
        this.$l.atmosphericFogging = aerialPerspective(
          this,
          this.uv,
          this.atmosphereParams,
          this.cameraPos,
          this.worldPos,
          pb.vec3(AP_LUT_SLICE_SIZE, AP_LUT_SLICE_SIZE, AP_LUT_DEPTH_SLICES),
          apLut
        );
        // rgb is inscattered radiance from the exposure-independent AP LUT, so it takes the camera
        // pre-exposure; alpha is transmittance and must stay unscaled.
        this.atmosphericFogging = pb.vec4(
          pb.mul(this.atmosphericFogging.rgb, this.heightFogParams.preExposure),
          this.atmosphericFogging.a
        );
        this.$if(pb.notEqual(this.fogType, Fog.FOG_TYPE_NONE), function () {
          this.fogging = combineAerialPerspectiveFog(this, this.fogging, this.atmosphericFogging);
        }).$else(function () {
          this.fogging = this.atmosphericFogging;
        });
      });
      this.$if(pb.notEqual(this.additive, 0), function () {
        this.fogging = pb.vec4(pb.vec3(0), this.fogging.a);
      });
      this.$return(this.fogging);
    }
  );
  return scope[funcName](
    aerialperspective,
    fogType,
    atmosphereParams,
    heightFogParams,
    isSky,
    uv,
    cameraPos,
    worldPos,
    additive
  );
}

export function combineAerialPerspectiveFog(
  scope: PBInsideFunctionScope,
  fogging: PBShaderExp,
  aerialPerspectiveFog: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_combineAerialPerspectiveFog';
  pb.func(funcName, [pb.vec4('fogging'), pb.vec4('aerialPerspectiveFog')], function () {
    this.$l.rgb = pb.add(this.fogging.rgb, pb.mul(this.aerialPerspectiveFog.rgb, this.fogging.a));
    this.$l.a = pb.mul(this.fogging.a, this.aerialPerspectiveFog.a);
    this.$return(pb.vec4(this.rgb, this.a));
  });
  return scope[funcName](fogging, aerialPerspectiveFog);
}

/**
 * Exponential height fog, following UE's GetExponentialHeightFog (HeightFogCommon.ush) with a single
 * fog term and no inscattering cubemap.
 *
 * Returns the in-scattered radiance in rgb and the transmittance in a.
 */
export function calculateHeightFog(
  scope: PBInsideFunctionScope,
  params: PBShaderExp,
  cameraPos: PBShaderExp,
  worldPos: PBShaderExp,
  isSky: PBShaderExp | boolean,
  skyDistantColorLut: PBShaderExp,
  skyLightCubemap: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_calcHeightFog';
  const Params = getHeightFogParamsStruct(pb);
  pb.func(
    funcName,
    [Params('params'), pb.vec3('cameraPosition'), pb.vec3('worldPosition'), pb.bool('isSky')],
    function () {
      this.$l.falloff = this.params.parameter1.w;
      this.$l.density = this.params.parameter2.x;
      this.$l.fogHeight = this.params.parameter2.y;
      this.$l.startDistance = this.params.parameter2.z;
      this.$l.endDistance = this.params.parameter2.w;
      this.$l.maxOpacity = this.params.parameter3.x;
      // Sky pixels have no depth: put them far away along the view ray.
      this.$l.receiver = this.$choice(
        this.isSky,
        pb.add(
          this.cameraPosition,
          pb.mul(pb.normalize(pb.sub(this.worldPosition, this.cameraPosition)), 1e8)
        ),
        this.worldPosition
      );
      // The density at the observer (rayOriginTerm, see SkyRenderer.update) is evaluated at a height
      // clamped to MAX_FOG_HEIGHT above the fog, so the ray starts from that clamped observer.
      this.$l.observerY = pb.min(this.cameraPosition.y, pb.add(this.fogHeight, MAX_FOG_HEIGHT));
      this.$l.cameraToReceiver = pb.sub(this.receiver, this.cameraPosition);
      // End distance: fog stops accumulating beyond this horizontal distance.
      this.$l.lenXZSqr = pb.dot(this.cameraToReceiver.xz, this.cameraToReceiver.xz);
      this.$if(
        pb.and(
          pb.greaterThan(this.endDistance, 0),
          pb.greaterThan(this.lenXZSqr, pb.mul(this.endDistance, this.endDistance))
        ),
        function () {
          this.cameraToReceiver = pb.mul(
            this.cameraToReceiver,
            pb.div(this.endDistance, pb.sqrt(pb.max(1, this.lenXZSqr)))
          );
        }
      );
      // Compensate for the clamped observer height.
      this.cameraToReceiver.y = pb.add(
        this.cameraToReceiver.y,
        pb.sub(this.cameraPosition.y, this.observerY)
      );
      this.$l.cameraToReceiverLength = pb.max(pb.length(this.cameraToReceiver), 1e-4);
      this.$l.cameraToReceiverNorm = pb.div(this.cameraToReceiver, this.cameraToReceiverLength);
      this.$l.rayOriginTerms = this.params.parameter3.z;
      this.$l.rayLength = this.cameraToReceiverLength;
      this.$l.rayDirectionY = this.cameraToReceiver.y;
      // Start distance: integrate from the exclusion point, with the density re-evaluated at its height.
      this.$if(pb.greaterThan(this.startDistance, 0), function () {
        this.$l.excludeIntersectionTime = pb.div(this.startDistance, this.cameraToReceiverLength);
        this.$l.cameraToExclusionY = pb.mul(this.excludeIntersectionTime, this.cameraToReceiver.y);
        this.$l.exclusionY = pb.add(this.observerY, this.cameraToExclusionY);
        this.rayLength = pb.mul(pb.sub(1, this.excludeIntersectionTime), this.cameraToReceiverLength);
        this.rayDirectionY = pb.sub(this.cameraToReceiver.y, this.cameraToExclusionY);
        this.$l.exponent = pb.max(-127, pb.mul(this.falloff, pb.sub(this.exclusionY, this.fogHeight)));
        this.rayOriginTerms = pb.mul(this.density, pb.exp2(pb.neg(this.exponent)));
      });
      // Line integral of density * exp2(-falloff * y) along the ray, divided by the ray length.
      this.$l.falloffTerm = pb.max(-127, pb.mul(this.falloff, this.rayDirectionY));
      this.$l.lineIntegralShared = pb.mul(
        this.rayOriginTerms,
        this.$choice(
          pb.greaterThan(pb.abs(this.falloffTerm), 0.01),
          pb.div(pb.sub(1, pb.exp2(pb.neg(this.falloffTerm))), this.falloffTerm),
          pb.sub(Math.log(2), pb.mul(0.5 * Math.log(2) * Math.log(2), this.falloffTerm))
        )
      );
      this.$l.lineIntegral = pb.mul(this.lineIntegralShared, this.rayLength);
      // Ad hoc horizon blend for sky pixels: fully fogged below the horizon.
      this.$l.fading = this.$choice(this.isSky, pb.smoothStep(5e6, 0, this.receiver.y), 0);

      // Directional inscattering: a lobe around the light approximating in-scattering from the
      // directional light off the haze. It has its own opacity, unaffected by maxOpacity.
      this.$l.directionalLight = pb.mul(
        pb.add(this.params.parameter4.rgb, pb.mul(this.params.lightColor, this.params.parameter3.y)),
        pb.pow(
          pb.clamp(pb.dot(this.cameraToReceiverNorm, this.params.lightDir), 0, 1),
          this.params.parameter3.w
        )
      );
      this.$l.dirFogOpacity = pb.sub(
        1,
        pb.clamp(pb.exp2(pb.neg(pb.mul(this.lineIntegralShared, pb.max(this.rayLength, 0)))), 0, 1)
      );
      this.$l.directionalInscattering = pb.mul(
        this.directionalLight,
        pb.max(this.dirFogOpacity, this.fading)
      );

      this.$l.fogColor = this.params.parameter1.rgb;
      this.$if(pb.greaterThan(this.params.parameter3.y, 0), function () {
        // The distant-sky LUT is baked exposure-independently (it feeds the cached IBL), so the
        // camera pre-exposure is applied here. The authored fogColor above is already pre-exposed.
        this.$l.skyContrib = pb.mul(
          pb.textureSampleLevel(skyDistantColorLut, pb.vec2(0.5), 0).rgb,
          this.params.preExposure
        );
        this.fogColor = pb.add(this.fogColor, pb.mul(this.skyContrib, this.params.parameter3.y));
      });
      // Sky light capture affects height fog (UE: SUPPORTS_SKYLIGHTCAPTURE_AFFECTS_HEIGHTFOGINSCATTERING).
      // A single view independent in-scattering color is the hemisphere average, darker than the
      // horizon sky it covers; sampling the environment along the view ray instead makes distant fog
      // take the color of the sky behind it. Lerped rather than added to not count the energy twice.
      this.$l.skyLightStrength = this.$choice(
        pb.greaterThan(this.params.skyLightScale, 0),
        pb.clamp(this.params.skyLightStrength, 0, 1),
        pb.float(0)
      );
      this.$if(pb.greaterThan(this.skyLightStrength, 0), function () {
        // Mirror downward rays into the upper hemisphere. The environment below the horizon is the
        // atmosphere seen against an unlit ground (nearly black), which would make distant fog below
        // the horizon a dark band; the fog medium there is lit by the sky above it. Same convention
        // as the physical distant-sky LUT bake (SkyRenderer._programDistantLight).
        // Mirroring alone does not keep the lookup off the ground: at the horizon the filter footprint
        // still straddles it and pulls the dark texels in. Lift the direction by one texel of the
        // sampled mip (a cube face spans 90 degrees) so the footprint stays in the upper hemisphere.
        this.$l.skyLightLod = pb.mul(
          pb.clamp(this.params.skyLightRoughness, 0, 1),
          this.params.skyLightMaxLod
        );
        this.$l.minElevation = pb.min(
          pb.mul(Math.PI / 2, pb.exp2(pb.sub(this.skyLightLod, this.params.skyLightMaxLod))),
          Math.PI / 2
        );
        this.$l.skyLightDir = pb.vec3(
          this.cameraToReceiverNorm.x,
          pb.max(pb.abs(this.cameraToReceiverNorm.y), pb.sin(this.minElevation)),
          this.cameraToReceiverNorm.z
        );
        this.$l.skyLightInscattering = pb.mul(
          pb.textureSampleLevel(skyLightCubemap, pb.normalize(this.skyLightDir), this.skyLightLod).rgb,
          this.params.skyLightScale
        );
        this.directionalInscattering = pb.mul(this.directionalInscattering, pb.sub(1, this.skyLightStrength));
        this.fogColor = pb.mix(this.fogColor, this.skyLightInscattering, this.skyLightStrength);
      });
      // UE: ExpFogFactor = max(saturate(exp2(-LineIntegral)), 1 - FogMaxOpacity)
      this.$l.fogOpacity = pb.min(
        pb.sub(1, pb.clamp(pb.exp2(pb.neg(this.lineIntegral)), 0, 1)),
        this.maxOpacity
      );
      this.fogOpacity = pb.max(this.fogOpacity, this.fading);
      this.$return(
        pb.vec4(
          pb.add(pb.mul(this.fogColor, this.fogOpacity), this.directionalInscattering),
          pb.sub(1, this.fogOpacity)
        )
      );
    }
  );
  return scope[funcName](params, cameraPos, worldPos, isSky);
}
