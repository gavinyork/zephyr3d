import { BindGroup, FrameBuffer, GPUProgram, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { Application } from '../app';
import { drawFullscreenQuad } from '../render/fullscreenquad';

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

export function renderTransmittanceLut(
  plantRadius = 6360000,
  atmosphereHeight = 60000,
  rayleighScatteringHeight = 8000,
  mieScatteringHeight = 1200,
  ozoneLevelCenterHeight = 25000,
  ozoneLevelWidth = 15000
) {
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
  }
}
