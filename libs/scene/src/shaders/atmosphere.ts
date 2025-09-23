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
import { Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import { uniformSphereSamples } from '../values';
import { getDevice } from '../app/api';

const TRANSMITTANCE_SAMPLES = 16;
const RAYLEIGH_SIGMA = [5.802, 13.558, 33.1];
const MIE_SIGMA = 3.996;
const MIE_ABSORPTION_SIGMA = 4.4;
const OZONE_ABSORPTION_SIGMA = [0.65, 1.881, 0.085];

/** @internal */
export const CAMERA_POS_Y = 1;

/** @internal */
export type AtmosphereParams = {
  plantRadius: number;
  atmosphereHeight: number;
  rayleighScatteringHeight: number;
  mieScatteringHeight: number;
  mieAnstropy: number;
  ozoneCenter: number;
  ozoneWidth: number;
  apDistance: number;
  cameraWorldMatrix: Matrix4x4;
  lightDir: Vector3;
  lightColor: Vector4;
  cameraAspect: number;
  cameraHeightScale: number;
};

/** @internal */
export function getDefaultAtmosphereParams(): AtmosphereParams {
  return {
    plantRadius: 6360000,
    atmosphereHeight: 60000,
    rayleighScatteringHeight: 8000,
    mieScatteringHeight: 1200,
    mieAnstropy: 0.8,
    ozoneCenter: 25000,
    ozoneWidth: 15000,
    apDistance: 4000,
    cameraWorldMatrix: Matrix4x4.identity(),
    lightDir: new Vector3(1, 0, 0),
    lightColor: new Vector4(1, 1, 1, 10),
    cameraAspect: 1,
    cameraHeightScale: 1
  };
}

const defaultAtmosphereParams = getDefaultAtmosphereParams();

let currentAtmosphereParams: AtmosphereParams = null;

function checkParams(other?: Partial<AtmosphereParams>): {
  transmittance: boolean;
  multiScattering: boolean;
  skyView: boolean;
  aerialPerspective: boolean;
} {
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
      cameraWorldMatrix: new Matrix4x4(defaultAtmosphereParams.cameraWorldMatrix)
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
    result.multiScattering =
      result.transmittance || currentAtmosphereParams.mieAnstropy !== other.mieAnstropy;
    result.skyView =
      result.transmittance ||
      result.multiScattering ||
      currentAtmosphereParams.cameraHeightScale !== other.cameraHeightScale ||
      !currentAtmosphereParams.lightDir.equalsTo(other.lightDir) ||
      !currentAtmosphereParams.lightColor.equalsTo(other.lightColor) ||
      !currentAtmosphereParams.cameraWorldMatrix.equalsTo(other.cameraWorldMatrix);
    result.aerialPerspective =
      result.transmittance ||
      result.multiScattering ||
      result.skyView ||
      currentAtmosphereParams.apDistance !== other.apDistance ||
      currentAtmosphereParams.cameraAspect !== other.cameraAspect;
  }
  if (result.transmittance) {
    currentAtmosphereParams.plantRadius = other.plantRadius;
    currentAtmosphereParams.atmosphereHeight = other.atmosphereHeight;
    currentAtmosphereParams.rayleighScatteringHeight = other.rayleighScatteringHeight;
    currentAtmosphereParams.mieScatteringHeight = other.mieScatteringHeight;
    currentAtmosphereParams.ozoneCenter = other.ozoneCenter;
    currentAtmosphereParams.ozoneWidth = other.ozoneWidth;
  }
  if (result.multiScattering) {
    currentAtmosphereParams.mieAnstropy = other.mieAnstropy;
  }
  if (result.skyView) {
    currentAtmosphereParams.cameraHeightScale = other.cameraHeightScale;
    currentAtmosphereParams.lightDir.set(other.lightDir);
    currentAtmosphereParams.lightColor.set(other.lightColor);
    currentAtmosphereParams.cameraWorldMatrix.set(other.cameraWorldMatrix);
  }
  if (result.aerialPerspective) {
    currentAtmosphereParams.apDistance = other.apDistance;
    currentAtmosphereParams.cameraAspect = other.cameraAspect;
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
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'z_rayIntersectSphere';
  pb.func(
    funcName,
    [pb.vec3('center'), pb.float('radius'), pb.vec3('rayStart'), pb.vec3('rayDir')],
    function () {
      this.$l.OS = pb.length(pb.sub(this.center, this.rayStart));
      this.$l.SH = pb.dot(pb.sub(this.center, this.rayStart), this.rayDir);
      this.$l.OH = pb.sqrt(pb.sub(pb.mul(this.OS, this.OS), pb.mul(this.SH, this.SH)));
      this.$l.PH = pb.sqrt(pb.sub(pb.mul(this.radius, this.radius), pb.mul(this.OH, this.OH)));
      this.$if(pb.greaterThan(this.OH, this.radius), function () {
        this.$return(pb.float(-1));
      });
      this.$l.t1 = pb.sub(this.SH, this.PH);
      this.$l.t2 = pb.add(this.SH, this.PH);
      this.$return(this.$choice(pb.lessThan(this.t1, 0), this.t2, this.t1));
    }
  );
  return scope[funcName](f3Center, fRadius, f3RayStart, f3RayDir);
}

/** @internal */
export function transmittanceToSky(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3Pos: PBShaderExp,
  f3Dir: PBShaderExp,
  texLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_transmittanceToSky';
  const Params = getAtmosphereParamsStruct(pb);
  pb.func(funcName, [Params('params'), pb.vec3('p'), pb.vec3('dir')], function () {
    this.$l.bottomRadius = this.params.plantRadius;
    this.$l.topRadius = pb.add(this.params.plantRadius, this.params.atmosphereHeight);
    this.$l.upVector = pb.normalize(this.p);
    this.$l.cosTheta = pb.dot(this.upVector, this.dir);
    this.$l.r = pb.length(this.p);
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
    this.$l.rho_h = pb.exp(pb.neg(pb.div(this.h, this.rayleighScatteringHeight)));
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
    this.$l.rho_h = pb.exp(pb.neg(pb.div(this.h, this.mieScatteringHeight)));
    this.$return(pb.mul(this.sigma, this.rho_h));
  });
  return scope[funcName](fMieScatteringHeight, fH);
}

/** @internal */
export function miePhase(scope: PBInsideFunctionScope, fMieAnstropy: PBShaderExp, fCosTheta: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'z_miePhase';
  pb.func(funcName, [pb.float('g'), pb.float('cosTheta')], function () {
    this.$l.g2 = pb.mul(this.g, this.g);
    this.$l.a = 3 / (8 * Math.PI);
    this.$l.b = pb.div(pb.sub(1, this.g2), pb.add(2, this.g2));
    this.$l.c = pb.add(1, pb.mul(this.cosTheta, this.cosTheta));
    this.$l.d = pb.pow(pb.sub(pb.add(1, this.g2), pb.mul(this.g, this.cosTheta, 2)), 1.5);
    this.$return(pb.div(pb.mul(this.a, this.b, this.c), this.d));
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
    this.$l.rho_h = pb.exp(pb.neg(pb.div(this.h, this.mieScatteringHeight)));
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

/** @internal */
export function getSkyView(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3EyePos: PBShaderExp,
  f3ViewDir: PBShaderExp,
  fMaxDis: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texMultiScatteringLut: PBShaderExp,
  withGround = true
) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'z_getSkyView';
  pb.func(
    funcName,
    [Params('params'), pb.vec3('eyePos'), pb.vec3('viewDir'), pb.float('maxDis')],
    function () {
      const N_SAMPLE = 32;
      this.$l.color = pb.vec3(0);
      this.$l.dis = rayIntersectSphere(
        this,
        pb.vec3(0),
        pb.add(this.params.plantRadius, this.params.atmosphereHeight),
        this.eyePos,
        this.viewDir
      );
      this.$if(pb.lessThan(this.dis, 0), function () {
        this.$return(pb.vec3(0));
      });
      if (withGround) {
        this.$l.d = rayIntersectSphere(this, pb.vec3(0), this.params.plantRadius, this.eyePos, this.viewDir);
        this.$if(pb.greaterThan(this.d, 0), function () {
          this.dis = pb.min(this.dis, this.d);
        });
      }
      this.$if(pb.greaterThanEqual(this.maxDis, 0), function () {
        this.dis = pb.min(this.dis, this.maxDis);
      });
      this.$l.ds = pb.div(this.dis, N_SAMPLE);
      this.$l.p = pb.add(this.eyePos, pb.mul(this.viewDir, this.ds, 0.5));
      this.$l.sunLuminance = pb.mul(this.params.lightColor.rgb, this.params.lightColor.a);
      this.$l.opticalDepth = pb.vec3(0);
      this.$for(pb.int('i'), 0, N_SAMPLE, function () {
        this.$l.h = pb.sub(pb.length(this.p), this.params.plantRadius);
        this.$l.extinction = pb.add(
          rayleighCoefficient(this, this.params.rayleighScatteringHeight, this.h),
          mieCoefficient(this, this.params.mieScatteringHeight, this.h),
          ozoneAbsorption(this, this.params.ozoneCenter, this.params.ozoneWidth, this.h),
          mieAbsorption(this, this.params.mieScatteringHeight, this.h)
        );
        this.opticalDepth = pb.add(this.opticalDepth, pb.mul(this.extinction, this.ds));
        this.$l.t1 = transmittanceToSky(this, this.params, this.p, this.params.lightDir, texTransmittanceLut);
        this.$l.s = scattering(this, this.params, this.p, this.viewDir);
        this.$l.t2 = pb.exp(pb.neg(this.opticalDepth));

        this.$l.inScattering = pb.mul(this.t1, this.s, this.t2, this.ds, this.sunLuminance);
        this.color = pb.add(this.color, this.inScattering);

        this.$l.multiScattering = getMultiScattering(this, this.params, this.p, texMultiScatteringLut);
        this.color = pb.add(this.color, pb.mul(this.multiScattering, this.t2, this.ds, this.sunLuminance));

        this.p = pb.add(this.p, pb.mul(this.viewDir, this.ds));
      });
      this.$return(this.color);
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
    const sphereSolidAngle = (4 * Math.PI) / N_DIRECTION;
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
      this.$if(pb.greaterThan(this.d, 0), function () {
        this.dis = pb.min(this.dis, this.d);
      });
      this.$l.ds = pb.div(this.dis, N_SAMPLE);
      this.$l.p = pb.add(this.samplePoint, pb.mul(this.viewDir, this.ds, 0.5));
      this.$l.opticalDepth = pb.vec3(0);
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
        this.opticalDepth = pb.add(this.opticalDepth, pb.mul(this.sigma_t, this.ds));
        this.$l.t1 = transmittanceToSky(this, this.params, this.p, this.lightDir, texTransmittanceLut);
        this.$l.s = scattering(this, this.params, this.p, this.viewDir);
        this.$l.t2 = pb.exp(pb.neg(this.opticalDepth));
        this.G_2 = pb.add(this.G_2, pb.mul(this.t1, this.s, this.t2, uniformPhase, this.ds));
        this.f_ms = pb.add(this.f_ms, pb.mul(this.t2, this.sigma_s, uniformPhase, this.ds));
        this.p = pb.add(this.p, pb.mul(this.viewDir, this.ds));
      });
    });
    this.G_2 = pb.mul(this.G_2, sphereSolidAngle);
    this.f_ms = pb.mul(this.f_ms, sphereSolidAngle);
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
): PBShaderExp {
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
  return scope[funcName](stParams, f3Pos, f3ViewDir);
}

/** @internal */
export function transmittance(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3P1: PBShaderExp,
  f3P2: PBShaderExp
): PBShaderExp {
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
  return scope[funcName](stParams, f3P1, f3P2);
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
      this.$l.d = pb.max(0, pb.sub(pb.sqrt(this.discriminant), pb.mul(this.mu, this.r)));
      this.$l.d_min = pb.sub(this.topRadius, this.r);
      this.$l.d_max = pb.add(this.rho, this.H);
      this.$l.x_mu = pb.div(pb.sub(this.d, this.d_min), pb.sub(this.d_max, this.d_min));
      this.$l.x_r = pb.div(this.rho, this.H);
      this.$return(pb.vec2(this.x_mu, this.x_r));
    }
  );
  return scope[funcName](fBottomRadius, fTopRadius, fMu, fR);
}

/** @internal */
export function viewDirToUV(scope: PBInsideFunctionScope, f3ViewDir: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'z_viewDirToUV';
  pb.func(funcName, [pb.vec3('viewDir')], function () {
    this.$l.uv = pb.vec2(pb.atan2(this.viewDir.z, this.viewDir.x), pb.asin(this.viewDir.y));
    this.uv = pb.div(this.uv, pb.vec2(2 * Math.PI, Math.PI));
    this.uv = pb.add(this.uv, pb.vec2(0.5));
    this.$return(this.uv);
  });
  return scope[funcName](f3ViewDir);
}

/** @internal */
export function uvToViewDir(scope: PBInsideFunctionScope, f2UV: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'z_uvToViewDir';
  pb.func(funcName, [pb.vec2('uv')], function () {
    this.$l.theta = pb.mul(pb.sub(1, this.uv.y), Math.PI);
    this.$l.phi = pb.mul(pb.sub(pb.mul(this.uv.x, 2), 1), Math.PI);
    this.$l.x = pb.mul(pb.sin(this.theta), pb.cos(this.phi));
    this.$l.z = pb.mul(pb.sin(this.theta), pb.sin(this.phi));
    this.$l.y = pb.cos(this.theta);
    this.$return(pb.vec3(this.x, this.y, this.z));
  });
  return scope[funcName](f2UV);
}

/** @internal */
export function uvToTransmittanceLut(
  scope: PBInsideFunctionScope,
  f2UV: PBShaderExp,
  fBottomRadius: PBShaderExp,
  fTopRadius: PBShaderExp
): PBShaderExp {
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
  return scope[funcName](f2UV, fBottomRadius, fTopRadius);
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
  return scope[funcName](f3ViewDir, f3LightDir, f4LightColorAndIntensity, fSunSolidAngle);
}

/** @internal */
export function skyBox(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f4SunColor: PBShaderExp,
  f3SkyBoxWorldPos: PBShaderExp,
  fSunSolidAngle: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texSkyViewLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'v_skybox';
  const Params = getAtmosphereParamsStruct(pb);
  pb.func(
    funcName,
    [Params('params'), pb.vec4('sunColor').out(), pb.vec3('worldPos'), pb.float('sunSolidAngle')],
    function () {
      this.$l.rgb = pb.vec3(0);
      this.$l.viewDir = pb.normalize(this.worldPos);
      this.rgb = pb.add(
        this.rgb,
        pb.textureSampleLevel(texSkyViewLut, viewDirToUV(this, this.viewDir), 0).rgb
      );
      this.$l.groundDistance = rayIntersectSphere(
        this,
        pb.vec3(0),
        this.params.plantRadius,
        pb.vec3(0, pb.add(this.params.plantRadius, pb.mul(CAMERA_POS_Y, this.params.cameraHeightScale)), 0),
        this.viewDir
      );
      this.$l.sunTransmittance = transmittanceToSky(
        this,
        this.params,
        pb.vec3(0, pb.add(this.params.cameraHeightScale, this.params.plantRadius), 0),
        this.params.lightDir,
        texTransmittanceLut
      );
      this.sunColor = pb.mul(this.params.lightColor, pb.vec4(this.sunTransmittance, 1));
      this.$if(pb.lessThan(this.groundDistance, 0), function () {
        this.rgb = pb.add(
          this.rgb,
          sunBloom(this, this.viewDir, this.params.lightDir, this.sunColor, this.sunSolidAngle)
        );
      });
      this.$return(pb.vec4(this.rgb, 1));
    }
  );
  return scope[funcName](stParams, f4SunColor, f3SkyBoxWorldPos, fSunSolidAngle);
}

/** @internal */
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
      this.$l.V = pb.sub(this.worldPos, this.cameraPos);
      this.$l.dis = pb.length(this.V);
      this.$l.viewDir = pb.normalize(this.V);
      this.$l.apDistance = pb.div(this.params.apDistance, this.params.cameraHeightScale);
      this.$l.d0 = pb.clamp(pb.div(this.dis, this.apDistance), 0, 1);
      this.$l.weight = pb.clamp(pb.mul(this.d0, 2), 0, 1);
      this.$l.dz = pb.mul(this.d0, pb.sub(this.dim.z, 1));
      this.$l.slice = pb.floor(this.dz);
      this.$l.nextSlice = pb.min(pb.add(this.slice, 1), pb.sub(this.dim.z, 1));
      this.$l.factor = pb.sub(this.dz, pb.floor(this.dz));
      this.t = pb.div(this.uv, pb.vec2(this.dim.x, 1));
      this.$l.uv1 = pb.add(this.t, pb.vec2(pb.div(this.slice, this.dim.z), 0));
      this.$l.uv2 = pb.add(this.t, pb.vec2(pb.div(this.nextSlice, this.dim.z), 0));
      this.$l.data1 = pb.textureSampleLevel(texAerialPerspectiveLut, this.uv1, 0);
      this.$l.data2 = pb.textureSampleLevel(texAerialPerspectiveLut, this.uv2, 0);
      this.$l.data = pb.mix(this.data1, this.data2, this.factor);
      this.$l.inscattering = pb.mul(this.data.rgb, this.weight);
      //this.$l.transmittance = pb.sub(1, pb.mul(this.weight, pb.sub(1, this.data.a)));
      this.$l.planetTranslate = pb.vec3(0, this.params.plantRadius, 0);
      this.$l.transmittance = pb.dot(
        transmittance(
          this,
          this.params,
          pb.add(this.cameraPos, this.planetTranslate),
          pb.add(this.worldPos, this.planetTranslate)
        ),
        pb.vec3(1 / 3, 1 / 3, 1 / 3)
      );
      this.$return(pb.vec4(this.inscattering, this.transmittance));
    }
  );
  return scope[funcName](stParams, f2UV, f3CameraPos, f3WorldPos, f3Dim);
}

/** @internal */
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
  const funcNameFixVoxel = 'z_fixVoxel';
  pb.func(
    funcNameFixVoxel,
    [
      Params('params'),
      pb.vec3('eyePos'),
      pb.vec3('viewDir').inout(),
      pb.float('maxDis'),
      pb.float('adjustedMaxDis').inout()
    ],
    function () {
      this.$l.voxelPos = pb.add(this.eyePos, pb.mul(this.viewDir, this.maxDis));
      this.$l.voxelHeight = pb.length(this.voxelPos);
      this.$l.underGround = pb.lessThan(this.voxelHeight, this.params.plantRadius);
      this.$l.cameraToVoxel = pb.sub(this.voxelPos, this.eyePos);
      this.$l.cameraToVoxelLen = pb.length(this.cameraToVoxel);
      this.$l.cameraToVoxelDir = pb.div(this.cameraToVoxel, this.cameraToVoxelLen);
      this.$l.planetNearT = rayIntersectSphere(
        this,
        pb.vec3(0),
        this.params.plantRadius,
        this.eyePos,
        this.cameraToVoxelDir
      );
      this.$l.belowHorizon = pb.and(
        pb.greaterThan(this.planetNearT, 0),
        pb.greaterThan(this.cameraToVoxelLen, this.planetNearT)
      );
      this.$l.eyePos2 = this.eyePos;
      this.$if(pb.or(this.underGround, this.belowHorizon), function () {
        this.eyePos2 = pb.add(this.eyePos2, pb.mul(pb.normalize(this.eyePos2), 0.02));
        this.$if(this.belowHorizon, function () {
          this.$l.voxelWorldPosNorm = pb.normalize(this.voxelPos);
          this.$l.camProjOnGround = pb.mul(pb.normalize(this.eyePos2), this.params.plantRadius);
          this.$l.voxProjOnGround = pb.mul(this.voxelWorldPosNorm, this.params.plantRadius);
          this.$l.voxelGroundToRayStart = pb.sub(this.eyePos2, this.voxProjOnGround);
          this.$if(
            pb.lessThan(pb.dot(pb.normalize(this.voxelGroundToRayStart), this.voxelWorldPosNorm), 0.0001),
            function () {
              this.$l.middlePoint = pb.mul(pb.add(this.camProjOnGround, this.voxProjOnGround), 0.5);
              this.$l.middlePointOnGround = pb.mul(pb.normalize(this.middlePoint), this.params.plantRadius);
              this.voxelPos = pb.add(this.eyePos2, pb.mul(pb.sub(this.middlePointOnGround, this.eyePos2), 2));
            }
          );
        }).$else(function () {
          this.voxelPos = pb.mul(pb.normalize(this.voxelPos), this.params.plantRadius);
        });
        this.$l.V = pb.sub(this.voxelPos, this.eyePos2);
        this.adjustedMaxDis = pb.length(this.V);
        this.viewDir = pb.div(this.V, this.adjustedMaxDis);
      });
      this.$return(this.eyePos2);
    }
  );
  const funcName = 'z_aerialPerspectiveLut';
  pb.func(funcName, [Params('params'), pb.vec2('uv'), pb.vec3('dim'), pb.float('cameraPosY')], function () {
    this.$l.uvw = pb.vec3(this.uv, 0);
    this.uvw.x = pb.mul(this.uvw.x, this.dim.x, this.dim.z);
    this.uvw.z = pb.div(pb.floor(pb.div(this.uvw.x, this.dim.z)), this.dim.x);
    this.uvw.x = pb.div(pb.mod(this.uvw.x, this.dim.z), this.dim.x);
    this.uvw = pb.add(this.uvw, pb.div(pb.vec3(0.5), this.dim));
    this.$l.slice = this.uvw.z; //pb.mul(this.uvw.z, this.uvw.z);
    this.$l.viewDir = pb.normalize(
      pb.mul(
        this.params.cameraWorldMatrix,
        pb.vec4(
          pb.sub(pb.mul(this.uvw.x, 2), 1),
          pb.div(pb.sub(pb.mul(this.uvw.y, 2), 1), this.params.cameraAspect),
          -1,
          0
        )
      ).xyz
    );
    this.$l.eyePos = pb.vec3(
      0,
      pb.add(pb.mul(this.cameraPosY, this.params.cameraHeightScale), this.params.plantRadius),
      0
    );
    this.$l.maxDis = pb.mul(this.slice, this.params.apDistance);
    this.$l.voxelPos = pb.add(this.eyePos, pb.mul(this.viewDir, this.maxDis));
    this.$if(pb.lessThan(pb.length(this.voxelPos), this.params.plantRadius), function () {
      this.voxelPos = pb.mul(pb.normalize(this.voxelPos), this.params.plantRadius);
      this.maxDis = pb.length(pb.sub(this.eyePos, this.voxelPos));
    });
    this.$l.color = getSkyView(
      this,
      this.params,
      this.eyePos,
      this.viewDir,
      this.maxDis,
      texTransmittanceLut,
      texMultiScatteringLut
    );
    this.$l.t1 = transmittanceToSky(this, this.params, this.eyePos, this.viewDir, texTransmittanceLut);
    this.$l.t2 = transmittanceToSky(this, this.params, this.voxelPos, this.viewDir, texTransmittanceLut);
    this.$l.t = pb.clamp(pb.div(this.t1, pb.max(this.t2, pb.vec3(0.0001))), pb.vec3(0), pb.vec3(1));
    this.$return(pb.vec4(this.color, pb.dot(this.t, pb.vec3(1 / 3, 1 / 3, 1 / 3))));
  });
  return scope[funcName](stParams, f2UV, f3VoxelDim, CAMERA_POS_Y);
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
  pb.func(funcName, [Params('params'), pb.vec2('uv'), pb.float('cameraPosY')], function () {
    this.$l.viewDir = uvToViewDir(this, this.uv);
    this.$l.h = pb.add(this.params.plantRadius, pb.mul(this.cameraPosY, this.params.cameraHeightScale));
    this.$l.eyePos = pb.vec3(0, this.h, 0);
    this.$l.rgb = getSkyView(
      this,
      this.params,
      this.eyePos,
      this.viewDir,
      pb.float(-1),
      texTransmittanceLut,
      texMultiScatteringLut
    );
    this.$return(pb.vec4(this.rgb, 1));
  });
  return scope[funcName](stParams, f2UV, CAMERA_POS_Y);
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
  return scope[funcName](stParams, f2UV);
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
  return scope[funcName](stParams, f2UV);
}

/** @internal */
export function atmosphereLUTRendered(): boolean {
  return !!transmittanceLUT && !!multiScatteringLUT && !!skyViewLUT && !!ApLut;
}

/** @internal */
export function renderAtmosphereLUTs(params?: Partial<AtmosphereParams>) {
  const checkResult = checkParams(params);
  if (checkResult.transmittance || !transmittanceLUT) {
    renderTransmittanceLut(currentAtmosphereParams);
  }
  if (checkResult.multiScattering || !multiScatteringLUT) {
    renderMultiScatteringLut(currentAtmosphereParams);
  }
  if (checkResult.skyView || !skyViewLUT) {
    renderSkyViewLut(currentAtmosphereParams);
  }
  if (checkResult.aerialPerspective || !ApLut) {
    renderAPLut(currentAtmosphereParams);
  }
}

/* For debug */
let transmittanceLutProgram: GPUProgram = undefined;
let multiScatteringLutProgram: GPUProgram = undefined;
let skyViewLutProgram: GPUProgram = undefined;
let APLutProgram: GPUProgram = undefined;
let transmittanceLutBindGroup: BindGroup = undefined;
let transmittanceLUT: Texture2D = undefined;
let transmittanceFramebuffer: FrameBuffer = undefined;

let multiScatteringLutBindGroup: BindGroup = undefined;
let multiScatteringLUT: Texture2D = undefined;
let uniformSphereSampleBuffer: GPUDataBuffer = undefined;
let multiScatteringFramebuffer: FrameBuffer = undefined;

let skyViewLutBindGroup: BindGroup = undefined;
let skyViewLUT: Texture2D = undefined;
let skyViewFramebuffer: FrameBuffer = undefined;

let APLutBindGroup: BindGroup = undefined;
let ApLut: Texture2D = undefined;
let APFramebuffer: FrameBuffer = undefined;

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
    pb.float('plantRadius'),
    pb.float('atmosphereHeight'),
    pb.float('rayleighScatteringHeight'),
    pb.float('mieScatteringHeight'),
    pb.float('mieAnstropy'),
    pb.float('ozoneCenter'),
    pb.float('ozoneWidth'),
    pb.float('apDistance'),
    pb.float('cameraHeightScale')
  ]);
}

/** @internal */
export function createTransmittanceLutProgram(device: AbstractDevice): GPUProgram {
  return device.buildRenderProgram({
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
  });
}

/** @internal */
export function renderTransmittanceLut(params: AtmosphereParams) {
  const device = getDevice();
  if (transmittanceLutProgram === undefined) {
    try {
      transmittanceLutProgram = createTransmittanceLutProgram(device);
      transmittanceLutBindGroup = device.createBindGroup(transmittanceLutProgram.bindGroupLayouts[0]);
      transmittanceLUT = device.createTexture2D('rgba16f', 256, 64, {
        samplerOptions: { mipFilter: 'none' }
      });
      transmittanceLUT.name = 'DebugTransmittanceLut';
      transmittanceFramebuffer = device.createFrameBuffer([transmittanceLUT], null);
    } catch (err) {
      console.error(err);
      transmittanceLutProgram = null;
      transmittanceLutBindGroup = null;
      transmittanceFramebuffer = null;
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
  return device.buildRenderProgram({
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
  });
}

/** @internal */
export function renderMultiScatteringLut(params: AtmosphereParams) {
  const device = getDevice();
  if (multiScatteringLutProgram === undefined) {
    try {
      multiScatteringLutProgram = createMultiScatteringLutProgram(device);
      multiScatteringLutBindGroup = device.createBindGroup(multiScatteringLutProgram.bindGroupLayouts[0]);
      multiScatteringLUT = device.createTexture2D('rgba16f', 32, 32, {
        samplerOptions: { mipFilter: 'none' }
      });
      multiScatteringLUT.name = 'DebugMultiScatteringLut';
      multiScatteringFramebuffer = device.createFrameBuffer([multiScatteringLUT], null);
      uniformSphereSampleBuffer = multiScatteringLutBindGroup.getBuffer('uniformSphereSamples', false);
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
      multiScatteringLutProgram = null;
      multiScatteringLutBindGroup = null;
      multiScatteringFramebuffer = null;
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
  return device.buildRenderProgram({
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
  });
}

/** @internal */
export function renderSkyViewLut(params: AtmosphereParams) {
  const device = getDevice();
  if (skyViewLutProgram === undefined) {
    try {
      skyViewLutProgram = createSkyViewLutProgram(device);
      skyViewLutBindGroup = device.createBindGroup(skyViewLutProgram.bindGroupLayouts[0]);
      skyViewLUT = device.createTexture2D('rgba16f', 256, 128, {
        samplerOptions: { mipFilter: 'none' }
      });
      skyViewLUT.name = 'DebugSkyViewLut';
      skyViewFramebuffer = device.createFrameBuffer([skyViewLUT], null);
    } catch (err) {
      console.error(err);
      skyViewLutProgram = null;
      skyViewLutBindGroup = null;
      skyViewFramebuffer = null;
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
  return device.buildRenderProgram({
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
          pb.vec3(32, 32, 32),
          this.transmittanceLut,
          this.multiScatteringLut
        );
      });
    }
  });
}

/** @internal */
export function renderAPLut(params: AtmosphereParams) {
  const device = getDevice();
  if (APLutProgram === undefined) {
    try {
      APLutProgram = createAPLutProgram(device);
      APLutBindGroup = device.createBindGroup(APLutProgram.bindGroupLayouts[0]);
      ApLut = device.createTexture2D('rgba16f', 32 * 32, 32, { samplerOptions: { mipFilter: 'none' } });
      ApLut.name = 'DebugAPLut';
      APFramebuffer = device.createFrameBuffer([ApLut], null);
    } catch (err) {
      console.error(err);
      APLutProgram = null;
      APLutBindGroup = null;
      APFramebuffer = null;
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
