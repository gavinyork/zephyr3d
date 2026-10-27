import type { BindGroup, FrameBuffer, Texture3D } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, Vector3 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import { RenderPass } from '../renderpass';
import { RENDER_PASS_TYPE_VOXELIZE } from '../../values';
import type { DrawContext } from '../drawable';
import type { RenderQueue } from '../render_queue';
import type { Camera } from '../../camera/camera';
import { Camera as CameraNode } from '../../camera/camera';
import type { Scene } from '../../scene/scene';
import type { Primitive } from '../primitive';
import type { MeshMaterial } from '../../material/meshmaterial';
import { ShaderHelper } from '../../material/shader/helper';
import { GlobalBindGroupAllocator } from '../globalbindgroup_allocator';
import { VOXELIZE_ALBEDO, VOXELIZE_EMISSIVE, VOXELIZE_PARAMS } from '../../shaders/gi';
import type { VoxelAtlasSlot } from './voxel_atlas';

/**
 * The render pass a mesh is voxelized in. Only its type and hash take part:
 * the voxelizer drives the draws itself rather than culling a scene.
 * @internal
 */
export class VoxelizePass extends RenderPass {
  constructor() {
    super(RENDER_PASS_TYPE_VOXELIZE);
  }
  /** @internal */
  protected _getGlobalBindGroupHash(_ctx: DrawContext) {
    return '';
  }
  /** @internal */
  protected renderItems(_ctx: DrawContext, _camera: Camera, _renderQueue: RenderQueue) {
    throw new Error('VoxelizePass: use Voxelizer.voxelize()');
  }
}

/**
 * Where a voxelization lands: a slot of the material atlases, and the box of
 * the mesh's local space it covers.
 * @internal
 */
export interface VoxelizeTarget {
  albedo: Texture3D;
  emissive: Texture3D;
  slot: VoxelAtlasSlot;
  /** Lower corner of the box in the mesh's local space. */
  boxMin: [number, number, number];
  /** Edge of a material voxel in local units. */
  voxelSize: number;
}

/**
 * Draws per axis along each screen axis, each shifted by a fraction of a
 * pixel: a grid of VOXELIZE_JITTER² sample positions per voxel face. One
 * sample per voxel misses a strip narrower than a voxel lying between pixel
 * centres in all three projections, and the field, built from the exact mesh,
 * then has a surface the material atlas has nothing for: a ray hitting it
 * reads black. WebGPU has no conservative rasterization; drawing again with
 * sub-pixel offsets, the jittered passes of Haeberli and Akeley's accumulation
 * buffer (SIGGRAPH 1990), samples as densely as rasterizing at this many times
 * the resolution while the texture derivatives, and so the mip the albedo is
 * read at, stay those of a voxel.
 */
const VOXELIZE_JITTER = 4;

const AXES: { dir: Vector3; up: Vector3 }[] = [
  { dir: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0) },
  { dir: new Vector3(0, 1, 0), up: new Vector3(0, 0, 1) },
  { dir: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) }
];

/**
 * Rasterizes a mesh with its material into the material atlases: orthographic
 * draws along each axis over a viewport one pixel per voxel, jittered by
 * sub-pixel offsets ({@link VOXELIZE_JITTER}), every fragment storing its
 * albedo and emissive in the voxel holding its position (the three
 * projections together reach surfaces facing any way). Depth test, culling
 * and colour writes are off; the colour attachment is a scratch target.
 *
 * After Crassin and Green, "Octree-Based Sparse Voxelization Using the GPU
 * Hardware Rasterizer", OpenGL Insights 2012, without conservative
 * rasterization, which WebGPU lacks: the jittered draws stand in for it, and
 * what still slips through is read through the mesh's distance field at
 * composite time.
 *
 * @internal
 */
export class Voxelizer {
  private readonly _scene: Scene;
  private readonly _pass: VoxelizePass;
  private readonly _camera: CameraNode;
  private readonly _allocator: GlobalBindGroupAllocator;
  private _drawableBindGroup: Nullable<BindGroup>;
  private readonly _params: Float32Array<ArrayBuffer>;
  private readonly _eye: Vector3;
  private readonly _center: Vector3;
  constructor(scene: Scene) {
    this._scene = scene;
    this._pass = new VoxelizePass();
    this._camera = new CameraNode(null);
    this._allocator = GlobalBindGroupAllocator.get();
    this._drawableBindGroup = null;
    this._params = new Float32Array(12);
    this._eye = new Vector3();
    this._center = new Vector3();
  }
  /**
   * Voxelizes a primitive with a material into the target.
   * @returns False when the material's program could not be built.
   */
  voxelize(primitive: Primitive, material: MeshMaterial, target: VoxelizeTarget): boolean {
    const device = getDevice();
    const res = target.slot.resolution;
    const n = Math.max(res[0], res[1], res[2], 1);
    const size = [res[0] * target.voxelSize, res[1] * target.voxelSize, res[2] * target.voxelSize];
    const half = Math.max(size[0], size[1], size[2]) * 0.5;
    this._center.setXYZ(
      target.boxMin[0] + size[0] * 0.5,
      target.boxMin[1] + size[1] * 0.5,
      target.boxMin[2] + size[2] * 0.5
    );
    this._params.set([...target.boxMin, target.voxelSize], 0);
    this._params.set([...target.slot.offset, 0], 4);
    this._params.set([...res, 0], 8);
    const ctx = this.createDrawContext(device);
    let fb: Nullable<FrameBuffer> = null;
    device.pushDeviceStates();
    try {
      fb = device.pool.fetchTemporalFramebuffer(false, n, n, 'rgba8unorm');
      device.setFramebuffer(fb);
      device.setViewport([0, 0, n, n]);
      device.setScissor([0, 0, n, n]);
      ctx.flip = this._pass.isAutoFlip(ctx);
      ctx.renderPassHash = this._pass.getGlobalBindGroupHash(ctx, this._camera);
      const bindGroup = this._allocator.getGlobalBindGroup(ctx);
      bindGroup.setTexture(VOXELIZE_ALBEDO, target.albedo);
      bindGroup.setTexture(VOXELIZE_EMISSIVE, target.emissive);
      bindGroup.setValue(VOXELIZE_PARAMS, this._params);
      device.setBindGroup(0, bindGroup);
      device.setBindGroup(1, this.getDrawableBindGroup());
      if (!material.apply(ctx)) {
        return false;
      }
      // One pixel per voxel: the view spans the box's largest side in n pixels
      const pixel = (2 * half) / n;
      for (const axis of AXES) {
        // Looking down the axis from outside the box, a symmetric orthographic
        // view wide enough for the box whichever way it is turned
        this._eye.set(this._center);
        this._eye.addBy(Vector3.scale(axis.dir, half + 1));
        this._camera.lookAt(this._eye, this._center, axis.up);
        for (let j = 0; j < VOXELIZE_JITTER * VOXELIZE_JITTER; j++) {
          // Sample positions spread evenly over the pixel
          const ox = (((j % VOXELIZE_JITTER) + 0.5) / VOXELIZE_JITTER - 0.5) * pixel;
          const oy = ((Math.floor(j / VOXELIZE_JITTER) + 0.5) / VOXELIZE_JITTER - 0.5) * pixel;
          this._camera.setProjectionMatrix(
            Matrix4x4.ortho(-half + ox, half + ox, -half + oy, half + oy, 1, 2 * half + 2)
          );
          ShaderHelper.setCameraUniforms(bindGroup, ctx, this._camera, true);
          material.draw(primitive, ctx);
        }
      }
      return true;
    } finally {
      device.popDeviceStates();
      if (fb) {
        device.pool.releaseFrameBuffer(fb);
      }
    }
  }
  dispose() {
    this._drawableBindGroup?.dispose();
    this._drawableBindGroup = null;
    GlobalBindGroupAllocator.release(this._allocator);
  }
  /** The mesh is drawn in its own space: an identity world matrix. @internal */
  private getDrawableBindGroup() {
    if (!this._drawableBindGroup) {
      const bindGroup = getDevice().createBindGroup(
        ShaderHelper.getDrawableBindGroupLayout(false, false, false)
      );
      const identity = Matrix4x4.identity();
      bindGroup.setValue(ShaderHelper.getWorldMatrixUniformName(), identity);
      bindGroup.setValue(ShaderHelper.getPrevWorldMatrixUniformName(), identity);
      bindGroup.setValue(ShaderHelper.getPrevWorldMatrixFrameUniformName(), 0);
      this._drawableBindGroup = bindGroup;
    }
    return this._drawableBindGroup;
  }
  /** @internal */
  private createDrawContext(device: DrawContext['device']): DrawContext {
    return {
      device,
      scene: this._scene,
      renderWidth: 1,
      renderHeight: 1,
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
      colorFormat: 'rgba8unorm',
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
