import { Matrix4x4, Vector3, Vector4, AABB, CubeFace, Frustum } from '@zephyr3d/base';
import type {
  PBShaderExp,
  FrameBuffer,
  Texture2D,
  Texture2DArray,
  TextureCube,
  TextureFormat,
  PBInsideFunctionScope,
  TextureSampler,
  TextureCreationOptions,
  TextureType,
  BaseTexture
} from '@zephyr3d/device';
import { Camera } from '../camera/camera';
import { SSM } from './ssm';
import { ESM } from './esm';
import { VSM } from './vsm';
import { PCFPD } from './pcf_pd';
import { PCFOPT } from './pcf_opt';
import { Application } from '../app';
import type { PointLight, PunctualLight, SpotLight } from '../scene/light';
import type { ShadowMapPass } from '../render/shadowmap_pass';
import type { Scene } from '../scene/scene';
import type { ShadowImpl } from './shadow_impl';
import { TemporalCache, type DrawContext } from '../render';
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_NONE } from '../values';
import { ShaderHelper } from '../material/shader/helper';

const tmpMatrix = new Matrix4x4();
const tmpFrustum = new Frustum(Matrix4x4.identity());

/**
 * Shadow mapping mode
 * @public
 */
export type ShadowMode = 'hard' | 'vsm' | 'esm' | 'pcf-pd' | 'pcf-opt';

/** @internal */
export type ShadowMapParams = {
  lightType: number;
  shaderHash: string;
  numShadowCascades: number;
  depthClampEnabled: boolean;
  cascadeDistances: Vector4;
  depthBiasValues: Vector4[];
  depthBiasScales: Vector4;
  cameraParams: Vector4;
  shadowMatrices: Float32Array;
  shadowMapFramebuffer: FrameBuffer;
  shadowMap: BaseTexture;
  shadowMapSampler: TextureSampler;
  impl: ShadowImpl;
  implData: unknown;
};

/** @internal */
export type ShadowMapType = Texture2D | TextureCube | Texture2DArray;

/** @internal */
export interface ShadowConfig {
  shadowMapSize: number;
  numCascades?: number;
  splitLambda?: number;
  depthBias?: number;
  normalBias?: number;
  nearClip?: number;
}

// const zeroPosition = Vector3.zero();
/**
 * The shadow map generator
 * @public
 */
export class ShadowMapper {
  /** @internal */
  private static _snapMatrix = new Matrix4x4();
  /** @internal */
  private static _target = new Vector3();
  /** @internal */
  private static _up = new Vector3();
  /** @internal */
  private static _frustumMin = new Vector3();
  /** @internal */
  private static _frustumMax = new Vector3();
  /** @internal */
  private static _frustumCenter = new Vector3();
  /** @internal */
  private static _lightCameras: WeakMap<Scene, Camera[]> = new WeakMap();
  /** @internal */
  private static _shadowMapParams: ShadowMapParams[] = [];
  /** @internal */
  protected _light: PunctualLight;
  /** @internal */
  protected _config: ShadowConfig;
  /** @internal */
  protected _resourceDirty: boolean;
  /** @internal */
  protected _shadowMode: ShadowMode;
  /** @internal */
  protected _shadowDistance: number;
  /** @internal */
  protected _impl: ShadowImpl;
  /** @internal */
  protected _pdSampleCount: number;
  /** @internal */
  protected _pdSampleRadius: number;
  /** @internal */
  protected _pcfKernelSize: number;
  /** @internal */
  protected _vsmBlurKernelSize: number;
  /** @internal */
  protected _vsmBlurRadius: number;
  /** @internal */
  protected _vsmDarkness: number;
  /** @internal */
  protected _esmBlur: boolean;
  /** @internal */
  protected _esmBlurKernelSize: number;
  /** @internal */
  protected _esmBlurRadius: number;
  /** @internal */
  protected _esmDepthScale: number;
  /**
   * Creates an instance of ShadowMapper
   * @param light - The light that is used to generate shadow map
   */
  constructor(light: PunctualLight) {
    this._light = light;
    this._config = {
      shadowMapSize: 1024,
      numCascades: 1,
      splitLambda: 0.5,
      depthBias: 0.05,
      normalBias: 0.05,
      nearClip: 1
    };
    this._resourceDirty = true;
    this._shadowMode = 'hard';
    this._shadowDistance = 2000;
    this._impl = null;
    this._pdSampleCount = 12;
    this._pdSampleRadius = 4;
    this._pcfKernelSize = 5;
    this._vsmBlurKernelSize = 5;
    this._vsmBlurRadius = 4;
    this._vsmDarkness = 0.3;
    this._esmBlur = true;
    this._esmBlurKernelSize = 5;
    this._esmBlurRadius = 4;
    this._esmDepthScale = 200;
    this.applyMode(this._shadowMode);
  }
  /** The light that is used to generate shadow map */
  get light(): PunctualLight {
    return this._light;
  }
  /** Size of the shadow map */
  get shadowMapSize(): number {
    return this._config.shadowMapSize;
  }
  set shadowMapSize(num: number) {
    if (!Number.isInteger(num) || num < 1) {
      console.error(`invalid shadow map size: ${num}`);
      return;
    }
    if (this._config.shadowMapSize !== num) {
      this._config.shadowMapSize = num;
      this._resourceDirty = true;
    }
  }
  /** Maximum distance from the camera, shadow will not be rendered beyond this range */
  get shadowDistance(): number {
    return this._shadowDistance;
  }
  set shadowDistance(val: number) {
    this._shadowDistance = Math.max(0, val);
  }
  /** Count of the cascades, The maximum value is 4 */
  get numShadowCascades(): number {
    return this._config.numCascades;
  }
  set numShadowCascades(num: number) {
    if (num !== 1 && num !== 2 && num !== 3 && num !== 4) {
      console.error(`invalid shadow cascade number: ${num}`);
      return;
    }
    if (!this._light.isDirectionLight() && num > 1) {
      console.error(`only directional light can have more than one shadow cascades`);
      return;
    }
    if (num !== this._config.numCascades) {
      this._config.numCascades = num;
      this._resourceDirty = true;
    }
  }
  /** The split lambda for cascaded shadow mapping */
  get splitLambda(): number {
    return this._config.splitLambda;
  }
  set splitLambda(val: number) {
    if (this._config.splitLambda !== val) {
      this._config.splitLambda = val;
    }
  }
  /** Depth bias for the shadow map */
  get depthBias(): number {
    return this._config.depthBias;
  }
  set depthBias(val: number) {
    this._config.depthBias = val;
  }
  /** Normal bias for the shadow map */
  get normalBias(): number {
    return this._config.normalBias;
  }
  set normalBias(val: number) {
    this._config.normalBias = val;
  }
  /** Near clip plane */
  get nearClip(): number {
    return this._config.nearClip;
  }
  set nearClip(val: number) {
    if (this._config.nearClip !== val) {
      this._config.nearClip = val;
    }
  }
  /** Shadow map mode */
  get mode(): ShadowMode {
    return this._shadowMode;
  }
  set mode(mode: ShadowMode) {
    if (mode !== this._shadowMode) {
      this._shadowMode = mode;
      this.applyMode(this._shadowMode);
    }
  }
  /** Generated shadow map */
  /*
  get shadowMap(): ShadowMapType {
    return (this._impl.getShadowMap(this) ?? this._framebuffer?.getColorAttachments()[0] ?? null) as ShadowMapType;
  }
  */
  /** Sampler of the shadow map */
  /*
  get shadowMapSampler(): TextureSampler {
    return this._impl.getShadowMapSampler(this);
  }
  */
  /** @internal */
  getShaderHash(shadowMapParams: ShadowMapParams): string {
    return `${shadowMapParams.impl.constructor.name}_${shadowMapParams.impl.getShaderHash()}_${
      shadowMapParams.lightType
    }_${shadowMapParams.shadowMap.target}_${Number(shadowMapParams.numShadowCascades > 1)}_${Number(
      Application.instance.device
        .getDeviceCaps()
        .textureCaps.getTextureFormatInfo(shadowMapParams.shadowMap.format).filterable
    )}`;
  }
  /** Sample count for poisson disc PCF */
  get pdSampleCount(): number {
    return this._pdSampleCount;
  }
  set pdSampleCount(val: number) {
    val = Math.min(Math.max(1, Number(val) >> 0), 64);
    if (val !== this._pdSampleCount) {
      this._pdSampleCount = val;
      this.asPCFPD() && (this.asPCFPD().tapCount = this._pdSampleCount);
    }
  }
  /** Radius for poisson disc PCF */
  get pdSampleRadius(): number {
    return this._pdSampleRadius;
  }
  set pdSampleRadius(val: number) {
    val = Math.max(0, Number(val) >> 0);
    if (val !== this._pdSampleRadius) {
      this._pdSampleRadius = val;
      this.asPCFPD()?.setDepthScale(this._pdSampleRadius);
    }
  }
  /** Kernel size for optimized PCF */
  get pcfKernelSize(): number {
    return this._pcfKernelSize;
  }
  set pcfKernelSize(val: number) {
    val = val !== 3 && val !== 5 && val !== 7 ? 5 : val;
    if (val !== this._pcfKernelSize) {
      this._pcfKernelSize = val;
      this.asPCFOPT() && (this.asPCFOPT().kernelSize = this._pcfKernelSize);
    }
  }
  /** Kernel size of VSM */
  get vsmBlurKernelSize(): number {
    return this._vsmBlurKernelSize;
  }
  set vsmBlurKernelSize(val: number) {
    val = Math.max(3, Number(val) >> 0) | 1;
    if (val !== this._vsmBlurKernelSize) {
      this._vsmBlurKernelSize = val;
      this.asVSM() && (this.asVSM().kernelSize = this._vsmBlurKernelSize);
    }
  }
  /** Blur radius for VSM */
  get vsmBlurRadius(): number {
    return this._vsmBlurRadius;
  }
  set vsmBlurRadius(val: number) {
    val = Math.max(0, Number(val) || 0);
    if (val !== this._vsmBlurRadius) {
      this._vsmBlurRadius = val;
      this.asVSM() && (this.asVSM().blurSize = this._vsmBlurRadius);
    }
  }
  /** Darkness for VSM */
  get vsmDarkness(): number {
    return this._vsmDarkness;
  }
  set vsmDarkness(val: number) {
    val = Math.min(0.999, Math.max(0, Number(val) || 0));
    if (val !== this._vsmDarkness) {
      this._vsmDarkness = val;
      this.asVSM()?.setDepthScale(this._vsmDarkness);
    }
  }
  /** Whether to enable ESM blur */
  get esmBlur(): boolean {
    return this._esmBlur;
  }
  set esmBlur(val: boolean) {
    if (!!val !== this.esmBlur) {
      this._esmBlur = !!val;
      this.asESM() && (this.asESM().blur = this._esmBlur);
    }
  }
  /** Kernel size for ESM */
  get esmBlurKernelSize(): number {
    return this._esmBlurKernelSize;
  }
  set esmBlurKernelSize(val: number) {
    val = Math.max(3, Number(val) >> 0) | 1;
    if (val !== this._esmBlurKernelSize) {
      this._esmBlurKernelSize = val;
      this.asESM() && (this.asESM().kernelSize = this._esmBlurKernelSize);
    }
  }
  /** Blur radius for ESM */
  get esmBlurRadius(): number {
    return this._esmBlurRadius;
  }
  set esmBlurRadius(val: number) {
    val = Math.max(0, Number(val) || 0);
    if (val !== this._esmBlurRadius) {
      this._esmBlurRadius = val;
      this.asESM() && (this.asESM().blurSize = this._esmBlurRadius);
    }
  }
  /** Depth scale for ESM */
  get esmDepthScale(): number {
    return this._esmDepthScale;
  }
  set esmDepthScale(val: number) {
    val = Math.max(0, Number(val) || 0);
    if (val !== this._esmDepthScale) {
      this._esmDepthScale = val;
      this.asESM()?.setDepthScale(this._esmDepthScale);
    }
  }
  /** @internal */
  computeShadow(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    shadowVertex: PBShaderExp,
    NdotL: PBShaderExp
  ): PBShaderExp {
    return this._impl.computeShadow(shadowMapParams, scope, shadowVertex, NdotL);
  }
  /** @internal */
  computeShadowCSM(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    shadowVertex: PBShaderExp,
    NdotL: PBShaderExp,
    split: PBShaderExp
  ): PBShaderExp {
    return this._impl.computeShadowCSM(shadowMapParams, scope, shadowVertex, NdotL, split);
  }
  /** @internal */
  static releaseTemporalResources(ctx: DrawContext) {
    if (ctx.shadowMapInfo) {
      for (const k of ctx.shadowMapInfo.keys()) {
        const shadowMapParams = ctx.shadowMapInfo.get(k);
        TemporalCache.releaseFramebuffer(shadowMapParams.shadowMapFramebuffer);
        shadowMapParams.impl.releaseTemporalResources(shadowMapParams);
        shadowMapParams.lightType = LIGHT_TYPE_NONE;
        shadowMapParams.depthClampEnabled = false;
        shadowMapParams.shaderHash = '';
        shadowMapParams.numShadowCascades = 1;
        shadowMapParams.shadowMapFramebuffer = null;
        shadowMapParams.impl = null;
        shadowMapParams.shadowMap = null;
        shadowMapParams.shadowMapSampler = null;
        shadowMapParams.implData = null;
        this._shadowMapParams.push(shadowMapParams);
      }
      ctx.shadowMapInfo = null;
    }
  }
  /** @internal */
  static computeShadowBias(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    z: PBShaderExp,
    NdotL: PBShaderExp,
    linear: boolean
  ): PBShaderExp {
    const pb = scope.$builder;
    const depthBiasParam = ShaderHelper.getDepthBiasValues(scope);
    if (shadowMapParams.lightType === LIGHT_TYPE_DIRECTIONAL) {
      return pb.dot(pb.mul(depthBiasParam.xy, pb.vec2(1, pb.sub(1, NdotL))), pb.vec2(1, 1));
    } else {
      const nearFar = ShaderHelper.getShadowCameraParams(scope).xy;
      const linearDepth = linear ? z : ShaderHelper.nonLinearDepthToLinearNormalized(scope, z, nearFar);
      const biasScaleFactor = pb.mix(1, depthBiasParam.w, linearDepth);
      return pb.dot(pb.mul(depthBiasParam.xy, pb.vec2(1, pb.sub(1, NdotL)), biasScaleFactor), pb.vec2(1, 1));
    }
  }
  /** @internal */
  static computeShadowBiasCSM(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    NdotL: PBShaderExp,
    split: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const depthBiasParam = ShaderHelper.getDepthBiasValues(scope);
    const splitFlags = pb.vec4(
      pb.float(pb.equal(split, 0)),
      pb.float(pb.equal(split, 1)),
      pb.float(pb.equal(split, 2)),
      pb.float(pb.equal(split, 3))
    );
    const depthBiasScale = pb.dot(ShaderHelper.getDepthBiasScales(scope), splitFlags);
    return pb.dot(pb.mul(depthBiasParam.xy, pb.vec2(1, pb.sub(1, NdotL)), depthBiasScale), pb.vec2(1, 1));
  }
  /** @internal */
  protected isTextureInvalid(
    texture: Texture2D | TextureCube | Texture2DArray,
    target: TextureType,
    format: TextureFormat,
    width: number,
    height: number
  ): boolean {
    return (
      texture &&
      (texture.target !== target ||
        texture.format !== format ||
        texture.width !== width ||
        texture.height !== height ||
        texture.depth !== this.numShadowCascades)
    );
  }
  /** @internal */
  protected createTexture(
    target: TextureType,
    format: TextureFormat,
    width: number,
    height: number,
    depth: number
  ): Texture2D | TextureCube | Texture2DArray {
    const device = Application.instance.device;
    const options: TextureCreationOptions = {
      samplerOptions: { mipFilter: 'none' }
    };
    switch (target) {
      case '2d':
        return device.createTexture2D(format, width, height, options);
      case 'cube':
        return device.createCubeTexture(format, width, options);
      case '2darray':
        return device.createTexture2DArray(format, width, height, depth, options);
      default:
        return null;
    }
  }
  /** @internal */
  protected updateResources(shadowMapParams: ShadowMapParams) {
    const device = Application.instance.device;
    const colorFormat = shadowMapParams.impl.getShadowMapColorFormat(shadowMapParams);
    const depthFormat = shadowMapParams.impl.getShadowMapDepthFormat(shadowMapParams);
    const numCascades = shadowMapParams.numShadowCascades;
    const useTextureArray = numCascades > 1 && device.type !== 'webgl';
    const shadowMapWidth =
      numCascades > 1 && !useTextureArray ? 2 * this._config.shadowMapSize : this._config.shadowMapSize;
    const shadowMapHeight =
      numCascades > 2 && !useTextureArray ? 2 * this._config.shadowMapSize : this._config.shadowMapSize;
    const colorTarget: TextureType = useTextureArray ? '2darray' : this._light.isPointLight() ? 'cube' : '2d';
    const depthTarget: TextureType = device.type === 'webgl' ? '2d' : colorTarget;
    shadowMapParams.shadowMapFramebuffer = TemporalCache.getFramebufferFixedSize(
      shadowMapWidth,
      shadowMapHeight,
      numCascades,
      colorFormat,
      depthFormat,
      colorTarget,
      depthTarget,
      false,
      1
    );
    shadowMapParams.impl = this._impl;
    this._impl.updateResources(shadowMapParams);
  }
  /** @internal */
  protected createLightCameraPoint(lightCamera: Camera): void {
    //lightCamera.reparent(this._light);
    lightCamera.reparent(lightCamera.scene.rootNode);
    lightCamera.resetTransform();
    lightCamera.setPerspective(
      Math.PI / 2,
      1,
      this._config.nearClip,
      Math.min(this._shadowDistance, (this._light as PointLight).range)
    );
    lightCamera.position.set(this._light.positionAndRange.xyz());
  }
  /** @internal */
  protected createLightCameraSpot(lightCamera: Camera): void {
    lightCamera.reparent(this._light);
    lightCamera.resetTransform();
    lightCamera.setPerspective(
      2 * (this._light as SpotLight).cutoff,
      1,
      this._config.nearClip,
      Math.min((this._shadowDistance, this._light as SpotLight).range)
    );
  }
  /** @internal */
  protected createLightCameraDirectional(
    sceneAABB: AABB,
    sceneCamera: Camera,
    lightCamera: Camera,
    cropMatrix?: Matrix4x4,
    border?: number
  ) {
    let frustum = sceneCamera.frustumViewSpace;
    if (this._shadowDistance < sceneCamera.getFarPlane()) {
      tmpMatrix.set(sceneCamera.getProjectionMatrix());
      tmpMatrix.setNearFar(tmpMatrix.getNearPlane(), this._shadowDistance);
      //tmpMatrix.multiplyRight(sceneCamera.viewMatrix);
      tmpFrustum.initWithMatrix(tmpMatrix);
      frustum = tmpFrustum;
    }
    border = border || 0;
    const expand = (this.shadowMapSize - 2 * border) / this.shadowMapSize;
    //const frustum = sceneCamera.frustum;
    const frustumMin = ShadowMapper._frustumMin;
    const frustumMax = ShadowMapper._frustumMax;
    const frustumCenter = ShadowMapper._frustumCenter;
    const target = ShadowMapper._target;
    const up = ShadowMapper._up;
    // const frustum = new Frustum(sceneCamera.viewProjectionMatrix);
    frustumMin.setXYZ(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    frustumMax.setXYZ(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);
    frustum.corners.forEach((p) => {
      frustumMin.inplaceMin(p);
      frustumMax.inplaceMax(p);
    });
    let radius = Vector3.distance(frustumMin, frustumMax) * 0.5 * expand;
    const center = sceneCamera.thisToWorld(
      Vector3.add(frustumMin, frustumMax, frustumCenter).scaleBy(0.5),
      frustumCenter
    );
    // Bounding sphere of the shadow camera should not be larger than bounding sphere of the scene.
    const sceneRadius = sceneAABB.diagonalLength * 0.5 * expand;
    if (sceneRadius < radius) {
      radius = sceneRadius;
      Vector3.add(sceneAABB.minPoint, sceneAABB.maxPoint, center).scaleBy(0.5);
    }
    target.setXYZ(
      center.x + this._light.directionAndCutoff.x,
      center.y + this._light.directionAndCutoff.y,
      center.z + this._light.directionAndCutoff.z
    );
    up.setXYZ(0, 1, 0);
    lightCamera.lookAt(center, target, up);
    lightCamera.position.set(center);
    lightCamera.setOrtho(-radius, radius, -radius, radius, -radius, radius);
    center.setXYZ(0, 0, 0);
    lightCamera.viewProjectionMatrix.transformPointP(center, center);
    if (cropMatrix) {
      const tx = center.x * this.shadowMapSize * 0.5;
      const ty = center.y * this.shadowMapSize * 0.5;
      const rx = Math.round(tx);
      const ry = Math.round(ty);
      center.setXYZ(((rx - tx) * 2) / this.shadowMapSize, ((ry - ty) * 2) / this.shadowMapSize, 0);
      cropMatrix.translation(center);
    }

    /*
    const minx = frustumMin.x;
    const maxx = frustumMax.x;
    const miny = frustumMin.y;
    const maxy = frustumMax.y;
    const minz = frustumMin.z;
    const maxz = frustumMax.z;
    const texelSizeW = (maxx - minx) / this.shadowMapSize;
    const texelSizeH = (maxy - miny) / this.shadowMapSize;
    const cx = Math.floor((minx + maxx) / 2 / texelSizeW) * texelSizeW;
    const cy = Math.floor((miny + maxy) / 2 / texelSizeH) * texelSizeH;
    const cz = (minz + maxz) / 2;
    const hx = Math.floor(((maxx - minx) * (expand + 0.5)) / texelSizeW) * texelSizeW;
    const hy = Math.floor(((maxy - miny) * (expand + 0.5)) / texelSizeH) * texelSizeH;
    lightCamera.position.setXYZ(cx, cy, cz);
    lightCamera.setOrtho(
      -hx,
      hx,
      -hy,
      hy,
      sceneMax.z - maxz,
      sceneMax.z - minz + 1
    );
    if (cropMatrix) {
      // compute crop matrix
      let clipMaxX = 0,
        clipMaxY = 0;
      let clipMinX = Number.MAX_VALUE,
        clipMinY = Number.MAX_VALUE;
      frustum.corners.forEach((p) => {
        const clipPos = lightCamera.viewProjectionMatrix.transformPoint(p);
        clipPos.x = Math.min(1, Math.max(-1, clipPos.x / clipPos.w));
        clipPos.y = Math.min(1, Math.max(-1, clipPos.y / clipPos.w));
        if (clipPos.x > clipMaxX) {
          clipMaxX = clipPos.x;
        }
        if (clipPos.x < clipMinX) {
          clipMinX = clipPos.x;
        }
        if (clipPos.y > clipMaxY) {
          clipMaxY = clipPos.y;
        }
        if (clipPos.y < clipMinY) {
          clipMinY = clipPos.y;
        }
      });
      const clipW = clipMaxX - clipMinX;
      const clipH = clipMaxY - clipMinY;
      clipMinX -= expand * clipW;
      clipMinY -= expand * clipH;
      clipMaxX += expand * clipW;
      clipMaxY += expand * clipH;
      const scaleX = 2 / (clipMaxX - clipMinX);
      const scaleY = 2 / (clipMaxY - clipMinY);
      const offsetX = -0.5 * (clipMaxX + clipMinX) * scaleX;
      const offsetY = -0.5 * (clipMaxY + clipMinY) * scaleY;
      cropMatrix.identity();
      cropMatrix.m00 = scaleX;
      cropMatrix.m11 = scaleY;
      cropMatrix.m03 = offsetX;
      cropMatrix.m13 = offsetY;
    }
    */
  }
  /** @internal */
  private static fetchShadowMapParams(): ShadowMapParams {
    if (this._shadowMapParams.length > 0) {
      return this._shadowMapParams.pop();
    } else {
      return {
        lightType: LIGHT_TYPE_NONE,
        depthClampEnabled: false,
        shaderHash: '',
        cameraParams: new Vector4(),
        cascadeDistances: new Vector4(),
        depthBiasScales: new Vector4(),
        depthBiasValues: [new Vector4(), new Vector4(), new Vector4(), new Vector4()],
        numShadowCascades: 1,
        shadowMatrices: new Float32Array(16 * 4),
        shadowMap: null,
        shadowMapSampler: null,
        shadowMapFramebuffer: null,
        impl: null,
        implData: null
      };
    }
  }
  /** @internal */
  private static fetchCameraForScene(scene: Scene) {
    const cameras = this._lightCameras.get(scene);
    if (!cameras || cameras.length === 0) {
      return new Camera(scene);
    } else {
      const camera = cameras.pop();
      camera.parent = scene.rootNode;
      camera.resetTransform();
      camera.clipMask = 0;
      return camera;
    }
  }
  /** @internal */
  private static releaseCamera(camera: Camera) {
    let cameras = this._lightCameras.get(camera.scene);
    if (!cameras) {
      cameras = [];
      this._lightCameras.set(camera.scene, cameras);
    }
    camera.remove();
    cameras.push(camera);
  }
  /** @internal */
  calcSplitDistances(nearPlane: number, farPlane: number, numCascades: number): number[] {
    const result: number[] = [0, 0, 0, 0, 0];
    for (let i = 0; i <= numCascades; ++i) {
      const fIDM = i / numCascades;
      const fLog = nearPlane * Math.pow(farPlane / nearPlane, fIDM);
      const fUniform = nearPlane + (farPlane - nearPlane) * fIDM;
      result[i] = fLog * this._config.splitLambda + fUniform * (1 - this._config.splitLambda);
    }
    return result;
  }
  /** @internal */
  protected calcDepthBiasParams(
    shadowMapCamera: Camera,
    shadowMapSize: number,
    depthBias: number,
    normalBias: number,
    depthScale: number,
    result: Vector4
  ): void {
    const sizeNear = Math.min(
      shadowMapCamera.getProjectionMatrix().getNearPlaneWidth(),
      shadowMapCamera.getProjectionMatrix().getNearPlaneHeight()
    );
    const sizeFar = Math.min(
      shadowMapCamera.getProjectionMatrix().getFarPlaneWidth(),
      shadowMapCamera.getProjectionMatrix().getFarPlaneHeight()
    );
    const scaleFactor = sizeNear / shadowMapSize / 2;
    result.setXYZW(depthBias * scaleFactor, normalBias * scaleFactor, depthScale, sizeFar / sizeNear);
  }
  /** @internal */
  protected postRenderShadowMap(shadowMapParams: ShadowMapParams) {
    this._impl.postRenderShadowMap(shadowMapParams);
  }
  /** @internal */
  render(ctx: DrawContext, renderPass: ShadowMapPass) {
    if (!ctx.shadowMapInfo) {
      ctx.shadowMapInfo = new Map();
    }
    const shadowMapParams = ShadowMapper.fetchShadowMapParams();
    shadowMapParams.impl = this._impl;
    shadowMapParams.lightType = this.light.lightType;
    shadowMapParams.numShadowCascades =
      shadowMapParams.lightType === LIGHT_TYPE_DIRECTIONAL ? this._config.numCascades : 1;
    ctx.shadowMapInfo.set(this.light, shadowMapParams);
    const scene = ctx.scene;
    const camera = ctx.camera;
    renderPass.light = this._light;
    this.updateResources(shadowMapParams);
    shadowMapParams.shaderHash = this.getShaderHash(shadowMapParams);
    const device = Application.instance.device;
    const fb = shadowMapParams.shadowMapFramebuffer;
    shadowMapParams.depthClampEnabled = false;
    renderPass.clearColor = fb.getColorAttachments()[0]
      ? fb.getColorAttachments()[0].isFloatFormat()
        ? new Vector4(1, 1, 1, 1)
        : new Vector4(0, 0, 0, 1)
      : null;
    const depthScale = this._impl.getDepthScale();
    if (this._light.isPointLight()) {
      const shadowMapRenderCamera = ShadowMapper.fetchCameraForScene(scene);
      this.createLightCameraPoint(shadowMapRenderCamera);
      this.calcDepthBiasParams(
        shadowMapRenderCamera,
        this._config.shadowMapSize,
        this._config.depthBias,
        this._config.normalBias,
        depthScale,
        shadowMapParams.depthBiasValues[0]
      );
      shadowMapParams.cameraParams.setXYZW(
        shadowMapRenderCamera.getNearPlane(),
        shadowMapRenderCamera.getFarPlane(),
        this._config.shadowMapSize,
        this._shadowDistance
      );
      device.setFramebuffer(fb);
      shadowMapParams.shadowMatrices.set(Matrix4x4.transpose(shadowMapRenderCamera.viewMatrix));
      for (const face of [CubeFace.PX, CubeFace.NX, CubeFace.PY, CubeFace.NY, CubeFace.PZ, CubeFace.NZ]) {
        shadowMapRenderCamera.lookAtCubeFace(face);
        fb.setColorAttachmentCubeFace(0, face);
        fb.setDepthAttachmentCubeFace(face);
        ctx.camera = shadowMapRenderCamera;
        renderPass.render(ctx);
      }
      shadowMapParams.shadowMatrices.set(Matrix4x4.identity());
      ShadowMapper.releaseCamera(shadowMapRenderCamera);
    } else {
      if (this._config.numCascades > 1) {
        const distances = this.calcSplitDistances(
          camera.getNearPlane(),
          Math.min(this._shadowDistance, camera.getFarPlane()),
          this._config.numCascades
        );
        const cascadeCamera = ShadowMapper.fetchCameraForScene(scene);
        const shadowMapRenderCamera = ShadowMapper.fetchCameraForScene(scene);
        const shadowMapCullCamera = ShadowMapper.fetchCameraForScene(scene);
        shadowMapCullCamera.clipMask = AABB.ClipLeft | AABB.ClipRight | AABB.ClipBottom | AABB.ClipTop;
        cascadeCamera.reparent(camera);
        shadowMapParams.depthClampEnabled =
          Application.instance.device.getDeviceCaps().shaderCaps.supportFragmentDepth;
        for (let split = 0; split < this._config.numCascades; split++) {
          cascadeCamera.setPerspective(
            camera.getFOV(),
            camera.getAspect(),
            distances[split],
            distances[split + 1]
          );
          const snapMatrix = ShadowMapper._snapMatrix;
          const border = shadowMapParams.impl.getShadowMapBorder(shadowMapParams); //20 / this._config.shadowMapSize;
          this.createLightCameraDirectional(
            ctx.scene.boundingBox,
            cascadeCamera,
            shadowMapRenderCamera,
            snapMatrix,
            border
          );
          this.createLightCameraDirectional(
            ctx.scene.boundingBox,
            cascadeCamera,
            shadowMapCullCamera,
            null,
            border
          );
          this.calcDepthBiasParams(
            shadowMapRenderCamera,
            this._config.shadowMapSize,
            this._config.depthBias,
            this._config.normalBias,
            depthScale,
            shadowMapParams.depthBiasValues[split]
          );
          shadowMapParams.depthBiasScales[split] = 1;
          // Incorrect calculation
          // shadowMapParams.depthBiasScales[split] = shadowMapParams.depthBiasValues[0].x !== 0 ? shadowMapParams.depthBiasValues[split].x / shadowMapParams.depthBiasValues[0].x : 1;
          shadowMapParams.cameraParams.setXYZW(
            shadowMapRenderCamera.getNearPlane(),
            shadowMapRenderCamera.getFarPlane(),
            this._config.shadowMapSize,
            this._shadowDistance
          );
          let scissor: number[] = null;
          if (
            fb.getColorAttachments()[0]?.isTexture2DArray() ||
            fb.getDepthAttachment()?.isTexture2DArray()
          ) {
            shadowMapRenderCamera.setProjectionMatrix(
              Matrix4x4.multiply(snapMatrix, shadowMapRenderCamera.getProjectionMatrix())
            );
            fb.setColorAttachmentLayer(0, split);
            fb.setDepthAttachmentLayer(split);
          } else {
            const numRows = this._config.numCascades > 2 ? 2 : 1;
            const numCols = this._config.numCascades > 1 ? 2 : 1;
            const adjMatrix = new Matrix4x4();
            const col = split % 2;
            const row = split >> 1;
            adjMatrix.setRowXYZW(0, 1.5 - 0.5 * numCols, 0, 0, 0);
            adjMatrix.setRowXYZW(1, 0, 1.5 - 0.5 * numRows, 0, 0);
            adjMatrix.setRowXYZW(2, 0, 0, 1, 0);
            adjMatrix.setRowXYZW(3, col - 0.5 * numCols + 0.5, row - 0.5 * numRows + 0.5, 0, 1);
            shadowMapRenderCamera.setProjectionMatrix(
              Matrix4x4.multiply(
                adjMatrix,
                Matrix4x4.multiply(snapMatrix, shadowMapRenderCamera.getProjectionMatrix())
              )
            );
            if (device.type === 'webgpu') {
              scissor = [
                col * this._config.shadowMapSize,
                (numRows - 1 - row) * this._config.shadowMapSize,
                this._config.shadowMapSize,
                this._config.shadowMapSize
              ];
            } else {
              scissor = [
                col * this._config.shadowMapSize,
                row * this._config.shadowMapSize,
                this._config.shadowMapSize,
                this._config.shadowMapSize
              ];
            }
          }
          device.setFramebuffer(fb);
          device.setScissor(scissor);
          ctx.camera = shadowMapRenderCamera;
          renderPass.render(ctx, shadowMapCullCamera);
          shadowMapParams.shadowMatrices.set(
            Matrix4x4.transpose(shadowMapRenderCamera.viewProjectionMatrix),
            split * 16
          );
          shadowMapParams.cascadeDistances[split] = distances[split + 1];
        }
        ShadowMapper.releaseCamera(cascadeCamera);
        ShadowMapper.releaseCamera(shadowMapRenderCamera);
        ShadowMapper.releaseCamera(shadowMapCullCamera);
      } else {
        const shadowMapRenderCamera = ShadowMapper.fetchCameraForScene(scene);
        const snapMatrix = ShadowMapper._snapMatrix;
        shadowMapRenderCamera.clipMask = AABB.ClipLeft | AABB.ClipRight | AABB.ClipBottom | AABB.ClipTop;
        if (this._light.isDirectionLight()) {
          this.createLightCameraDirectional(
            ctx.scene.boundingBox,
            camera,
            shadowMapRenderCamera,
            snapMatrix,
            shadowMapParams.impl.getShadowMapBorder(shadowMapParams)
          );
        } else {
          this.createLightCameraSpot(shadowMapRenderCamera);
        }
        this.calcDepthBiasParams(
          shadowMapRenderCamera,
          this._config.shadowMapSize,
          this._config.depthBias,
          this._config.normalBias,
          depthScale,
          shadowMapParams.depthBiasValues[0]
        );
        shadowMapParams.cameraParams.setXYZW(
          shadowMapRenderCamera.getNearPlane(),
          shadowMapRenderCamera.getFarPlane(),
          this._config.shadowMapSize,
          this._shadowDistance
        );
        device.setFramebuffer(fb);
        shadowMapRenderCamera.setProjectionMatrix(
          Matrix4x4.multiply(snapMatrix, shadowMapRenderCamera.getProjectionMatrix())
        );
        ctx.camera = shadowMapRenderCamera;
        renderPass.render(ctx);
        shadowMapParams.shadowMatrices.set(Matrix4x4.transpose(shadowMapRenderCamera.viewProjectionMatrix));
        ShadowMapper.releaseCamera(shadowMapRenderCamera);
      }
    }
    ctx.camera = camera;
    this.postRenderShadowMap(shadowMapParams);
  }
  /** @internal */
  private applyMode(mode: ShadowMode) {
    if (mode !== 'hard' && mode !== 'vsm' && mode !== 'esm' && mode !== 'pcf-pd' && mode !== 'pcf-opt') {
      console.error(`ShadowMapper.setShadowMode() failed: invalid mode: ${mode}`);
      return;
    }
    this._impl = null;
    if (mode === 'hard') {
      this._impl = new SSM();
    } else if (mode === 'vsm') {
      this._impl = new VSM(this._vsmBlurKernelSize, this._vsmBlurRadius, this._vsmDarkness);
    } else if (mode === 'esm') {
      this._impl = new ESM(this._esmBlurKernelSize, this._esmBlurRadius, this._esmDepthScale);
    } else if (mode === 'pcf-pd') {
      this._impl = new PCFPD(this._pdSampleCount, this._pdSampleRadius);
    } else if (mode === 'pcf-opt') {
      this._impl = new PCFOPT(this._pcfKernelSize);
    }
  }
  /** @internal */
  private asVSM(): VSM {
    return this._impl?.getType() === 'vsm' ? (this._impl as VSM) : null;
  }
  /** @internal */
  private asESM(): ESM {
    return this._impl?.getType() === 'esm' ? (this._impl as ESM) : null;
  }
  /** @internal */
  private asPCFPD(): PCFPD {
    return this._impl?.getType() === 'pcf-pd' ? (this._impl as PCFPD) : null;
  }
  /** @internal */
  private asPCFOPT(): PCFOPT {
    return this._impl?.getType() === 'pcf-opt' ? (this._impl as PCFOPT) : null;
  }
}
