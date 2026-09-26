import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUDataBuffer,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder,
  Texture2D
} from '@zephyr3d/device';
import { drawFullscreenQuad } from '../render/fullscreenquad';
import { fetchSampler } from '../utility/misc';
import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import { uniformSphereSamples } from '../values';
import { getDevice } from '../app/api';

const TRANSMITTANCE_SAMPLES = 16;
const RAYLEIGH_SIGMA = [5.802, 13.558, 33.1];
const MIE_SIGMA = 3.996;
const MIE_ABSORPTION_SIGMA = 4.4;
const OZONE_ABSORPTION_SIGMA = [0.65, 1.881, 0.085];

/**
 * @internal
 * Lowest observer altitude above the ground, in meters (UE: PlanetRadiusOffset in
 * FAtmosphereSetup::ComputeViewData). Keeps the sky visible when the camera is at or below the
 * virtual planet surface.
 */
export const MIN_OBSERVER_ALTITUDE = 5;

/** @internal */
export type AtmosphereParams = {
  plantRadius: number;
  atmosphereHeight: number;
  rayleighScatteringHeight: number;
  mieScatteringHeight: number;
  mieAnstropy: number;
  ozoneCenter: number;
  ozoneWidth: number;
  /** Albedo of the virtual planet ground (UE: GroundAlbedo) */
  groundAlbedo: Vector3;
  apDistance: number;
  /**
   * Scales the distances the aerial perspective integrates over, making distant objects hazier (>1)
   * or clearer (<1). Does not affect the sky (UE: AerialPespectiveViewDistanceScale).
   */
  apViewDistanceScale: number;
  /**
   * Distance from the camera, in atmosphere meters, where aerial perspective starts; nearer
   * surfaces get none. The LUT depth slices cover [apStartDepth, apStartDepth + apDistance]
   * (UE: AerialPerspectiveStartDepth).
   */
  apStartDepth: number;
  cameraWorldMatrix: Matrix4x4;
  lightDir: Vector3;
  lightColor: Vector4;
  cameraAspect: number;
  cameraTanHalfFovy: number;
  /** Atmosphere meters per world unit */
  cameraHeightScale: number;
  /**
   * Observer altitude above the ground, in meters. Every atmosphere computation runs in the
   * observer's local frame: planet center at the origin, observer at (0, R + altitude, 0).
   */
  observerAltitude: number;
  /**
   * World to observer-local rotation (UE: SkyViewLutReferential). Its Y row is the local up; at the
   * world origin it is the identity. `lightDir` and `cameraWorldMatrix` are stored in this frame.
   */
  skyViewReferential: Matrix4x4;
};

/** @internal */
export function getDefaultAtmosphereParams() {
  return {
    plantRadius: 6360000,
    atmosphereHeight: 60000,
    rayleighScatteringHeight: 8000,
    mieScatteringHeight: 1200,
    mieAnstropy: 0.8,
    ozoneCenter: 25000,
    ozoneWidth: 15000,
    // UE default FColor(170, 170, 170), i.e. 0.4 linear
    groundAlbedo: new Vector3(0.401978, 0.401978, 0.401978),
    apDistance: 96000,
    apViewDistanceScale: 1,
    // UE default 0.1 km
    apStartDepth: 100,
    cameraWorldMatrix: Matrix4x4.identity(),
    lightDir: new Vector3(1, 0, 0),
    lightColor: new Vector4(1, 1, 1, 10),
    cameraAspect: 1,
    cameraTanHalfFovy: 1,
    cameraHeightScale: 1,
    observerAltitude: MIN_OBSERVER_ALTITUDE,
    skyViewReferential: Matrix4x4.identity()
  } as AtmosphereParams;
}

const defaultAtmosphereParams = getDefaultAtmosphereParams();

let currentAtmosphereParams: Nullable<AtmosphereParams> = null;

function checkParams(other?: Partial<AtmosphereParams>) {
  const result = {
    transmittance: false,
    multiScattering: false,
    skyView: false,
    aerialPerspective: false
  };
  other = { ...defaultAtmosphereParams, ...other };
  if (!currentAtmosphereParams) {
    currentAtmosphereParams = {
      ...defaultAtmosphereParams,
      lightDir: new Vector3(defaultAtmosphereParams.lightDir),
      lightColor: new Vector4(defaultAtmosphereParams.lightColor),
      groundAlbedo: new Vector3(defaultAtmosphereParams.groundAlbedo),
      cameraWorldMatrix: new Matrix4x4(defaultAtmosphereParams.cameraWorldMatrix),
      skyViewReferential: new Matrix4x4(defaultAtmosphereParams.skyViewReferential)
    };
    result.transmittance = true;
    result.multiScattering = true;
    result.skyView = true;
    result.aerialPerspective = true;
  } else {
    result.transmittance =
      currentAtmosphereParams.plantRadius !== other.plantRadius ||
      currentAtmosphereParams.atmosphereHeight !== other.atmosphereHeight ||
      currentAtmosphereParams.rayleighScatteringHeight !== other.rayleighScatteringHeight ||
      currentAtmosphereParams.mieScatteringHeight !== other.mieScatteringHeight ||
      currentAtmosphereParams.ozoneCenter !== other.ozoneCenter ||
      currentAtmosphereParams.ozoneWidth !== other.ozoneWidth;
    // The multi-scattering LUT uses an isotropic phase and a unit light, so it depends on the
    // medium only (see integralMultiScattering).
    result.multiScattering =
      result.transmittance || !currentAtmosphereParams.groundAlbedo.equalsTo(other.groundAlbedo!);
    // The sky view LUT is a full lat-long sphere around the observer in its local frame: the camera
    // orientation does not affect it, its altitude and the local light direction do.
    result.skyView =
      result.transmittance ||
      result.multiScattering ||
      currentAtmosphereParams.mieAnstropy !== other.mieAnstropy ||
      currentAtmosphereParams.observerAltitude !== other.observerAltitude ||
      !currentAtmosphereParams.lightDir.equalsTo(other.lightDir!) ||
      !currentAtmosphereParams.lightColor.equalsTo(other.lightColor!);
    result.aerialPerspective =
      result.transmittance ||
      result.multiScattering ||
      result.skyView ||
      currentAtmosphereParams.apDistance !== other.apDistance ||
      currentAtmosphereParams.apViewDistanceScale !== other.apViewDistanceScale ||
      currentAtmosphereParams.apStartDepth !== other.apStartDepth ||
      currentAtmosphereParams.cameraAspect !== other.cameraAspect ||
      currentAtmosphereParams.cameraTanHalfFovy !== other.cameraTanHalfFovy ||
      !currentAtmosphereParams.cameraWorldMatrix.equalsTo(other.cameraWorldMatrix!);
  }
  if (result.transmittance) {
    currentAtmosphereParams.plantRadius = other.plantRadius!;
    currentAtmosphereParams.atmosphereHeight = other.atmosphereHeight!;
    currentAtmosphereParams.rayleighScatteringHeight = other.rayleighScatteringHeight!;
    currentAtmosphereParams.mieScatteringHeight = other.mieScatteringHeight!;
    currentAtmosphereParams.ozoneCenter = other.ozoneCenter!;
    currentAtmosphereParams.ozoneWidth = other.ozoneWidth!;
  }
  if (result.multiScattering) {
    currentAtmosphereParams.groundAlbedo.set(other.groundAlbedo!);
  }
  if (result.skyView) {
    currentAtmosphereParams.mieAnstropy = other.mieAnstropy!;
    currentAtmosphereParams.observerAltitude = other.observerAltitude!;
    currentAtmosphereParams.lightDir.set(other.lightDir!);
    currentAtmosphereParams.lightColor.set(other.lightColor!);
  }
  if (result.aerialPerspective) {
    currentAtmosphereParams.apDistance = other.apDistance!;
    currentAtmosphereParams.apViewDistanceScale = other.apViewDistanceScale!;
    currentAtmosphereParams.apStartDepth = other.apStartDepth!;
    currentAtmosphereParams.cameraAspect = other.cameraAspect!;
    currentAtmosphereParams.cameraTanHalfFovy = other.cameraTanHalfFovy!;
    currentAtmosphereParams.cameraWorldMatrix.set(other.cameraWorldMatrix!);
  }
  return result;
}

/** @internal */
export function rayIntersectSphere(
  scope: PBInsideFunctionScope,
  f3Center: PBShaderExp,
  fRadius: PBShaderExp,
  f3RayStart: PBShaderExp,
  f3RayDir: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_rayIntersectSphere';
  pb.func(
    funcName,
    [pb.vec3('center'), pb.float('radius'), pb.vec3('rayStart'), pb.vec3('rayDir')],
    function () {
      this.$l.OS = pb.length(pb.sub(this.center, this.rayStart));
      this.$l.SH = pb.dot(pb.sub(this.center, this.rayStart), this.rayDir);
      this.$l.OH = pb.sqrt(pb.max(pb.sub(pb.mul(this.OS, this.OS), pb.mul(this.SH, this.SH)), 0));
      this.$if(pb.greaterThan(this.OH, this.radius), function () {
        this.$return(pb.float(-1));
      });
      this.$l.PH = pb.sqrt(pb.max(pb.sub(pb.mul(this.radius, this.radius), pb.mul(this.OH, this.OH)), 0));
      this.$l.t1 = pb.sub(this.SH, this.PH);
      this.$l.t2 = pb.add(this.SH, this.PH);
      this.$return(this.$choice(pb.lessThan(this.t1, 0), this.t2, this.t1));
    }
  );
  return scope[funcName](f3Center, fRadius, f3RayStart, f3RayDir) as PBShaderExp;
}

/**
 * @internal
 *
 * Far intersection of a ray with a sphere, -1 when missed. For a start inside the sphere this is
 * where the ray leaves it: unlike {@link rayIntersectSphere} it cannot mistake a near root that float
 * error nudged above 0 for the exit (UE: max(SolT.x, SolT.y) in IntegrateSingleScatteredLuminance).
 */
export function rayIntersectSphereFar(
  scope: PBInsideFunctionScope,
  fRadius: PBShaderExp,
  f3RayStart: PBShaderExp,
  f3RayDir: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_rayIntersectSphereFar';
  pb.func(funcName, [pb.float('radius'), pb.vec3('rayStart'), pb.vec3('rayDir')], function () {
    this.$l.OS = pb.length(this.rayStart);
    this.$l.SH = pb.neg(pb.dot(this.rayStart, this.rayDir));
    this.$l.OH = pb.sqrt(pb.max(pb.sub(pb.mul(this.OS, this.OS), pb.mul(this.SH, this.SH)), 0));
    this.$if(pb.greaterThan(this.OH, this.radius), function () {
      this.$return(pb.float(-1));
    });
    this.$l.PH = pb.sqrt(pb.max(pb.sub(pb.mul(this.radius, this.radius), pb.mul(this.OH, this.OH)), 0));
    this.$return(pb.add(this.SH, this.PH));
  });
  return scope[funcName](fRadius, f3RayStart, f3RayDir) as PBShaderExp;
}

/** @internal */
export function transmittanceToSky(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3Pos: PBShaderExp,
  f3Dir: PBShaderExp,
  texLut: PBShaderExp,
  planetShadow = true
) {
  const pb = scope.$builder;
  const funcName = planetShadow ? 'z_transmittanceToSky' : 'z_transmittanceToSkyNoShadow';
  const Params = getAtmosphereParamsStruct(pb);
  pb.func(funcName, [Params('params'), pb.vec3('p'), pb.vec3('dir')], function () {
    this.$l.bottomRadius = this.params.plantRadius;
    this.$l.topRadius = pb.add(this.params.plantRadius, this.params.atmosphereHeight);
    this.$l.upVector = pb.normalize(this.p);
    // Planet shadow. The LUT only parameterizes zenith..horizon: a direction below the horizon
    // would clamp to the horizon texel and keep the sun lit after it has set. Test the planet
    // analytically instead, from a point lifted 1m to stay clear of float error on the sphere
    // (UE: GetAtmosphereTransmittance / PLANET_RADIUS_OFFSET).
    if (planetShadow) {
      this.$l.tPlanet = rayIntersectSphere(
        this,
        pb.vec3(0),
        this.bottomRadius,
        pb.add(this.p, this.upVector),
        this.dir
      );
      this.$if(pb.greaterThan(this.tPlanet, 0), function () {
        this.$return(pb.vec3(0));
      });
    }
    // Above the atmosphere the LUT has no entry: look it up from where the ray enters it.
    this.$l.pos = this.p;
    this.$if(pb.greaterThan(pb.length(this.p), this.topRadius), function () {
      this.$l.tTop = rayIntersectSphere(this, pb.vec3(0), this.topRadius, this.p, this.dir);
      this.$if(pb.lessThan(this.tTop, 0), function () {
        this.$return(pb.vec3(1));
      });
      this.pos = pb.add(this.p, pb.mul(this.dir, this.tTop));
      this.upVector = pb.normalize(this.pos);
    });
    this.$l.cosTheta = pb.dot(this.upVector, this.dir);
    this.$l.r = pb.min(pb.length(this.pos), this.topRadius);
    this.$l.uv = transmittanceLutToUV(this, this.bottomRadius, this.topRadius, this.cosTheta, this.r);
    this.$return(pb.textureSampleLevel(texLut, this.uv, 0).rgb);
  });
  return scope[funcName](stParams, f3Pos, f3Dir);
}

/** @internal */
export function rayleighCoefficient(
  scope: PBInsideFunctionScope,
  fRayleighScatteringHeight: PBShaderExp,
  fH: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_rayleighCoefficient';
  pb.func(funcName, [pb.float('rayleighScatteringHeight'), pb.float('h')], function () {
    this.$l.sigma = pb.mul(pb.vec3(RAYLEIGH_SIGMA[0], RAYLEIGH_SIGMA[1], RAYLEIGH_SIGMA[2]), 1e-6);
    // Height clamped at the ground as in UE (SampleAtmosphereMediumRGB): a ray that float error lets
    // through the planet must not reach exp() overflow and turn into NaN.
    this.$l.rho_h = pb.exp(pb.neg(pb.div(pb.max(this.h, 0), this.rayleighScatteringHeight)));
    this.$return(pb.mul(this.sigma, this.rho_h));
  });
  return scope[funcName](fRayleighScatteringHeight, fH);
}

/** @internal */
export function rayleighPhase(scope: PBInsideFunctionScope, fCosTheta: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'z_rayleighPhase';
  pb.func(funcName, [pb.float('cosTheta')], function () {
    this.$return(pb.mul(3 / (16 * Math.PI), pb.add(1, pb.mul(this.cosTheta, this.cosTheta))));
  });
  return scope[funcName](fCosTheta);
}

/** @internal */
export function mieCoefficient(
  scope: PBInsideFunctionScope,
  fMieScatteringHeight: PBShaderExp,
  fH: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_mieCoefficient';
  pb.func(funcName, [pb.float('mieScatteringHeight'), pb.float('h')], function () {
    this.$l.sigma = pb.mul(pb.vec3(MIE_SIGMA), 1e-6);
    this.$l.rho_h = pb.exp(pb.neg(pb.div(pb.max(this.h, 0), this.mieScatteringHeight)));
    this.$return(pb.mul(this.sigma, this.rho_h));
  });
  return scope[funcName](fMieScatteringHeight, fH);
}

/** @internal */
export function miePhase(scope: PBInsideFunctionScope, fMieAnstropy: PBShaderExp, fCosTheta: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'z_miePhase';
  // Henyey-Greenstein, as UE (HenyeyGreensteinPhase(MiePhaseG, -cosTheta)). cosTheta is the cosine
  // between the direction towards the light and the view direction, so forward scattering peaks
  // when looking at the light.
  pb.func(funcName, [pb.float('g'), pb.float('cosTheta')], function () {
    this.$l.g2 = pb.mul(this.g, this.g);
    this.$l.denom = pb.sub(pb.add(1, this.g2), pb.mul(this.g, this.cosTheta, 2));
    this.$return(pb.div(pb.sub(1, this.g2), pb.mul(4 * Math.PI, this.denom, pb.sqrt(this.denom))));
  });
  return scope[funcName](fMieAnstropy, fCosTheta);
}

/** @internal */
export function mieAbsorption(
  scope: PBInsideFunctionScope,
  fMieScatteringHeight: PBShaderExp,
  fH: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_mieAbsorption';
  pb.func(funcName, [pb.float('mieScatteringHeight'), pb.float('h')], function () {
    this.$l.sigma = pb.mul(pb.vec3(MIE_ABSORPTION_SIGMA), 1e-6);
    this.$l.rho_h = pb.exp(pb.neg(pb.div(pb.max(this.h, 0), this.mieScatteringHeight)));
    this.$return(pb.mul(this.sigma, this.rho_h));
  });
  return scope[funcName](fMieScatteringHeight, fH);
}

/** @internal */
export function ozoneAbsorption(
  scope: PBInsideFunctionScope,
  fOzoneLevelCenterHeight: PBShaderExp,
  fOzoneLevelWidth: PBShaderExp,
  fH: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_ozoneAbsorption';
  pb.func(funcName, [pb.float('center'), pb.float('width'), pb.float('h')], function () {
    this.$l.sigma = pb.mul(
      pb.vec3(OZONE_ABSORPTION_SIGMA[0], OZONE_ABSORPTION_SIGMA[1], OZONE_ABSORPTION_SIGMA[2]),
      1e-6
    );
    this.$l.rho_h = pb.max(0, pb.sub(1, pb.div(pb.abs(pb.sub(this.h, this.center)), this.width)));
    this.$return(pb.mul(this.sigma, this.rho_h));
  });
  return scope[funcName](fOzoneLevelCenterHeight, fOzoneLevelWidth, fH);
}

/**
 * @internal
 *
 * Sun light reflected by the virtual planet ground at `groundPos`, per unit illuminance: a Lambertian
 * surface of albedo `groundAlbedo` lit through the atmosphere (UE: the `Ground` branch of
 * IntegrateSingleScatteredLuminance). Multiply by the throughput from the observer.
 */
export function groundBounce(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3GroundPos: PBShaderExp,
  f3LightDir: PBShaderExp,
  texTransmittanceLut: PBShaderExp
) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'z_groundBounce';
  pb.func(funcName, [Params('params'), pb.vec3('groundPos'), pb.vec3('lightDir')], function () {
    this.$l.up = pb.normalize(this.groundPos);
    this.$l.NdotL = pb.clamp(pb.dot(this.up, this.lightDir), 0, 1);
    // No planet shadow test: on a convex planet NdotL > 0 already means the sun is above the local
    // horizon, and the test itself is unreliable here -- seen from space the ground point carries
    // meters of float error, enough to drop the 1m-lifted start below the surface (UE's ground
    // term likewise only reads the LUT).
    this.$l.transmittanceToLight = transmittanceToSky(
      this,
      this.params,
      this.groundPos,
      this.lightDir,
      texTransmittanceLut,
      false
    );
    this.$return(pb.mul(this.transmittanceToLight, this.params.groundAlbedo, this.NdotL, 1 / Math.PI));
  });
  return scope[funcName](stParams, f3GroundPos, f3LightDir) as PBShaderExp;
}

/**
 * @internal
 *
 * Single scattering along a view ray, plus multiple scattering from the LUT.
 *
 * @param withGround - Stop the ray at the planet ground.
 * @param groundLit - When the ray ends on the ground (not cut short by `maxDis`), add the sun light
 *   the ground reflects (UE: `Ground` parameter). Implies `withGround`.
 * @param apScale - Scale the integrated segment lengths by `params.apViewDistanceScale`, for the
 *   aerial perspective. The medium is still sampled at the true positions, as in UE.
 */
export function getSkyView(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3EyePos: PBShaderExp,
  f3ViewDir: PBShaderExp,
  fMaxDis: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texMultiScatteringLut: PBShaderExp,
  withGround = true,
  groundLit = false,
  apScale = false
) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = `z_getSkyView${withGround ? '_G' : ''}${groundLit ? '_L' : ''}${apScale ? '_AP' : ''}`;
  pb.func(
    funcName,
    [Params('params'), pb.vec3('eyePos'), pb.vec3('viewDir'), pb.float('maxDis')],
    function () {
      const N_SAMPLE = 32;
      this.$l.color = pb.vec3(0);
      this.$l.topRadius = pb.add(this.params.plantRadius, this.params.atmosphereHeight);
      this.$l.eye = this.eyePos;
      this.$l.maxDistance = this.maxDis;
      this.$l.dis = rayIntersectSphere(this, pb.vec3(0), this.topRadius, this.eye, this.viewDir);
      this.$if(pb.lessThan(this.dis, 0), function () {
        this.$return(pb.vec4(0, 0, 0, 1));
      });
      // Observer above the atmosphere: start at the point where the ray enters it, 1m inside so the
      // exit intersection below does not degenerate (UE: MoveToTopAtmosphere).
      this.$if(pb.greaterThan(pb.length(this.eye), this.topRadius), function () {
        this.$l.tEnter = this.dis;
        this.eye = pb.add(this.eye, pb.mul(this.viewDir, this.tEnter));
        this.eye = pb.sub(this.eye, pb.normalize(this.eye));
        this.$if(pb.greaterThanEqual(this.maxDistance, 0), function () {
          this.maxDistance = pb.sub(this.maxDistance, this.tEnter);
          this.$if(pb.lessThanEqual(this.maxDistance, 0), function () {
            this.$return(pb.vec4(0, 0, 0, 1));
          });
        });
        this.dis = pb.max(rayIntersectSphereFar(this, this.topRadius, this.eye, this.viewDir), 0);
      });
      this.$l.hitGround = pb.bool(false);
      if (withGround || groundLit) {
        this.$l.d = rayIntersectSphere(this, pb.vec3(0), this.params.plantRadius, this.eye, this.viewDir);
        this.$if(pb.and(pb.greaterThan(this.d, 0), pb.lessThanEqual(this.d, this.dis)), function () {
          this.dis = this.d;
          this.hitGround = pb.bool(true);
        });
      }
      this.$if(
        pb.and(pb.greaterThanEqual(this.maxDistance, 0), pb.lessThan(this.maxDistance, this.dis)),
        function () {
          this.dis = this.maxDistance;
          this.hitGround = pb.bool(false);
        }
      );
      this.$l.ds = pb.div(this.dis, N_SAMPLE);
      this.$l.p = pb.add(this.eye, pb.mul(this.viewDir, this.ds, 0.5));
      this.$l.sunLuminance = pb.mul(this.params.lightColor.rgb, this.params.lightColor.a);
      this.$l.throughput = pb.vec3(1);
      this.$for(pb.int('i'), 0, N_SAMPLE, function () {
        this.$l.h = pb.sub(pb.length(this.p), this.params.plantRadius);
        this.$l.extinction = pb.add(
          rayleighCoefficient(this, this.params.rayleighScatteringHeight, this.h),
          mieCoefficient(this, this.params.mieScatteringHeight, this.h),
          ozoneAbsorption(this, this.params.ozoneCenter, this.params.ozoneWidth, this.h),
          mieAbsorption(this, this.params.mieScatteringHeight, this.h)
        );
        this.$l.sampleTransmittance = pb.exp(
          pb.neg(pb.mul(this.extinction, this.ds, apScale ? this.params.apViewDistanceScale : 1))
        );
        this.$l.t1 = transmittanceToSky(this, this.params, this.p, this.params.lightDir, texTransmittanceLut);
        this.$l.s = scattering(this, this.params, this.p, this.viewDir);
        // Multi-scattering is diffuse light left after single scattering: not planet shadowed.
        this.$l.multiScattering = getMultiScattering(this, this.params, this.p, texMultiScatteringLut);
        this.$l.S = pb.mul(pb.add(pb.mul(this.t1, this.s), this.multiScattering), this.sunLuminance);
        // Integrate the source term analytically over the segment instead of weighting it by the
        // transmittance to the segment end, which darkens long (horizon) steps. See slide 28 of
        // Frostbite's physically based unified volumetric rendering (UE: IntegrateSingleScatteredLuminance).
        this.$l.Sint = pb.div(
          pb.sub(this.S, pb.mul(this.S, this.sampleTransmittance)),
          pb.max(this.extinction, pb.vec3(1e-12))
        );
        this.color = pb.add(this.color, pb.mul(this.throughput, this.Sint));
        this.throughput = pb.mul(this.throughput, this.sampleTransmittance);
        this.p = pb.add(this.p, pb.mul(this.viewDir, this.ds));
      });
      if (groundLit) {
        this.$if(this.hitGround, function () {
          this.$l.groundPos = pb.add(this.eye, pb.mul(this.viewDir, this.dis));
          this.color = pb.add(
            this.color,
            pb.mul(
              groundBounce(this, this.params, this.groundPos, this.params.lightDir, texTransmittanceLut),
              this.throughput,
              this.sunLuminance
            )
          );
        });
      }
      this.$return(pb.vec4(this.color, pb.dot(this.throughput, pb.vec3(1 / 3))));
    }
  );
  return scope[funcName](stParams, f3EyePos, f3ViewDir, fMaxDis);
}

/** @internal */
export function getMultiScattering(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3Pos: PBShaderExp,
  texMultiScatteringLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_getMultiScattering';
  const Params = getAtmosphereParamsStruct(pb);
  pb.func(funcName, [Params('params'), pb.vec3('p')], function () {
    this.$l.h = pb.sub(pb.length(this.p), this.params.plantRadius);
    this.$l.sigma_s = pb.add(
      rayleighCoefficient(this, this.params.rayleighScatteringHeight, this.h),
      mieCoefficient(this, this.params.mieScatteringHeight, this.h)
    );
    this.$l.zenithAngle = pb.dot(pb.normalize(this.p), this.params.lightDir);
    this.$l.uv = pb.vec2(
      pb.add(pb.mul(this.zenithAngle, 0.5), 0.5),
      pb.div(this.h, this.params.atmosphereHeight)
    );
    this.$l.G_ALL = pb.textureSampleLevel(texMultiScatteringLut, this.uv, 0).rgb;
    this.$return(pb.mul(this.G_ALL, this.sigma_s));
  });
  return scope[funcName](stParams, f3Pos);
}

/** @internal */
export function integralMultiScattering(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3LightDir: PBShaderExp,
  f3SamplePoint: PBShaderExp,
  texTransmittanceLut: PBShaderExp
) {
  const N_DIRECTION = 64;
  const N_SAMPLE = 32;
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'z_integralMultiScattering';
  pb.func(funcName, [Params('params'), pb.vec3('lightDir'), pb.vec3('samplePoint')], function () {
    const uniformPhase = 1 / (4 * Math.PI);
    this.$l.G_2 = pb.vec3(0);
    this.$l.f_ms = pb.vec3(0);
    this.$for(pb.int('i'), 0, N_DIRECTION, function () {
      this.$l.viewDir = this.uniformSphereSamples.at(this.i).xyz;
      this.$l.dis = rayIntersectSphere(
        this,
        pb.vec3(0),
        pb.add(this.params.plantRadius, this.params.atmosphereHeight),
        this.samplePoint,
        this.viewDir
      );
      this.$l.d = rayIntersectSphere(
        this,
        pb.vec3(0),
        this.params.plantRadius,
        this.samplePoint,
        this.viewDir
      );
      this.$l.hitGround = pb.and(pb.greaterThan(this.d, 0), pb.lessThanEqual(this.d, this.dis));
      this.$if(this.hitGround, function () {
        this.dis = this.d;
      });
      this.$l.ds = pb.div(this.dis, N_SAMPLE);
      this.$l.p = pb.add(this.samplePoint, pb.mul(this.viewDir, this.ds, 0.5));
      this.$l.throughput = pb.vec3(1);
      this.$for(pb.int('j'), 0, N_SAMPLE, function () {
        this.$l.h = pb.sub(pb.length(this.p), this.params.plantRadius);
        this.$l.sigma_s = pb.add(
          rayleighCoefficient(this, this.params.rayleighScatteringHeight, this.h),
          mieCoefficient(this, this.params.mieScatteringHeight, this.h)
        );
        this.$l.sigma_a = pb.add(
          ozoneAbsorption(this, this.params.ozoneCenter, this.params.ozoneWidth, this.h),
          mieAbsorption(this, this.params.mieScatteringHeight, this.h)
        );
        this.$l.sigma_t = pb.add(this.sigma_s, this.sigma_a);
        this.$l.sampleTransmittance = pb.exp(pb.neg(pb.mul(this.sigma_t, this.ds)));
        this.$l.t1 = transmittanceToSky(this, this.params, this.p, this.lightDir, texTransmittanceLut);
        // Isotropic phase for the sun scattering event, as in UE (MieRayPhase = false): the LUT
        // is a transfer function of the medium only and must not depend on the scene sun direction.
        this.$l.S = pb.mul(this.t1, this.sigma_s, uniformPhase);
        this.$l.Sint = pb.div(
          pb.sub(this.S, pb.mul(this.S, this.sampleTransmittance)),
          pb.max(this.sigma_t, pb.vec3(1e-12))
        );
        this.G_2 = pb.add(this.G_2, pb.mul(this.throughput, this.Sint));
        // Unit uniform luminance over the sphere scattered with an isotropic phase (UE: MultiScatAs1).
        this.f_ms = pb.add(this.f_ms, pb.mul(this.throughput, this.sigma_s, this.ds));
        this.throughput = pb.mul(this.throughput, this.sampleTransmittance);
        this.p = pb.add(this.p, pb.mul(this.viewDir, this.ds));
      });
      // Light bounced off the ground (UE: Ground = true for the multi-scattering LUT)
      this.$if(this.hitGround, function () {
        this.$l.groundPos = pb.add(this.samplePoint, pb.mul(this.viewDir, this.dis));
        this.G_2 = pb.add(
          this.G_2,
          pb.mul(
            groundBounce(this, this.params, this.groundPos, this.lightDir, texTransmittanceLut),
            this.throughput
          )
        );
      });
    });
    // G_2: (4pi / N) * sum(L) is the illuminance, times the isotropic phase 1 / (4pi) gives the
    // in-scattered luminance, i.e. the plain average over the N directions.
    this.G_2 = pb.div(this.G_2, N_DIRECTION);
    this.f_ms = pb.div(this.f_ms, N_DIRECTION);
    this.$return(pb.div(this.G_2, pb.sub(pb.vec3(1), this.f_ms)));
  });
  return scope[funcName](stParams, f3LightDir, f3SamplePoint);
}

/** @internal */
export function scattering(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3Pos: PBShaderExp,
  f3ViewDir: PBShaderExp
) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'z_scattering';
  pb.func(funcName, [Params('params'), pb.vec3('p'), pb.vec3('viewDir')], function () {
    this.$l.cosTheta = pb.dot(this.params.lightDir, this.viewDir);
    this.$l.h = pb.sub(pb.length(this.p), this.params.plantRadius);
    this.$l.rayleigh = pb.mul(
      rayleighCoefficient(this, this.params.rayleighScatteringHeight, this.h),
      rayleighPhase(this, this.cosTheta)
    );
    this.$l.mie = pb.mul(
      mieCoefficient(this, this.params.mieScatteringHeight, this.h),
      miePhase(this, this.params.mieAnstropy, this.cosTheta)
    );
    this.$return(pb.add(this.rayleigh, this.mie));
  });
  return scope[funcName](stParams, f3Pos, f3ViewDir) as PBShaderExp;
}

/** @internal */
export function transmittance(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3P1: PBShaderExp,
  f3P2: PBShaderExp
) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'z_transmittance';
  pb.func(funcName, [Params('params'), pb.vec3('p1'), pb.vec3('p2')], function () {
    this.$l.dir = pb.normalize(pb.sub(this.p2, this.p1));
    this.$l.distance = pb.length(pb.sub(this.p2, this.p1));
    this.$l.ds = pb.div(this.distance, TRANSMITTANCE_SAMPLES);
    this.$l.sum = pb.vec3(0);
    this.$l.p = pb.add(this.p1, pb.mul(this.dir, this.ds, 0.5));
    this.$for(pb.int('i'), 0, TRANSMITTANCE_SAMPLES, function () {
      this.$l.h = pb.sub(pb.length(this.p), this.params.plantRadius);
      this.$l.scattering = pb.add(
        rayleighCoefficient(this, this.params.rayleighScatteringHeight, this.h),
        mieCoefficient(this, this.params.mieScatteringHeight, this.h)
      );
      this.$l.absorption = pb.add(
        ozoneAbsorption(this, this.params.ozoneCenter, this.params.ozoneWidth, this.h),
        mieAbsorption(this, this.params.mieScatteringHeight, this.h)
      );
      this.$l.extinction = pb.add(this.scattering, this.absorption);
      this.sum = pb.add(this.sum, pb.mul(this.extinction, this.ds));
      this.p = pb.add(this.p, pb.mul(this.dir, this.ds));
    });
    this.$return(pb.exp(pb.neg(this.sum)));
  });
  return scope[funcName](stParams, f3P1, f3P2) as PBShaderExp;
}

/** @internal */
export function transmittanceLutToUV(
  scope: PBInsideFunctionScope,
  fBottomRadius: PBShaderExp,
  fTopRadius: PBShaderExp,
  fMu: PBShaderExp,
  fR: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_transmittanceToUV';
  pb.func(
    funcName,
    [pb.float('bottomRadius'), pb.float('topRadius'), pb.float('mu'), pb.float('r')],
    function () {
      this.$l.H = pb.sqrt(
        pb.max(
          0,
          pb.sub(pb.mul(this.topRadius, this.topRadius), pb.mul(this.bottomRadius, this.bottomRadius))
        )
      );
      this.$l.rho = pb.sqrt(
        pb.max(0, pb.sub(pb.mul(this.r, this.r), pb.mul(this.bottomRadius, this.bottomRadius)))
      );
      this.$l.discriminant = pb.add(
        pb.mul(this.r, this.r, pb.sub(pb.mul(this.mu, this.mu), 1)),
        pb.mul(this.topRadius, this.topRadius)
      );
      // r ~ topRadius (a ray entering from space) makes this top^2 - r^2 difference of two ~4e13 values,
      // which float error can drive negative.
      this.$l.d = pb.max(0, pb.sub(pb.sqrt(pb.max(this.discriminant, 0)), pb.mul(this.mu, this.r)));
      this.$l.d_min = pb.sub(this.topRadius, this.r);
      this.$l.d_max = pb.add(this.rho, this.H);
      this.$l.x_mu = pb.div(pb.sub(this.d, this.d_min), pb.sub(this.d_max, this.d_min));
      this.$l.x_r = pb.div(this.rho, this.H);
      this.$return(pb.vec2(this.x_mu, this.x_r));
    }
  );
  return scope[funcName](fBottomRadius, fTopRadius, fMu, fR) as PBShaderExp;
}

/** @internal */
export const SKY_VIEW_LUT_WIDTH = 256;
/** @internal */
export const SKY_VIEW_LUT_HEIGHT = 128;

/**
 * Zenith angle of the horizon, and the angle from the horizon down to the nadir, seen from the
 * sky view LUT observer.
 */
function skyViewHorizon(scope: PBInsideFunctionScope, stParams: PBShaderExp) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'z_skyViewHorizon';
  pb.func(funcName, [Params('params')], function () {
    this.$l.altitude = this.params.observerAltitude;
    this.$l.viewHeight = pb.add(this.params.plantRadius, this.altitude);
    // sqrt(h^2 - R^2) written as sqrt(a * (2R + a)): at an altitude of meters against a radius of
    // thousands of kilometers, h^2 - R^2 is pure fp32 cancellation.
    this.$l.vHorizon = pb.sqrt(
      pb.mul(this.altitude, pb.add(pb.mul(this.params.plantRadius, 2), this.altitude))
    );
    this.$l.beta = pb.acos(pb.clamp(pb.div(this.vHorizon, this.viewHeight), -1, 1));
    this.$return(pb.vec2(pb.sub(Math.PI, this.beta), this.beta));
  });
  return scope[funcName](stParams) as PBShaderExp;
}

/**
 * @internal
 *
 * Sky view LUT parameterization (UE: SkyViewLutParamsToUv). Latitude is split at the observer's
 * horizon, which lands exactly on v = 0.5, with texels concentrated towards it on both sides: a
 * uniform latitude mapping interpolates the dark below-horizon texels into the sky just above it.
 * v = 0 is the zenith.
 */
export function viewDirToUV(scope: PBInsideFunctionScope, stParams: PBShaderExp, f3ViewDir: PBShaderExp) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'z_viewDirToUV';
  pb.func(funcName, [Params('params'), pb.vec3('viewDir')], function () {
    this.$l.horizon = skyViewHorizon(this, this.params);
    this.$l.zenithHorizonAngle = this.horizon.x;
    this.$l.beta = this.horizon.y;
    this.$l.viewZenithAngle = pb.acos(pb.clamp(this.viewDir.y, -1, 1));
    this.$l.v = pb.float();
    this.$if(pb.lessThan(this.viewZenithAngle, this.zenithHorizonAngle), function () {
      this.$l.coord = pb.div(this.viewZenithAngle, this.zenithHorizonAngle);
      this.v = pb.mul(pb.sub(1, pb.sqrt(pb.max(pb.sub(1, this.coord), 0))), 0.5);
    }).$else(function () {
      this.$l.coord = pb.div(pb.sub(this.viewZenithAngle, this.zenithHorizonAngle), this.beta);
      this.v = pb.add(pb.mul(pb.sqrt(pb.max(this.coord, 0)), 0.5), 0.5);
    });
    this.$l.u = pb.add(pb.div(pb.atan2(this.viewDir.z, this.viewDir.x), 2 * Math.PI), 0.5);
    // FromUnitToSubUvs: keep lookups inside the texel-center range.
    this.$l.size = pb.vec2(SKY_VIEW_LUT_WIDTH, SKY_VIEW_LUT_HEIGHT);
    this.$return(
      pb.mul(
        pb.add(pb.vec2(this.u, this.v), pb.div(pb.vec2(0.5), this.size)),
        pb.div(this.size, pb.add(this.size, pb.vec2(1)))
      )
    );
  });
  return scope[funcName](stParams, f3ViewDir) as PBShaderExp;
}

/**
 * @internal
 *
 * Inverse of {@link viewDirToUV} (UE: UvToSkyViewLutParams).
 */
export function uvToViewDir(scope: PBInsideFunctionScope, stParams: PBShaderExp, f2UV: PBShaderExp) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'z_uvToViewDir';
  pb.func(funcName, [Params('params'), pb.vec2('uv')], function () {
    // FromSubUvsToUnit
    this.$l.size = pb.vec2(SKY_VIEW_LUT_WIDTH, SKY_VIEW_LUT_HEIGHT);
    this.$l.unit = pb.mul(
      pb.sub(this.uv, pb.div(pb.vec2(0.5), this.size)),
      pb.div(this.size, pb.sub(this.size, pb.vec2(1)))
    );
    this.$l.horizon = skyViewHorizon(this, this.params);
    this.$l.zenithHorizonAngle = this.horizon.x;
    this.$l.beta = this.horizon.y;
    this.$l.viewZenithAngle = pb.float();
    this.$if(pb.lessThan(this.unit.y, 0.5), function () {
      this.$l.coord = pb.sub(1, pb.mul(this.unit.y, 2));
      this.viewZenithAngle = pb.mul(this.zenithHorizonAngle, pb.sub(1, pb.mul(this.coord, this.coord)));
    }).$else(function () {
      this.$l.coord = pb.sub(pb.mul(this.unit.y, 2), 1);
      this.viewZenithAngle = pb.add(this.zenithHorizonAngle, pb.mul(this.beta, this.coord, this.coord));
    });
    this.$l.phi = pb.mul(pb.sub(pb.mul(this.unit.x, 2), 1), Math.PI);
    this.$l.sinTheta = pb.sin(this.viewZenithAngle);
    this.$return(
      pb.vec3(
        pb.mul(this.sinTheta, pb.cos(this.phi)),
        pb.cos(this.viewZenithAngle),
        pb.mul(this.sinTheta, pb.sin(this.phi))
      )
    );
  });
  return scope[funcName](stParams, f2UV) as PBShaderExp;
}

/** @internal */
export function uvToTransmittanceLut(
  scope: PBInsideFunctionScope,
  f2UV: PBShaderExp,
  fBottomRadius: PBShaderExp,
  fTopRadius: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_uvToTransmittanceLut';
  pb.func(funcName, [pb.vec2('uv'), pb.float('bottomRadius'), pb.float('topRadius')], function () {
    this.$l.x_mu = this.uv.x;
    this.$l.x_r = this.uv.y;
    this.$l.H = pb.sqrt(
      pb.max(0, pb.sub(pb.mul(this.topRadius, this.topRadius), pb.mul(this.bottomRadius, this.bottomRadius)))
    );
    this.$l.rho = pb.mul(this.H, this.x_r);
    this.$l.r = pb.sqrt(
      pb.max(0, pb.add(pb.mul(this.rho, this.rho), pb.mul(this.bottomRadius, this.bottomRadius)))
    );
    this.$l.d_min = pb.sub(this.topRadius, this.r);
    this.$l.d_max = pb.add(this.rho, this.H);
    this.$l.d = pb.add(this.d_min, pb.mul(this.x_mu, pb.sub(this.d_max, this.d_min)));
    this.$l.mu = this.$choice(
      pb.equal(this.d, 0),
      pb.float(1),
      pb.div(
        pb.sub(pb.mul(this.H, this.H), pb.add(pb.mul(this.rho, this.rho), pb.mul(this.d, this.d))),
        pb.mul(this.r, this.d, 2)
      )
    );
    this.mu = pb.clamp(this.mu, -1, 1);
    this.$return(pb.vec2(this.mu, this.r));
  });
  return scope[funcName](f2UV, fBottomRadius, fTopRadius) as PBShaderExp;
}

function sunBloom(
  scope: PBInsideFunctionScope,
  f3ViewDir: PBShaderExp,
  f3LightDir: PBShaderExp,
  f4LightColorAndIntensity: PBShaderExp,
  fSunSolidAngle: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'v_sunBloom';
  pb.func(
    funcName,
    [pb.vec3('viewDir'), pb.vec3('lightDir'), pb.vec4('sunColorAndIntensity'), pb.float('sunSolidAngle')],
    function () {
      this.$l.minSunCosTheta = pb.cos(this.sunSolidAngle);
      this.$l.cosTheta = pb.dot(this.viewDir, this.lightDir);
      this.$l.luminance = pb.mul(this.sunColorAndIntensity.rgb, this.sunColorAndIntensity.a);
      this.$if(pb.lessThan(this.cosTheta, this.minSunCosTheta), function () {
        this.$l.offset = pb.sub(this.minSunCosTheta, this.cosTheta);
        this.$l.gaussianBloom = pb.mul(pb.exp(pb.mul(this.offset, -50000)), 0.5);
        this.$l.invBloom = pb.mul(pb.div(1, pb.add(0.02, pb.mul(this.offset, 300))), 0.01);
        this.luminance = pb.mul(this.luminance, pb.add(this.gaussianBloom, this.invBloom));
      });
      this.$return(this.luminance);
    }
  );
  return scope[funcName](f3ViewDir, f3LightDir, f4LightColorAndIntensity, fSunSolidAngle) as PBShaderExp;
}

/** @internal UE default sun angular diameter (DirectionalLight LightSourceAngle), as a half apex angle */
export const SUN_DISK_HALF_APEX_ANGLE = (0.5 * 0.5357 * Math.PI) / 180;

/**
 * @internal
 *
 * Sky luminance along a view direction, plus the sun disk.
 *
 * @remarks
 * `f3LocalDir` is in the observer's local frame (see {@link AtmosphereParams.skyViewReferential}).
 * Inside the atmosphere the luminance comes from the sky view LUT; above it the LUT, which is
 * parameterized around a horizon inside the atmosphere, does not apply and the view ray is marched
 * per pixel instead, starting where it enters the atmosphere (UE: the FastSky condition in
 * RenderSkyAtmosphereRayMarchingPS). That path draws the planet as seen from space: the lit virtual
 * ground behind the full atmosphere.
 *
 * `sunColor` receives the light color attenuated towards the observer.
 *
 * @param fIncludeSunDisk - 0: no sun disk; 1: legacy stylized disk with glow; 2: physical disk as in
 *   UE (GetLightDiskLuminance): illuminance over the disk's solid angle, attenuated by the atmosphere
 *   along the view ray, soft outer edge. Bloom is left to post processing.
 */
export function skyBox(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f4SunColor: PBShaderExp,
  f3LocalDir: PBShaderExp,
  fSunSolidAngle: PBShaderExp,
  fIncludeSunDisk: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texSkyViewLut: PBShaderExp,
  texMultiScatteringLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'v_skybox';
  const Params = getAtmosphereParamsStruct(pb);
  pb.func(
    funcName,
    [
      Params('params'),
      pb.vec4('sunColor').out(),
      pb.vec3('localDir'),
      pb.float('sunSolidAngle'),
      pb.int('includeSunDisk')
    ],
    function () {
      this.$l.viewDir = pb.normalize(this.localDir);
      this.$l.eyePos = pb.vec3(0, pb.add(this.params.plantRadius, this.params.observerAltitude), 0);
      this.$l.rgb = pb.vec3(0);
      this.$if(pb.lessThan(this.params.observerAltitude, this.params.atmosphereHeight), function () {
        this.rgb = pb.textureSampleLevel(texSkyViewLut, viewDirToUV(this, this.params, this.viewDir), 0).rgb;
      }).$else(function () {
        this.rgb = getSkyView(
          this,
          this.params,
          this.eyePos,
          this.viewDir,
          pb.float(-1),
          texTransmittanceLut,
          texMultiScatteringLut,
          true,
          true
        ).rgb;
      });
      this.$l.groundDistance = rayIntersectSphere(
        this,
        pb.vec3(0),
        this.params.plantRadius,
        this.eyePos,
        this.viewDir
      );
      this.$l.sunTransmittance = transmittanceToSky(
        this,
        this.params,
        this.eyePos,
        this.params.lightDir,
        texTransmittanceLut
      );
      this.sunColor = pb.mul(this.params.lightColor, pb.vec4(this.sunTransmittance, 1));
      this.$if(pb.and(pb.equal(this.includeSunDisk, 1), pb.lessThan(this.groundDistance, 0)), function () {
        this.rgb = pb.add(
          this.rgb,
          sunBloom(this, this.viewDir, this.params.lightDir, this.sunColor, this.sunSolidAngle)
        );
      });
      this.$if(pb.equal(this.includeSunDisk, 2), function () {
        const cosHalfApex = Math.cos(SUN_DISK_HALF_APEX_ANGLE);
        const solidAngle = 2 * Math.PI * (1 - cosHalfApex);
        this.$l.viewDotLight = pb.dot(this.viewDir, this.params.lightDir);
        this.$if(pb.greaterThan(this.viewDotLight, cosHalfApex), function () {
          // Planet shadowed by transmittanceToSky
          this.$l.transmittanceToLight = transmittanceToSky(
            this,
            this.params,
            this.eyePos,
            this.viewDir,
            texTransmittanceLut
          );
          this.$l.softEdge = pb.clamp(
            pb.div(pb.mul(pb.sub(this.viewDotLight, cosHalfApex), 2), 1 - cosHalfApex),
            0,
            1
          );
          this.rgb = pb.add(
            this.rgb,
            pb.mul(
              this.transmittanceToLight,
              this.params.lightColor.rgb,
              pb.div(this.params.lightColor.a, solidAngle),
              this.softEdge
            )
          );
        });
      });
      this.$return(pb.vec4(this.rgb, 1));
    }
  );
  return scope[funcName](stParams, f4SunColor, f3LocalDir, fSunSolidAngle, fIncludeSunDisk) as PBShaderExp;
}

/** @internal */
export const AP_LUT_SLICE_SIZE = 32;
/** @internal */
export const AP_LUT_DEPTH_SLICES = 32;

/**
 * @internal
 *
 * Samples the aerial perspective LUT.
 *
 * @remarks
 * Mirrors UE's GetAerialPerspectiveLuminanceTransmittance: luminance and transmittance both come
 * from the same LUT entry and fade in together near the camera, depth slices follow a squared
 * distribution over `apDistance` (atmosphere meters). World distances are converted to atmosphere
 * meters by `cameraHeightScale`, the same scale the LUT observer height uses.
 *
 * The LUT is a 2D atlas: `dim.z` depth slices of `dim.x` x `dim.y` texels laid out side by side.
 */
export function aerialPerspective(
  scope: PBInsideFunctionScope,
  f2UV: PBShaderExp,
  stParams: PBShaderExp,
  f3CameraPos: PBShaderExp,
  f3WorldPos: PBShaderExp,
  f3Dim: PBShaderExp,
  texAerialPerspectiveLut: PBShaderExp
) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'z_aerialPerspective';
  pb.func(
    funcName,
    [Params('params'), pb.vec2('uv'), pb.vec3('cameraPos'), pb.vec3('worldPos'), pb.vec3('dim')],
    function () {
      // Depth past the start depth (UE: max(0, length(WorldPositionRelativeToCamera) - StartDepth))
      this.$l.tDepth = pb.max(
        pb.sub(
          pb.mul(pb.distance(this.worldPos, this.cameraPos), this.params.cameraHeightScale),
          this.params.apStartDepth
        ),
        0
      );
      this.$l.linearW = pb.clamp(pb.div(this.tDepth, this.params.apDistance), 0, 1);
      // Squared slice distribution
      this.$l.nonLinSlice = pb.mul(pb.sqrt(this.linearW), this.dim.z);
      // Fade luminance and opacity to 0 within the first half slice (UE: HalfSliceDepth). Squared to
      // be linear in distance given the distribution above.
      this.$l.weight = pb.clamp(pb.mul(this.nonLinSlice, this.nonLinSlice, 2), 0, 1);
      // Slice k is stored at its texel center (k + 0.5), interpolate between the two nearest ones.
      this.$l.sliceF = pb.clamp(pb.sub(this.nonLinSlice, 0.5), 0, pb.sub(this.dim.z, 1));
      this.$l.slice0 = pb.floor(this.sliceF);
      this.$l.slice1 = pb.min(pb.add(this.slice0, 1), pb.sub(this.dim.z, 1));
      this.$l.factor = pb.sub(this.sliceF, this.slice0);
      // Keep the horizontal footprint inside one slice of the atlas so bilinear filtering does not
      // bleed across neighbouring slices at the left/right screen edges.
      this.$l.halfTexel = pb.div(0.5, this.dim.x);
      this.$l.u = pb.clamp(this.uv.x, this.halfTexel, pb.sub(1, this.halfTexel));
      this.$l.uv1 = pb.vec2(pb.div(pb.add(this.slice0, this.u), this.dim.z), this.uv.y);
      this.$l.uv2 = pb.vec2(pb.div(pb.add(this.slice1, this.u), this.dim.z), this.uv.y);
      this.$l.data1 = pb.textureSampleLevel(texAerialPerspectiveLut, this.uv1, 0);
      this.$l.data2 = pb.textureSampleLevel(texAerialPerspectiveLut, this.uv2, 0);
      this.$l.data = pb.mix(this.data1, this.data2, this.factor);
      this.$return(
        pb.vec4(pb.mul(this.data.rgb, this.weight), pb.sub(1, pb.mul(this.weight, pb.sub(1, this.data.a))))
      );
    }
  );
  return scope[funcName](stParams, f2UV, f3CameraPos, f3WorldPos, f3Dim) as PBShaderExp;
}

/**
 * @internal
 *
 * Renders one texel of the aerial perspective LUT atlas: rgb is the in-scattered luminance and a
 * the mean transmittance from the observer to the froxel (UE: RenderCameraAerialPerspectiveVolumeCS).
 */
export function aerialPerspectiveLut(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f2UV: PBShaderExp,
  f3VoxelDim: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texMultiScatteringLut: PBShaderExp
) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'z_aerialPerspectiveLut';
  pb.func(funcName, [Params('params'), pb.vec2('uv'), pb.vec3('dim')], function () {
    // uv arrives at the texel center of the dim.x * dim.z wide atlas.
    this.$l.px = pb.floor(pb.mul(this.uv.x, this.dim.x, this.dim.z));
    this.$l.slice = pb.floor(pb.div(this.px, this.dim.x));
    this.$l.screenUV = pb.vec2(
      pb.div(pb.add(pb.sub(this.px, pb.mul(this.slice, this.dim.x)), 0.5), this.dim.x),
      this.uv.y
    );
    this.$l.w = pb.div(pb.add(this.slice, 0.5), this.dim.z);
    this.$l.ndc = pb.sub(pb.mul(this.screenUV, 2), pb.vec2(1));
    this.$l.viewDir = pb.normalize(
      pb.mul(
        this.params.cameraWorldMatrix,
        pb.vec4(
          pb.mul(this.ndc.x, this.params.cameraTanHalfFovy, this.params.cameraAspect),
          pb.mul(this.ndc.y, this.params.cameraTanHalfFovy),
          -1,
          0
        )
      ).xyz
    );
    this.$l.eyePos = pb.vec3(0, pb.add(this.params.observerAltitude, this.params.plantRadius), 0);
    // Slices start at the start depth (UE: RayStartWorldPos = CamPos + StartDepth * WorldDir).
    this.$l.maxDis = pb.add(this.params.apStartDepth, pb.mul(this.w, this.w, this.params.apDistance));
    this.$l.voxelPos = pb.add(this.eyePos, pb.mul(this.viewDir, this.maxDis));
    this.$l.underGround = pb.lessThan(pb.length(this.voxelPos), this.params.plantRadius);
    this.$l.planetNearT = rayIntersectSphere(
      this,
      pb.vec3(0),
      this.params.plantRadius,
      this.eyePos,
      this.viewDir
    );
    this.$l.belowHorizon = pb.and(
      pb.greaterThan(this.planetNearT, 0),
      pb.greaterThan(this.maxDis, this.planetNearT)
    );
    // A froxel behind the ground would only integrate up to the ground hit, leaving surfaces seen
    // from above (the observer sits just above the planet) without any aerial perspective. Instead
    // integrate towards the ground point below the froxel, as UE does.
    this.$if(pb.or(this.underGround, this.belowHorizon), function () {
      this.$l.voxelPosNorm = pb.normalize(this.voxelPos);
      this.$l.camProjOnGround = pb.mul(pb.normalize(this.eyePos), this.params.plantRadius);
      this.$l.voxProjOnGround = pb.mul(this.voxelPosNorm, this.params.plantRadius);
      this.$l.voxelGroundToRayStart = pb.sub(this.eyePos, this.voxProjOnGround);
      this.$if(
        pb.and(
          this.belowHorizon,
          pb.lessThan(pb.dot(pb.normalize(this.voxelGroundToRayStart), this.voxelPosNorm), 0.0001)
        ),
        function () {
          // Behind the planet: evaluate the point mirrored through the horizon point.
          this.$l.middlePoint = pb.mul(pb.add(this.camProjOnGround, this.voxProjOnGround), 0.5);
          this.$l.middlePointOnGround = pb.mul(pb.normalize(this.middlePoint), this.params.plantRadius);
          this.voxelPos = pb.add(this.eyePos, pb.mul(pb.sub(this.middlePointOnGround, this.eyePos), 2));
        }
      ).$elseif(this.underGround, function () {
        this.voxelPos = this.voxProjOnGround;
      });
      this.$l.V = pb.sub(this.voxelPos, this.eyePos);
      this.maxDis = pb.length(this.V);
      this.viewDir = pb.div(this.V, this.maxDis);
    });
    // Integrate from the start depth along the (possibly redirected) ray up to the froxel.
    this.$l.rayStart = pb.add(this.eyePos, pb.mul(this.viewDir, this.params.apStartDepth));
    this.$l.segment = pb.sub(this.maxDis, this.params.apStartDepth);
    this.$if(pb.lessThanEqual(this.segment, 0), function () {
      this.$return(pb.vec4(0, 0, 0, 1));
    });
    this.$return(
      getSkyView(
        this,
        this.params,
        this.rayStart,
        this.viewDir,
        this.segment,
        texTransmittanceLut,
        texMultiScatteringLut,
        true,
        false,
        true
      )
    );
  });
  return scope[funcName](stParams, f2UV, f3VoxelDim) as PBShaderExp;
}

/** @internal */
export function skyViewLut(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f2UV: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texMultiScatteringLut: PBShaderExp
) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'v_skyViewLut';
  pb.func(funcName, [Params('params'), pb.vec2('uv')], function () {
    this.$l.viewDir = uvToViewDir(this, this.params, this.uv);
    this.$l.h = pb.add(this.params.plantRadius, this.params.observerAltitude);
    this.$l.eyePos = pb.vec3(0, this.h, 0);
    this.$l.rgb = getSkyView(
      this,
      this.params,
      this.eyePos,
      this.viewDir,
      pb.float(-1),
      texTransmittanceLut,
      texMultiScatteringLut,
      true,
      true
    ).rgb;
    this.$return(pb.vec4(this.rgb, 1));
  });
  return scope[funcName](stParams, f2UV) as PBShaderExp;
}

/** @internal */
export function multiScatteringLut(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f2UV: PBShaderExp,
  texTransmittanceLut: PBShaderExp
) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'v_multiScatteringLut';
  pb.func(funcName, [Params('params'), pb.vec2('uv')], function () {
    this.$l.mu_s = pb.sub(pb.mul(this.uv.x, 2), 1);
    this.$l.r = pb.add(pb.mul(this.uv.y, this.params.atmosphereHeight), this.params.plantRadius);
    this.$l.cosTheta = this.mu_s;
    this.$l.sinTheta = pb.sqrt(pb.sub(1, pb.mul(this.cosTheta, this.cosTheta)));
    this.$l.lightDir = pb.vec3(this.sinTheta, this.cosTheta, 0);
    this.$l.p = pb.vec3(0, this.r, 0);
    this.$l.rgb = integralMultiScattering(this, this.params, this.lightDir, this.p, texTransmittanceLut);
    this.$return(pb.vec4(this.rgb, 1));
  });
  return scope[funcName](stParams, f2UV) as PBShaderExp;
}

/** @internal */
export function transmittanceLut(scope: PBInsideFunctionScope, stParams: PBShaderExp, f2UV: PBShaderExp) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'transmittanceLut';
  pb.func(funcName, [Params('params'), pb.vec2('uv')], function () {
    this.$l.color = pb.vec4(0, 0, 0, 1);
    this.$l.bottomRadius = this.params.plantRadius;
    this.$l.topRadius = pb.add(this.bottomRadius, this.params.atmosphereHeight);
    this.$l.lutParams = uvToTransmittanceLut(this, this.uv, this.bottomRadius, this.topRadius);
    this.$l.cos_theta = this.lutParams.x;
    this.$l.r = this.lutParams.y;
    this.$l.sin_theta = pb.sqrt(pb.sub(1, pb.mul(this.cos_theta, this.cos_theta)));
    this.$l.viewDir = pb.vec3(this.sin_theta, this.cos_theta, 0);
    this.$l.eyePos = pb.vec3(0, this.r, 0);
    this.$l.dis = rayIntersectSphere(this, pb.vec3(0), this.topRadius, this.eyePos, this.viewDir);
    this.$l.hitPoint = pb.add(this.eyePos, pb.mul(this.viewDir, this.dis));
    this.$return(pb.vec4(transmittance(this, this.params, this.eyePos, this.hitPoint), 1));
  });
  return scope[funcName](stParams, f2UV) as PBShaderExp;
}

/** @internal */
export function atmosphereLUTRendered() {
  return !!transmittanceLUT && !!multiScatteringLUT && !!skyViewLUT && !!ApLut;
}

/** @internal */
export function renderAtmosphereLUTs(params?: Partial<AtmosphereParams>) {
  const checkResult = checkParams(params);
  if (checkResult.transmittance || !transmittanceLUT) {
    renderTransmittanceLut(currentAtmosphereParams!);
  }
  if (checkResult.multiScattering || !multiScatteringLUT) {
    renderMultiScatteringLut(currentAtmosphereParams!);
  }
  if (checkResult.skyView || !skyViewLUT) {
    renderSkyViewLut(currentAtmosphereParams!);
  }
  if (checkResult.aerialPerspective || !ApLut) {
    renderAPLut(currentAtmosphereParams!);
  }
}

/* For debug */
let transmittanceLutProgram: GPUProgram;
let multiScatteringLutProgram: GPUProgram;
let skyViewLutProgram: GPUProgram;
let APLutProgram: GPUProgram;
let transmittanceLutBindGroup: BindGroup;
let transmittanceLUT: Texture2D;
let transmittanceFramebuffer: FrameBuffer;

let multiScatteringLutBindGroup: BindGroup;
let multiScatteringLUT: Texture2D;
let uniformSphereSampleBuffer: GPUDataBuffer;
let multiScatteringFramebuffer: FrameBuffer;

let skyViewLutBindGroup: BindGroup;
let skyViewLUT: Texture2D;
let skyViewFramebuffer: FrameBuffer;

let APLutBindGroup: BindGroup;
let ApLut: Texture2D;
let APFramebuffer: FrameBuffer;

/** @internal */
export function getTransmittanceLut() {
  return transmittanceLUT;
}

/** @internal */
export function getMultiScatteringLut() {
  return multiScatteringLUT;
}

/** @internal */
export function getSkyViewLut() {
  return skyViewLUT;
}

/** @internal */
export function getAerialPerspectiveLut() {
  return ApLut;
}

/** @internal */
export function getAtmosphereParamsStruct(pb: ProgramBuilder) {
  return pb.defineStruct([
    pb.mat4('cameraWorldMatrix'),
    pb.vec4('lightColor'),
    pb.vec3('lightDir'),
    pb.float('cameraAspect'),
    pb.vec3('groundAlbedo'),
    pb.float('cameraTanHalfFovy'),
    pb.float('plantRadius'),
    pb.float('atmosphereHeight'),
    pb.float('rayleighScatteringHeight'),
    pb.float('mieScatteringHeight'),
    pb.float('mieAnstropy'),
    pb.float('ozoneCenter'),
    pb.float('ozoneWidth'),
    pb.float('apDistance'),
    pb.float('apViewDistanceScale'),
    pb.float('apStartDepth'),
    pb.float('cameraHeightScale'),
    pb.float('observerAltitude'),
    pb.mat4('skyViewReferential')
  ]);
}

/** @internal */
export function createTransmittanceLutProgram(device: AbstractDevice) {
  const program = device.buildRenderProgram({
    vertex(pb) {
      this.flip = pb.int().uniform(0);
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        this.$if(pb.notEqual(this.flip, 0), function () {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        });
      });
    },
    fragment(pb) {
      const Params = getAtmosphereParamsStruct(pb);
      this.params = Params().uniform(0);
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        this.$outputs.outColor = transmittanceLut(this, this.params, this.$inputs.uv);
      });
    }
  })!;
  program.name = '@TransmittanceLutProgram';
  return program;
}

/** @internal */
export function renderTransmittanceLut(params: AtmosphereParams) {
  const device = getDevice();
  if (transmittanceLutProgram === undefined) {
    try {
      transmittanceLutProgram = createTransmittanceLutProgram(device);
      transmittanceLutBindGroup = device.createBindGroup(transmittanceLutProgram.bindGroupLayouts[0]);
      transmittanceLUT = device.createTexture2D('rgba16f', 256, 64, {
        mipmapping: false
      })!;
      transmittanceLUT.name = 'DebugTransmittanceLut';
      transmittanceFramebuffer = device.createFrameBuffer([transmittanceLUT], null);
    } catch (err) {
      console.error(err);
    }
  }
  if (transmittanceLutProgram) {
    transmittanceLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    transmittanceLutBindGroup.setValue('params', params);
    device.pushDeviceStates();
    device.setFramebuffer(transmittanceFramebuffer);
    device.setProgram(transmittanceLutProgram);
    device.setBindGroup(0, transmittanceLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
  }
}

/** @internal */
export function createMultiScatteringLutProgram(device: AbstractDevice) {
  const program = device.buildRenderProgram({
    vertex(pb) {
      this.flip = pb.int().uniform(0);
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        this.$if(pb.notEqual(this.flip, 0), function () {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        });
      });
    },
    fragment(pb) {
      const Params = getAtmosphereParamsStruct(pb);
      this.params = Params().uniform(0);
      this.uniformSphereSamples = pb.vec4[64]().uniformBuffer(0);
      this.transmittanceLut = pb.tex2D().uniform(0);
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        this.$outputs.outColor = multiScatteringLut(
          this,
          this.params,
          this.$inputs.uv,
          this.transmittanceLut
        );
      });
    }
  })!;
  program.name = '@MultiScatteringLutProgram';
  return program;
}

/** @internal */
export function renderMultiScatteringLut(params: AtmosphereParams) {
  const device = getDevice();
  if (multiScatteringLutProgram === undefined) {
    try {
      multiScatteringLutProgram = createMultiScatteringLutProgram(device);
      multiScatteringLutBindGroup = device.createBindGroup(multiScatteringLutProgram.bindGroupLayouts[0]);
      multiScatteringLUT = device.createTexture2D('rgba16f', 32, 32, {
        mipmapping: false
      })!;
      multiScatteringLUT.name = 'DebugMultiScatteringLut';
      multiScatteringFramebuffer = device.createFrameBuffer([multiScatteringLUT], null);
      uniformSphereSampleBuffer = multiScatteringLutBindGroup.getBuffer('uniformSphereSamples', false)!;
      const sphereSamples = new Float32Array(64 * 4);
      for (let i = 0; i < 64; i++) {
        sphereSamples[i * 4 + 0] = uniformSphereSamples[i].x;
        sphereSamples[i * 4 + 1] = uniformSphereSamples[i].y;
        sphereSamples[i * 4 + 2] = uniformSphereSamples[i].z;
        sphereSamples[i * 4 + 3] = 0;
      }
      uniformSphereSampleBuffer.bufferSubData(0, sphereSamples);
    } catch (err) {
      console.error(err);
    }
  }
  if (multiScatteringLutProgram) {
    multiScatteringLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    multiScatteringLutBindGroup.setValue('params', params);
    //multiScatteringLutBindGroup.setBuffer('uniformSphereSamples', uniformSphereSampleBuffer);
    multiScatteringLutBindGroup.setTexture(
      'transmittanceLut',
      transmittanceLUT,
      fetchSampler('clamp_linear_nomip')
    );
    device.pushDeviceStates();
    device.setFramebuffer(multiScatteringFramebuffer);
    device.setProgram(multiScatteringLutProgram);
    device.setBindGroup(0, multiScatteringLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
  }
}

/** @internal */
export function createSkyViewLutProgram(device: AbstractDevice) {
  const program = device.buildRenderProgram({
    vertex(pb) {
      this.flip = pb.int().uniform(0);
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        this.$if(pb.notEqual(this.flip, 0), function () {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        });
      });
    },
    fragment(pb) {
      const Params = getAtmosphereParamsStruct(pb);
      this.params = Params().uniform(0);
      this.transmittanceLut = pb.tex2D().uniform(0);
      this.multiScatteringLut = pb.tex2D().uniform(0);
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        this.$outputs.outColor = skyViewLut(
          this,
          this.params,
          this.$inputs.uv,
          this.transmittanceLut,
          this.multiScatteringLut
        );
      });
    }
  })!;
  program.name = '@SkyViewLutProgram';
  return program;
}

/** @internal */
export function renderSkyViewLut(params: AtmosphereParams) {
  const device = getDevice();
  if (skyViewLutProgram === undefined) {
    try {
      skyViewLutProgram = createSkyViewLutProgram(device);
      skyViewLutBindGroup = device.createBindGroup(skyViewLutProgram.bindGroupLayouts[0]);
      skyViewLUT = device.createTexture2D('rgba16f', SKY_VIEW_LUT_WIDTH, SKY_VIEW_LUT_HEIGHT, {
        mipmapping: false
      })!;
      skyViewLUT.name = 'DebugSkyViewLut';
      skyViewFramebuffer = device.createFrameBuffer([skyViewLUT], null);
    } catch (err) {
      console.error(err);
    }
  }
  if (skyViewLutProgram) {
    skyViewLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    skyViewLutBindGroup.setValue('params', params);
    skyViewLutBindGroup.setTexture('transmittanceLut', transmittanceLUT, fetchSampler('clamp_linear_nomip'));
    skyViewLutBindGroup.setTexture(
      'multiScatteringLut',
      multiScatteringLUT,
      fetchSampler('clamp_linear_nomip')
    );
    device.pushDeviceStates();
    device.setFramebuffer(skyViewFramebuffer);
    device.setProgram(skyViewLutProgram);
    device.setBindGroup(0, skyViewLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
  }
}

/** @internal */
export function createAPLutProgram(device: AbstractDevice) {
  const program = device.buildRenderProgram({
    vertex(pb) {
      this.flip = pb.int().uniform(0);
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        this.$if(pb.notEqual(this.flip, 0), function () {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        });
      });
    },
    fragment(pb) {
      const Params = getAtmosphereParamsStruct(pb);
      this.params = Params().uniform(0);
      this.transmittanceLut = pb.tex2D().uniform(0);
      this.multiScatteringLut = pb.tex2D().uniform(0);
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        this.$outputs.outColor = aerialPerspectiveLut(
          this,
          this.params,
          this.$inputs.uv,
          pb.vec3(AP_LUT_SLICE_SIZE, AP_LUT_SLICE_SIZE, AP_LUT_DEPTH_SLICES),
          this.transmittanceLut,
          this.multiScatteringLut
        );
      });
    }
  })!;
  program.name = '@APLutProgram';
  return program;
}

/** @internal */
export function renderAPLut(params: AtmosphereParams) {
  const device = getDevice();
  if (APLutProgram === undefined) {
    try {
      APLutProgram = createAPLutProgram(device);
      APLutBindGroup = device.createBindGroup(APLutProgram.bindGroupLayouts[0]);
      ApLut = device.createTexture2D('rgba16f', AP_LUT_SLICE_SIZE * AP_LUT_DEPTH_SLICES, AP_LUT_SLICE_SIZE, {
        mipmapping: false
      })!;
      ApLut.name = 'DebugAPLut';
      APFramebuffer = device.createFrameBuffer([ApLut], null);
    } catch (err) {
      console.error(err);
    }
  }
  if (APLutProgram) {
    APLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    APLutBindGroup.setValue('params', params);
    APLutBindGroup.setTexture('transmittanceLut', transmittanceLUT, fetchSampler('clamp_linear_nomip'));
    APLutBindGroup.setTexture('multiScatteringLut', multiScatteringLUT, fetchSampler('clamp_linear_nomip'));
    device.pushDeviceStates();
    device.setFramebuffer(APFramebuffer);
    device.setProgram(APLutProgram);
    device.setBindGroup(0, APLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
  }
}
