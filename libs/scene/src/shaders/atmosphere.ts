import {
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import { Application } from '../app';
import { drawFullscreenQuad } from '../render/fullscreenquad';
import { fetchSampler } from '../utility/misc';
import { CubeFace, Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import { Primitive } from '../render';
import { BoxShape } from '../shapes';
import { Camera } from '../camera';

const TRANSMITTANCE_SAMPLES = 32;
const RAYLEIGH_SIGMA = [5.802, 13.558, 33.1];
const MIE_SIGMA = 3.996;
const MIE_ABSORPTION_SIGMA = 4.4;
const OZONE_ABSORPTION_SIGMA = [0.65, 1.881, 0.085];

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
};

export const defaultAtmosphereParams: Readonly<AtmosphereParams> = {
  plantRadius: 6360000,
  atmosphereHeight: 60000,
  rayleighScatteringHeight: 8000,
  mieScatteringHeight: 1200,
  mieAnstropy: 0.8,
  ozoneCenter: 25000,
  ozoneWidth: 15000,
  apDistance: 32000,
  cameraWorldMatrix: Matrix4x4.identity(),
  lightDir: new Vector3(1, 0, 0),
  lightColor: new Vector4(1, 1, 1, 10),
  cameraAspect: 1
};

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

export function rayleighPhase(scope: PBInsideFunctionScope, fCosTheta: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'z_rayleighPhase';
  pb.func(funcName, [pb.float('cosTheta')], function () {
    this.$return(pb.mul(3 / (16 * Math.PI), pb.add(1, pb.mul(this.cosTheta, this.cosTheta))));
  });
  return scope[funcName](fCosTheta);
}

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

export function getSkyView(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f3EyePos: PBShaderExp,
  f3ViewDir: PBShaderExp,
  fMaxDis: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texMultiScatteringLut: PBShaderExp
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
      this.$l.d = rayIntersectSphere(this, pb.vec3(0), this.params.plantRadius, this.eyePos, this.viewDir);
      this.$if(pb.lessThan(this.dis, 0), function () {
        this.$return(pb.vec3(0));
      });
      this.$if(pb.greaterThan(this.d, 0), function () {
        this.dis = pb.min(this.dis, this.d);
      });
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
    this.$l.sphereSamples = [
      pb.vec3(-0.7838, -0.620933, 0.00996137),
      pb.vec3(0.106751, 0.965982, 0.235549),
      pb.vec3(-0.215177, -0.687115, -0.693954),
      pb.vec3(0.318002, 0.0640084, -0.945927),
      pb.vec3(0.357396, 0.555673, 0.750664),
      pb.vec3(0.866397, -0.19756, 0.458613),
      pb.vec3(0.130216, 0.232736, -0.963783),
      pb.vec3(-0.00174431, 0.376657, 0.926351),
      pb.vec3(0.663478, 0.704806, -0.251089),
      pb.vec3(0.0327851, 0.110534, -0.993331),
      pb.vec3(0.0561973, 0.0234288, 0.998145),
      pb.vec3(0.0905264, -0.169771, 0.981317),
      pb.vec3(0.26694, 0.95222, -0.148393),
      pb.vec3(-0.812874, -0.559051, -0.163393),
      pb.vec3(-0.323378, -0.25855, -0.910263),
      pb.vec3(-0.1333, 0.591356, -0.795317),
      pb.vec3(0.480876, 0.408711, 0.775702),
      pb.vec3(-0.332263, -0.533895, -0.777533),
      pb.vec3(-0.0392473, -0.704457, -0.708661),
      pb.vec3(0.427015, 0.239811, 0.871865),
      pb.vec3(-0.416624, -0.563856, 0.713085),
      pb.vec3(0.12793, 0.334479, -0.933679),
      pb.vec3(-0.0343373, -0.160593, -0.986423),
      pb.vec3(0.580614, 0.0692947, 0.811225),
      pb.vec3(-0.459187, 0.43944, 0.772036),
      pb.vec3(0.215474, -0.539436, -0.81399),
      pb.vec3(-0.378969, -0.31988, -0.868366),
      pb.vec3(-0.279978, -0.0109692, 0.959944),
      pb.vec3(0.692547, 0.690058, 0.210234),
      pb.vec3(0.53227, -0.123044, -0.837585),
      pb.vec3(-0.772313, -0.283334, -0.568555),
      pb.vec3(-0.0311218, 0.995988, -0.0838977),
      pb.vec3(-0.366931, -0.276531, -0.888196),
      pb.vec3(0.488778, 0.367878, -0.791051),
      pb.vec3(-0.885561, -0.453445, 0.100842),
      pb.vec3(0.71656, 0.443635, 0.538265),
      pb.vec3(0.645383, -0.152576, -0.748466),
      pb.vec3(-0.171259, 0.91907, 0.354939),
      pb.vec3(-0.0031122, 0.9457, 0.325026),
      pb.vec3(0.731503, 0.623089, -0.276881),
      pb.vec3(-0.91466, 0.186904, 0.358419),
      pb.vec3(0.15595, 0.828193, -0.538309),
      pb.vec3(0.175396, 0.584732, 0.792038),
      pb.vec3(-0.0838381, -0.943461, 0.320707),
      pb.vec3(0.305876, 0.727604, 0.614029),
      pb.vec3(0.754642, -0.197903, -0.62558),
      pb.vec3(0.217255, -0.0177771, -0.975953),
      pb.vec3(0.140412, -0.844826, 0.516287),
      pb.vec3(-0.549042, 0.574859, -0.606705),
      pb.vec3(0.570057, 0.17459, 0.802841),
      pb.vec3(-0.0330304, 0.775077, 0.631003),
      pb.vec3(-0.938091, 0.138937, 0.317304),
      pb.vec3(0.483197, -0.726405, -0.48873),
      pb.vec3(0.485263, 0.52926, 0.695991),
      pb.vec3(0.224189, 0.742282, -0.631472),
      pb.vec3(-0.322429, 0.662214, -0.676396),
      pb.vec3(0.625577, -0.12711, 0.769738),
      pb.vec3(-0.714032, -0.584461, -0.385439),
      pb.vec3(-0.0652053, -0.892579, -0.446151),
      pb.vec3(0.408421, -0.912487, 0.0236566),
      pb.vec3(0.0900381, 0.319983, 0.943135),
      pb.vec3(-0.708553, 0.483646, 0.513847),
      pb.vec3(0.803855, -0.0902273, 0.587942),
      pb.vec3(-0.0555802, -0.374602, -0.925519)
    ];
    const uniformPhase = 1 / (4 * Math.PI);
    const sphereSolidAngle = (4 * Math.PI) / N_DIRECTION;
    this.$l.G_2 = pb.vec3(0);
    this.$l.f_ms = pb.vec3(0);
    this.$for(pb.int('i'), 0, N_DIRECTION, function () {
      this.$l.viewDir = this.sphereSamples.at(this.i);
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

/** @internal */
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

export function skyBox(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  fCameraPosY: PBShaderExp,
  f3SkyBoxWorldPos: PBShaderExp,
  fSunSolidAngle: PBShaderExp,
  texSkyViewLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'v_skybox';
  const Params = getAtmosphereParamsStruct(pb);
  pb.func(
    funcName,
    [Params('params'), pb.float('cameraPosY'), pb.vec3('worldPos'), pb.float('sunSolidAngle')],
    function () {
      this.$l.rgb = pb.vec3(0);
      this.$l.viewDir = pb.normalize(this.worldPos);
      this.$l.eyePos = pb.vec3(0, pb.add(this.params.plantRadius, this.cameraPosY), 0);
      this.rgb = pb.add(
        this.rgb,
        pb.textureSampleLevel(texSkyViewLut, viewDirToUV(this, this.viewDir), 0).rgb
      );
      this.rgb = pb.add(
        this.rgb,
        sunBloom(this, this.viewDir, this.params.lightDir, this.params.lightColor, this.sunSolidAngle)
      );
      this.$return(pb.vec4(this.rgb, 1));
    }
  );
  return scope[funcName](stParams, fCameraPosY, f3SkyBoxWorldPos, fSunSolidAngle);
}

export function aerialPerspective(
  scope: PBInsideFunctionScope,
  f2UV: PBShaderExp,
  f3CameraPos: PBShaderExp,
  f3WorldPos: PBShaderExp,
  fAPDistance: PBShaderExp,
  f3Dim: PBShaderExp,
  texAerialPerspectiveLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_aerialPerspective';
  pb.func(
    funcName,
    [pb.vec2('uv'), pb.vec3('cameraPos'), pb.vec3('worldPos'), pb.float('apDistance'), pb.vec3('dim')],
    function () {
      this.$l.V = pb.sub(this.worldPos, this.cameraPos);
      this.$l.dis = pb.length(this.V);
      this.$l.viewDir = pb.normalize(this.V);
      this.$l.d0 = pb.clamp(pb.div(this.dis, this.apDistance), 0, 1);
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
      this.$l.inscattering = this.data.rgb;
      this.$l.transmittance = this.data.a;
      this.$return(pb.vec4(this.inscattering, pb.sub(1, this.transmittance)));
    }
  );
  return scope[funcName](f2UV, f3CameraPos, f3WorldPos, fAPDistance, f3Dim);
}

export function aerialPerspectiveLut(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f2UV: PBShaderExp,
  f3VoxelDim: PBShaderExp,
  fCameraPosY: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texMultiScatteringLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_aerialPerspectiveLut';
  const Params = getAtmosphereParamsStruct(pb);
  pb.func(funcName, [Params('params'), pb.vec2('uv'), pb.vec3('dim'), pb.float('cameraPosY')], function () {
    if (1) {
      this.$l.uvw = pb.vec3(this.uv, 0);
      this.uvw.x = pb.mul(this.uvw.x, this.dim.x, this.dim.z);
      this.uvw.z = pb.div(pb.floor(pb.div(this.uvw.x, this.dim.z)), this.dim.x);
      this.uvw.x = pb.div(pb.mod(this.uvw.x, this.dim.z), this.dim.x);
      this.uvw = pb.add(this.uvw, pb.div(pb.vec3(0.5), this.dim));
      this.$l.viewDir = pb.normalize(
        pb.mul(
          this.params.cameraWorldMatrix,
          pb.vec4(
            pb.sub(pb.mul(this.uvw.x, 2), 1),
            pb.div(pb.sub(pb.mul(this.uvw.y, 2), 1), this.params.cameraAspect),
            1,
            0
          )
        ).xyz
      );
      this.$l.eyePos = pb.vec3(0, pb.add(this.cameraPosY, this.params.plantRadius), 0);
      this.$l.maxDis = pb.mul(this.uvw.z, this.params.apDistance);
      this.$l.color = getSkyView(
        this,
        this.params,
        this.eyePos,
        this.viewDir,
        this.maxDis,
        texTransmittanceLut,
        texMultiScatteringLut
      );
      this.$l.voxelPos = pb.add(this.eyePos, pb.mul(this.viewDir, this.maxDis));
      this.$l.t1 = transmittanceToSky(this, this.params, this.eyePos, this.viewDir, texTransmittanceLut);
      this.$l.t2 = transmittanceToSky(this, this.params, this.voxelPos, this.viewDir, texTransmittanceLut);
      this.$l.t = pb.div(this.t1, this.t2);
      this.$return(pb.vec4(this.color, pb.dot(this.t, pb.vec3(1 / 3, 1 / 3, 1 / 3))));
    } else {
      this.$l.slice = pb.clamp(pb.floor(pb.mul(this.uv.x, this.dim.z)), 0, pb.sub(this.dim.z, 1));
      this.$l.sliceU = pb.clamp(pb.mul(pb.sub(this.uv.x, pb.div(this.slice, this.dim.z)), this.dim.z), 0, 1);
      this.$l.sliceDist = pb.div(this.slice, this.dim.z);
      this.$l.horizonAngle = pb.sub(pb.mul(this.sliceU, Math.PI * 2), Math.PI);
      this.$l.zenithAngle = pb.mul(this.uv.y, Math.PI / 2);
      this.$l.rayDir = pb.vec3(
        pb.mul(pb.cos(this.zenithAngle), pb.sin(this.horizonAngle)),
        pb.sin(this.zenithAngle),
        pb.mul(pb.neg(pb.cos(this.zenithAngle)), pb.cos(this.horizonAngle))
      );
      this.$l.eyePos = pb.vec3(0, pb.add(this.cameraPosY, this.params.plantRadius), 0);
      this.$l.maxDis = pb.mul(this.params.apDistance, this.sliceDist);
      this.$l.color = getSkyView(
        this,
        this.params,
        this.eyePos,
        this.rayDir,
        this.maxDis,
        texTransmittanceLut,
        texMultiScatteringLut
      );
      this.$l.voxelPos = pb.add(this.eyePos, pb.mul(this.rayDir, this.maxDis));
      this.$l.t1 = transmittanceToSky(this, this.params, this.eyePos, this.rayDir, texTransmittanceLut);
      this.$l.t2 = transmittanceToSky(this, this.params, this.voxelPos, this.rayDir, texTransmittanceLut);
      this.$l.t = pb.div(this.t1, this.t2);
      this.$return(pb.vec4(this.color, pb.dot(this.t, pb.vec3(1 / 3, 1 / 3, 1 / 3))));
    }
  });
  return scope[funcName](stParams, f2UV, f3VoxelDim, fCameraPosY);
}

export function skyViewLut(
  scope: PBInsideFunctionScope,
  stParams: PBShaderExp,
  f2UV: PBShaderExp,
  fCameraPosY: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texMultiScatteringLut: PBShaderExp
) {
  const pb = scope.$builder;
  const Params = getAtmosphereParamsStruct(pb);
  const funcName = 'v_skyViewLut';
  pb.func(funcName, [Params('params'), pb.vec2('uv'), pb.float('cameraPosY')], function () {
    this.$l.viewDir = uvToViewDir(this, this.uv);
    this.$l.h = pb.add(this.params.plantRadius, this.cameraPosY);
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
  return scope[funcName](stParams, f2UV, fCameraPosY);
}

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

export function renderAtmosphereLUTs(params?: Partial<AtmosphereParams>) {
  const checkResult = checkParams(params);
  if (checkResult.transmittance) {
    renderTransmittanceLut(currentAtmosphereParams);
  }
  if (checkResult.multiScattering) {
    renderMultiScatteringLut(currentAtmosphereParams);
  }
  if (checkResult.skyView) {
    renderSkyViewLut(currentAtmosphereParams);
  }
  if (checkResult.aerialPerspective) {
    renderAPLut(currentAtmosphereParams);
  }
}

/* For debug */
let debugTransmittanceLutProgram: GPUProgram = undefined;
let debugTransmittanceLutBindGroup: BindGroup = undefined;
let debugTransmittanceLut: Texture2D = undefined;
let debugTransmittanceFramebuffer: FrameBuffer = undefined;

let debugMultiScatteringLutProgram: GPUProgram = undefined;
let debugMultiScatteringLutBindGroup: BindGroup = undefined;
let debugMultiScatteringLut: Texture2D = undefined;
let debugMultiScatteringFramebuffer: FrameBuffer = undefined;

let debugSkyViewLutProgram: GPUProgram = undefined;
let debugSkyViewLutBindGroup: BindGroup = undefined;
let debugSkyViewLut: Texture2D = undefined;
let debugSkyViewFramebuffer: FrameBuffer = undefined;

let debugAPLutProgram: GPUProgram = undefined;
let debugAPLutBindGroup: BindGroup = undefined;
let debugApLut: Texture2D = undefined;
let debugAPFramebuffer: FrameBuffer = undefined;

let debugSkyBoxProgram: GPUProgram = undefined;
let debugSkyBoxBindGroup: BindGroup = undefined;
let debugSkyBoxFrameBuffer: FrameBuffer = undefined;
let debugPrimitiveSky: Primitive = undefined;
let debugSkyBoxCamera: Camera = undefined;
let debugSkyBoxRenderStates: RenderStateSet = undefined;

export function getTransmittanceLut() {
  return debugTransmittanceLut;
}

export function getMultiScatteringLut() {
  return debugMultiScatteringLut;
}

export function getSkyViewLut() {
  return debugSkyViewLut;
}

export function getAerialPerspectiveLut() {
  return debugApLut;
}

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
    pb.float('apDistance')
  ]);
}

export function renderTransmittanceLut(params: AtmosphereParams) {
  const device = Application.instance.device;
  if (debugTransmittanceLutProgram === undefined) {
    try {
      debugTransmittanceLutProgram = device.buildRenderProgram({
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
      debugTransmittanceLutBindGroup = device.createBindGroup(
        debugTransmittanceLutProgram.bindGroupLayouts[0]
      );
      debugTransmittanceLut = device.createTexture2D('rgba16f', 256, 64, {
        samplerOptions: { mipFilter: 'none' }
      });
      debugTransmittanceLut.name = 'DebugTransmittanceLut';
      debugTransmittanceFramebuffer = device.createFrameBuffer([debugTransmittanceLut], null);
    } catch (err) {
      console.error(err);
      debugTransmittanceLutProgram = null;
      debugTransmittanceLutBindGroup = null;
      debugTransmittanceFramebuffer = null;
    }
  }
  if (debugTransmittanceLutProgram) {
    debugTransmittanceLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    debugTransmittanceLutBindGroup.setValue('params', params);
    device.pushDeviceStates();
    device.setFramebuffer(debugTransmittanceFramebuffer);
    device.setProgram(debugTransmittanceLutProgram);
    device.setBindGroup(0, debugTransmittanceLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
  }
}

export function renderMultiScatteringLut(params: AtmosphereParams) {
  const device = Application.instance.device;
  if (debugMultiScatteringLutProgram === undefined) {
    try {
      debugMultiScatteringLutProgram = device.buildRenderProgram({
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
      debugMultiScatteringLutBindGroup = device.createBindGroup(
        debugMultiScatteringLutProgram.bindGroupLayouts[0]
      );
      debugMultiScatteringLut = device.createTexture2D('rgba16f', 32, 32, {
        samplerOptions: { mipFilter: 'none' }
      });
      debugMultiScatteringLut.name = 'DebugMultiScatteringLut';
      debugMultiScatteringFramebuffer = device.createFrameBuffer([debugMultiScatteringLut], null);
    } catch (err) {
      console.error(err);
      debugMultiScatteringLutProgram = null;
      debugMultiScatteringLutBindGroup = null;
      debugMultiScatteringFramebuffer = null;
    }
  }
  if (debugMultiScatteringLutProgram) {
    debugMultiScatteringLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    debugMultiScatteringLutBindGroup.setValue('params', params);
    debugMultiScatteringLutBindGroup.setTexture(
      'transmittanceLut',
      debugTransmittanceLut,
      fetchSampler('clamp_linear_nomip')
    );
    device.pushDeviceStates();
    device.setFramebuffer(debugMultiScatteringFramebuffer);
    device.setProgram(debugMultiScatteringLutProgram);
    device.setBindGroup(0, debugMultiScatteringLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
  }
}

export function renderSkyViewLut(params: AtmosphereParams) {
  const device = Application.instance.device;
  if (debugSkyViewLutProgram === undefined) {
    try {
      debugSkyViewLutProgram = device.buildRenderProgram({
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
          this.cameraPosY = pb.float().uniform(0);
          this.transmittanceLut = pb.tex2D().uniform(0);
          this.multiScatteringLut = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$outputs.outColor = skyViewLut(
              this,
              this.params,
              this.$inputs.uv,
              this.cameraPosY,
              this.transmittanceLut,
              this.multiScatteringLut
            );
          });
        }
      });
      debugSkyViewLutBindGroup = device.createBindGroup(debugSkyViewLutProgram.bindGroupLayouts[0]);
      debugSkyViewLut = device.createTexture2D('rgba16f', 256, 128, {
        samplerOptions: { mipFilter: 'none' }
      });
      debugSkyViewLut.name = 'DebugSkyViewLut';
      debugSkyViewFramebuffer = device.createFrameBuffer([debugSkyViewLut], null);
    } catch (err) {
      console.error(err);
      debugSkyViewLutProgram = null;
      debugSkyViewLutBindGroup = null;
      debugSkyViewFramebuffer = null;
    }
  }
  if (debugSkyViewLutProgram) {
    debugSkyViewLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    debugSkyViewLutBindGroup.setValue('params', params);
    debugSkyViewLutBindGroup.setValue('cameraPosY', 1);
    debugSkyViewLutBindGroup.setTexture(
      'transmittanceLut',
      debugTransmittanceLut,
      fetchSampler('clamp_linear_nomip')
    );
    debugSkyViewLutBindGroup.setTexture(
      'multiScatteringLut',
      debugMultiScatteringLut,
      fetchSampler('clamp_linear_nomip')
    );
    device.pushDeviceStates();
    device.setFramebuffer(debugSkyViewFramebuffer);
    device.setProgram(debugSkyViewLutProgram);
    device.setBindGroup(0, debugSkyViewLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
  }
}

export function renderAPLut(params: AtmosphereParams) {
  const device = Application.instance.device;
  if (debugAPLutProgram === undefined) {
    try {
      debugAPLutProgram = device.buildRenderProgram({
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
          this.cameraPosY = pb.float().uniform(0);
          this.transmittanceLut = pb.tex2D().uniform(0);
          this.multiScatteringLut = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$outputs.outColor = aerialPerspectiveLut(
              this,
              this.params,
              this.$inputs.uv,
              pb.vec3(32, 32, 32),
              this.cameraPosY,
              this.transmittanceLut,
              this.multiScatteringLut
            );
          });
        }
      });
      debugAPLutBindGroup = device.createBindGroup(debugAPLutProgram.bindGroupLayouts[0]);
      debugApLut = device.createTexture2D('rgba16f', 32 * 32, 32, { samplerOptions: { mipFilter: 'none' } });
      debugApLut.name = 'DebugAPLut';
      debugAPFramebuffer = device.createFrameBuffer([debugApLut], null);
    } catch (err) {
      console.error(err);
      debugAPLutProgram = null;
      debugAPLutBindGroup = null;
      debugAPFramebuffer = null;
    }
  }
  if (debugAPLutProgram) {
    debugAPLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    debugAPLutBindGroup.setValue('params', params);
    debugAPLutBindGroup.setValue('cameraPosY', 1);
    debugAPLutBindGroup.setTexture(
      'transmittanceLut',
      debugTransmittanceLut,
      fetchSampler('clamp_linear_nomip')
    );
    debugAPLutBindGroup.setTexture(
      'multiScatteringLut',
      debugMultiScatteringLut,
      fetchSampler('clamp_linear_nomip')
    );
    device.pushDeviceStates();
    device.setFramebuffer(debugAPFramebuffer);
    device.setProgram(debugAPLutProgram);
    device.setBindGroup(0, debugAPLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
  }
}

export function renderSkyBox(
  params: AtmosphereParams,
  cameraPosY: number,
  skyViewLut: Texture2D,
  sunSolidAngle = 0.01
) {
  const device = Application.instance.device;
  if (debugSkyBoxProgram === undefined) {
    debugSkyBoxProgram = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.viewProjMatrix = pb.mat4().uniform(0);
        this.flip = pb.vec4().uniform(0);
        pb.main(function () {
          this.$outputs.worldDirection = this.$inputs.pos;
          this.$builtins.position = pb.mul(
            this.viewProjMatrix,
            pb.vec4(this.$outputs.worldDirection, 1),
            this.flip
          );
          this.$builtins.position.z = this.$builtins.position.w;
        });
      },
      fragment(pb) {
        const Params = getAtmosphereParamsStruct(pb);
        this.params = Params().uniform(0);
        this.cameraPosY = pb.float().uniform(0);
        this.sunSolidAngle = pb.float().uniform(0);
        this.skyViewLut = pb.tex2D().uniform(0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = skyBox(
            this,
            this.params,
            this.cameraPosY,
            this.$inputs.worldDirection,
            this.sunSolidAngle,
            this.skyViewLut
          );
        });
      }
    });
    debugSkyBoxBindGroup = device.createBindGroup(debugSkyBoxProgram.bindGroupLayouts[0]);
    debugSkyBoxFrameBuffer = device.createFrameBuffer(
      [device.createCubeTexture('rgba16f', 128, { samplerOptions: { mipFilter: 'none' } })],
      null
    );
    debugSkyBoxFrameBuffer.getColorAttachments()[0].name = 'DebugSkyBox';
    debugPrimitiveSky = new BoxShape({ size: 8 });
    debugSkyBoxCamera = new Camera(null);
    debugSkyBoxCamera.setPerspective(Math.PI / 2, 1, 1, 20);
    debugSkyBoxRenderStates = device.createRenderStateSet();
    debugSkyBoxRenderStates.useDepthState().enableTest(false).enableWrite(false);
    debugSkyBoxRenderStates.useRasterizerState().setCullMode('none');
  }
  if (debugSkyBoxProgram) {
    debugSkyBoxBindGroup.setValue('params', params);
    debugSkyBoxBindGroup.setValue('cameraPosY', cameraPosY);
    debugSkyBoxBindGroup.setValue('sunSolidAngle', sunSolidAngle);
    debugSkyBoxBindGroup.setTexture('skyViewLut', skyViewLut, fetchSampler('clamp_linear_nomip'));
    debugSkyBoxBindGroup.setValue(
      'flip',
      device.type === 'webgpu' ? new Vector4(1, -1, 1, 1) : new Vector4(1, 1, 1, 1)
    );

    device.pushDeviceStates();
    device.setProgram(debugSkyBoxProgram);
    device.setBindGroup(0, debugSkyBoxBindGroup);
    device.setRenderStates(debugSkyBoxRenderStates);
    device.setFramebuffer(debugSkyBoxFrameBuffer);
    for (const face of [CubeFace.PX, CubeFace.NX, CubeFace.PY, CubeFace.NY, CubeFace.PZ, CubeFace.NZ]) {
      debugSkyBoxCamera.lookAtCubeFace(face);
      debugSkyBoxBindGroup.setValue('viewProjMatrix', debugSkyBoxCamera.viewProjectionMatrix);
      debugSkyBoxFrameBuffer.setColorAttachmentCubeFace(0, face);
      debugPrimitiveSky.draw();
    }
    device.popDeviceStates();
  }
}
