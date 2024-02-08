import { Application } from '../app';
import { decodeNormalizedFloatFromRGBA, linearToGamma } from '../shaders/misc';
import { ShaderFramework, smoothNoise3D } from '../shaders';
import { CubeFace, Matrix4x4, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import type { Primitive } from './primitive';
import { BoxShape } from '../shapes';
import { ScatteringLut } from './scatteringlut';
import { Camera } from '../camera/camera';
import { prefilterCubemap } from '../utility';
import type { DirectionalLight } from '../scene';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  RenderStateSet,
  TextureCube,
  TextureFormat,
  TextureSampler,
  VertexLayout
} from '@zephyr3d/device';
import type { DrawContext } from './drawable';

/**
 * Type of sky
 *
 * @remarks
 * none - Sky will not be rendered
 * color - Sky will be rendered with a solid color.
 * skybox - Sky will be rendered as box using a preloaded cube texture.
 * scatter - Render dynamic sky with atmospheric scattering.
 *
 * @public
 */
export type SkyType = 'color' | 'skybox' | 'scatter' | 'scatter-nocloud' | 'none';

/**
 * Type of fog
 * @public
 */
export type FogType = 'linear' | 'exp' | 'exp2' | 'scatter' | 'none';

const fogTypeMap: Record<FogType, number> = {
  linear: ShaderFramework.FOG_TYPE_LINEAR,
  exp: ShaderFramework.FOG_TYPE_EXP,
  exp2: ShaderFramework.FOG_TYPE_EXP2,
  scatter: ShaderFramework.FOG_TYPE_SCATTER,
  none: ShaderFramework.FOG_TYPE_NONE
};

const defaultSkyWorldMatrix = Matrix4x4.identity();

/**
 * The sky renderer
 * @public
 */
export class SkyRenderer {
  private static _defaultSunDir = Vector3.one().inplaceNormalize();
  private _skyType: SkyType;
  private _skyColor: Vector4;
  private _skyboxTexture: TextureCube;
  private _updateRadianceMaps: boolean;
  private _radianceMapDirty: boolean;
  private _scatterSkyboxFramebuffer: FrameBuffer;
  private _scatterSkyboxTextureWidth: number;
  private _radianceMap: TextureCube;
  private _radianceMapWidth: number;
  private _irradianceMap: TextureCube;
  private _irradianceMapWidth: number;
  private _fogType: FogType;
  private _fogColor: Vector4;
  private _fogParams: Vector4;
  private _cloudy: number;
  private _cloudIntensity: number;
  private _wind: Vector2;
  private _nearestSampler: TextureSampler;
  private _programSky: Partial<Record<SkyType, GPUProgram>>;
  private _bindgroupSky: Partial<Record<SkyType, BindGroup>>;
  private _programFog: GPUProgram;
  private _bindgroupFog: BindGroup;
  private _programFogScatter: GPUProgram;
  private _bindgroupFogScatter: BindGroup;
  private _vertexLayout: VertexLayout;
  private _primitiveSky: Primitive;
  private _skyWorldMatrix: Matrix4x4;
  private _renderStatesSky: RenderStateSet;
  private _renderStatesSkyNoDepthTest: RenderStateSet;
  private _renderStatesFog: RenderStateSet;
  private _renderStatesFogScatter: RenderStateSet;
  private _lastSunDir: Vector3;
  /**
   * Creates an instance of SkyRenderer
   */
  constructor() {
    this._skyType = 'scatter';
    this._updateRadianceMaps = true;
    this._radianceMapDirty = true;
    this._skyColor = Vector4.zero();
    this._skyboxTexture = null;
    this._scatterSkyboxFramebuffer = null;
    this._scatterSkyboxTextureWidth = 256;
    this._radianceMap = null;
    this._radianceMapWidth = 128;
    this._irradianceMap = null;
    this._irradianceMapWidth = 64;
    this._fogType = 'none';
    this._fogColor = Vector4.one();
    this._fogParams = new Vector4(1, 100, 50, 0.002);
    this._cloudy = 0.6;
    this._cloudIntensity = 40;
    this._wind = Vector2.zero();
    this._nearestSampler = null;
    this._programSky = {};
    this._bindgroupSky = {};
    this._programFog = null;
    this._bindgroupFog = null;
    this._programFogScatter = null;
    this._bindgroupFogScatter = null;
    this._vertexLayout = null;
    this._primitiveSky = null;
    this._renderStatesSky = null;
    this._renderStatesSkyNoDepthTest = null;
    this._renderStatesFog = null;
    this._renderStatesFogScatter = null;
    this._skyWorldMatrix = defaultSkyWorldMatrix;
    this._lastSunDir = Vector3.zero();
  }
  /** @internal */
  getHash(ctx: DrawContext): string {
    return ctx.applyFog ? (this._fogType === 'none' ? '0' : this.drawScatteredFog(ctx) ? '1' : '2') : '';
  }
  /** Which type of the sky should be rendered */
  get skyType(): SkyType {
    return this._skyType;
  }
  set skyType(val: SkyType) {
    if (val !== this._skyType) {
      this._skyType = val;
      this.invalidateIBLMaps();
    }
  }
  /**
   * Wether the IBL maps should be updated automatically.
   *
   * @remarks
   * If use use the sky for image-based lighting, the value shoud be set to true. default is false
   *
   */
  get autoUpdateIBLMaps(): boolean {
    return this._updateRadianceMaps;
  }
  set autoUpdateIBLMaps(val: boolean) {
    if (this._updateRadianceMaps !== !!val) {
      this._updateRadianceMaps = !!val;
      if (this._updateRadianceMaps) {
        this.invalidateIBLMaps();
      }
    }
  }
  /**
   * The solid sky color
   */
  get skyColor(): Vector4 {
    return this._skyColor;
  }
  set skyColor(val: Vector4) {
    if (!val.equalsTo(this._skyColor)) {
      this._skyColor.set(val);
      this.invalidateIBLMaps();
    }
  }
  /**
   * Light density of the sky.
   *
   * @remarks
   * This value controls how much cloud should be rendered when the sky type is scatter.
   * Typically, the value should be in the range of 0 to 1.
   */
  get cloudy(): number {
    return this._cloudy;
  }
  set cloudy(val: number) {
    if (val !== this._cloudy && this._skyType === 'scatter') {
      this._cloudy = val;
      this.invalidateIBLMaps();
    }
  }
  /**
   * Intensity of the sky color
   */
  get cloudIntensity(): number {
    return this._cloudIntensity;
  }
  set cloudIntensity(val: number) {
    if (val !== this._cloudIntensity && this._skyType === 'scatter') {
      this._cloudIntensity = val;
      this.invalidateIBLMaps();
    }
  }
  /**
   * Wind velocity
   *
   * @remarks
   * This value affects the movement of the cloud
   */
  get wind(): Vector2 {
    return this._wind;
  }
  set wind(val: Vector2) {
    this._wind.set(val);
  }
  /**
   * Radiance map of the sky.
   */
  get radianceMap(): TextureCube {
    if (!this._radianceMap) {
      this._radianceMap = Application.instance.device.createCubeTexture('rgba16f', this._radianceMapWidth);
      this._radianceMap.name = 'SkyRadianceMap';
    }
    return this._radianceMap;
  }
  /**
   * Irradiance map of the sky.
   */
  get irradianceMap(): TextureCube {
    if (!this._irradianceMap) {
      this._irradianceMap = Application.instance.device.createCubeTexture(
        'rgba16f',
        this._irradianceMapWidth,
        {
          samplerOptions: { mipFilter: 'none' }
        }
      );
      this._irradianceMap.name = 'SkyIrradianceMap';
    }
    return this._irradianceMap;
  }
  /**
   * Cube texture for skybox.
   */
  get skyboxTexture(): TextureCube {
    return this._skyboxTexture;
  }
  set skyboxTexture(tex: TextureCube) {
    if (tex !== this._skyboxTexture) {
      this._skyboxTexture = tex;
      if (this._skyType === 'skybox') {
        this.invalidateIBLMaps();
      }
    }
  }
  /** @internal */
  get skyWorldMatrix(): Matrix4x4 {
    return this._skyWorldMatrix;
  }
  set skyWorldMatrix(val: Matrix4x4) {
    val = val ?? defaultSkyWorldMatrix;
    if (val !== this._skyWorldMatrix) {
      this._skyWorldMatrix = val;
      this.invalidateIBLMaps();
    }
  }
  /** @internal */
  get mappedFogType(): number {
    return fogTypeMap[this._fogType];
  }
  /** Current fog type */
  get fogType(): FogType {
    return this._fogType;
  }
  set fogType(val: FogType) {
    this._fogType = val;
  }
  /** Start distance of linear fog */
  get fogStart(): number {
    return this._fogParams.x;
  }
  set fogStart(val: number) {
    this._fogParams.x = val;
  }
  /** End distance of linear fog */
  get fogEnd(): number {
    return this._fogParams.y;
  }
  set fogEnd(val: number) {
    this._fogParams.y = val;
  }
  /** Top distance of fog if fog type is not scatter */
  get fogTop(): number {
    return this._fogParams.z;
  }
  set fogTop(val: number) {
    this._fogParams.z = val;
  }
  /** Density of exp/exp2 fog */
  get fogDensity(): number {
    return this._fogParams.w;
  }
  set fogDensity(val: number) {
    this._fogParams.w = val;
  }
  /** The fog color if fog type is not scatter */
  get fogColor(): Vector4 {
    return this._fogColor;
  }
  set fogColor(val: Vector4) {
    this._fogColor.set(val);
  }
  /** @internal */
  get fogParams(): Vector4 {
    return this._fogParams;
  }
  set fogParams(val: Vector4) {
    this._fogParams.set(val);
  }
  /**
   * Force the radiance map and irradiance map to be regenerated.
   */
  invalidateIBLMaps() {
    this._radianceMapDirty = true;
  }
  /** @internal */
  drawScatteredFog(ctx: DrawContext) {
    return ctx.sunLight && this._fogType === 'scatter';
  }
  /** @internal */
  getAerialPerspectiveLUT(ctx: DrawContext) {
    if (this.drawScatteredFog(ctx)) {
      const sunDir = SkyRenderer._getSunDir(ctx.sunLight);
      const alpha = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, sunDir.y)));
      const farPlane = ctx.camera.getFarPlane() * ctx.scene.worldUnit;
      return ScatteringLut.getAerialPerspectiveLut(alpha, farPlane);
    } else {
      return null;
    }
  }
  /**
   * Regenerate the radiance map and irradiance map
   *
   * @param sunLight - The sun light
   */
  updateIBLMaps(sunDir: Vector3) {
    const device = Application.instance.device;
    let bakedSkyboxTexture: TextureCube = null;
    if (this._skyType === 'skybox' && this._skyboxTexture) {
      bakedSkyboxTexture = this._skyboxTexture;
    } else {
      if (!this._scatterSkyboxFramebuffer) {
        const texCaps = device.getDeviceCaps().textureCaps;
        const format: TextureFormat =
          texCaps.supportHalfFloatColorBuffer && texCaps.supportLinearHalfFloatTexture
            ? 'rgba16f'
            : texCaps.supportFloatColorBuffer && texCaps.supportLinearFloatTexture
            ? 'rgba32f'
            : 'rgba8unorm';
        const tex = device.createCubeTexture(format, this._scatterSkyboxTextureWidth);
        tex.name = 'BakedSkyboxTexture';
        this._scatterSkyboxFramebuffer = device.createFrameBuffer([tex], null);
        this._radianceMapDirty = true;
      }
      const camera = new Camera(null);
      camera.setPerspective(Math.PI / 2, 1, 1, 20);
      const saveRenderStates = device.getRenderStates();
      device.pushDeviceStates();
      device.setFramebuffer(this._scatterSkyboxFramebuffer);
      for (const face of [CubeFace.PX, CubeFace.NX, CubeFace.PY, CubeFace.NY, CubeFace.PZ, CubeFace.NZ]) {
        camera.lookAtCubeFace(face);
        this._scatterSkyboxFramebuffer.setColorAttachmentCubeFace(0, face);
        this._renderSky(camera, false, sunDir, true, false);
      }
      device.popDeviceStates();
      device.setRenderStates(saveRenderStates);
      bakedSkyboxTexture = this._scatterSkyboxFramebuffer.getColorAttachments()[0] as TextureCube;
    }
    prefilterCubemap(bakedSkyboxTexture, 'ggx', this.radianceMap);
    prefilterCubemap(bakedSkyboxTexture, 'lambertian', this.irradianceMap);
  }
  /** @internal */
  renderFog(ctx: DrawContext) {
    const camera = ctx.camera;
    const sceneDepthTexture = ctx.linearDepthTexture;
    const device = Application.instance.device;
    const savedRenderStates = device.getRenderStates();
    this._prepareSkyBox(device);
    const sunLight = ctx.sunLight;
    if (this._fogType === 'scatter' && !sunLight) {
      console.error('Cannot render scattering fog without sun light');
      return;
    }
    const fogProgram = this._fogType === 'scatter' ? this._programFogScatter : this._programFog;
    const renderStates = this._fogType === 'scatter' ? this._renderStatesFogScatter : this._renderStatesFog;
    if (fogProgram && sceneDepthTexture) {
      const bindgroup = this._fogType === 'scatter' ? this._bindgroupFogScatter : this._bindgroupFog;
      bindgroup.setTexture('depthTex', sceneDepthTexture, this._nearestSampler);
      bindgroup.setValue('rt', device.getFramebuffer() ? 1 : 0);
      bindgroup.setValue('invProjViewMatrix', camera.invViewProjectionMatrix);
      bindgroup.setValue('cameraNearFar', new Vector2(camera.getNearPlane(), camera.getFarPlane()));
      bindgroup.setValue('cameraPosition', camera.getWorldPosition());
      bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
      if (this._fogType === 'scatter') {
        const sunDir = sunLight ? sunLight.directionAndCutoff.xyz().scaleBy(-1) : SkyRenderer._defaultSunDir;
        const alpha = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, sunDir.y)));
        const farPlane = ctx.camera.getFarPlane() * ctx.scene.worldUnit;
        bindgroup.setTexture('apLut', ScatteringLut.getAerialPerspectiveLut(alpha, farPlane));
        bindgroup.setValue('sliceDist', farPlane / ScatteringLut.aerialPerspectiveSliceZ);
        bindgroup.setValue('sunDir', sunDir);
        bindgroup.setValue('worldScale', ctx.scene.worldUnit);
      } else {
        bindgroup.setValue('fogType', this.mappedFogType);
        bindgroup.setValue('fogColor', this._fogColor);
        bindgroup.setValue('fogParams', this._fogParams);
      }
      device.setProgram(fogProgram);
      device.setBindGroup(0, bindgroup);
      device.setVertexLayout(this._vertexLayout);
      device.setRenderStates(renderStates);
      device.draw('triangle-strip', 0, 4);
      device.setRenderStates(savedRenderStates);
    }
  }
  /** @internal */
  renderSky(ctx: DrawContext) {
    const sunDir = SkyRenderer._getSunDir(ctx.sunLight);
    if (!sunDir.equalsTo(this._lastSunDir)) {
      this._radianceMapDirty = true;
    }
    this._renderSky(ctx.camera, true, sunDir, false, this._skyType === 'scatter' && this._cloudy > 0);
    if (this._radianceMapDirty && ctx.env.light.type === 'ibl') {
      if (
        ctx.env.light.radianceMap &&
        (ctx.env.light.radianceMap === this._radianceMap ||
          ctx.env.light.irradianceMap === this._irradianceMap)
      ) {
        this._radianceMapDirty = false;
        this._lastSunDir.set(sunDir);
        this.updateIBLMaps(sunDir);
      }
    }
  }
  /** @internal */
  private _renderSky(
    camera: Camera,
    depthTest: boolean,
    sunDir: Vector3,
    drawGround: boolean,
    drawCloud: boolean
  ) {
    const device = Application.instance.device;
    const savedRenderStates = device.getRenderStates();
    this._prepareSkyBox(device);
    if (this._skyType === 'scatter') {
      this._drawScattering(camera, sunDir, depthTest, drawGround, drawCloud);
    } else if (this._skyType === 'skybox' && this._skyboxTexture) {
      this._drawSkybox(camera, depthTest);
    } else {
      this._drawSkyColor(camera, depthTest);
    }
    device.setRenderStates(savedRenderStates);
  }
  /** @internal */
  private _drawSkyColor(camera: Camera, depthTest: boolean) {
    const device = Application.instance.device;
    const bindgroup = this._bindgroupSky.color;
    bindgroup.setValue('viewProjMatrix', camera.viewProjectionMatrix);
    bindgroup.setValue('worldMatrix', this._skyWorldMatrix);
    bindgroup.setValue('cameraPos', camera.getWorldPosition());
    bindgroup.setValue('color', this._skyColor);
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    device.setProgram(this._programSky.color);
    device.setBindGroup(0, bindgroup);
    device.setRenderStates(depthTest ? this._renderStatesSky : this._renderStatesSkyNoDepthTest);
    this._primitiveSky.draw();
  }
  /** @internal */
  private _drawSkybox(camera: Camera, depthTest: boolean) {
    const device = Application.instance.device;
    const bindgroup = this._bindgroupSky.skybox;
    bindgroup.setTexture('skyCubeMap', this._skyboxTexture);
    bindgroup.setValue(
      'flip',
      device.getFramebuffer() && device.type === 'webgpu' ? new Vector4(1, -1, 1, 1) : new Vector4(1, 1, 1, 1)
    );
    bindgroup.setValue('viewProjMatrix', camera.viewProjectionMatrix);
    bindgroup.setValue('worldMatrix', this._skyWorldMatrix);
    bindgroup.setValue('cameraPos', camera.getWorldPosition());
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    device.setProgram(this._programSky.skybox);
    device.setBindGroup(0, bindgroup);
    device.setRenderStates(depthTest ? this._renderStatesSky : this._renderStatesSkyNoDepthTest);
    this._primitiveSky.draw();
  }
  /** @internal */
  private _drawScattering(
    camera: Camera,
    sunDir: Vector3,
    depthTest: boolean,
    drawGround: boolean,
    drawCloud: boolean
  ) {
    const device = Application.instance.device;
    const alpha = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, sunDir.y)));
    const tLut = ScatteringLut.getTransmittanceLut();
    const skyLut = ScatteringLut.getSkyViewLut(alpha);
    //const apLut = ScatteringLut.getAerialPerspectiveLut(alpha, 8000);
    const program = drawCloud ? this._programSky.scatter : this._programSky['scatter-nocloud'];
    const bindgroup = drawCloud ? this._bindgroupSky.scatter : this._bindgroupSky['scatter-nocloud'];
    bindgroup.setValue('sunDir', sunDir);
    bindgroup.setValue(
      'flip',
      device.getFramebuffer() && device.type === 'webgpu' ? new Vector4(1, -1, 1, 1) : new Vector4(1, 1, 1, 1)
    );
    bindgroup.setValue('viewProjMatrix', camera.viewProjectionMatrix);
    bindgroup.setValue('worldMatrix', this._skyWorldMatrix);
    bindgroup.setValue('cameraPos', camera.getWorldPosition());
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    bindgroup.setTexture('tLut', tLut);
    bindgroup.setTexture('skyLut', skyLut);
    if (drawCloud) {
      bindgroup.setValue('cloudy', this._cloudy);
      bindgroup.setValue('cloudIntensity', this._cloudIntensity);
      bindgroup.setValue('time', device.frameInfo.elapsedOverall * 0.001);
      bindgroup.setValue('velocity', this._wind);
    }
    bindgroup.setValue('drawGround', drawGround ? 1 : 0);
    device.setProgram(program);
    device.setBindGroup(0, bindgroup);
    device.setRenderStates(depthTest ? this._renderStatesSky : this._renderStatesSkyNoDepthTest);
    this._primitiveSky.draw();
  }
  /** @internal */
  private _prepareSkyBox(device: AbstractDevice) {
    if (!this._programFogScatter) {
      this._programFogScatter = device.buildRenderProgram({
        label: 'FogScatter',
        vertex(pb) {
          this.rt = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type === 'webgpu') {
              this.$if(pb.notEqual(this.rt, 0), function () {
                this.$builtins.position.y = pb.neg(this.$builtins.position.y);
              });
            }
          });
        },
        fragment(pb) {
          this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.invProjViewMatrix = pb.mat4().uniform(0);
          this.cameraNearFar = pb.vec2().uniform(0);
          this.cameraPosition = pb.vec3().uniform(0);
          this.apLut = pb.tex2D().uniform(0);
          this.worldScale = pb.float().uniform(0);
          this.sliceDist = pb.float().uniform(0);
          this.sunDir = pb.vec3().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.depthValue = pb.textureSample(this.depthTex, this.$inputs.uv);
            if (device.type === 'webgl') {
              this.$l.linearDepth = decodeNormalizedFloatFromRGBA(this, this.depthValue);
            } else {
              this.$l.linearDepth = this.depthValue.r;
            }
            this.$l.nonLinearDepth = pb.div(
              pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
              pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
            );
            //this.$l.clipSpacePos = pb.vec4(pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)), this.nonLinearDepth, 1);
            this.$l.clipSpacePos = pb.vec4(
              pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)),
              pb.sub(pb.mul(this.nonLinearDepth, 2), 1),
              1
            );
            this.$l.hPos = pb.mul(this.invProjViewMatrix, this.clipSpacePos);
            this.$l.hPos = pb.div(this.$l.hPos, this.$l.hPos.w);
            this.$l.viewDir = pb.sub(this.hPos.xyz, this.cameraPosition);
            // Assume object is above the sea level
            this.viewDir.y = pb.max(0, this.viewDir.y);
            this.$l.distance = pb.mul(pb.length(this.viewDir), this.worldScale);
            this.$l.slice0 = pb.floor(pb.div(this.distance, this.sliceDist));
            this.$l.slice1 = pb.add(this.slice0, 1);
            this.$l.factor = pb.sub(pb.div(this.distance, this.sliceDist), this.slice0);
            this.$l.viewNormal = pb.normalize(this.viewDir);
            this.$l.horizonAngle = pb.acos(
              pb.clamp(pb.dot(pb.normalize(this.sunDir.xz), pb.normalize(this.viewNormal.xz)), 0, 1)
            );
            this.$l.zenithAngle = pb.asin(this.viewNormal.y);
            this.$l.sliceU = pb.max(
              pb.div(this.horizonAngle, Math.PI * 2),
              0.5 / ScatteringLut.aerialPerspectiveSliceZ
            );
            this.$l.u0 = pb.div(pb.add(this.slice0, this.sliceU), ScatteringLut.aerialPerspectiveSliceZ);
            this.$l.u1 = pb.add(this.u0, 1 / ScatteringLut.aerialPerspectiveSliceZ);
            this.$l.v = pb.div(this.zenithAngle, Math.PI / 2);
            this.$l.t0 = pb.textureSampleLevel(this.apLut, pb.vec2(this.u0, this.v), 0);
            this.$l.t1 = pb.textureSampleLevel(this.apLut, pb.vec2(this.u1, this.v), 0);
            this.$l.t = pb.mix(this.t0, this.t1, this.factor);
            this.$outputs.outColor = pb.vec4(this.t.rgb, pb.sub(1, this.t.a));
          });
        }
      });
      this._bindgroupFogScatter = device.createBindGroup(this._programFogScatter.bindGroupLayouts[0]);
    }
    if (!this._programFog) {
      this._programFog = device.buildRenderProgram({
        label: 'Fog',
        vertex(pb) {
          this.rt = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type === 'webgpu') {
              this.$if(pb.notEqual(this.rt, 0), function () {
                this.$builtins.position.y = pb.neg(this.$builtins.position.y);
              });
            }
          });
        },
        fragment(pb) {
          this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.invProjViewMatrix = pb.mat4().uniform(0);
          this.cameraNearFar = pb.vec2().uniform(0);
          this.cameraPosition = pb.vec3().uniform(0);
          this.fogType = pb.int().uniform(0);
          this.fogColor = pb.vec4().uniform(0);
          this.fogParams = pb.vec4().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.depthValue = pb.textureSample(this.depthTex, this.$inputs.uv);
            if (device.type === 'webgl') {
              this.$l.linearDepth = decodeNormalizedFloatFromRGBA(this, this.depthValue);
            } else {
              this.$l.linearDepth = this.depthValue.r;
            }
            this.$l.nonLinearDepth = pb.div(
              pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
              pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
            );
            //this.$l.clipSpacePos = pb.vec4(pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)), this.nonLinearDepth, 1);
            this.$l.clipSpacePos = pb.vec4(
              pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)),
              pb.sub(pb.mul(this.nonLinearDepth, 2), 1),
              1
            );
            this.$l.hPos = pb.mul(this.invProjViewMatrix, this.clipSpacePos);
            this.$l.hPos = pb.div(this.$l.hPos, this.$l.hPos.w);
            this.$l.viewDir = pb.sub(this.hPos.xyz, this.cameraPosition);
            this.$l.fogFactor = ShaderFramework.computeFogFactor(
              this,
              this.viewDir,
              this.fogType,
              this.fogParams
            );
            this.$l.color = pb.mul(this.fogColor.rgb, this.fogFactor);
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.color, this.fogFactor);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), this.fogFactor);
            });
          });
        }
      });
      this._bindgroupFog = device.createBindGroup(this._programFog.bindGroupLayouts[0]);
    }
    if (!this._programSky.color) {
      this._programSky.color = device.buildRenderProgram({
        label: 'SolidColorSky',
        vertex(pb) {
          this.$inputs.pos = pb.vec3().attrib('position');
          this.worldMatrix = pb.mat4().uniform(0);
          this.viewProjMatrix = pb.mat4().uniform(0);
          this.cameraPos = pb.vec3().uniform(0);
          pb.main(function () {
            this.$l.worldDirection = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.pos, 0)).xyz;
            this.$builtins.position = pb.mul(
              this.viewProjMatrix,
              pb.vec4(pb.add(this.worldDirection, this.cameraPos), 1)
            );
            this.$builtins.position.z = this.$builtins.position.w;
          });
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.color = pb.vec4().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          pb.main(function () {
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.color.rgb, 1);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color.rgb), 1);
            });
          });
        }
      });
      this._bindgroupSky.color = device.createBindGroup(this._programSky.color.bindGroupLayouts[0]);
    }
    if (!this._programSky.scatter) {
      this._programSky.scatter = SkyRenderer._createScatterProgram(device, true);
      this._bindgroupSky.scatter = device.createBindGroup(this._programSky.scatter.bindGroupLayouts[0]);
    }
    if (!this._programSky['scatter-nocloud']) {
      this._programSky['scatter-nocloud'] = SkyRenderer._createScatterProgram(device, false);
      this._bindgroupSky['scatter-nocloud'] = device.createBindGroup(
        this._programSky['scatter-nocloud'].bindGroupLayouts[0]
      );
    }
    if (!this._programSky.skybox) {
      this._programSky.skybox = device.buildRenderProgram({
        label: 'SkyBoxSky',
        vertex(pb) {
          this.$inputs.pos = pb.vec3().attrib('position');
          this.$outputs.texCoord = pb.vec3();
          this.worldMatrix = pb.mat4().uniform(0);
          this.viewProjMatrix = pb.mat4().uniform(0);
          this.cameraPos = pb.vec3().uniform(0);
          this.flip = pb.vec4().uniform(0);
          pb.main(function () {
            this.$outputs.texCoord = this.$inputs.pos;
            this.$l.worldPos = pb.add(
              this.cameraPos,
              pb.mul(this.worldMatrix, pb.vec4(this.$inputs.pos, 0)).xyz
            );
            this.$builtins.position = pb.mul(this.viewProjMatrix, pb.vec4(this.worldPos, 1), this.flip);
            this.$builtins.position.z = this.$builtins.position.w;
          });
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.skyCubeMap = pb.texCube().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          pb.main(function () {
            this.$l.texCoord = pb.normalize(this.$inputs.texCoord);
            this.$l.color = pb.textureSampleLevel(this.skyCubeMap, this.texCoord, 0).rgb;
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.color, 1);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), 1);
            });
          });
        }
      });
      this._bindgroupSky.skybox = device.createBindGroup(this._programSky.skybox.bindGroupLayouts[0]);
    }
    if (!this._renderStatesSky) {
      this._renderStatesSky = device.createRenderStateSet();
      this._renderStatesSky.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('le');
      this._renderStatesSky.useRasterizerState().setCullMode('none');
    }
    if (!this._renderStatesSkyNoDepthTest) {
      this._renderStatesSkyNoDepthTest = device.createRenderStateSet();
      this._renderStatesSkyNoDepthTest.useDepthState().enableTest(false).enableWrite(false);
      this._renderStatesSkyNoDepthTest.useRasterizerState().setCullMode('none');
    }
    if (!this._renderStatesFog) {
      this._renderStatesFog = device.createRenderStateSet();
      this._renderStatesFog.useRasterizerState().setCullMode('none');
      this._renderStatesFog.useBlendingState().enable(true).setBlendFunc('one', 'inv-src-alpha');
      this._renderStatesFog.useDepthState().enableTest(false).enableWrite(false);
    }
    if (!this._renderStatesFogScatter) {
      this._renderStatesFogScatter = device.createRenderStateSet();
      this._renderStatesFogScatter.useRasterizerState().setCullMode('none');
      this._renderStatesFogScatter.useBlendingState().enable(true).setBlendFunc('one', 'inv-src-alpha');
      this._renderStatesFogScatter.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('gt');
    }
    if (!this._nearestSampler) {
      this._nearestSampler = device.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
        mipFilter: 'none',
        addressU: 'clamp',
        addressV: 'clamp'
      });
    }
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
    if (!this._primitiveSky) {
      this._primitiveSky = new BoxShape({ size: 8, anchorX: 0.5, anchorY: 0.5, anchorZ: 0.5 });
    }
  }
  /** @internal */
  private static _getSunDir(sunLight: DirectionalLight) {
    // TODO: reduce GC
    return sunLight?.directionAndCutoff.xyz().scaleBy(-1) ?? SkyRenderer._defaultSunDir;
  }
  private static _createScatterProgram(device: AbstractDevice, cloud: boolean) {
    return device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.worldMatrix = pb.mat4().uniform(0);
        this.viewProjMatrix = pb.mat4().uniform(0);
        this.cameraPos = pb.vec3().uniform(0);
        this.flip = pb.vec4().uniform(0);
        pb.main(function () {
          this.$outputs.worldDirection = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.pos, 0)).xyz;
          this.$builtins.position = pb.mul(
            this.viewProjMatrix,
            pb.vec4(pb.add(this.$outputs.worldDirection, this.cameraPos), 1),
            this.flip
          );
          this.$builtins.position.z = this.$builtins.position.w;
        });
      },
      fragment(pb) {
        this.$outputs.outColor = pb.vec4();
        this.tLut = pb.tex2D().uniform(0);
        this.skyLut = pb.tex2D().uniform(0);
        this.sunDir = pb.vec3().uniform(0);
        if (cloud) {
          this.cloudy = pb.float().uniform(0);
          this.cloudIntensity = pb.float().uniform(0);
          this.time = pb.float().uniform(0);
          this.velocity = pb.vec2().uniform(0);
        }
        this.drawGround = pb.int().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.viewPos = pb.vec3(
          ScatteringLut.viewPosition.x,
          ScatteringLut.viewPosition.y,
          ScatteringLut.viewPosition.z
        );
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
        pb.func('noise', [pb.vec3('p'), pb.float('t')], function () {
          this.p2 = pb.mul(this.p, 0.25);
          this.f = pb.mul(smoothNoise3D(this, this.p2), 0.5);
          this.p2 = pb.mul(this.p2, 3.02);
          this.p2.y = pb.sub(this.p2.y, pb.mul(this.t, 0.02));
          this.f = pb.add(this.f, pb.mul(smoothNoise3D(this, this.p2), 0.25));
          this.p2 = pb.mul(this.p2, 3.03);
          this.p2.y = pb.add(this.p2.y, pb.mul(this.t, 0.01));
          this.f = pb.add(this.f, pb.mul(smoothNoise3D(this, this.p2), 0.125));
          this.p2 = pb.mul(this.p2, 3.02);
          this.f = pb.add(this.f, pb.mul(smoothNoise3D(this, this.p2), 0.0625));
          this.p2 = pb.mul(this.p2, 3.01);
          this.f = pb.add(this.f, pb.mul(smoothNoise3D(this, this.p2), 0.03125));
          this.p2 = pb.mul(this.p2, 3.01);
          this.f = pb.add(this.f, pb.mul(smoothNoise3D(this, this.p2), 0.015625));
          this.$return(this.f);
        });
        pb.func('getValFromSkyLUT', [pb.vec3('rayDir'), pb.vec3('sunDir')], function () {
          this.$l.height = pb.length(this.viewPos);
          this.$l.up = pb.div(this.viewPos, this.height);
          this.$l.c = pb.div(
            pb.sqrt(
              pb.sub(
                pb.mul(this.height, this.height),
                pb.mul(ScatteringLut.groundRadius, ScatteringLut.groundRadius)
              )
            ),
            this.height
          );
          this.$l.horizonAngle = pb.acos(pb.clamp(this.c, -1, 1));
          this.$l.altitudeAngle = pb.sub(this.horizonAngle, pb.acos(pb.dot(this.rayDir, this.up)));
          this.$l.azimuthAngle = pb.float();
          this.$if(pb.greaterThan(pb.abs(this.altitudeAngle), Math.PI * 0.5 - 0.0001), function () {
            this.azimuthAngle = 0;
          }).$else(function () {
            this.$l.right = pb.cross(this.sunDir, this.up);
            this.$l.forward = pb.cross(this.up, this.right);
            this.$l.projectedDir = pb.normalize(
              pb.sub(this.rayDir, pb.mul(this.up, pb.dot(this.rayDir, this.up)))
            );
            this.$l.sinTheta = pb.dot(this.projectedDir, this.right);
            this.$l.cosTheta = pb.dot(this.projectedDir, this.forward);
            this.azimuthAngle = pb.add(pb.atan2(this.sinTheta, this.cosTheta), Math.PI);
          });
          this.$l.v = pb.add(
            0.5,
            pb.mul(0.5, pb.sign(this.altitudeAngle), pb.sqrt(pb.mul(pb.abs(this.altitudeAngle), 2 / Math.PI)))
          );
          this.$l.uv = pb.vec2(pb.div(this.azimuthAngle, Math.PI * 2), this.v);
          this.$return(pb.textureSampleLevel(this.skyLut, this.uv, 0).rgb);
        });
        pb.func('sunWithBloom', [pb.vec3('rayDir'), pb.vec3('sunDir')], function () {
          this.$l.sunSolidAngle = (0.53 * Math.PI) / 180;
          this.$l.minSunCosTheta = pb.cos(this.sunSolidAngle);
          this.$l.cosTheta = pb.dot(this.rayDir, this.sunDir);
          this.$if(pb.greaterThanEqual(this.cosTheta, this.minSunCosTheta), function () {
            this.$return(pb.vec3(1));
          });
          this.$l.offset = pb.sub(this.minSunCosTheta, this.cosTheta);
          this.$l.gaussianBloom = pb.mul(pb.exp(pb.mul(this.offset, -50000)), 0.5);
          this.$l.invBloom = pb.mul(pb.div(1, pb.add(0.02, pb.mul(this.offset, 300))), 0.01);
          this.$return(pb.vec3(pb.add(this.gaussianBloom, this.invBloom)));
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
                  pb.sub(this.height, ScatteringLut.groundRadius),
                  pb.sub(ScatteringLut.atmosphereRadius, ScatteringLut.groundRadius)
                )
              )
            )
          );
          this.$return(pb.textureSampleLevel(this.tLut, this.uv, 0).rgb);
        });
        pb.main(function () {
          this.$l.rayDir = pb.normalize(this.$inputs.worldDirection);
          // ad-hoc
          this.$l.sunIntensity = pb.sqrt(pb.max(0, pb.mul(this.sunDir.y, this.rayDir.y)));

          // compute cloud
          if (cloud) {
            this.$l.noiseValue = pb.float();
            this.$if(pb.lessThanEqual(this.rayDir.y, 0), function () {
              this.noiseValue = 0;
            }).$else(function () {
              this.$l.tMin = pb.div(3000, this.rayDir.y);
              this.$l.cloudPoint = pb.mul(this.rayDir, this.tMin);
              this.speed = pb.mul(pb.vec3(this.velocity.x, 0, this.velocity.y), this.time);
              this.$l.noiseScale = pb.float(4e-4);
              this.noiseValue = this.noise(
                pb.mul(pb.add(this.cloudPoint, this.speed), this.noiseScale),
                this.time
              );
              this.noiseValue = pb.add(this.noiseValue, this.cloudy);
              this.noiseValue = pb.smoothStep(1, pb.add(1, this.cloudy), this.noiseValue);
            });
            // use sun color as cloud color
            this.$l.sunColor = pb.mul(this.getValFromSkyLUT(this.sunDir, this.sunDir), this.sunIntensity);
            this.$l.cloudColor = pb.mul(this.sunColor.rgb, pb.mul(this.noiseValue, this.cloudIntensity));
          }

          // Compute sky color
          this.$l.skyRayDir = this.$choice(
            pb.equal(this.drawGround, 0),
            pb.normalize(pb.vec3(this.rayDir.x, pb.max(0, this.rayDir.y), this.rayDir.z)),
            this.rayDir
          );
          this.$l.lum = this.getValFromSkyLUT(this.skyRayDir, this.sunDir);
          this.$l.sunLum = this.sunWithBloom(this.rayDir, this.sunDir);
          this.sunLum = pb.smoothStep(pb.vec3(0.002), pb.vec3(1), this.sunLum);
          this.$if(pb.greaterThan(pb.length(this.sunLum), 0), function () {
            this.$if(
              pb.greaterThanEqual(
                this.rayIntersectSphere(this.viewPos, this.rayDir, ScatteringLut.groundRadius),
                0
              ),
              function () {
                this.sunLum = pb.vec3(0);
              }
            ).$else(function () {
              this.sunLum = pb.mul(this.sunLum, this.getValFromTLUT(this.viewPos, this.sunDir));
            });
          });
          if (cloud) {
            this.lum = pb.add(this.lum, this.sunLum);
            // blend
            this.$l.vfactor = pb.clamp(pb.div(pb.sub(this.rayDir.y, 0.01), pb.sub(0.03, 0.01)), 0, 1);
            this.$l.factor = pb.clamp(pb.mul(this.noiseValue, this.vfactor), 0, 1);
            this.$l.color = pb.mix(this.lum, this.cloudColor, this.factor);
          } else {
            this.$l.color = this.lum;
          }
          this.color = pb.mul(this.color, 8);
          this.color = pb.pow(this.color, pb.vec3(1.3));
          this.color = pb.div(
            this.color,
            pb.add(pb.mul(pb.smoothStep(0, 0.2, pb.clamp(this.sunDir.y, 0, 1)), 2), 0.15)
          );

          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.color, 1);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), 1);
          });
        });
      }
    });
  }
}
