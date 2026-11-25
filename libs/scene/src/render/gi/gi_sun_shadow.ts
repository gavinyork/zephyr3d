import type {
  BindGroup,
  FrameBuffer,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { DEPTH_CLEAR_VALUE, Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import { DepthPass } from '../depthpass';
import type { DrawContext } from '../drawable';
import type { Scene } from '../../scene/scene';
import { Camera as CameraNode } from '../../camera/camera';
import { GlobalBindGroupAllocator } from '../globalbindgroup_allocator';
import { applyShadowDepthBias, ndcToShadowCoord3, shadowCoordDepthInRange } from '../../shaders/shadow';

/** Uniform names of the GI sun shadow map, see {@link declareGISunShadowUniforms}. @internal */
export const GI_SUN_SHADOW_MAP = 'zGISunShadowMap';
/** @internal */
export const GI_SUN_SHADOW_MATRIX = 'zGISunShadowMatrix';
/** (texel size in world units, depth bias in world units over the depth range, 1/size, 0). @internal */
export const GI_SUN_SHADOW_PARAMS = 'zGISunShadowParams';

/**
 * Declares the GI sun shadow map uniforms: the depth texture (sampled through a comparison
 * sampler), the world to shadow clip matrix and its parameters.
 * @internal
 */
export function declareGISunShadowUniforms(scope: PBGlobalScope, group: number) {
  const pb = scope.$builder;
  scope[GI_SUN_SHADOW_MAP] = pb.tex2DShadow().noSampler().uniform(group);
  scope[GI_SUN_SHADOW_MATRIX] = pb.mat4().uniform(group);
  scope[GI_SUN_SHADOW_PARAMS] = pb.vec4().uniform(group);
}

/**
 * Sun visibility of a world point from the GI sun shadow map, 3x3 PCF over `radius` world units;
 * -1 outside the map, for the caller to fall back on. `bias` (world units) moves the point towards the light before comparing.
 * Same coordinate conventions as the camera's shadow maps (see ndcToShadowCoord3).
 * @internal
 */
export function sampleGISunShadow(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  radius: PBShaderExp,
  bias: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_sampleGISunShadow';
  pb.func(funcName, [pb.vec3('p'), pb.float('radius'), pb.float('bias')], function () {
    this.$l.prm = this[GI_SUN_SHADOW_PARAMS];
    this.$l.clip = pb.mul(this[GI_SUN_SHADOW_MATRIX], pb.vec4(this.p, 1));
    this.$l.sc = ndcToShadowCoord3(this, this.clip.xyz);
    this.$l.inside = pb.and(
      pb.and(pb.all(pb.greaterThan(this.sc.xy, pb.vec2(0))), pb.all(pb.lessThan(this.sc.xy, pb.vec2(1)))),
      shadowCoordDepthInRange(this, this.sc.z)
    );
    this.$if(pb.not(this.inside), function () {
      this.$return(pb.float(-1));
    });
    // prm.y: device depth per world unit along the light
    this.$l.z = applyShadowDepthBias(this, this.sc.z, pb.mul(this.bias, this.prm.y), true);
    this.$l.step = pb.mul(pb.div(this.radius, this.prm.x), this.prm.z);
    this.$l.sum = pb.float(0);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        this.sum = pb.add(
          this.sum,
          pb.textureSampleCompareLevel(
            this[GI_SUN_SHADOW_MAP],
            pb.add(this.sc.xy, pb.mul(pb.vec2(i, j), this.step)),
            this.z
          )
        );
      }
    }
    this.$return(pb.div(this.sum, 9));
  });
  return scope[funcName](worldPos, radius, bias) as PBShaderExp;
}

/**
 * A depth map of the scene's opaque geometry as the sun sees it, covering a box around the
 * camera, for the GI voxel lighting: openings far smaller than the scene field's voxels (a
 * dome's oculus, a window's tracery) let the sun in as they do on screen. Rendered with the
 * depth pass through an orthographic camera along the sun, the box snapped to whole texels so
 * the map does not shimmer as the camera moves, after Lumen's use of the shadow map for its
 * surface cache's direct lighting.
 * @internal
 */
export class GISunShadow {
  private readonly _scene: Scene;
  private readonly _pass: DepthPass;
  private readonly _camera: CameraNode;
  private readonly _allocator: GlobalBindGroupAllocator;
  private _depth: Nullable<Texture2D>;
  private _framebuffer: Nullable<FrameBuffer>;
  private _size: number;
  private readonly _matrix: Matrix4x4;
  private readonly _params: Vector4;
  private _valid: boolean;
  private readonly _eye: Vector3;
  private readonly _target: Vector3;
  constructor(scene: Scene) {
    this._scene = scene;
    this._pass = new DepthPass();
    this._pass.clearColor = new Vector4(1, 1, 1, 1);
    this._pass.clearDepth = DEPTH_CLEAR_VALUE;
    this._camera = new CameraNode(null);
    this._allocator = GlobalBindGroupAllocator.get();
    this._depth = null;
    this._framebuffer = null;
    this._size = 0;
    this._matrix = new Matrix4x4();
    this._params = new Vector4();
    this._valid = false;
    this._eye = new Vector3();
    this._target = new Vector3();
  }
  /** Whether a map was rendered and can be bound. */
  get valid() {
    return this._valid;
  }
  /**
   * Renders the map.
   * @param center - World point the map is centred on (the camera).
   * @param lightDir - Direction the sunlight travels, normalized.
   * @param halfExtent - Half the side of the covered square, world units.
   * @param depthRange - Depth of the view volume along the light, world units.
   * @param size - Texels per side.
   */
  update(center: Vector3, lightDir: Vector3, halfExtent: number, depthRange: number, size: number) {
    const device = getDevice();
    size = Math.max(256, Math.min(4096, size | 0));
    if (!this._depth || this._size !== size) {
      this._framebuffer?.dispose();
      this._depth?.dispose();
      this._depth = device.createTexture2D('d32f', size, size, { mipmapping: false })!;
      this._depth.name = '@GISunShadowMap';
      const color = device.createTexture2D('r8unorm', size, size, { mipmapping: false })!;
      color.name = '@GISunShadowColor';
      this._framebuffer = device.createFrameBuffer([color], this._depth);
      this._size = size;
    }
    // Light space basis; the box is snapped to whole texels across the light
    const up = Math.abs(lightDir.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const right = Vector3.normalize(Vector3.cross(up, lightDir, new Vector3()));
    const up2 = Vector3.cross(lightDir, right, new Vector3());
    const texel = (2 * halfExtent) / size;
    const cx = Math.round(Vector3.dot(center, right) / texel) * texel;
    const cy = Math.round(Vector3.dot(center, up2) / texel) * texel;
    const cz = Vector3.dot(center, lightDir);
    this._target.setXYZ(
      right.x * cx + up2.x * cy + lightDir.x * cz,
      right.y * cx + up2.y * cy + lightDir.y * cz,
      right.z * cx + up2.z * cy + lightDir.z * cz
    );
    this._eye.set(Vector3.sub(this._target, Vector3.scale(lightDir, depthRange * 0.5)));
    this._camera.lookAt(this._eye, this._target, up2);
    this._camera.setProjectionMatrix(
      Matrix4x4.ortho(-halfExtent, halfExtent, -halfExtent, halfExtent, 0, depthRange)
    );
    const ctx = this.createDrawContext(device);
    device.pushDeviceStates();
    try {
      device.setFramebuffer(this._framebuffer);
      device.setViewport(null);
      device.setScissor(null);
      this._pass.render(ctx, this._camera, this._camera);
    } finally {
      device.popDeviceStates();
    }
    this._matrix.set(this._camera.viewProjectionMatrix);
    // device depth spans the range over 0..1 in either depth convention: 1/range per world unit
    this._params.setXYZW(texel, 1 / depthRange, 1 / size, 0);
    this._valid = true;
  }
  /** Binds what {@link declareGISunShadowUniforms} declared. */
  applyBindGroup(bg: BindGroup) {
    bg.setTexture(GI_SUN_SHADOW_MAP, this._depth!, this._depth!.getDefaultSampler(true));
    bg.setValue(GI_SUN_SHADOW_MATRIX, this._matrix);
    bg.setValue(GI_SUN_SHADOW_PARAMS, this._params);
  }
  dispose() {
    this._framebuffer?.getColorAttachments()[0]?.dispose();
    this._framebuffer?.dispose();
    this._framebuffer = null;
    this._depth?.dispose();
    this._depth = null;
    this._valid = false;
    GlobalBindGroupAllocator.release(this._allocator);
  }
  /** @internal */
  private createDrawContext(device: DrawContext['device']): DrawContext {
    return {
      device,
      scene: this._scene,
      renderWidth: this._size,
      renderHeight: this._size,
      oit: null,
      motionVectors: false,
      sssProfileId: false,
      SSSProfileIdTexture: null,
      HiZ: false,
      HiZTexture: null,
      screenSpaceShadowMask: false,
      waterCaustics: false,
      underwater: null,
      globalBindGroupAllocator: this._allocator,
      camera: this._camera,
      compositor: null,
      queue: 0,
      lightBlending: false,
      renderPass: this._pass,
      renderPassHash: null,
      shaderVariantHash: null,
      flip: false,
      depthFormat: 'd32f',
      colorFormat: 'r8unorm',
      drawEnvLight: false,
      env: null,
      sunLight: null,
      primaryDirectionalLight: null,
      primaryTransmissionLight: null,
      materialFlags: 0,
      primitiveLod: 0,
      SSR: false,
      SSGI: false,
      SSGIIrradianceHistoryTexture: null,
      SSGISurfaceHistoryTexture: null,
      SSS: false,
      SSRCalcThickness: false,
      SceneRoughnessTexture: null,
      SceneNormalTexture: null,
      SSSProfileTexture: null,
      SSSParamTexture: null,
      SSSDiffuseTexture: null,
      SSSTransmissionTexture: null,
      SSSMaskTexture: null,
      postSSS: false,
      ssrSDFBoxBuffer: null,
      ssrSDFBoxCount: 0,
      finalFramebuffer: null,
      intermediateFramebuffer: null
    };
  }
}
