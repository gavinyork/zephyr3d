import type {
  AbstractDevice,
  VertexLayout,
  GPUProgram,
  RenderStateSet,
  Texture2D,
  TextureFormat,
  BindGroup,
  PBGlobalScope,
  FrameBuffer
} from '@zephyr3d/device';
import { Vector3 } from '@zephyr3d/base';
import { getDevice } from '../app/api';

export class ScatteringLut {
  private static readonly _groundAlbedo = 1.0;
  private static readonly _groundRadiusMM = 6.36;
  private static readonly _atmosphereRadiusMM = 6.46;
  private static readonly _scatteringSteps = 32;
  private static readonly _sunTransmittanceSteps = 40;
  private static readonly _rayleighScatteringBase = [5.802, 13.558, 33.1] as const;
  private static readonly _rayleighAbsorptionBase = 0;
  private static readonly _mieScatteringBase = 3.996;
  private static readonly _mieAbsorptionBase = 4.4;
  private static readonly _ozoneAbsorptionBase = [0.65, 1.881, 0.085] as const;
  private static readonly _multiScatteringSteps = 20;
  private static readonly _sqrtSamples = 8;
  private static readonly _transmittanceLutWidth = 256;
  private static readonly _transmittanceLutHeight = 64;
  private static readonly _multiScatteringLutWidth = 32;
  private static readonly _multiScatteringLutHeight = 32;
  private static readonly _skyViewLutWidth = 256;
  private static readonly _skyViewLutHeight = 256;
  private static _vertexLayout: VertexLayout = null;
  private static _renderStates: RenderStateSet = null;
  private static _programTransmittanceLut: GPUProgram = null;
  private static _bindgroupTransmittanceLut: BindGroup = null;
  private static _programMultiScatteringLut: GPUProgram = null;
  private static _bindgroupMultiScatteringLut: BindGroup = null;
  private static _programSkyViewLut: GPUProgram = null;
  private static _bindgroupSkyViewLut: BindGroup = null;
  private static _transmittanceLut: Texture2D = null;
  private static _multiScatteringLut: Texture2D = null;
  private static _skyViewFramebuffer: FrameBuffer = null;
  private static _programAerialPerspectiveLut: GPUProgram = null;
  private static _bindgroupAerialPerspectiveLut: BindGroup = null;
  private static _aerialPerspectiveLut: Texture2D = null;
  private static _currentSkyViewSunAltitude = 0;
  private static _currentAerialPerspectiveAltitude = 0;
  private static _currentMaxAerialPerspectiveDistance = 800;
  private static readonly _aerialPerspectiveSliceX = 32;
  private static readonly _aerialPerspectiveSliceY = 32;
  private static readonly _aerialPerspectiveSliceZ = 32;
  private static readonly _aerialPerspectiveTextureWidth =
    this._aerialPerspectiveSliceX * this._aerialPerspectiveSliceZ;
  private static readonly _aerialPerspectiveTextureHeight = this._aerialPerspectiveSliceY;

  private static readonly _viewPos = new Vector3(0.0, this._groundRadiusMM + 0.00005, 0.0);
  static get aerialPerspectiveSliceZ() {
    return this._aerialPerspectiveSliceZ;
  }
  static get groundRadius(): number {
    return this._groundRadiusMM;
  }
  static get atmosphereRadius(): number {
    return this._atmosphereRadiusMM;
  }
  static get viewPosition(): Vector3 {
    return this._viewPos;
  }
  static getMultiScatteringLut() {
    const device = getDevice();
    if (!this._multiScatteringLut) {
      this.prepare(device);
      const format: TextureFormat =
        device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer &&
        device.getDeviceCaps().textureCaps.supportLinearHalfFloatTexture
          ? 'rgba16f'
          : 'rgba8unorm';
      this._multiScatteringLut = device.createTexture2D(
        format,
        this._multiScatteringLutWidth,
        this._multiScatteringLutHeight,
        {
          samplerOptions: { mipFilter: 'none' }
        }
      );
      this._multiScatteringLut.name = 'MultiScatteringLUT';
      const tLut = this.getTransmittanceLut();
      const tempFramebuffer = device.createFrameBuffer([this._multiScatteringLut], null);
      device.pushDeviceStates();
      device.setFramebuffer(tempFramebuffer);
      device.setProgram(this._programMultiScatteringLut);
      device.setBindGroup(0, this._bindgroupMultiScatteringLut);
      this._bindgroupMultiScatteringLut.setValue('flip', device.type === 'webgpu' ? 1 : 0);
      this._bindgroupMultiScatteringLut.setTexture('tLut', tLut);
      this.drawQuad(device);
      device.popDeviceStates();
      tempFramebuffer.dispose();
    }
    return this._multiScatteringLut;
  }
  static getAerialPerspectiveLut(sunAltitude: number, maxDistance: number) {
    const device = getDevice();
    if (
      sunAltitude !== this._currentAerialPerspectiveAltitude ||
      maxDistance !== this._currentMaxAerialPerspectiveDistance ||
      !this._aerialPerspectiveLut
    ) {
      if (!this._aerialPerspectiveLut) {
        const format: TextureFormat =
          device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer &&
          device.getDeviceCaps().textureCaps.supportLinearHalfFloatTexture
            ? 'rgba16f'
            : 'rgba8unorm';
        if (!this._aerialPerspectiveLut) {
          this._aerialPerspectiveLut = device.createTexture2D(
            format,
            this._aerialPerspectiveTextureWidth,
            this._aerialPerspectiveTextureHeight,
            {
              samplerOptions: { mipFilter: 'none' }
            }
          );
          this._aerialPerspectiveLut.name = 'AerialPerspectiveLUT';
        }
      }
      const fb = device.createFrameBuffer([this._aerialPerspectiveLut], null);
      const tLut = this.getTransmittanceLut();
      const msLut = this.getMultiScatteringLut();
      this._currentAerialPerspectiveAltitude = sunAltitude;
      this._currentMaxAerialPerspectiveDistance = maxDistance;
      device.pushDeviceStates();
      device.setFramebuffer(fb);
      device.setProgram(this._programAerialPerspectiveLut);
      device.setBindGroup(0, this._bindgroupAerialPerspectiveLut);
      this._bindgroupAerialPerspectiveLut.setValue('flip', device.type === 'webgpu' ? 1 : 0);
      this._bindgroupAerialPerspectiveLut.setValue('sunAltitude', this._currentAerialPerspectiveAltitude);
      this._bindgroupAerialPerspectiveLut.setValue('maxDistance', this._currentMaxAerialPerspectiveDistance);
      this._bindgroupAerialPerspectiveLut.setTexture('tLut', tLut);
      this._bindgroupAerialPerspectiveLut.setTexture('msLut', msLut);
      this.drawQuad(device);
      device.popDeviceStates();
      fb.dispose();
    }
    return this._aerialPerspectiveLut;
  }
  static getSkyViewLut(sunAltitude: number) {
    const device = getDevice();
    if (sunAltitude !== this._currentSkyViewSunAltitude || !this._skyViewFramebuffer) {
      if (!this._skyViewFramebuffer) {
        const format: TextureFormat =
          device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer &&
          device.getDeviceCaps().textureCaps.supportLinearHalfFloatTexture
            ? 'rgba16f'
            : 'rgba8unorm';
        const skyViewLut = device.createTexture2D(format, this._skyViewLutWidth, this._skyViewLutHeight, {
          samplerOptions: { mipFilter: 'none' }
        });
        skyViewLut.name = 'SkyViewLut';
        this._skyViewFramebuffer = device.createFrameBuffer([skyViewLut], null);
      }
      const tLut = this.getTransmittanceLut();
      const msLut = this.getMultiScatteringLut();
      this._currentSkyViewSunAltitude = sunAltitude;
      device.pushDeviceStates();
      device.setFramebuffer(this._skyViewFramebuffer);
      device.setProgram(this._programSkyViewLut);
      device.setBindGroup(0, this._bindgroupSkyViewLut);
      this._bindgroupSkyViewLut.setValue('flip', device.type === 'webgpu' ? 1 : 0);
      this._bindgroupSkyViewLut.setValue('sunAltitude', this._currentSkyViewSunAltitude);
      this._bindgroupSkyViewLut.setTexture('tLut', tLut);
      this._bindgroupSkyViewLut.setTexture('msLut', msLut);
      this.drawQuad(device);
      device.popDeviceStates();
    }
    return this._skyViewFramebuffer.getColorAttachments()[0];
  }
  static getTransmittanceLut() {
    const device = getDevice();
    if (!this._transmittanceLut) {
      this.prepare(device);
      const format: TextureFormat =
        device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer &&
        device.getDeviceCaps().textureCaps.supportLinearHalfFloatTexture
          ? 'rgba16f'
          : 'rgba8unorm';
      this._transmittanceLut = device.createTexture2D(
        format,
        this._transmittanceLutWidth,
        this._transmittanceLutHeight,
        {
          samplerOptions: { mipFilter: 'none' }
        }
      );
      this._transmittanceLut.name = 'TransmittanceLUT';
      const tempFramebuffer = device.createFrameBuffer([this._transmittanceLut], null);
      device.pushDeviceStates();
      device.setFramebuffer(tempFramebuffer);
      device.setProgram(this._programTransmittanceLut);
      device.setBindGroup(0, this._bindgroupTransmittanceLut);
      this._bindgroupTransmittanceLut.setValue('flip', device.type === 'webgpu' ? 1 : 0);
      this.drawQuad(device);
      device.popDeviceStates();
      tempFramebuffer.dispose();
    }
    return this._transmittanceLut;
  }
  private static drawQuad(device: AbstractDevice) {
    const lastRenderState = device.getRenderStates();
    device.setRenderStates(this._renderStates);
    device.setVertexLayout(this._vertexLayout);
    device.draw('triangle-strip', 0, 4);
    device.setRenderStates(lastRenderState);
  }
  private static commonVertexShader(this: PBGlobalScope) {
    const pb = this.$builder;
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
  }
  private static commonFunctions(this: PBGlobalScope) {
    const pb = this.$builder;
    this.viewPos = pb.vec3(ScatteringLut._viewPos.x, ScatteringLut._viewPos.y, ScatteringLut._viewPos.z);
    pb.func('getMiePhase', [pb.float('cosTheta')], function () {
      this.$l.g = pb.float(0.8);
      this.$l.scale = pb.float(3 / (Math.PI * 8));
      this.$l.gg = pb.mul(this.g, this.g);
      this.$l.num = pb.mul(pb.sub(1, this.gg), pb.add(pb.mul(this.cosTheta, this.cosTheta), 1));
      this.$l.denom = pb.mul(
        pb.add(2, this.gg),
        pb.pow(pb.sub(pb.add(1, this.gg), pb.mul(this.g, this.cosTheta, 2)), 1.5)
      );
      this.$return(pb.div(pb.mul(this.scale, this.num), this.denom));
    });
    pb.func('getRayleighPhase', [pb.float('cosTheta')], function () {
      this.$l.k = pb.float(3 / (Math.PI * 16));
      this.$return(pb.mul(this.k, pb.add(1, pb.mul(this.cosTheta, this.cosTheta))));
    });
    pb.func('rayIntersectSphere', [pb.vec3('ro'), pb.vec3('rd'), pb.float('rad')], function () {
      this.$l.b = pb.dot(this.ro, this.rd);
      this.$l.c = pb.sub(pb.dot(this.ro, this.ro), pb.mul(this.rad, this.rad));
      this.$if(pb.and(pb.greaterThan(this.c, 0), pb.greaterThan(this.b, 0)), function () {
        this.$return(pb.float(-1));
      });
      this.$l.bb = pb.mul(this.b, this.b);
      this.$l.discr = pb.sub(this.bb, this.c);
      this.$if(pb.lessThan(this.discr, 0), function () {
        this.$return(pb.float(-1));
      });
      this.$if(pb.greaterThan(this.discr, this.bb), function () {
        this.$return(pb.sub(pb.sqrt(this.discr), this.b));
      });
      this.$return(pb.sub(pb.neg(pb.sqrt(this.discr)), this.b));
    });
    pb.func(
      'getScatteringValues',
      [
        pb.vec3('pos'),
        pb.vec3('rayleighScattering').out(),
        pb.float('mieScattering').out(),
        pb.vec3('extinction').out()
      ],
      function () {
        this.$l.altitudeKM = pb.mul(pb.sub(pb.length(this.pos), ScatteringLut._groundRadiusMM), 1000);
        this.$l.rayleighDensity = pb.exp(pb.div(this.altitudeKM, -8));
        this.$l.mieDensity = pb.exp(pb.div(this.altitudeKM, -1.2));
        this.rayleighScattering = pb.mul(
          pb.vec3(...ScatteringLut._rayleighScatteringBase),
          this.rayleighDensity
        );
        this.$l.rayleighAbsorption = pb.mul(ScatteringLut._rayleighAbsorptionBase, this.rayleighDensity);
        this.mieScattering = pb.mul(ScatteringLut._mieScatteringBase, this.mieDensity);
        this.$l.mieAbsorption = pb.mul(ScatteringLut._mieAbsorptionBase, this.mieDensity);
        this.$l.ozoneAbsorption = pb.mul(
          pb.vec3(...ScatteringLut._ozoneAbsorptionBase),
          pb.max(0, pb.sub(1, pb.div(pb.abs(pb.sub(this.altitudeKM, 25)), 15)))
        );
        this.extinction = pb.add(
          this.rayleighScattering,
          pb.vec3(this.rayleighAbsorption),
          pb.vec3(this.mieScattering),
          pb.vec3(this.mieAbsorption),
          this.ozoneAbsorption
        );
      }
    );
  }
  private static prepare(device: AbstractDevice) {
    const that = this;
    if (!this._vertexLayout) {
      this._vertexLayout = device.createVertexLayout({
        vertexBuffers: [
          {
            buffer: device.createVertexBuffer(
              'position_f32x2',
              new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
            )
          }
        ]
      });
    }
    if (!this._renderStates) {
      this._renderStates = device.createRenderStateSet();
      this._renderStates.useRasterizerState().setCullMode('none');
      this._renderStates.useDepthState().enableTest(false).enableWrite(false);
    }
    if (!this._programAerialPerspectiveLut) {
      this._programAerialPerspectiveLut = device.buildRenderProgram({
        vertex(_pb) {
          that.commonVertexShader.call(this);
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.sunAltitude = pb.float().uniform(0);
          this.tLut = pb.tex2D().uniform(0);
          this.msLut = pb.tex2D().uniform(0);
          this.maxDistance = pb.float().uniform(0);
          that.commonFunctions.call(this);
          pb.func('getValFromTLUT', [pb.vec3('pos'), pb.vec3('sunDir')], function () {
            this.$l.height = pb.length(this.pos);
            this.$l.up = pb.div(this.pos, this.height);
            this.$l.sunCosZenithAngle = pb.dot(this.sunDir, this.up);
            this.$l.uv = pb.vec2(
              pb.clamp(pb.add(0.5, pb.mul(this.sunCosZenithAngle, 0.5)), 0, 1),
              pb.max(
                0,
                pb.min(
                  1,
                  pb.div(
                    pb.sub(this.height, that._groundRadiusMM),
                    pb.sub(that._atmosphereRadiusMM, that._groundRadiusMM)
                  )
                )
              )
            );
            this.$return(pb.textureSampleLevel(this.tLut, this.uv, 0).rgb);
          });
          pb.func('getValFromMSLUT', [pb.vec3('pos'), pb.vec3('sunDir')], function () {
            this.$l.height = pb.length(this.pos);
            this.$l.up = pb.div(this.pos, this.height);
            this.$l.sunCosZenithAngle = pb.dot(this.sunDir, this.up);
            this.$l.uv = pb.vec2(
              pb.clamp(pb.add(0.5, pb.mul(this.sunCosZenithAngle, 0.5)), 0, 1),
              pb.max(
                0,
                pb.min(
                  1,
                  pb.div(
                    pb.sub(this.height, that._groundRadiusMM),
                    pb.sub(that._atmosphereRadiusMM, that._groundRadiusMM)
                  )
                )
              )
            );
            this.$return(pb.textureSampleLevel(this.msLut, this.uv, 0).rgb);
          });
          pb.func(
            'raymarchScattering',
            [pb.vec3('pos'), pb.vec3('rayDir'), pb.vec3('sunDir'), pb.float('tMax')],
            function () {
              this.$l.cosTheta = pb.dot(this.rayDir, this.sunDir);
              this.$l.miePhaseValue = this.getMiePhase(this.cosTheta);
              this.$l.rayleighPhaseValue = this.getRayleighPhase(pb.neg(this.cosTheta));
              this.$l.lum = pb.vec3(0);
              this.$l.transmittance = pb.vec3(1);
              this.$l.t = pb.float(0);
              this.$for(pb.int('i'), 0, that._scatteringSteps, function () {
                this.$l.newT = pb.mul(
                  pb.div(pb.add(pb.float(this.i), 0.3), that._scatteringSteps),
                  this.tMax
                );
                this.$l.dt = pb.sub(this.newT, this.t);
                this.t = this.newT;
                this.$l.newPos = pb.add(this.pos, pb.mul(this.rayDir, this.t));
                this.$l.rayleighScattering = pb.vec3();
                this.$l.extinction = pb.vec3();
                this.$l.mieScattering = pb.float();
                this.getScatteringValues(
                  this.newPos,
                  this.rayleighScattering,
                  this.mieScattering,
                  this.extinction
                );
                this.$l.sampleTransmittance = pb.exp(pb.mul(pb.neg(this.dt), this.extinction));
                this.$l.sunTransmittance = this.getValFromTLUT(this.newPos, this.sunDir);
                this.$l.psiMS = this.getValFromMSLUT(this.newPos, this.sunDir);
                this.$l.rayleighInScattering = pb.mul(
                  this.rayleighScattering,
                  pb.add(pb.mul(this.sunTransmittance, this.rayleighPhaseValue), this.psiMS)
                );
                this.$l.mieInScattering = pb.mul(
                  pb.add(pb.mul(this.sunTransmittance, this.miePhaseValue), this.psiMS),
                  this.mieScattering
                );
                this.$l.inScattering = pb.add(this.rayleighInScattering, this.mieInScattering);
                this.$l.scatteringIntegral = pb.div(
                  pb.sub(this.inScattering, pb.mul(this.inScattering, this.sampleTransmittance)),
                  this.extinction
                );
                this.lum = pb.add(this.lum, pb.mul(this.scatteringIntegral, this.transmittance));
                this.transmittance = pb.mul(this.transmittance, this.sampleTransmittance);
              });
              this.$return(this.lum);
            }
          );
          pb.main(function () {
            this.$l.slice = pb.clamp(
              pb.floor(pb.div(this.$inputs.uv.x, 1 / ScatteringLut._aerialPerspectiveSliceZ)),
              0,
              pb.sub(ScatteringLut._aerialPerspectiveSliceZ, 1)
            );
            this.$l.sliceU = pb.clamp(
              pb.div(
                pb.sub(this.$inputs.uv.x, pb.mul(this.slice, 1 / ScatteringLut._aerialPerspectiveSliceZ)),
                1 / ScatteringLut._aerialPerspectiveSliceZ
              ),
              0,
              1
            );
            this.$l.horizonAngle = pb.sub(pb.mul(this.sliceU, Math.PI * 2), Math.PI);
            this.$l.zenithAngle = pb.mul(this.$inputs.uv.y, Math.PI / 2);
            /*
            this.$l.rayDir = pb.vec3(pb.mul(this.cosAltitude, pb.sin(this.azimuthAngle)), pb.sin(this.altitudeAngle), pb.mul(pb.neg(this.cosAltitude), pb.cos(this.azimuthAngle)));
            this.$l.sunDir = pb.vec3(0, pb.sin(this.sunAltitude), pb.neg(pb.cos(this.sunAltitude)));
            */
            this.$l.rayDir = pb.vec3(
              pb.mul(pb.cos(this.zenithAngle), pb.sin(this.horizonAngle)),
              pb.sin(this.zenithAngle),
              pb.mul(pb.neg(pb.cos(this.zenithAngle)), pb.cos(this.horizonAngle))
            );
            this.$l.atmoDist = this.rayIntersectSphere(
              this.viewPos,
              this.rayDir,
              ScatteringLut._atmosphereRadiusMM
            );
            this.$l.groundDist = this.rayIntersectSphere(
              this.viewPos,
              this.rayDir,
              ScatteringLut._groundRadiusMM
            );
            this.$l.tMax = pb.float();
            this.$if(pb.lessThan(this.groundDist, 0), function () {
              this.tMax = this.atmoDist;
            }).$else(function () {
              this.tMax = this.groundDist;
            });
            this.tMax = this.atmoDist;
            this.$l.maxDistanceMM = pb.mul(this.maxDistance, 1e-6);
            this.$l.sliceDist = pb.mul(
              this.maxDistanceMM,
              pb.div(this.slice, ScatteringLut._aerialPerspectiveSliceZ)
            );
            this.tMax = pb.min(this.tMax, this.sliceDist);
            this.$l.sunDir = pb.vec3(0, pb.sin(this.sunAltitude), pb.neg(pb.cos(this.sunAltitude)));
            this.$l.lum = this.raymarchScattering(this.viewPos, this.rayDir, this.sunDir, this.tMax);
            const heightKM = (that._viewPos.y - that._groundRadiusMM) * 1000;
            const rayleighDensity = Math.exp(-heightKM / 8);
            const mieDensity = Math.exp(-heightKM / 1.2);
            this.$l.extinction = pb.vec3(
              -(
                (that._rayleighScatteringBase[0] + that._rayleighAbsorptionBase) * rayleighDensity +
                (that._mieScatteringBase + that._mieAbsorptionBase) * mieDensity
              ),
              -(
                (that._rayleighScatteringBase[1] + that._rayleighAbsorptionBase) * rayleighDensity +
                (that._mieScatteringBase + that._mieAbsorptionBase) * mieDensity
              ),
              -(
                (that._rayleighScatteringBase[2] + that._rayleighAbsorptionBase) * rayleighDensity +
                (that._mieScatteringBase + that._mieAbsorptionBase) * mieDensity
              )
            );
            this.$l.t = pb.exp(pb.mul(this.extinction, this.tMax));
            this.$outputs.outColor = pb.vec4(this.lum, pb.dot(this.t, pb.vec3(1 / 3, 1 / 3, 1 / 3)));
          });
        }
      });
      this._bindgroupAerialPerspectiveLut = device.createBindGroup(
        this._programAerialPerspectiveLut.bindGroupLayouts[0]
      );
    }
    if (!this._programSkyViewLut) {
      this._programSkyViewLut = device.buildRenderProgram({
        vertex(_pb) {
          that.commonVertexShader.call(this);
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.sunAltitude = pb.float().uniform(0);
          this.tLut = pb.tex2D().uniform(0);
          this.msLut = pb.tex2D().uniform(0);
          that.commonFunctions.call(this);
          pb.func('getValFromTLUT', [pb.vec3('pos'), pb.vec3('sunDir')], function () {
            this.$l.height = pb.length(this.pos);
            this.$l.up = pb.div(this.pos, this.height);
            this.$l.sunCosZenithAngle = pb.dot(this.sunDir, this.up);
            this.$l.uv = pb.vec2(
              pb.clamp(pb.add(0.5, pb.mul(this.sunCosZenithAngle, 0.5)), 0, 1),
              pb.max(
                0,
                pb.min(
                  1,
                  pb.div(
                    pb.sub(this.height, that._groundRadiusMM),
                    pb.sub(that._atmosphereRadiusMM, that._groundRadiusMM)
                  )
                )
              )
            );
            this.$return(pb.textureSampleLevel(this.tLut, this.uv, 0).rgb);
          });
          pb.func('getValFromMSLUT', [pb.vec3('pos'), pb.vec3('sunDir')], function () {
            this.$l.height = pb.length(this.pos);
            this.$l.up = pb.div(this.pos, this.height);
            this.$l.sunCosZenithAngle = pb.dot(this.sunDir, this.up);
            this.$l.uv = pb.vec2(
              pb.clamp(pb.add(0.5, pb.mul(this.sunCosZenithAngle, 0.5)), 0, 1),
              pb.max(
                0,
                pb.min(
                  1,
                  pb.div(
                    pb.sub(this.height, that._groundRadiusMM),
                    pb.sub(that._atmosphereRadiusMM, that._groundRadiusMM)
                  )
                )
              )
            );
            this.$return(pb.textureSampleLevel(this.msLut, this.uv, 0).rgb);
          });
          pb.func(
            'raymarchScattering',
            [pb.vec3('pos'), pb.vec3('rayDir'), pb.vec3('sunDir'), pb.float('tMax')],
            function () {
              this.$l.cosTheta = pb.dot(this.rayDir, this.sunDir);
              this.$l.miePhaseValue = this.getMiePhase(this.cosTheta);
              this.$l.rayleighPhaseValue = this.getRayleighPhase(pb.neg(this.cosTheta));
              this.$l.lum = pb.vec3(0);
              this.$l.transmittance = pb.vec3(1);
              this.$l.t = pb.float(0);
              this.$for(pb.int('i'), 0, that._scatteringSteps, function () {
                this.$l.newT = pb.mul(
                  pb.div(pb.add(pb.float(this.i), 0.3), that._scatteringSteps),
                  this.tMax
                );
                this.$l.dt = pb.sub(this.newT, this.t);
                this.t = this.newT;
                this.$l.newPos = pb.add(this.pos, pb.mul(this.rayDir, this.t));
                this.$l.rayleighScattering = pb.vec3();
                this.$l.extinction = pb.vec3();
                this.$l.mieScattering = pb.float();
                this.getScatteringValues(
                  this.newPos,
                  this.rayleighScattering,
                  this.mieScattering,
                  this.extinction
                );
                this.$l.sampleTransmittance = pb.exp(pb.mul(pb.neg(this.dt), this.extinction));
                this.$l.sunTransmittance = this.getValFromTLUT(this.newPos, this.sunDir);
                this.$l.psiMS = this.getValFromMSLUT(this.newPos, this.sunDir);
                this.$l.rayleighInScattering = pb.mul(
                  this.rayleighScattering,
                  pb.add(pb.mul(this.sunTransmittance, this.rayleighPhaseValue), this.psiMS)
                );
                this.$l.mieInScattering = pb.mul(
                  pb.add(pb.mul(this.sunTransmittance, this.miePhaseValue), this.psiMS),
                  this.mieScattering
                );
                this.$l.inScattering = pb.add(this.rayleighInScattering, this.mieInScattering);
                this.$l.scatteringIntegral = pb.div(
                  pb.sub(this.inScattering, pb.mul(this.inScattering, this.sampleTransmittance)),
                  this.extinction
                );
                this.lum = pb.add(this.lum, pb.mul(this.scatteringIntegral, this.transmittance));
                this.transmittance = pb.mul(this.transmittance, this.sampleTransmittance);
              });
              this.$return(this.lum);
            }
          );
          pb.main(function () {
            this.$l.azimuthAngle = pb.mul(pb.sub(this.$inputs.uv.x, 0.5), 2 * Math.PI);
            this.$l.adjV = pb.float();
            this.$if(pb.lessThan(this.$inputs.uv.y, 0.5), function () {
              this.$l.coord = pb.sub(1, pb.mul(this.$inputs.uv.y, 2));
              this.adjV = pb.neg(pb.mul(this.coord, this.coord));
            }).$else(function () {
              this.$l.coord = pb.sub(pb.mul(this.$inputs.uv.y, 2), 1);
              this.adjV = pb.mul(this.coord, this.coord);
            });
            this.$l.height = pb.length(this.viewPos);
            this.$l.up = pb.div(this.viewPos, this.height);
            this.$l.horizonAngle = pb.sub(
              pb.acos(
                pb.clamp(
                  pb.div(
                    pb.sqrt(
                      pb.sub(
                        pb.mul(this.height, this.height),
                        pb.mul(that._groundRadiusMM, that._groundRadiusMM)
                      )
                    ),
                    this.height
                  ),
                  -1,
                  1
                )
              ),
              Math.PI * 0.5
            );
            this.$l.altitudeAngle = pb.sub(pb.mul(this.adjV, Math.PI * 0.5), this.horizonAngle);
            this.$l.cosAltitude = pb.cos(this.altitudeAngle);
            this.$l.rayDir = pb.vec3(
              pb.mul(this.cosAltitude, pb.sin(this.azimuthAngle)),
              pb.sin(this.altitudeAngle),
              pb.mul(pb.neg(this.cosAltitude), pb.cos(this.azimuthAngle))
            );
            this.$l.sunDir = pb.vec3(0, pb.sin(this.sunAltitude), pb.neg(pb.cos(this.sunAltitude)));
            this.$l.atmoDist = this.rayIntersectSphere(this.viewPos, this.rayDir, that._atmosphereRadiusMM);
            this.$l.groundDist = this.rayIntersectSphere(this.viewPos, this.rayDir, that._groundRadiusMM);
            this.$l.tMax = pb.float();
            this.$if(pb.lessThan(this.groundDist, 0), function () {
              this.tMax = this.atmoDist;
            }).$else(function () {
              this.tMax = this.groundDist;
            });
            this.$l.lum = this.raymarchScattering(this.viewPos, this.rayDir, this.sunDir, this.tMax);
            this.$outputs.outColor = pb.vec4(this.lum, 1);
          });
        }
      });
      this._bindgroupSkyViewLut = device.createBindGroup(this._programSkyViewLut.bindGroupLayouts[0]);
    }
    if (!this._programMultiScatteringLut) {
      this._programMultiScatteringLut = device.buildRenderProgram({
        vertex(_pb) {
          that.commonVertexShader.call(this);
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.tLut = pb.tex2D().uniform(0);
          that.commonFunctions.call(this);
          pb.func('getValFromTLUT', [pb.vec3('pos'), pb.vec3('sunDir')], function () {
            this.$l.height = pb.length(this.pos);
            this.$l.up = pb.div(this.pos, this.height);
            this.$l.sunCosZenithAngle = pb.dot(this.sunDir, this.up);
            this.$l.uv = pb.vec2(
              pb.clamp(pb.add(0.5, pb.mul(this.sunCosZenithAngle, 0.5)), 0, 1),
              pb.max(
                0,
                pb.min(
                  1,
                  pb.div(
                    pb.sub(this.height, that._groundRadiusMM),
                    pb.sub(that._atmosphereRadiusMM, that._groundRadiusMM)
                  )
                )
              )
            );
            this.$return(pb.textureSampleLevel(this.tLut, this.uv, 0).rgb);
          });
          pb.func('getSphericalDir', [pb.float('theta'), pb.float('phi')], function () {
            this.$l.cosPhi = pb.cos(this.phi);
            this.$l.sinPhi = pb.sin(this.phi);
            this.$l.cosTheta = pb.cos(this.theta);
            this.$l.sinTheta = pb.sin(this.theta);
            this.$return(
              pb.vec3(pb.mul(this.sinPhi, this.sinTheta), this.cosPhi, pb.mul(this.sinPhi, this.cosTheta))
            );
          });
          pb.func(
            'getMultiScatteringValues',
            [pb.vec3('pos'), pb.vec3('sunDir'), pb.vec3('lumTotal').out(), pb.vec3('fms').out()],
            function () {
              this.lumTotal = pb.vec3(0);
              this.fms = pb.vec3(0);
              this.$l.invSamples = pb.div(pb.float(1), pb.mul(that._sqrtSamples, that._sqrtSamples));
              this.$for(pb.int('i'), 0, that._sqrtSamples, function () {
                this.$for(pb.int('j'), 0, that._sqrtSamples, function () {
                  this.$l.theta = pb.div(pb.mul(pb.add(pb.float(this.i), 0.5), Math.PI), that._sqrtSamples);
                  this.$l.c = pb.sub(1, pb.div(pb.mul(pb.add(pb.float(this.j), 0.5), 2), that._sqrtSamples));
                  this.$l.phi = pb.acos(pb.clamp(this.c, -1, 1));
                  this.$l.rayDir = this.getSphericalDir(this.theta, this.phi);
                  this.$l.atmoDist = this.rayIntersectSphere(this.pos, this.rayDir, that._atmosphereRadiusMM);
                  this.$l.groundDist = this.rayIntersectSphere(this.pos, this.rayDir, that._groundRadiusMM);
                  this.$l.tMax = this.atmoDist;
                  this.$if(pb.greaterThan(this.groundDist, 0), function () {
                    this.tMax = this.groundDist;
                  });
                  this.$l.cosTheta = pb.dot(this.rayDir, this.sunDir);
                  this.$l.miePhaseValue = this.getMiePhase(this.cosTheta);
                  this.$l.rayleighPhaseValue = this.getRayleighPhase(pb.neg(this.cosTheta));
                  this.$l.lum = pb.vec3(0);
                  this.$l.lumFactor = pb.vec3(0);
                  this.$l.transmittance = pb.vec3(1);
                  this.$l.t = pb.float(0);
                  this.$for(pb.int('stepI'), 0, that._multiScatteringSteps, function () {
                    this.$l.newT = pb.mul(
                      pb.div(pb.add(pb.float(this.stepI), 0.3), that._multiScatteringSteps),
                      this.tMax
                    );
                    this.$l.dt = pb.sub(this.newT, this.t);
                    this.t = this.newT;
                    this.$l.newPos = pb.add(this.pos, pb.mul(this.rayDir, this.t));
                    this.$l.rayleighScattering = pb.vec3();
                    this.$l.extinction = pb.vec3();
                    this.$l.mieScattering = pb.float();
                    this.getScatteringValues(
                      this.newPos,
                      this.rayleighScattering,
                      this.mieScattering,
                      this.extinction
                    );
                    this.$l.sampleTransmittance = pb.exp(pb.mul(pb.neg(this.dt), this.extinction));
                    this.$l.scatteringNoPhase = pb.add(this.rayleighScattering, pb.vec3(this.mieScattering));
                    this.$l.scatteringF = pb.div(
                      pb.sub(
                        this.scatteringNoPhase,
                        pb.mul(this.scatteringNoPhase, this.sampleTransmittance)
                      ),
                      this.extinction
                    );
                    this.lumFactor = pb.add(this.lumFactor, pb.mul(this.transmittance, this.scatteringF));
                    this.$l.sunTransmittance = this.getValFromTLUT(this.newPos, this.sunDir);
                    this.$l.rayleighInscattering = pb.mul(this.rayleighScattering, this.rayleighPhaseValue);
                    this.$l.mieInscattering = pb.mul(this.mieScattering, this.miePhaseValue);
                    this.$l.inscattering = pb.mul(
                      pb.add(this.rayleighInscattering, pb.vec3(this.mieInscattering)),
                      this.sunTransmittance
                    );
                    this.$l.scatteringIntegral = pb.div(
                      pb.sub(this.inscattering, pb.mul(this.inscattering, this.sampleTransmittance)),
                      this.extinction
                    );
                    this.lum = pb.add(this.lum, pb.mul(this.scatteringIntegral, this.transmittance));
                    this.transmittance = pb.mul(this.transmittance, this.sampleTransmittance);
                  });
                  this.$if(pb.greaterThan(this.groundDist, 0), function () {
                    this.$l.hitPos = pb.add(this.pos, pb.mul(this.rayDir, this.groundDist));
                    this.$if(pb.greaterThan(pb.dot(this.pos, this.sunDir), 0), function () {
                      this.hitPos = pb.mul(pb.normalize(this.hitPos), that._groundRadiusMM);
                      this.lum = pb.add(
                        this.lum,
                        pb.mul(
                          this.transmittance,
                          pb.vec3(that._groundAlbedo),
                          this.getValFromTLUT(this.hitPos, this.sunDir)
                        )
                      );
                    });
                  });
                  this.fms = pb.add(this.fms, pb.mul(this.lumFactor, this.invSamples));
                  this.lumTotal = pb.add(this.lumTotal, pb.mul(this.lum, this.invSamples));
                });
              });
            }
          );
          pb.main(function () {
            this.$l.sunCosTheta = pb.sub(pb.mul(this.$inputs.uv.x, 2), 1);
            this.$l.sunTheta = pb.acos(pb.clamp(this.sunCosTheta, -1, 1));
            this.$l.height = pb.mix(that._groundRadiusMM, that._atmosphereRadiusMM, this.$inputs.uv.y);
            this.$l.pos = pb.vec3(0, this.height, 0);
            this.$l.sunDir = pb.normalize(pb.vec3(0, this.sunCosTheta, pb.neg(pb.sin(this.sunTheta))));
            this.$l.lum = pb.vec3();
            this.$l.fms = pb.vec3();
            this.getMultiScatteringValues(this.pos, this.sunDir, this.lum, this.fms);
            this.$l.psi = pb.div(this.lum, pb.sub(1, this.fms));
            this.$outputs.outColor = pb.vec4(this.psi, 1);
          });
        }
      });
    }
    this._bindgroupMultiScatteringLut = device.createBindGroup(
      this._programMultiScatteringLut.bindGroupLayouts[0]
    );
    if (!this._programTransmittanceLut) {
      this._programTransmittanceLut = device.buildRenderProgram({
        vertex(_pb) {
          that.commonVertexShader.call(this);
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          that.commonFunctions.call(this);
          pb.func('getSunTransmittance', [pb.vec3('pos'), pb.vec3('sunDir')], function () {
            this.$if(
              pb.greaterThan(this.rayIntersectSphere(this.pos, this.sunDir, that._groundRadiusMM), 0),
              function () {
                this.$return(pb.vec3(0));
              }
            );
            this.$l.atmoDist = this.rayIntersectSphere(this.pos, this.sunDir, that._atmosphereRadiusMM);
            this.$l.t = pb.float(0);
            this.$l.transmittance = pb.vec3(1);
            this.$for(pb.int('i'), 0, that._sunTransmittanceSteps, function () {
              this.$l.newT = pb.mul(
                pb.div(pb.add(pb.float(this.i), 0.3), that._sunTransmittanceSteps),
                this.atmoDist
              );
              this.$l.dt = pb.sub(this.newT, this.t);
              this.t = this.newT;
              this.$l.newPos = pb.add(this.pos, pb.mul(this.sunDir, this.t));
              this.$l.rayleighScattering = pb.vec3();
              this.$l.extinction = pb.vec3();
              this.$l.mieScattering = pb.float();
              this.getScatteringValues(
                this.newPos,
                this.rayleighScattering,
                this.mieScattering,
                this.extinction
              );
              this.transmittance = pb.mul(
                this.transmittance,
                pb.exp(pb.mul(this.extinction, pb.neg(this.dt)))
              );
            });
            this.$return(this.transmittance);
          });
          pb.main(function () {
            this.$l.sunCosTheta = pb.sub(pb.mul(this.$inputs.uv.x, 2), 1);
            this.$l.sunTheta = pb.acos(pb.clamp(this.sunCosTheta, -1, 1));
            this.$l.height = pb.mix(that._groundRadiusMM, that._atmosphereRadiusMM, this.$inputs.uv.y);
            this.$l.pos = pb.vec3(0, this.height, 0);
            this.$l.sunDir = pb.normalize(pb.vec3(0, this.sunCosTheta, pb.neg(pb.sin(this.sunTheta))));
            this.$outputs.outColor = pb.vec4(this.getSunTransmittance(this.pos, this.sunDir), 1);
          });
        }
      });
    }
    this._bindgroupTransmittanceLut = device.createBindGroup(
      this._programTransmittanceLut.bindGroupLayouts[0]
    );
  }
}
