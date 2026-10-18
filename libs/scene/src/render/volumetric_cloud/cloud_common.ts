import type { PBInsideFunctionScope, PBShaderExp, ProgramBuilder } from '@zephyr3d/device';
import {
  getAtmosphereParamsStruct,
  getSkyView,
  rayIntersectSphere,
  transmittanceToSky
} from '../../shaders/atmosphere';

/*
 * Volumetric cloud ray marching, shared by every cloud pass.
 *
 * The march, lighting and integration follow UE 5.8 VolumetricCloud.usf (RenderVolumetricCloud,
 * lines 523-1500): layer entry/exit from the top and bottom spheres, uniform steps whose count
 * grows with the traced length up to 15 km, a secondary march towards the sun with x^2 sample
 * distribution, Wrenninge multiple-scattering octaves (SetupParticipatingMediaContext /
 * SetupParticipatingMediaPhaseContext), the analytic segment integral of Hillaire 2016, and the
 * aerial perspective applied once at the transmittance-weighted mean depth.
 *
 * UE leaves the density to a user material. Here it is the model of Schneider, "The Real-time
 * Volumetric Cloudscapes of Horizon Zero Dawn" (SIGGRAPH 2015 / GPU Pro 7), see
 * cloudSampleDensity().
 *
 * Everything runs in the observer-local atmosphere frame (planet centre at the origin, +Y up at
 * the observer, meters); the noise is anchored to the planet through the referential.
 */

/** UE r.VolumetricCloud.SampleMinCount */
export const CLOUD_SAMPLE_COUNT_MIN = 2;
/** UE r.VolumetricCloud.DistanceToSampleMaxCount: traced length at which the full count is used, in meters */
export const CLOUD_DISTANCE_TO_SAMPLE_COUNT_MAX = 15000;
/** UE VolumetricCloudComponent TracingStartMaxDistance default, in meters */
export const CLOUD_TRACING_START_MAX_DISTANCE = 350000;
/** UE UVolumetricCloudComponent::BaseViewRaySampleCount and r.VolumetricCloud.ViewRaySampleMaxCount */
export const CLOUD_BASE_VIEW_SAMPLE_COUNT = 96;
export const CLOUD_VIEW_SAMPLE_COUNT_MAX = 768;
/** UE UVolumetricCloudComponent::BaseShadowRaySampleCount and r.VolumetricCloud.Shadow.ViewRaySampleMaxCount */
export const CLOUD_BASE_SHADOW_SAMPLE_COUNT = 10;
export const CLOUD_SHADOW_SAMPLE_COUNT_MAX = 80;
/** UE r.SkyAtmosphere.DistantSkyLightLUT.Altitude, in meters */
export const CLOUD_DISTANT_SKY_LIGHT_ALTITUDE = 6000;
/**
 * 5% and 95% quantiles of the base shape (Perlin-Worley remapped by the Worley fbm) of the
 * generated noise, and the median of the generated weather map coverage, measured over 20000
 * samples of a CPU replica of cloud_noise.ts. The coverage remap spans this range so that
 * Coverage c fills about c of the mid layer (0.1 -> 0.11, 0.25 -> 0.26, 0.45 -> 0.51,
 * 0.7 -> 0.76, 0.9 -> 0.88). Imported noise with another distribution maps differently.
 */
export const CLOUD_COVERAGE_BASE_RANGE = [0.68, 0.93];
export const CLOUD_COVERAGE_WEATHER_MEDIAN = 0.75;
/** [Schneider15] cloud_top_offset: how far the wind pushes cloud tops ahead of their base, in meters */
export const CLOUD_TOP_OFFSET = 500;

/**
 * Uniform block of the cloud passes.
 * @internal
 */
export function getCloudParamsStruct(pb: ProgramBuilder) {
  return pb.defineStruct([
    // World (planet-fixed) to observer-local rotation the trace was set up with
    pb.mat4('referential'),
    // (bottom radius, top radius, planet radius, tracing max distance)
    pb.vec4('layer'),
    // (view sample count max, shadow sample count max, shadow tracing distance, stop transmittance)
    pb.vec4('march'),
    // (observer-local eye position, 0)
    pb.vec4('eye'),
    // (direction to the sun, per-sample atmosphere transmittance 0/1)
    pb.vec4('sunDir'),
    // (sun illuminance outside the atmosphere, 0)
    pb.vec4('sunIlluminance'),
    // (phase g, phase g2, phase blend, sky light bottom visibility)
    pb.vec4('phase'),
    // (multiple scattering contribution, occlusion, eccentricity, 0)
    pb.vec4('ms'),
    // (coverage, extinction per meter, detail erosion, 0)
    pb.vec4('density'),
    // (albedo, 0)
    pb.vec4('albedo'),
    // (1 / weather map scale, 1 / base noise scale, 1 / detail noise scale, cloud top offset)
    pb.vec4('scales'),
    // (wind offset of the noise in planet-fixed meters, 0)
    pb.vec4('windOffset'),
    // (horizontal wind direction x, z, 0, 0)
    pb.vec4('windDir')
  ]);
}

/**
 * Both roots of a ray / origin-centred sphere intersection, (-1, -1) when missed.
 * Mirrors UE RayIntersectSphereSolution.
 */
function raySphereSolutions(
  scope: PBInsideFunctionScope,
  origin: PBShaderExp,
  dir: PBShaderExp,
  radius: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_cloudRaySphereSolutions';
  pb.func(funcName, [pb.vec3('o'), pb.vec3('d'), pb.float('r')], function () {
    this.$l.b = pb.dot(this.o, this.d);
    this.$l.c = pb.sub(pb.dot(this.o, this.o), pb.mul(this.r, this.r));
    this.$l.disc = pb.sub(pb.mul(this.b, this.b), this.c);
    this.$if(pb.lessThan(this.disc, 0), function () {
      this.$return(pb.vec2(-1));
    });
    this.$l.s = pb.sqrt(this.disc);
    this.$return(pb.vec2(pb.sub(pb.neg(this.b), this.s), pb.add(pb.neg(this.b), this.s)));
  });
  return pb.getGlobalScope()[funcName](origin, dir, radius) as PBShaderExp;
}

/** Henyey-Greenstein with the forward peak where the view looks into the light (UE convention). */
function hgPhase(scope: PBInsideFunctionScope, g: PBShaderExp, cosTheta: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_cloudHGPhase';
  pb.func(funcName, [pb.float('g'), pb.float('c')], function () {
    this.$l.numer = pb.sub(1, pb.mul(this.g, this.g));
    this.$l.denom = pb.max(pb.sub(pb.add(1, pb.mul(this.g, this.g)), pb.mul(this.g, this.c, 2)), 1e-6);
    this.$return(pb.div(this.numer, pb.mul(4 * Math.PI, this.denom, pb.sqrt(this.denom))));
  });
  return pb.getGlobalScope()[funcName](g, cosTheta) as PBShaderExp;
}

/**
 * Density height gradient by cloud type (0 stratus, 0.5 stratocumulus, 1 cumulus), [Schneider15]
 * figure "height gradients", with the gradient corners of clayjohn's
 * godot-volumetric-cloud-demo-v2 (clouds.glsl, mixGradients).
 */
function densityHeightGradient(
  scope: PBInsideFunctionScope,
  heightFrac: PBShaderExp,
  cloudType: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_cloudHeightGradient';
  pb.func(funcName, [pb.float('h'), pb.float('t')], function () {
    this.$l.stratus = pb.sub(1, pb.clamp(pb.mul(this.t, 2), 0, 1));
    this.$l.stratocumulus = pb.sub(1, pb.mul(pb.abs(pb.sub(this.t, 0.5)), 2));
    this.$l.cumulus = pb.mul(pb.clamp(pb.sub(this.t, 0.5), 0, 1), 2);
    this.$l.g = pb.add(
      pb.mul(pb.vec4(0.02, 0.05, 0.09, 0.11), this.stratus),
      pb.mul(pb.vec4(0.02, 0.2, 0.48, 0.625), this.stratocumulus),
      pb.mul(pb.vec4(0.01, 0.0625, 0.78, 1), this.cumulus)
    );
    this.$return(
      pb.sub(pb.smoothStep(this.g.x, this.g.y, this.h), pb.smoothStep(this.g.z, this.g.w, this.h))
    );
  });
  return pb.getGlobalScope()[funcName](heightFrac, cloudType) as PBShaderExp;
}

/** remap(v, l0, h0, l1, h1) of [Schneider15] */
function remap(
  pb: ProgramBuilder,
  v: PBShaderExp | number,
  l0: PBShaderExp | number,
  h0: PBShaderExp | number,
  l1: number,
  h1: number
) {
  return pb.add(l1, pb.mul(pb.div(pb.sub(v, l0), pb.sub(h0, l0)), h1 - l1));
}

/**
 * Cloud medium at an observer-local position, standing in for the UE cloud material.
 *
 * Returns (extinction per meter, conservative density, normalized altitude in the layer,
 * altitude in the layer in meters). The conservative density is the base shape with coverage,
 * before detail erosion: zero there means zero density, which lets the march skip the detail
 * fetch, as UE does with its material's conservative density output.
 *
 * [Schneider15] SampleCloudDensity with these choices:
 * - the coverage remap's low end is spread over the range the base shape actually takes, so the
 *   Coverage parameter reads as the fraction of the mid layer filled with cloud (see
 *   CLOUD_COVERAGE_BASE_RANGE). With (1 - coverage) as the low end, as clayjohn and most published
 *   implementations do, Coverage 0.45 already filled 92% of the layer;
 * - the global coverage parameter scales the weather map coverage, normalized by its median;
 * - the precipitation channel is not used yet.
 * @internal
 */
export function cloudSampleDensity(
  scope: PBInsideFunctionScope,
  cloud: PBShaderExp,
  pos: PBShaderExp,
  weatherMap: PBShaderExp,
  baseNoise: PBShaderExp,
  detailNoise: PBShaderExp
) {
  const pb = scope.$builder;
  const CloudParams = getCloudParamsStruct(pb);
  const funcName = 'Z_cloudSampleDensity';
  pb.func(funcName, [CloudParams('cloud'), pb.vec3('p')], function () {
    // UE UpdateMaterialCloudParam
    this.$l.r = pb.length(this.p);
    this.$l.altInLayer = pb.sub(this.r, this.cloud.layer.x);
    this.$l.h = pb.div(this.altInLayer, pb.sub(this.cloud.layer.y, this.cloud.layer.x));
    this.$if(pb.or(pb.lessThanEqual(this.h, 0), pb.greaterThanEqual(this.h, 1)), function () {
      this.$return(pb.vec4(0, 0, this.h, this.altInLayer));
    });
    // Planet-fixed position (transpose of the referential), altitude as height so the noise
    // follows the curvature
    this.$l.planet = pb.mul(pb.vec4(this.p, 0), this.cloud.referential).xyz;
    this.$l.q = pb.vec3(this.planet.x, pb.sub(this.r, this.cloud.layer.z), this.planet.z);
    // [Schneider15] wind: tops pushed ahead of the base, plus the drift
    this.q = pb.add(
      this.q,
      pb.mul(pb.vec3(this.cloud.windDir.x, 0, this.cloud.windDir.y), pb.mul(this.cloud.scales.w, this.h)),
      this.cloud.windOffset.xyz
    );
    this.$l.weather = pb.textureSampleLevel(weatherMap, pb.mul(this.q.xz, this.cloud.scales.x), 0);
    this.$l.coverage = pb.clamp(
      pb.mul(this.weather.r, this.cloud.density.x, 1 / CLOUD_COVERAGE_WEATHER_MEDIAN),
      0,
      1
    );
    this.$if(pb.lessThanEqual(this.coverage, 0), function () {
      this.$return(pb.vec4(0, 0, this.h, this.altInLayer));
    });
    this.$l.n = pb.textureSampleLevel(baseNoise, pb.mul(this.q, this.cloud.scales.y), 0);
    this.$l.lowFbm = pb.add(pb.mul(this.n.g, 0.625), pb.mul(this.n.b, 0.25), pb.mul(this.n.a, 0.125));
    this.$l.base = remap(pb, this.n.r, pb.sub(this.lowFbm, 1), 1, 0, 1);
    this.base = pb.mul(this.base, densityHeightGradient(this, this.h, this.weather.b));
    this.$l.coverageLow = pb.mix(CLOUD_COVERAGE_BASE_RANGE[1], CLOUD_COVERAGE_BASE_RANGE[0], this.coverage);
    this.base = pb.mul(remap(pb, this.base, this.coverageLow, 1, 0, 1), this.coverage);
    this.$if(pb.lessThanEqual(this.base, 0), function () {
      this.$return(pb.vec4(0, 0, this.h, this.altInLayer));
    });
    this.$l.d = pb.textureSampleLevel(detailNoise, pb.mul(this.q, this.cloud.scales.z), 0).rgb;
    this.$l.highFbm = pb.add(pb.mul(this.d.r, 0.625), pb.mul(this.d.g, 0.25), pb.mul(this.d.b, 0.125));
    // Wispy at the base, billowy above
    this.$l.modifier = pb.mix(this.highFbm, pb.sub(1, this.highFbm), pb.clamp(pb.mul(this.h, 10), 0, 1));
    this.$l.eroded = pb.clamp(
      remap(pb, this.base, pb.mul(this.modifier, this.cloud.density.z), 1, 0, 1),
      0,
      1
    );
    this.$return(pb.vec4(pb.mul(this.eroded, this.cloud.density.y), 1, this.h, this.altInLayer));
  });
  return pb.getGlobalScope()[funcName](cloud, pos) as PBShaderExp;
}

/**
 * Traces the clouds along one view ray from the cloud eye position.
 *
 * Returns (scattered luminance with aerial perspective, mean transmittance), the luminance in the
 * units of the atmosphere (`params.lightColor`) so it composites directly over `skyBox()`:
 * `sky * a + rgb`.
 *
 * @param msCount - 1 + multiple scattering octaves (UE MSCOUNT), compile time
 * @param jitter - start offset of the march in steps, 0..1
 * @param stepScale - scales the sample count, below 1 for quick previews
 * @param groundDistance - distance at which the planet ground blocks the ray, or < 0
 * @internal
 */
export function cloudTrace(
  scope: PBInsideFunctionScope,
  msCount: number,
  atmosphere: PBShaderExp,
  cloud: PBShaderExp,
  dir: PBShaderExp,
  jitter: PBShaderExp,
  stepScale: PBShaderExp,
  ambient: PBShaderExp,
  textures: {
    weatherMap: PBShaderExp;
    baseNoise: PBShaderExp;
    detailNoise: PBShaderExp;
    transmittanceLut: PBShaderExp;
    multiScatteringLut: PBShaderExp;
  }
) {
  const pb = scope.$builder;
  const AtmosphereParams = getAtmosphereParamsStruct(pb);
  const CloudParams = getCloudParamsStruct(pb);
  const funcName = `Z_cloudTrace${msCount}`;
  const density = (s: PBInsideFunctionScope, p: PBShaderExp) =>
    cloudSampleDensity(s, s.cloud, p, textures.weatherMap, textures.baseNoise, textures.detailNoise);
  pb.func(
    funcName,
    [
      AtmosphereParams('atmo'),
      CloudParams('cloud'),
      pb.vec3('dir'),
      pb.float('jitter'),
      pb.float('stepScale'),
      pb.vec3('ambient')
    ],
    function () {
      this.$l.eye = this.cloud.eye.xyz;
      // Layer entry and exit, UE RenderVolumetricCloud lines 527-559
      this.$l.tTop2 = raySphereSolutions(this, this.eye, this.dir, this.cloud.layer.y);
      this.$l.tBottom2 = raySphereSolutions(this, this.eye, this.dir, this.cloud.layer.x);
      this.$l.tMin = pb.float(0);
      this.$l.tMax = pb.float(0);
      this.$if(pb.and(pb.lessThan(this.tTop2.x, 0), pb.lessThan(this.tTop2.y, 0)), function () {
        this.$return(pb.vec4(0, 0, 0, 1));
      });
      this.$if(pb.greaterThan(pb.abs(pb.sub(this.tBottom2.x, this.tBottom2.y)), 0), function () {
        this.$l.bottomBothAhead = pb.all(pb.greaterThan(this.tBottom2, pb.vec2(0)));
        this.$l.tempTop = this.$choice(
          pb.all(pb.greaterThan(this.tTop2, pb.vec2(0))),
          pb.min(this.tTop2.x, this.tTop2.y),
          pb.max(this.tTop2.x, this.tTop2.y)
        );
        this.$l.tempBottom = this.$choice(
          this.bottomBothAhead,
          pb.min(this.tBottom2.x, this.tBottom2.y),
          pb.max(this.tBottom2.x, this.tBottom2.y)
        );
        this.$if(this.bottomBothAhead, function () {
          this.tempTop = pb.max(0, pb.min(this.tTop2.x, this.tTop2.y));
        });
        this.tMin = pb.min(this.tempBottom, this.tempTop);
        this.tMax = pb.max(this.tempBottom, this.tempTop);
      }).$else(function () {
        this.tMin = this.tTop2.x;
        this.tMax = this.tTop2.y;
      });
      this.tMin = pb.max(this.tMin, 0);
      this.tMax = pb.max(this.tMax, 0);
      // The planet ground stands in for UE's depth buffer test
      this.$l.tGround = rayIntersectSphere(this, pb.vec3(0), this.cloud.layer.z, this.eye, this.dir);
      this.$if(pb.greaterThan(this.tGround, 0), function () {
        this.tMax = pb.min(this.tMax, this.tGround);
      });
      this.$if(
        pb.or(
          pb.lessThanEqual(this.tMax, this.tMin),
          pb.greaterThan(this.tMin, CLOUD_TRACING_START_MAX_DISTANCE)
        ),
        function () {
          this.$return(pb.vec4(0, 0, 0, 1));
        }
      );
      // TracingMaxDistanceMode 0: distance after the layer entry
      this.tMax = pb.add(this.tMin, pb.min(this.cloud.layer.w, pb.sub(this.tMax, this.tMin)));
      this.$l.stepCount = pb.max(
        pb.floor(
          pb.mul(
            this.cloud.march.x,
            this.stepScale,
            pb.clamp(pb.div(pb.sub(this.tMax, this.tMin), CLOUD_DISTANCE_TO_SAMPLE_COUNT_MAX), 0, 1)
          )
        ),
        CLOUD_SAMPLE_COUNT_MIN
      );
      this.$l.stepT = pb.div(pb.sub(this.tMax, this.tMin), this.stepCount);
      this.$l.iStepCount = pb.int(this.stepCount);

      // Per-ray factors, UE lines 737-794
      this.$l.msScatt = this.cloud.ms.x;
      this.$l.msExtin = pb.clamp(this.cloud.ms.y, 0, 1);
      this.$l.cosTheta = pb.dot(this.cloud.sunDir.xyz, this.dir);
      this.$l.phase0 = pb.mix(
        hgPhase(this, this.cloud.phase.x, this.cosTheta),
        hgPhase(this, this.cloud.phase.y, this.cosTheta),
        this.cloud.phase.z
      );
      // SetupParticipatingMediaPhaseContext
      const isotropic = 1 / (4 * Math.PI);
      this.$l.msPhaseFactor = pb.clamp(this.cloud.ms.z, 0, 1);
      for (let ms = 0; ms < msCount; ms++) {
        if (ms === 0) {
          this.$l.phaseMs0 = this.phase0;
        } else {
          this.$l[`phaseMs${ms}`] = pb.mix(isotropic, this.phase0, this.msPhaseFactor);
          this.msPhaseFactor = pb.mul(this.msPhaseFactor, this.msPhaseFactor);
        }
      }
      // Sun illuminance: outside the atmosphere with per-sample transmittance, else at the eye
      this.$l.perSample = pb.notEqual(this.cloud.sunDir.w, 0);
      this.$l.lightIlluminance = this.cloud.sunIlluminance.xyz;
      this.$if(pb.not(this.perSample), function () {
        this.lightIlluminance = pb.mul(
          this.lightIlluminance,
          transmittanceToSky(this, this.atmo, this.eye, this.cloud.sunDir.xyz, textures.transmittanceLut)
        );
      });

      this.$l.luminance = pb.vec3(0);
      this.$l.transmittanceToView = pb.float(1);
      this.$l.tAPWeightedSum = pb.float(0);
      this.$l.tAPWeightsSum = pb.float(0);
      this.$l.t = pb.add(this.tMin, pb.mul(this.jitter, this.stepT));
      this.$l.shadowCount = this.cloud.march.y;
      this.$l.shadowLength = this.cloud.march.z;
      this.$for(pb.int('i'), 0, this.iStepCount, function () {
        this.$l.samplePos = pb.add(this.eye, pb.mul(this.dir, this.t));
        this.$l.medium = density(this, this.samplePos);
        // Conservative density 0 or outside the layer: skip (StepSizeOnZeroConservativeDensity 1)
        this.$if(pb.lessThanEqual(this.medium.y, 0), function () {
          this.t = pb.add(this.t, this.stepT);
          this.$continue();
        });
        this.$l.extinction = this.medium.x;
        this.$l.scattering = pb.mul(this.cloud.albedo.xyz, this.extinction);
        // SetupParticipatingMediaContext
        this.$l.sFactor = this.msScatt;
        this.$l.eFactor = this.msExtin;
        this.$l.atmoTransmittance = pb.vec3(1);
        this.$if(this.perSample, function () {
          this.atmoTransmittance = transmittanceToSky(
            this,
            this.atmo,
            this.samplePos,
            this.cloud.sunDir.xyz,
            textures.transmittanceLut
          );
        });
        for (let ms = 0; ms < msCount; ms++) {
          if (ms === 0) {
            this.$l.scat0 = this.scattering;
            this.$l.ext0 = this.extinction;
          } else {
            this.$l[`scat${ms}`] = pb.mul(this[`scat${ms - 1}`], this.sFactor);
            this.$l[`ext${ms}`] = pb.mul(this[`ext${ms - 1}`], this.eFactor);
            this.sFactor = pb.mul(this.sFactor, this.sFactor);
            this.eFactor = pb.mul(this.eFactor, this.eFactor);
          }
          this.$l[`lightT${ms}`] = this.atmoTransmittance;
        }
        // Sky light, occluded towards the layer bottom (UE line 954)
        this.$l.distantLight = pb.mul(
          this.ambient,
          pb.clamp(pb.add(this.cloud.phase.w, this.medium.z), 0, 1)
        );
        this.$if(pb.greaterThan(this.extinction, 0), function () {
          // Secondary march towards the sun, x^2 distribution, fixed 0.5 jitter (UE lines 1063-1149)
          for (let ms = 0; ms < msCount; ms++) {
            this.$l[`extAcc${ms}`] = pb.float(0);
          }
          this.$l.prevNormT = pb.float(0);
          this.$for(pb.int('j'), 1, pb.add(pb.int(this.shadowCount), 1), function () {
            this.$l.normT = pb.div(pb.float(this.j), this.shadowCount);
            this.$l.curNormT = pb.mul(this.normT, this.normT);
            this.$l.deltaNormT = pb.sub(this.curNormT, this.prevNormT);
            this.$l.shadowPos = pb.add(
              this.samplePos,
              pb.mul(
                this.cloud.sunDir.xyz,
                this.shadowLength,
                pb.add(this.prevNormT, pb.mul(this.deltaNormT, 0.5))
              )
            );
            this.prevNormT = this.curNormT;
            this.$l.shadowMedium = density(this, this.shadowPos);
            this.$if(
              pb.or(pb.lessThanEqual(this.shadowMedium.z, 0), pb.greaterThanEqual(this.shadowMedium.z, 1)),
              function () {
                this.$break();
              }
            );
            this.$if(pb.lessThanEqual(this.shadowMedium.y, 0), function () {
              this.$continue();
            });
            this.$l.shadowExt = this.shadowMedium.x;
            this.$l.shadowEFactor = this.msExtin;
            for (let ms = 0; ms < msCount; ms++) {
              this[`extAcc${ms}`] = pb.add(this[`extAcc${ms}`], pb.mul(this.shadowExt, this.deltaNormT));
              if (ms + 1 < msCount) {
                this.shadowExt = pb.mul(this.shadowExt, this.shadowEFactor);
                this.shadowEFactor = pb.mul(this.shadowEFactor, this.shadowEFactor);
              }
            }
          });
          for (let ms = 0; ms < msCount; ms++) {
            this[`lightT${ms}`] = pb.mul(
              this[`lightT${ms}`],
              pb.exp(pb.neg(pb.mul(this[`extAcc${ms}`], this.shadowLength)))
            );
          }
          // Transmittance-weighted depth for the aerial perspective
          this.tAPWeightedSum = pb.add(this.tAPWeightedSum, pb.mul(this.t, this.transmittanceToView));
          this.tAPWeightsSum = pb.add(this.tAPWeightsSum, this.transmittanceToView);
        });
        // Analytic integration over the step, octaves in reverse so the last one updates the
        // view transmittance (UE lines 1353-1440)
        for (let ms = msCount - 1; ms >= 0; ms--) {
          this.$l.sunSky = pb.mul(this[`lightT${ms}`], this.lightIlluminance, this[`phaseMs${ms}`]);
          if (ms === 0) {
            this.sunSky = pb.add(this.sunSky, this.distantLight);
          }
          this.$l.scattered = pb.mul(this.sunSky, this[`scat${ms}`]);
          this.$l.safeExt = pb.max(this[`ext${ms}`], 1e-6);
          this.$l.segT = pb.exp(pb.neg(pb.mul(this.safeExt, this.stepT)));
          this.luminance = pb.add(
            this.luminance,
            pb.mul(
              this.transmittanceToView,
              pb.div(pb.sub(this.scattered, pb.mul(this.scattered, this.segT)), this.safeExt)
            )
          );
          if (ms === 0) {
            this.transmittanceToView = pb.mul(this.transmittanceToView, this.segT);
          }
        }
        this.$if(pb.lessThan(this.transmittanceToView, this.cloud.march.w), function () {
          this.$break();
        });
        this.t = pb.add(this.t, this.stepT);
      });
      // Aerial perspective at the mean cloud depth (UE lines 1481-1530), integrated along the
      // direction since the cache covers directions outside any camera's AP froxel volume
      this.$if(pb.greaterThan(this.tAPWeightsSum, 0), function () {
        this.$l.tAP = pb.div(this.tAPWeightedSum, pb.max(this.tAPWeightsSum, 1e-10));
        this.$l.ap = getSkyView(
          this,
          this.atmo,
          this.eye,
          this.dir,
          this.tAP,
          textures.transmittanceLut,
          textures.multiScatteringLut
        );
        this.luminance = pb.add(
          pb.mul(this.ap.rgb, pb.sub(1, this.transmittanceToView)),
          pb.mul(this.luminance, this.ap.a)
        );
      });
      this.$return(pb.vec4(this.luminance, this.transmittanceToView));
    }
  );
  return pb.getGlobalScope()[funcName](atmosphere, cloud, dir, jitter, stepScale, ambient) as PBShaderExp;
}

/**
 * Average sky luminance over the sphere at the distant sky light altitude: UE
 * RenderDistantSkyLightLutCS (SkyAtmosphere.usf), 64 uniform directions without ground,
 * illuminance times the isotropic phase.
 * @internal
 */
export function cloudDistantSkyLight(
  scope: PBInsideFunctionScope,
  atmosphere: PBShaderExp,
  sphereSamples: PBShaderExp,
  transmittanceLut: PBShaderExp,
  multiScatteringLut: PBShaderExp
) {
  const pb = scope.$builder;
  const AtmosphereParams = getAtmosphereParamsStruct(pb);
  const funcName = 'Z_cloudDistantSkyLight';
  pb.func(funcName, [AtmosphereParams('atmo')], function () {
    this.$l.pos = pb.vec3(0, pb.add(this.atmo.plantRadius, CLOUD_DISTANT_SKY_LIGHT_ALTITUDE), 0);
    this.$l.sum = pb.vec3(0);
    this.$for(pb.int('i'), 0, 64, function () {
      this.sum = pb.add(
        this.sum,
        getSkyView(
          this,
          this.atmo,
          this.pos,
          sphereSamples.at(this.i).xyz,
          pb.float(-1),
          transmittanceLut,
          multiScatteringLut,
          false
        ).rgb
      );
    });
    // sum * (4 pi / 64) * (1 / (4 pi))
    this.$return(pb.div(this.sum, 64));
  });
  return pb.getGlobalScope()[funcName](atmosphere) as PBShaderExp;
}

/**
 * Elevation of the cached sky remapped so [-delta, pi/2] fills the hemisphere: the cache also
 * holds clouds a raised observer sees below the horizon.
 */
function remapElevation(pb: ProgramBuilder, elevation: PBShaderExp, delta: PBShaderExp, encode: boolean) {
  const span = pb.add(Math.PI / 2, delta);
  return encode
    ? pb.mul(pb.div(pb.add(elevation, delta), span), Math.PI / 2)
    : pb.sub(pb.mul(pb.div(elevation, Math.PI / 2), span), delta);
}

/**
 * Observer-local direction to cloud cache uv: the upper hemisphere octahedron rotated 45 degrees
 * to fill the square (clayjohn clouds.gdshader vec3_to_oct, after J. White, "Signed Octahedron
 * Normal Encoding"), elevation remapped by `delta`. Directions below -delta are clamped to it.
 * @internal
 */
export function cloudCacheEncode(scope: PBInsideFunctionScope, dir: PBShaderExp, delta: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_cloudCacheEncode';
  pb.func(funcName, [pb.vec3('d'), pb.float('delta')], function () {
    this.$l.horizontal = pb.length(this.d.xz);
    this.$l.azimuth = this.$choice(
      pb.greaterThan(this.horizontal, 1e-6),
      pb.div(this.d.xz, this.horizontal),
      pb.vec2(1, 0)
    );
    this.$l.elevation = pb.asin(pb.clamp(this.d.y, -1, 1));
    this.elevation = pb.clamp(remapElevation(pb, this.elevation, this.delta, true), 0, Math.PI / 2);
    // Octahedron frame: x, y horizontal, z up
    this.$l.e = pb.vec3(pb.mul(this.azimuth, pb.cos(this.elevation)), pb.sin(this.elevation));
    this.e = pb.div(this.e, pb.add(pb.abs(this.e.x), pb.abs(this.e.y), pb.abs(this.e.z)));
    this.$return(
      pb.vec2(
        pb.add(0.5, pb.mul(pb.add(this.e.x, this.e.y), 0.5)),
        pb.add(0.5, pb.mul(pb.sub(this.e.y, this.e.x), 0.5))
      )
    );
  });
  return pb.getGlobalScope()[funcName](dir, delta) as PBShaderExp;
}

/**
 * Cloud cache uv to observer-local direction, inverse of {@link cloudCacheEncode}
 * (clayjohn clouds.glsl oct_to_vec3).
 * @internal
 */
export function cloudCacheDecode(scope: PBInsideFunctionScope, uv: PBShaderExp, delta: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_cloudCacheDecode';
  pb.func(funcName, [pb.vec2('uv'), pb.float('delta')], function () {
    this.$l.n = pb.vec3(pb.sub(this.uv.x, this.uv.y), pb.sub(pb.add(this.uv.x, this.uv.y), 1), 0);
    this.n.z = pb.max(pb.sub(pb.sub(1, pb.abs(this.n.x)), pb.abs(this.n.y)), 0);
    this.n = pb.normalize(this.n);
    this.$l.elevation = remapElevation(pb, pb.asin(this.n.z), this.delta, false);
    this.$l.horizontal = pb.length(this.n.xy);
    this.$l.azimuth = this.$choice(
      pb.greaterThan(this.horizontal, 1e-6),
      pb.div(this.n.xy, this.horizontal),
      pb.vec2(1, 0)
    );
    this.$l.c = pb.cos(this.elevation);
    this.$return(
      pb.vec3(pb.mul(this.azimuth.x, this.c), pb.sin(this.elevation), pb.mul(this.azimuth.y, this.c))
    );
  });
  return pb.getGlobalScope()[funcName](uv, delta) as PBShaderExp;
}
