import type { BindGroup, FrameBuffer, Texture2D } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { AABB, DEPTH_CLEAR_VALUE, Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import { RenderPass } from '../renderpass';
import { RENDER_PASS_TYPE_CAPTURE } from '../../values';
import type { DrawContext } from '../drawable';
import type { RenderQueue } from '../render_queue';
import type { Camera } from '../../camera/camera';
import { Camera as CameraNode } from '../../camera/camera';
import type { Scene } from '../../scene/scene';
import type { Primitive } from '../primitive';
import type { MeshMaterial } from '../../material/meshmaterial';
import { ShaderHelper, SURFACE_CAPTURE_PARAMS } from '../../material/shader/helper';
import { GlobalBindGroupAllocator } from '../globalbindgroup_allocator';
import { impostorFrameBasis, impostorGridToVector } from './octahedral';

/**
 * The render pass meshes are captured in for impostors. Only its type and hash take part: the
 * baker drives the draws itself rather than culling a scene.
 * @internal
 */
export class SurfaceCapturePass extends RenderPass {
  constructor() {
    super(RENDER_PASS_TYPE_CAPTURE);
  }
  /** @internal */
  protected _getGlobalBindGroupHash(_ctx: DrawContext) {
    return '';
  }
  /** @internal */
  protected renderItems(_ctx: DrawContext, _camera: Camera, _renderQueue: RenderQueue) {
    throw new Error('SurfaceCapturePass: use ImpostorBaker.bake()');
  }
}

/**
 * A mesh of the object an impostor is baked from
 * @public
 */
export interface ImpostorBakePart {
  primitive: Primitive;
  material: MeshMaterial;
  /** Transform of the mesh relative to the object */
  matrix: Matrix4x4;
}

/**
 * Settings of an impostor bake
 * @public
 */
export interface ImpostorBakeSettings {
  /** Frames along each side of the grid. Default 12. */
  frames: number;
  /** Edge of the base colour atlas in pixels. Default 2048. */
  atlasSize: number;
  /** The normal and depth, and the occlusion, roughness and metallic atlases are this many times smaller. Default 2. */
  detailDivider: number;
  /** Only views from above the horizon, for objects such as trees. Default true. */
  hemisphere: boolean;
  /**
   * Level of detail of the meshes drawn, clamped to the levels each has. Default 0. Bake from the
   * level the meshes are at where the impostor takes over, so the swap does not change the detail.
   */
  lod: number;
}

/**
 * Atlases and placement of a baked impostor
 * @public
 */
export interface ImpostorBakeResult {
  settings: ImpostorBakeSettings;
  /** Centre of the bounding sphere of the object, in its own space */
  center: [number, number, number];
  /** Radius of the bounding sphere: each frame spans its diameter */
  radius: number;
  /**
   * Base colour and opacity, atlasSize² RGBA8. The atlases are upright images, row 0 at the top:
   * frame (i, j) has its lower left corner at (i, j) · cell from the lower left of the atlas, and
   * the image of a frame has its y axis (see impostorFrameBasis) going up. Sampled from an image
   * loaded as it is, the vertical texture coordinate is 1 - v of that layout.
   */
  base: Uint8Array;
  /** Normal in the object's space (RGB, 0.5 + 0.5·n) and depth towards the view (A, 1 nearest), at the detail size */
  normalDepth: Uint8Array;
  /** Occlusion, roughness, metallic, at the detail size */
  orm: Uint8Array;
  /** Edge of the normal-depth and occlusion atlases */
  detailSize: number;
  /** Meshes whose material could only give its colour, see MeshMaterial.supportsSurfaceCapture */
  uncapturedMaterials: string[];
}

/** Default bake settings, see {@link ImpostorBakeSettings} */
export function defaultImpostorBakeSettings(): ImpostorBakeSettings {
  return { frames: 12, atlasSize: 2048, detailDivider: 2, hemisphere: true, lod: 0 };
}

/**
 * Bakes octahedral impostors: the object is drawn with its materials from frames x frames
 * directions of a hemi-octahedral (or octahedral) grid into one atlas, each frame an orthographic
 * view fitting its bounding sphere, capturing the surface attributes the lighting uses rather than
 * a lit colour, so that the impostor is shaded with the same lighting as the object.
 *
 * @remarks
 * Follows the Godot Octahedral Impostors baker (wojtekpil, MIT, `multi_bake_scene.gd`): an
 * orthographic camera sized to the bounding box diagonal, aimed at the box centre from
 * grid_to_vector(frame / (N - 1)). Frames are drawn one viewport each rather than as N² copies.
 * Empty pixels are then filled from their nearest covered neighbours, ring by ring, as UE
 * ImpostorBaker's M_Sample_Frame does, so that mipmaps do not bleed the background in.
 *
 * @public
 */
export class ImpostorBaker {
  private readonly _scene: Scene;
  private readonly _pass: SurfaceCapturePass;
  private readonly _camera: CameraNode;
  private readonly _allocator: GlobalBindGroupAllocator;
  private readonly _params: Float32Array<ArrayBuffer>;
  constructor(scene: Scene) {
    this._scene = scene;
    this._pass = new SurfaceCapturePass();
    this._camera = new CameraNode(null);
    this._allocator = GlobalBindGroupAllocator.get();
    this._params = new Float32Array(8);
  }
  /**
   * Bakes an impostor of an object made of meshes
   * @param parts - The meshes of the object
   * @param settings - Bake settings; omitted ones take their defaults
   * @returns The atlases, or null when the object has no bounds
   */
  async bake(
    parts: ImpostorBakePart[],
    settings?: Partial<ImpostorBakeSettings>
  ): Promise<Nullable<ImpostorBakeResult>> {
    const s: ImpostorBakeSettings = { ...defaultImpostorBakeSettings(), ...(settings ?? {}) };
    s.frames = Math.max(2, Math.floor(s.frames));
    s.detailDivider = Math.max(1, Math.floor(s.detailDivider));
    s.lod = Math.max(0, Math.floor(s.lod));
    const cell = Math.max(1, Math.floor(s.atlasSize / s.frames));
    const size = cell * s.frames;
    s.atlasSize = size;
    let bounds: Nullable<AABB> = null;
    for (const part of parts) {
      const box = part.primitive.getBoundingVolume()?.toAABB();
      if (box) {
        const world = AABB.transform(box, part.matrix);
        if (bounds) {
          bounds.union(world);
        } else {
          bounds = world;
        }
      }
    }
    if (!bounds || !bounds.isValid()) {
      return null;
    }
    const center = Vector3.scale(Vector3.add(bounds.minPoint, bounds.maxPoint), 0.5);
    const radius = Math.max(Vector3.distance(bounds.minPoint, bounds.maxPoint) * 0.5, 1e-4);
    const device = getDevice();
    const targets: Texture2D[] = [];
    let fb: Nullable<FrameBuffer> = null;
    const drawableBindGroups: BindGroup[] = [];
    const uncaptured = new Set<string>();
    const base = new Uint8Array(size * size * 4);
    const normalDepth = new Uint8Array(size * size * 4);
    const orm = new Uint8Array(size * size * 4);
    device.pushDeviceStates();
    try {
      for (let i = 0; i < 3; i++) {
        // Base colour encoded as sRGB, as colour textures are stored and loaded
        const tex = device.createTexture2D(i === 0 ? 'rgba8unorm-srgb' : 'rgba8unorm', size, size, {
          mipmapping: false
        });
        if (!tex) {
          throw new Error(`ImpostorBaker: cannot create a ${size}x${size} target`);
        }
        targets.push(tex);
      }
      const depth = device.createTexture2D('d32f', size, size, { mipmapping: false })!;
      targets.push(depth);
      fb = device.createFrameBuffer(targets.slice(0, 3), depth);
      device.setFramebuffer(fb);
      device.setViewport(null);
      device.setScissor(null);
      device.clearFrameBuffer(new Vector4(0, 0, 0, 0), DEPTH_CLEAR_VALUE, 0);
      const ctx = this.createDrawContext(device);
      ctx.flip = this._pass.isAutoFlip(ctx);
      ctx.renderPassHash = this._pass.getGlobalBindGroupHash(ctx, this._camera);
      const bindGroup = this._allocator.getGlobalBindGroup(ctx);
      device.setBindGroup(0, bindGroup);
      for (const part of parts) {
        drawableBindGroups.push(this.createDrawableBindGroup(part.matrix));
        if (!part.material.supportsSurfaceCapture()) {
          uncaptured.add(part.material.constructor.name);
        }
      }
      const windingReversed = device.isWindingOrderReversed();
      device.reverseVertexWindingOrder(ctx.flip ? !windingReversed : windingReversed);
      const dir = new Vector3();
      const eye = new Vector3();
      this._camera.setProjectionMatrix(Matrix4x4.ortho(-radius, radius, -radius, radius, radius, 3 * radius));
      for (let j = 0; j < s.frames; j++) {
        for (let i = 0; i < s.frames; i++) {
          impostorGridToVector(i / (s.frames - 1), j / (s.frames - 1), s.hemisphere, dir);
          const basis = impostorFrameBasis(dir);
          eye.set(Vector3.add(center, Vector3.scale(dir, 2 * radius)));
          this._camera.lookAt(eye, center, basis.up);
          device.setViewport([i * cell, j * cell, cell, cell]);
          device.setScissor([i * cell, j * cell, cell, cell]);
          this._params.set([center.x, center.y, center.z, radius, dir.x, dir.y, dir.z, 0]);
          bindGroup.setValue(SURFACE_CAPTURE_PARAMS, this._params);
          ShaderHelper.setCameraUniforms(bindGroup, ctx, this._camera, true);
          for (let k = 0; k < parts.length; k++) {
            device.setBindGroup(0, bindGroup);
            device.setBindGroup(1, drawableBindGroups[k]);
            ctx.primitiveLod = Math.min(s.lod, parts[k].primitive.lodCount - 1);
            if (parts[k].material.apply(ctx)) {
              parts[k].material.draw(parts[k].primitive, ctx);
            }
          }
        }
      }
      device.reverseVertexWindingOrder(windingReversed);
      await targets[0].readPixels(0, 0, size, size, 0, 0, base);
      await targets[1].readPixels(0, 0, size, size, 0, 0, normalDepth);
      await targets[2].readPixels(0, 0, size, size, 0, 0, orm);
    } finally {
      device.popDeviceStates();
      fb?.dispose();
      for (const t of targets) {
        t.dispose();
      }
      for (const b of drawableBindGroups) {
        b.dispose();
      }
    }
    // Read back as the target is laid out, from the bottom row up; stored as images, top down
    flipRows(base, size);
    flipRows(normalDepth, size);
    flipRows(orm, size);
    const coverage = new Uint8Array(size * size);
    for (let p = 0; p < size * size; p++) {
      coverage[p] = base[p * 4 + 3] > 0 ? 1 : 0;
    }
    dilate(cell, s.frames, coverage, [base, normalDepth, orm], [3, 4, 4]);
    const detailSize = Math.max(1, Math.floor(size / s.detailDivider));
    return {
      settings: s,
      center: [center.x, center.y, center.z],
      radius,
      base,
      normalDepth: downsample(normalDepth, size, detailSize),
      orm: downsample(orm, size, detailSize),
      detailSize,
      uncapturedMaterials: [...uncaptured]
    };
  }
  dispose() {
    GlobalBindGroupAllocator.release(this._allocator);
  }
  /** Places a mesh in the object's space */
  private createDrawableBindGroup(matrix: Matrix4x4) {
    const bindGroup = getDevice().createBindGroup(
      ShaderHelper.getDrawableBindGroupLayout(false, false, false)
    );
    bindGroup.setValue(ShaderHelper.getWorldMatrixUniformName(), matrix);
    bindGroup.setValue(ShaderHelper.getPrevWorldMatrixUniformName(), matrix);
    bindGroup.setValue(ShaderHelper.getPrevWorldMatrixFrameUniformName(), 0);
    return bindGroup;
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

function flipRows(data: Uint8Array, size: number) {
  const row = size * 4;
  const tmp = new Uint8Array(row);
  for (let y = 0; y < size >> 1; y++) {
    const a = y * row;
    const b = (size - 1 - y) * row;
    tmp.set(data.subarray(a, a + row));
    data.copyWithin(a, b, b + row);
    data.set(tmp, b);
  }
}

/**
 * Fills the empty pixels of every frame from their covered 8-neighbours, ring by ring, as UE
 * ImpostorBaker's M_Sample_Frame. Stays within each frame, so frames do not bleed into each other.
 * Opacity is left at 0 where there is no surface.
 *
 * @param channels - Channels to fill of each image: 3 keeps the alpha of the base colour
 */
function dilate(
  cell: number,
  frames: number,
  coverage: Uint8Array,
  images: Uint8Array[],
  channels: number[]
) {
  const size = cell * frames;
  let frontier: number[] = [];
  for (let p = 0; p < size * size; p++) {
    if (!coverage[p]) {
      frontier.push(p);
    }
  }
  for (let ring = 0; ring < cell && frontier.length > 0; ring++) {
    const filled: number[] = [];
    const remaining: number[] = [];
    for (const p of frontier) {
      const x = p % size;
      const y = (p / size) | 0;
      const fx0 = x - (x % cell);
      const fy0 = y - (y % cell);
      let n = 0;
      const acc: number[][] = images.map(() => [0, 0, 0, 0]);
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < fy0 || yy >= fy0 + cell) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < fx0 || xx >= fx0 + cell) {
            continue;
          }
          const q = yy * size + xx;
          if (coverage[q]) {
            n++;
            images.forEach((img, k) => {
              for (let c = 0; c < channels[k]; c++) {
                acc[k][c] += img[q * 4 + c];
              }
            });
          }
        }
      }
      if (n > 0) {
        images.forEach((img, k) => {
          for (let c = 0; c < channels[k]; c++) {
            img[p * 4 + c] = Math.round(acc[k][c] / n);
          }
        });
        filled.push(p);
      } else {
        remaining.push(p);
      }
    }
    if (filled.length === 0) {
      break;
    }
    for (const p of filled) {
      coverage[p] = 1;
    }
    frontier = remaining;
  }
}

/** Box-filters an RGBA8 image down to a smaller square */
function downsample(src: Uint8Array, size: number, target: number) {
  if (target === size) {
    return src;
  }
  const out = new Uint8Array(target * target * 4);
  const scale = size / target;
  for (let y = 0; y < target; y++) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
    for (let x = 0; x < target; x++) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const q = (yy * size + xx) * 4;
          acc[0] += src[q];
          acc[1] += src[q + 1];
          acc[2] += src[q + 2];
          acc[3] += src[q + 3];
          n++;
        }
      }
      const o = (y * target + x) * 4;
      out[o] = Math.round(acc[0] / n);
      out[o + 1] = Math.round(acc[1] / n);
      out[o + 2] = Math.round(acc[2] / n);
      out[o + 3] = Math.round(acc[3] / n);
    }
  }
  return out;
}
