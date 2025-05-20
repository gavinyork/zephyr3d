import {
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import { Application } from '../app';
import { drawFullscreenQuad } from '../render/fullscreenquad';
import { fetchSampler } from '../utility/misc';
import { Vector3, Vector4 } from '@zephyr3d/base';

const TRANSMITTANCE_SAMPLES = 32;
const RAYLEIGH_SIGMA = [5.802, 13.558, 33.1];
const MIE_SIGMA = 3.996;
const MIE_ABSORPTION_SIGMA = 4.4;
const OZONE_ABSORPTION_SIGMA = [0.65, 1.881, 0.085];

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
  fPlantRadius: PBShaderExp,
  fAtmosphereHeight: PBShaderExp,
  f3Pos: PBShaderExp,
  f3Dir: PBShaderExp,
  texLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_transmittanceToSky';
  pb.func(
    funcName,
    [pb.float('plantRadius'), pb.float('atmosphereHeight'), pb.vec3('p'), pb.vec3('dir')],
    function () {
      this.$l.bottomRadius = this.plantRadius;
      this.$l.topRadius = pb.add(this.plantRadius, this.atmosphereHeight);
      this.$l.upVector = pb.normalize(this.p);
      this.$l.cosTheta = pb.dot(this.upVector, this.dir);
      this.$l.r = pb.length(this.p);
      this.$l.uv = transmittanceLutToUV(this, this.bottomRadius, this.topRadius, this.cosTheta, this.r);
      this.$return(pb.textureSampleLevel(texLut, this.uv, 0).rgb);
    }
  );
  return scope[funcName](fPlantRadius, fAtmosphereHeight, f3Pos, f3Dir);
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
  fPlantRadius: PBShaderExp,
  fAtmosphereHeight: PBShaderExp,
  fRayleighScatteringHeight: PBShaderExp,
  fMieScatteringHeight: PBShaderExp,
  fMieAnstroy: PBShaderExp,
  fOzoneLevelCenterHeight: PBShaderExp,
  fOzoneLevelWidth: PBShaderExp,
  f3EyePos: PBShaderExp,
  f3ViewDir: PBShaderExp,
  f3LightDir: PBShaderExp,
  f4LightColorAndIntensity: PBShaderExp,
  fMaxDis: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texMultiScatteringLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_getSkyView';
  pb.func(
    funcName,
    [
      pb.float('plantRadius'),
      pb.float('atmosphereHeight'),
      pb.float('rayleighScatteringHeight'),
      pb.float('mieScatteringHeight'),
      pb.float('mieAnstropy'),
      pb.float('center'),
      pb.float('width'),
      pb.vec3('eyePos'),
      pb.vec3('viewDir'),
      pb.vec3('lightDir'),
      pb.vec4('lightColorAndIntensity'),
      pb.float('maxDis')
    ],
    function () {
      const N_SAMPLE = 32;
      this.$l.color = pb.vec3(0);
      this.$l.dis = rayIntersectSphere(
        this,
        pb.vec3(0),
        pb.add(this.plantRadius, this.atmosphereHeight),
        this.eyePos,
        this.viewDir
      );
      this.$l.d = rayIntersectSphere(this, pb.vec3(0), this.plantRadius, this.eyePos, this.viewDir);
      this.$if(pb.lessThan(this.d, 0), function () {
        this.$return(pb.vec3(0));
      });
      this.$if(pb.greaterThan(this.d, 0), function () {
        this.dis = pb.min(this.dis, this.d);
      });
      this.$if(pb.greaterThan(this.maxDis, 0), function () {
        this.dis = pb.min(this.dis, this.maxDis);
      });
      this.$l.ds = pb.div(this.dis, N_SAMPLE);
      this.$l.p = pb.add(this.eyePos, pb.mul(this.viewDir, this.ds, 0.5));
      this.$l.sunLuminance = pb.mul(this.lightColorAndIntensity.rgb, this.lightColorAndIntensity.a);
      this.$l.opticalDepth = pb.vec3(0);
      this.$for(pb.int('i'), 0, N_SAMPLE, function () {
        this.$l.h = pb.sub(pb.length(this.p), this.plantRadius);
        this.$l.extinction = pb.add(
          rayleighCoefficient(this, this.rayleighScatteringHeight, this.h),
          mieCoefficient(this, this.mieScatteringHeight, this.h),
          ozoneAbsorption(this, this.center, this.width, this.h),
          mieAbsorption(this, this.mieScatteringHeight, this.h)
        );
        this.opticalDepth = pb.add(this.opticalDepth, pb.mul(this.extinction, this.ds));
        this.$l.t1 = transmittanceToSky(
          this,
          this.plantRadius,
          this.atmosphereHeight,
          this.p,
          this.lightDir,
          texTransmittanceLut
        );
        this.$l.s = scattering(
          this,
          this.p,
          this.lightDir,
          this.viewDir,
          this.plantRadius,
          this.rayleighScatteringHeight,
          this.mieScatteringHeight,
          this.mieAnstropy
        );
        this.$l.t2 = pb.exp(pb.neg(this.opticalDepth));

        this.$l.inScattering = pb.mul(this.t1, this.s, this.t2, this.ds, this.sunLuminance);
        this.color = pb.add(this.color, this.inScattering);

        this.$l.multiScattering = getMultiScattering(
          this,
          this.plantRadius,
          this.atmosphereHeight,
          this.rayleighScatteringHeight,
          this.mieScatteringHeight,
          this.p,
          this.lightDir,
          texMultiScatteringLut
        );
        this.color = pb.add(this.color, pb.mul(this.multiScattering, this.t2, this.ds, this.sunLuminance));

        this.p = pb.add(this.p, pb.mul(this.viewDir, this.ds));
      });
      this.$return(this.color);
    }
  );
  return scope[funcName](
    fPlantRadius,
    fAtmosphereHeight,
    fRayleighScatteringHeight,
    fMieScatteringHeight,
    fMieAnstroy,
    fOzoneLevelCenterHeight,
    fOzoneLevelWidth,
    f3EyePos,
    f3ViewDir,
    f3LightDir,
    f4LightColorAndIntensity,
    fMaxDis
  );
}

export function getMultiScattering(
  scope: PBInsideFunctionScope,
  fPlantRadius: PBShaderExp,
  fAtmosphereHeight: PBShaderExp,
  fRayleighScatteringHeight: PBShaderExp,
  fMieScatteringHeight: PBShaderExp,
  f3Pos: PBShaderExp,
  f3LightDir: PBShaderExp,
  texMultiScatteringLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'z_getMultiScattering';
  pb.func(
    funcName,
    [
      pb.float('plantRadius'),
      pb.float('atmosphereHeight'),
      pb.float('rayleighScatteringHeight'),
      pb.float('mieScatteringHeight'),
      pb.vec3('p'),
      pb.vec3('lightDir')
    ],
    function () {
      this.$l.h = pb.sub(pb.length(this.p), this.plantRadius);
      this.$l.sigma_s = pb.add(
        rayleighCoefficient(this, this.rayleighScatteringHeight, this.h),
        mieCoefficient(this, this.mieScatteringHeight, this.h)
      );
      this.$l.zenithAngle = pb.dot(pb.normalize(this.p), this.lightDir);
      this.$l.uv = pb.vec2(pb.add(pb.mul(this.zenithAngle, 0.5), 0.5), pb.div(this.h, this.atmosphereHeight));
      this.$l.G_ALL = pb.textureSampleLevel(texMultiScatteringLut, this.uv, 0).rgb;
      this.$return(pb.mul(this.G_ALL, this.sigma_s));
    }
  );
  return scope[funcName](
    fPlantRadius,
    fAtmosphereHeight,
    fRayleighScatteringHeight,
    fMieScatteringHeight,
    f3Pos,
    f3LightDir
  );
}

export function integralMultiScattering(
  scope: PBInsideFunctionScope,
  fPlantRadius: PBShaderExp,
  fAtmosphereHeight: PBShaderExp,
  fRayleighScatteringHeight: PBShaderExp,
  fMieScatteringHeight: PBShaderExp,
  fMieAnstropy: PBShaderExp,
  fOzoneLevelCenterHeight: PBShaderExp,
  fOzoneLevelWidth: PBShaderExp,
  f3SamplePoint: PBShaderExp,
  f3LightDir: PBShaderExp,
  texTransmittanceLut: PBShaderExp
) {
  const N_DIRECTION = 64;
  const N_SAMPLE = 32;
  const pb = scope.$builder;
  const funcName = 'z_integralMultiScattering';
  pb.func(
    funcName,
    [
      pb.float('plantRadius'),
      pb.float('atmosphereHeight'),
      pb.float('rayleighScatteringHeight'),
      pb.float('mieScatteringHeight'),
      pb.float('mieAnstropy'),
      pb.float('center'),
      pb.float('width'),
      pb.vec3('samplePoint'),
      pb.vec3('lightDir')
    ],
    function () {
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
          pb.add(this.plantRadius, this.atmosphereHeight),
          this.samplePoint,
          this.viewDir
        );
        this.$l.d = rayIntersectSphere(this, pb.vec3(0), this.plantRadius, this.samplePoint, this.viewDir);
        this.$if(pb.greaterThan(this.d, 0), function () {
          this.dis = pb.min(this.dis, this.d);
        });
        this.$l.ds = pb.div(this.dis, N_SAMPLE);
        this.$l.p = pb.add(this.samplePoint, pb.mul(this.viewDir, this.ds, 0.5));
        this.$l.opticalDepth = pb.vec3(0);
        this.$for(pb.int('j'), 0, N_SAMPLE, function () {
          this.$l.h = pb.sub(pb.length(this.p), this.plantRadius);
          this.$l.sigma_s = pb.add(
            rayleighCoefficient(this, this.rayleighScatteringHeight, this.h),
            mieCoefficient(this, this.mieScatteringHeight, this.h)
          );
          this.$l.sigma_a = pb.add(
            ozoneAbsorption(this, this.center, this.width, this.h),
            mieAbsorption(this, this.mieScatteringHeight, this.h)
          );
          this.$l.sigma_t = pb.add(this.sigma_s, this.sigma_a);
          this.opticalDepth = pb.add(this.opticalDepth, pb.mul(this.sigma_t, this.ds));
          this.$l.t1 = transmittanceToSky(
            this,
            this.plantRadius,
            this.atmosphereHeight,
            this.p,
            this.lightDir,
            texTransmittanceLut
          );
          this.$l.s = scattering(
            this,
            this.p,
            this.lightDir,
            this.viewDir,
            this.plantRadius,
            this.rayleighScatteringHeight,
            this.mieScatteringHeight,
            this.mieAnstropy
          );
          this.$l.t2 = pb.exp(pb.neg(this.opticalDepth));
          this.G_2 = pb.add(this.G_2, pb.mul(this.t1, this.s, this.t2, uniformPhase, this.ds));
          this.f_ms = pb.add(this.f_ms, pb.mul(this.t2, this.sigma_s, uniformPhase, this.ds));
          this.p = pb.add(this.p, pb.mul(this.viewDir, this.ds));
        });
      });
      this.G_2 = pb.mul(this.G_2, sphereSolidAngle);
      this.f_ms = pb.mul(this.f_ms, sphereSolidAngle);
      this.$return(pb.div(this.G_2, pb.sub(pb.vec3(1), this.f_ms)));
    }
  );
  return scope[funcName](
    fPlantRadius,
    fAtmosphereHeight,
    fRayleighScatteringHeight,
    fMieScatteringHeight,
    fMieAnstropy,
    fOzoneLevelCenterHeight,
    fOzoneLevelWidth,
    f3SamplePoint,
    f3LightDir
  );
}

export function scattering(
  scope: PBInsideFunctionScope,
  f3Pos: PBShaderExp,
  f3LightDir: PBShaderExp,
  f3ViewDir: PBShaderExp,
  fPlantRadius: PBShaderExp,
  fRayleighScatteringHeight: PBShaderExp,
  fMieScatteringHeight: PBShaderExp,
  fMieAnstropy: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'z_scattering';
  pb.func(
    funcName,
    [
      pb.vec3('p'),
      pb.vec3('lightDir'),
      pb.vec3('viewDir'),
      pb.float('plantRadius'),
      pb.float('rayleighScatteringHeight'),
      pb.float('mieScatteringHeight'),
      pb.float('mieAnstropy')
    ],
    function () {
      this.$l.cosTheta = pb.dot(this.lightDir, this.viewDir);
      this.$l.h = pb.sub(pb.length(this.p), this.plantRadius);
      this.$l.rayleigh = pb.mul(
        rayleighCoefficient(this, this.rayleighScatteringHeight, this.h),
        rayleighPhase(this, this.cosTheta)
      );
      this.$l.mie = pb.mul(
        mieCoefficient(this, this.mieScatteringHeight, this.h),
        miePhase(this, this.mieAnstropy, this.cosTheta)
      );
      this.$return(pb.add(this.rayleigh, this.mie));
    }
  );
  return scope[funcName](
    f3Pos,
    f3LightDir,
    f3ViewDir,
    fPlantRadius,
    fRayleighScatteringHeight,
    fMieScatteringHeight,
    fMieAnstropy
  );
}

export function transmittance(
  scope: PBInsideFunctionScope,
  fRayleighScatteringHeight: PBShaderExp,
  fMieScatteringHeight: PBShaderExp,
  fOzoneLevelCenterHeight: PBShaderExp,
  fOzoneLevelWidth: PBShaderExp,
  fPlantRadius: PBShaderExp,
  f3P1: PBShaderExp,
  f3P2: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcName = 'z_transmittance';
  pb.func(
    funcName,
    [
      pb.float('rayleighScatteringHeight'),
      pb.float('mieScatteringHeight'),
      pb.float('center'),
      pb.float('width'),
      pb.float('plantRadius'),
      pb.vec3('p1'),
      pb.vec3('p2')
    ],
    function () {
      this.$l.dir = pb.normalize(pb.sub(this.p2, this.p1));
      this.$l.distance = pb.length(pb.sub(this.p2, this.p1));
      this.$l.ds = pb.div(this.distance, TRANSMITTANCE_SAMPLES);
      this.$l.sum = pb.vec3(0);
      this.$l.p = pb.add(this.p1, pb.mul(this.dir, this.ds, 0.5));
      this.$for(pb.int('i'), 0, TRANSMITTANCE_SAMPLES, function () {
        this.$l.h = pb.sub(pb.length(this.p), this.plantRadius);
        this.$l.scattering = pb.add(
          rayleighCoefficient(this, this.rayleighScatteringHeight, this.h),
          mieCoefficient(this, this.mieScatteringHeight, this.h)
        );
        this.$l.absorption = pb.add(
          ozoneAbsorption(this, this.center, this.width, this.h),
          mieAbsorption(this, this.mieScatteringHeight, this.h)
        );
        this.$l.extinction = pb.add(this.scattering, this.absorption);
        this.sum = pb.add(this.sum, pb.mul(this.extinction, this.ds));
        this.p = pb.add(this.p, pb.mul(this.dir, this.ds));
      });
      this.$return(pb.exp(pb.neg(this.sum)));
    }
  );
  return scope[funcName](
    fRayleighScatteringHeight,
    fMieScatteringHeight,
    fOzoneLevelCenterHeight,
    fOzoneLevelWidth,
    fPlantRadius,
    f3P1,
    f3P2
  );
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

export function skyViewLut(
  scope: PBInsideFunctionScope,
  f2UV: PBShaderExp,
  fPlantRadius: PBShaderExp,
  fAtmosphereHeight: PBShaderExp,
  fRayleighScatteringHeight: PBShaderExp,
  fMieScatteringHeight: PBShaderExp,
  fMieAnstropy: PBShaderExp,
  fOzoneLevelCenterHeight: PBShaderExp,
  fOzoneLevelWidth: PBShaderExp,
  fCameraPosY: PBShaderExp,
  f3LightDir: PBShaderExp,
  f4LightColorAndIntensity: PBShaderExp,
  texTransmittanceLut: PBShaderExp,
  texMultiScatteringLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'v_skyViewLut';
  pb.func(
    funcName,
    [
      pb.vec2('uv'),
      pb.float('plantRadius'),
      pb.float('atmosphereHeight'),
      pb.float('rayleighScatteringHeight'),
      pb.float('mieScatteringHeight'),
      pb.float('mieAnstropy'),
      pb.float('center'),
      pb.float('width'),
      pb.float('cameraPosY'),
      pb.vec3('lightDir'),
      pb.vec4('lightColorAndIntensity')
    ],
    function () {
      this.$l.viewDir = uvToViewDir(this, this.uv);
      this.$l.h = pb.add(this.plantRadius, this.cameraPosY);
      this.$l.eyePos = pb.vec3(0, this.h, 0);
      this.$l.rgb = getSkyView(
        this,
        this.plantRadius,
        this.atmosphereHeight,
        this.rayleighScatteringHeight,
        this.mieScatteringHeight,
        this.mieAnstropy,
        this.center,
        this.width,
        this.eyePos,
        this.viewDir,
        this.lightDir,
        this.lightColorAndIntensity,
        pb.float(-1),
        texTransmittanceLut,
        texMultiScatteringLut
      );
      this.$return(pb.vec4(this.rgb, 1));
    }
  );
  return scope[funcName](
    f2UV,
    fPlantRadius,
    fAtmosphereHeight,
    fRayleighScatteringHeight,
    fMieScatteringHeight,
    fMieAnstropy,
    fOzoneLevelCenterHeight,
    fOzoneLevelWidth,
    fCameraPosY,
    f3LightDir,
    f4LightColorAndIntensity
  );
}

export function multiScatteringLut(
  scope: PBInsideFunctionScope,
  f2UV: PBShaderExp,
  fPlantRadius: PBShaderExp,
  fAtmosphereHeight: PBShaderExp,
  fRayleighScatteringHeight: PBShaderExp,
  fMieScatteringHeight: PBShaderExp,
  fMieAnstropy: PBShaderExp,
  fOzoneLevelCenterHeight: PBShaderExp,
  fOzoneLevelWidth: PBShaderExp,
  texTransmittanceLut: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'v_multiScatteringLut';
  pb.func(
    funcName,
    [
      pb.vec2('uv'),
      pb.float('plantRadius'),
      pb.float('atmosphereHeight'),
      pb.float('rayleighScatteringHeight'),
      pb.float('mieScatteringHeight'),
      pb.float('mieAnstropy'),
      pb.float('center'),
      pb.float('width')
    ],
    function () {
      this.$l.mu_s = pb.sub(pb.mul(this.uv.x, 2), 1);
      this.$l.r = pb.add(pb.mul(this.uv.y, this.atmosphereHeight), this.plantRadius);
      this.$l.cosTheta = this.mu_s;
      this.$l.sinTheta = pb.sqrt(pb.sub(1, pb.mul(this.cosTheta, this.cosTheta)));
      this.$l.lightDir = pb.vec3(this.sinTheta, this.cosTheta, 0);
      this.$l.p = pb.vec3(0, this.r, 0);
      this.$l.rgb = integralMultiScattering(
        this,
        this.plantRadius,
        this.atmosphereHeight,
        this.rayleighScatteringHeight,
        this.mieScatteringHeight,
        this.mieAnstropy,
        this.center,
        this.width,
        this.p,
        this.lightDir,
        texTransmittanceLut
      );
      this.$return(pb.vec4(this.rgb, 1));
    }
  );
  return scope[funcName](
    f2UV,
    fPlantRadius,
    fAtmosphereHeight,
    fRayleighScatteringHeight,
    fMieScatteringHeight,
    fMieAnstropy,
    fOzoneLevelCenterHeight,
    fOzoneLevelWidth
  );
}

export function transmittanceLut(
  scope: PBInsideFunctionScope,
  f2UV: PBShaderExp,
  fPlantRadius: PBShaderExp,
  fAtmosphereHeight: PBShaderExp,
  fRayleighScatteringHeight: PBShaderExp,
  fMieScatteringHeight: PBShaderExp,
  fOzoneLevelCenterHeight: PBShaderExp,
  fOzoneLevelWidth: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'transmittanceLut';
  pb.func(
    funcName,
    [
      pb.vec2('uv'),
      pb.float('plantRadius'),
      pb.float('atmosphereHeight'),
      pb.float('rayleighScatteringHeight'),
      pb.float('mieScatteringHeight'),
      pb.float('center'),
      pb.float('width')
    ],
    function () {
      this.$l.color = pb.vec4(0, 0, 0, 1);
      this.$l.bottomRadius = this.plantRadius;
      this.$l.topRadius = pb.add(this.bottomRadius, this.atmosphereHeight);
      this.$l.lutParams = uvToTransmittanceLut(this, this.uv, this.bottomRadius, this.topRadius);
      this.$l.cos_theta = this.lutParams.x;
      this.$l.r = this.lutParams.y;
      this.$l.sin_theta = pb.sqrt(pb.sub(1, pb.mul(this.cos_theta, this.cos_theta)));
      this.$l.viewDir = pb.vec3(this.sin_theta, this.cos_theta, 0);
      this.$l.eyePos = pb.vec3(0, this.r, 0);
      this.$l.dis = rayIntersectSphere(this, pb.vec3(0), this.topRadius, this.eyePos, this.viewDir);
      this.$l.hitPoint = pb.add(this.eyePos, pb.mul(this.viewDir, this.dis));
      this.$return(
        pb.vec4(
          transmittance(
            this,
            this.rayleighScatteringHeight,
            this.mieScatteringHeight,
            this.center,
            this.width,
            this.plantRadius,
            this.eyePos,
            this.hitPoint
          ),
          1
        )
      );
    }
  );
  return scope[funcName](
    f2UV,
    fPlantRadius,
    fAtmosphereHeight,
    fRayleighScatteringHeight,
    fMieScatteringHeight,
    fOzoneLevelCenterHeight,
    fOzoneLevelWidth
  );
}

/* For debug */
let debugTransmittanceLutProgram: GPUProgram = undefined;
let debugTransmittanceLutBindGroup: BindGroup = undefined;
let debugTransmittanceFramebuffer: FrameBuffer = undefined;

let debugMultiScatteringLutProgram: GPUProgram = undefined;
let debugMultiScatteringLutBindGroup: BindGroup = undefined;
let debugMultiScatteringFramebuffer: FrameBuffer = undefined;

let debugSkyViewLutProgram: GPUProgram = undefined;
let debugSkyViewLutBindGroup: BindGroup = undefined;
let debugSkyViewFramebuffer: FrameBuffer = undefined;

export function renderTransmittanceLut(
  plantRadius = 6360000,
  atmosphereHeight = 60000,
  rayleighScatteringHeight = 8000,
  mieScatteringHeight = 1200,
  ozoneLevelCenterHeight = 25000,
  ozoneLevelWidth = 15000
): Texture2D {
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
          this.plantRadius = pb.float().uniform(0);
          this.atmosphereHeight = pb.float().uniform(0);
          this.rayleighScatteringHeight = pb.float().uniform(0);
          this.mieScatteringHeight = pb.float().uniform(0);
          this.ozoneLevelCenterHeight = pb.float().uniform(0);
          this.ozoneLevelWidth = pb.float().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$outputs.outColor = transmittanceLut(
              this,
              this.$inputs.uv,
              this.plantRadius,
              this.atmosphereHeight,
              this.rayleighScatteringHeight,
              this.mieScatteringHeight,
              this.ozoneLevelCenterHeight,
              this.ozoneLevelWidth
            );
          });
        }
      });
      debugTransmittanceLutBindGroup = device.createBindGroup(
        debugTransmittanceLutProgram.bindGroupLayouts[0]
      );
      debugTransmittanceFramebuffer = device.pool.fetchTemporalFramebuffer(false, 256, 64, 'rgba32f');
      debugTransmittanceFramebuffer.getColorAttachments()[0].name = 'DebugTransmittanceLut';
    } catch (err) {
      console.error(err);
      debugTransmittanceLutProgram = null;
      debugTransmittanceLutBindGroup = null;
      debugTransmittanceFramebuffer = null;
    }
  }
  if (debugTransmittanceLutProgram) {
    debugTransmittanceLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    debugTransmittanceLutBindGroup.setValue('plantRadius', plantRadius);
    debugTransmittanceLutBindGroup.setValue('atmosphereHeight', atmosphereHeight);
    debugTransmittanceLutBindGroup.setValue('rayleighScatteringHeight', rayleighScatteringHeight);
    debugTransmittanceLutBindGroup.setValue('mieScatteringHeight', mieScatteringHeight);
    debugTransmittanceLutBindGroup.setValue('ozoneLevelCenterHeight', ozoneLevelCenterHeight);
    debugTransmittanceLutBindGroup.setValue('ozoneLevelWidth', ozoneLevelWidth);
    device.pushDeviceStates();
    device.setFramebuffer(debugTransmittanceFramebuffer);
    device.setProgram(debugTransmittanceLutProgram);
    device.setBindGroup(0, debugTransmittanceLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
    return debugTransmittanceFramebuffer.getColorAttachments()[0] as Texture2D;
  } else {
    return null;
  }
}

export function renderMultiScatteringLut(
  texTransmittanceLut: Texture2D,
  plantRadius = 6360000,
  atmosphereHeight = 60000,
  rayleighScatteringHeight = 8000,
  mieScatteringHeight = 1200,
  mieAnstropy = 0.8,
  ozoneLevelCenterHeight = 25000,
  ozoneLevelWidth = 15000
): Texture2D {
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
          this.plantRadius = pb.float().uniform(0);
          this.atmosphereHeight = pb.float().uniform(0);
          this.rayleighScatteringHeight = pb.float().uniform(0);
          this.mieScatteringHeight = pb.float().uniform(0);
          this.mieAnstropy = pb.float().uniform(0);
          this.ozoneLevelCenterHeight = pb.float().uniform(0);
          this.ozoneLevelWidth = pb.float().uniform(0);
          this.transmittanceLut = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$outputs.outColor = multiScatteringLut(
              this,
              this.$inputs.uv,
              this.plantRadius,
              this.atmosphereHeight,
              this.rayleighScatteringHeight,
              this.mieScatteringHeight,
              this.mieAnstropy,
              this.ozoneLevelCenterHeight,
              this.ozoneLevelWidth,
              this.transmittanceLut
            );
          });
        }
      });
      debugMultiScatteringLutBindGroup = device.createBindGroup(
        debugMultiScatteringLutProgram.bindGroupLayouts[0]
      );
      debugMultiScatteringFramebuffer = device.pool.fetchTemporalFramebuffer(false, 32, 32, 'rgba32f');
      debugMultiScatteringFramebuffer.getColorAttachments()[0].name = 'DebugMultiScatteringLut';
    } catch (err) {
      console.error(err);
      debugMultiScatteringLutProgram = null;
      debugMultiScatteringLutBindGroup = null;
      debugMultiScatteringFramebuffer = null;
    }
  }
  if (debugMultiScatteringLutProgram) {
    debugMultiScatteringLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    debugMultiScatteringLutBindGroup.setValue('plantRadius', plantRadius);
    debugMultiScatteringLutBindGroup.setValue('atmosphereHeight', atmosphereHeight);
    debugMultiScatteringLutBindGroup.setValue('rayleighScatteringHeight', rayleighScatteringHeight);
    debugMultiScatteringLutBindGroup.setValue('mieScatteringHeight', mieScatteringHeight);
    debugMultiScatteringLutBindGroup.setValue('mieAnstropy', mieAnstropy);
    debugMultiScatteringLutBindGroup.setValue('ozoneLevelCenterHeight', ozoneLevelCenterHeight);
    debugMultiScatteringLutBindGroup.setValue('ozoneLevelWidth', ozoneLevelWidth);
    debugMultiScatteringLutBindGroup.setTexture(
      'transmittanceLut',
      texTransmittanceLut,
      fetchSampler('clamp_linear_nomip')
    );
    device.pushDeviceStates();
    device.setFramebuffer(debugMultiScatteringFramebuffer);
    device.setProgram(debugMultiScatteringLutProgram);
    device.setBindGroup(0, debugMultiScatteringLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();

    return debugMultiScatteringFramebuffer.getColorAttachments()[0] as Texture2D;
  } else {
    return null;
  }
}

export function renderSkyViewLut(
  texTransmittanceLut: Texture2D,
  texMultiScatteringLut: Texture2D,
  lightDir: Vector3,
  lightColorAndIntensity: Vector4,
  cameraPosY = 0,
  plantRadius = 6360000,
  atmosphereHeight = 60000,
  rayleighScatteringHeight = 8000,
  mieScatteringHeight = 1200,
  mieAnstropy = 0.8,
  ozoneLevelCenterHeight = 25000,
  ozoneLevelWidth = 15000
): Texture2D {
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
          this.plantRadius = pb.float().uniform(0);
          this.atmosphereHeight = pb.float().uniform(0);
          this.rayleighScatteringHeight = pb.float().uniform(0);
          this.mieScatteringHeight = pb.float().uniform(0);
          this.mieAnstropy = pb.float().uniform(0);
          this.ozoneLevelCenterHeight = pb.float().uniform(0);
          this.ozoneLevelWidth = pb.float().uniform(0);
          this.lightDir = pb.vec3().uniform(0);
          this.cameraPosY = pb.float().uniform(0);
          this.lightColorAndIntensity = pb.vec4().uniform(0);
          this.transmittanceLut = pb.tex2D().uniform(0);
          this.multiScatteringLut = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$outputs.outColor = skyViewLut(
              this,
              this.$inputs.uv,
              this.plantRadius,
              this.atmosphereHeight,
              this.rayleighScatteringHeight,
              this.mieScatteringHeight,
              this.mieAnstropy,
              this.ozoneLevelCenterHeight,
              this.ozoneLevelWidth,
              this.cameraPosY,
              this.lightDir,
              this.lightColorAndIntensity,
              this.transmittanceLut,
              this.multiScatteringLut
            );
          });
        }
      });
      debugSkyViewLutBindGroup = device.createBindGroup(debugSkyViewLutProgram.bindGroupLayouts[0]);
      debugSkyViewFramebuffer = device.pool.fetchTemporalFramebuffer(false, 256, 128, 'rgba32f');
      debugSkyViewFramebuffer.getColorAttachments()[0].name = 'DebugSkyViewLut';
    } catch (err) {
      console.error(err);
      debugSkyViewLutProgram = null;
      debugSkyViewLutBindGroup = null;
      debugSkyViewFramebuffer = null;
    }
  }
  if (debugSkyViewLutProgram) {
    debugSkyViewLutBindGroup.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    debugSkyViewLutBindGroup.setValue('plantRadius', plantRadius);
    debugSkyViewLutBindGroup.setValue('atmosphereHeight', atmosphereHeight);
    debugSkyViewLutBindGroup.setValue('rayleighScatteringHeight', rayleighScatteringHeight);
    debugSkyViewLutBindGroup.setValue('mieScatteringHeight', mieScatteringHeight);
    debugSkyViewLutBindGroup.setValue('mieAnstropy', mieAnstropy);
    debugSkyViewLutBindGroup.setValue('ozoneLevelCenterHeight', ozoneLevelCenterHeight);
    debugSkyViewLutBindGroup.setValue('ozoneLevelWidth', ozoneLevelWidth);
    debugSkyViewLutBindGroup.setValue('cameraPosY', cameraPosY);
    debugSkyViewLutBindGroup.setValue('lightDir', lightDir);
    debugSkyViewLutBindGroup.setValue('lightColorAndIntensity', lightColorAndIntensity);
    debugSkyViewLutBindGroup.setTexture(
      'transmittanceLut',
      texTransmittanceLut,
      fetchSampler('clamp_linear_nomip')
    );
    debugSkyViewLutBindGroup.setTexture(
      'multiScatteringLut',
      texMultiScatteringLut,
      fetchSampler('clamp_linear_nomip')
    );
    device.pushDeviceStates();
    device.setFramebuffer(debugSkyViewFramebuffer);
    device.setProgram(debugSkyViewLutProgram);
    device.setBindGroup(0, debugSkyViewLutBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();

    return debugSkyViewFramebuffer.getColorAttachments()[0] as Texture2D;
  } else {
    return null;
  }
}
