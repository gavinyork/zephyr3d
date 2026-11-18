import type { Immutable, Nullable } from '@zephyr3d/base';
import { Disposable, DRef, Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import { getDevice } from '../../app/api';
import type { AtmosphereParams } from '../../shaders/atmosphere';
import { fetchSampler } from '../../utility/misc';
import {
  CLOUD_SHADOW_EDGE_WIDTH,
  cloudSampleDensity,
  getCloudParamsStruct,
  raySphereSolutions
} from './cloud_common';
import type { VolumetricCloudResources } from './resources';
import { buildCloudParams } from './sky_cache';
import type { VolumetricCloud } from './volumetric_cloud';

/*
 * Volumetric cloud shadow map. An orthographic map seen from the sun stores per texel the depth
 * along the light where the clouds start, their mean extinction and the optical depth through the
 * whole layer; a receiver reconstructs its transmittance from its own depth along the light.
 *
 * Distances are planet-fixed meters, as the clouds are traced: the planet center at the origin,
 * the world axes, world positions scaled by the atmosphere's camera height scale and lifted by the
 * planet radius.
 */

/** Grid the map center snaps to, meters */
const SNAP_LENGTH = 20000;
/** Maximum map resolution */
const MAX_RESOLUTION = 2048;
/** Maximum samples per texel ray */
const RAY_SAMPLE_MAX_COUNT = 128;
/** Sample count multiplier with the sun at the horizon */
const RAY_SAMPLE_HORIZON_MULTIPLIER = 2;

/**
 * What a cloud shadow map is generated with: the settings of the directional light casting it.
 * @internal
 */
export interface CloudShadowSettings {
  /** Half the side the map covers is twice this, in planet meters */
  extent: number;
  resolutionScale: number;
  raySampleCountScale: number;
  strength: number;
  /** Planet meters, added to the front depth */
  depthBias: number;
}

/**
 * Uniforms receivers sample the map with.
 * @internal
 */
export interface CloudShadowUniforms {
  /** World position to map u, v and depth along the light in km: dot(row.xyz, p) + row.w */
  rowU: Vector4;
  rowV: Vector4;
  rowDepth: Vector4;
  /** (direction the light travels, far depth in km) */
  lightDir: Vector4;
  /** The same as rowU, rowV and rowDepth for planet-fixed positions, for the atmosphere */
  planetRowU: Vector4;
  planetRowV: Vector4;
  planetRowDepth: Vector4;
}

let traceProgram: Nullable<GPUProgram> = null;
let filterProgram: Nullable<GPUProgram> = null;

function getTraceProgram() {
  if (!traceProgram) {
    traceProgram = getDevice().buildComputeProgram({
      label: 'VolumetricCloudShadow',
      workgroupSize: [8, 8, 1],
      compute(pb) {
        const CloudParams = getCloudParamsStruct(pb);
        this.cloud = CloudParams().uniform(0);
        // (near plane origin, half width)
        this.lightPos = pb.vec4().uniform(0);
        this.axisX = pb.vec4().uniform(0);
        this.axisY = pb.vec4().uniform(0);
        // (direction the light travels, sample count)
        this.lightDir = pb.vec4().uniform(0);
        // (strength, depth bias km, far depth km, resolution)
        this.params = pb.vec4().uniform(0);
        this.weatherMap = pb.tex2D().uniform(0);
        this.baseNoise = pb.tex3D().uniform(0);
        this.detailNoise = pb.tex3D().uniform(0);
        this.dst = pb.texStorage2D.rgba16float().storage(0);
        pb.main(function () {
          this.$l.res = pb.uint(this.params.w);
          this.$if(
            pb.or(
              pb.greaterThanEqual(this.$builtins.globalInvocationId.x, this.res),
              pb.greaterThanEqual(this.$builtins.globalInvocationId.y, this.res)
            ),
            function () {
              this.$return();
            }
          );
          this.$l.texel = this.$builtins.globalInvocationId.xy;
          this.$l.uv = pb.div(pb.add(pb.vec2(this.texel), pb.vec2(0.5)), this.params.w);
          this.$l.ndc = pb.sub(pb.mul(this.uv, 2), pb.vec2(1));
          // The texel on the near plane
          this.$l.nearPos = pb.add(
            this.lightPos.xyz,
            pb.mul(this.axisX.xyz, pb.mul(this.ndc.x, this.lightPos.w)),
            pb.mul(this.axisY.xyz, pb.mul(this.ndc.y, this.lightPos.w))
          );
          this.$l.dir = this.lightDir.xyz;
          this.$l.farDepthKm = this.params.z;
          this.$l.tTop2 = raySphereSolutions(this, this.nearPos, this.dir, this.cloud.layer.y);
          this.$l.tBottom2 = raySphereSolutions(this, this.nearPos, this.dir, this.cloud.layer.x);
          this.$if(pb.and(pb.lessThan(this.tTop2.x, 0), pb.lessThan(this.tTop2.y, 0)), function () {
            // Misses the layer: no shadow
            pb.textureStore(this.dst, this.texel, pb.vec4(this.farDepthKm, 0, 0, 0));
            this.$return();
          });
          this.$l.tMin = pb.float(0);
          this.$l.tMax = pb.float(0);
          this.$if(pb.greaterThan(pb.abs(pb.sub(this.tBottom2.x, this.tBottom2.y)), 0), function () {
            this.$if(pb.not(pb.all(pb.greaterThan(this.tBottom2, pb.vec2(0)))), function () {
              // Starts below the layer: nothing to trace
              pb.textureStore(this.dst, this.texel, pb.vec4(0));
              this.$return();
            });
            this.$l.tempTop = pb.max(0, pb.min(this.tTop2.x, this.tTop2.y));
            this.$l.tempBottom = pb.min(this.tBottom2.x, this.tBottom2.y);
            this.tMin = pb.min(this.tempBottom, this.tempTop);
            this.tMax = pb.max(this.tempBottom, this.tempTop);
          }).$else(function () {
            this.tMin = this.tTop2.x;
            this.tMax = this.tTop2.y;
          });
          this.tMin = pb.max(this.tMin, 0);
          this.tMax = pb.max(this.tMax, 0);
          this.$l.layerPos = pb.add(this.nearPos, pb.mul(this.dir, this.tMin));
          this.$l.length = pb.sub(this.tMax, this.tMin);
          this.$l.sampleCount = this.lightDir.w;
          this.$l.dt = pb.div(this.length, this.sampleCount);
          // Distances here and in the map are relative to the near plane
          this.$l.nearDepth = pb.mul(this.farDepthKm, 1000);
          this.$l.extinctionAcc = pb.float(0);
          this.$l.extinctionCount = pb.float(0);
          this.$l.opticalDepth = pb.float(0);
          // Sample midpoints, no jitter
          this.$for(pb.int('i'), 0, pb.int(this.sampleCount), function () {
            this.$l.sampleT = pb.mul(this.length, pb.div(pb.add(pb.float(this.i), 0.5), this.sampleCount));
            this.$l.medium = cloudSampleDensity(
              this,
              this.cloud,
              pb.add(this.layerPos, pb.mul(this.dir, this.sampleT)),
              this.weatherMap,
              this.baseNoise,
              this.detailNoise,
              'density',
              CLOUD_SHADOW_EDGE_WIDTH
            );
            // Conservative density: skip empty space
            this.$if(pb.lessThanEqual(this.medium.y, 0), function () {
              this.$continue();
            });
            this.$l.extinction = this.medium.x;
            this.$if(pb.greaterThan(this.extinction, 0), function () {
              this.nearDepth = pb.min(this.nearDepth, this.sampleT);
              this.extinctionCount = pb.add(this.extinctionCount, 1);
            });
            this.extinctionAcc = pb.add(this.extinctionAcc, this.extinction);
            this.opticalDepth = pb.add(this.opticalDepth, pb.mul(this.extinction, this.dt));
          });
          this.$l.meanExtinction = pb.mul(
            this.params.x,
            pb.div(this.extinctionAcc, pb.max(1, this.extinctionCount))
          );
          this.$l.maxOpticalDepth = pb.mul(this.params.x, this.opticalDepth);
          this.$l.frontDepthKm = pb.mul(
            this.$choice(pb.equal(this.extinctionCount, 0), this.tMax, pb.add(this.tMin, this.nearDepth)),
            0.001
          );
          pb.textureStore(
            this.dst,
            this.texel,
            pb.vec4(
              pb.max(0, pb.add(this.frontDepthKm, this.params.y)),
              this.meanExtinction,
              this.maxOpticalDepth,
              0
            )
          );
        });
      }
    })!;
  }
  return traceProgram;
}

function getFilterProgram() {
  if (!filterProgram) {
    filterProgram = getDevice().buildComputeProgram({
      label: 'VolumetricCloudShadowFilter',
      workgroupSize: [8, 8, 1],
      compute(pb) {
        this.src = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.size = pb.uint().uniform(0);
        this.dst = pb.texStorage2D.rgba16float().storage(0);
        pb.main(function () {
          this.$if(
            pb.or(
              pb.greaterThanEqual(this.$builtins.globalInvocationId.x, this.size),
              pb.greaterThanEqual(this.$builtins.globalInvocationId.y, this.size)
            ),
            function () {
              this.$return();
            }
          );
          this.$l.texel = this.$builtins.globalInvocationId.xy;
          this.$l.p = pb.ivec2(pb.mul(this.texel, 2));
          this.$l.d0 = pb.textureLoad(this.src, this.p, 0);
          this.$l.d1 = pb.textureLoad(this.src, pb.add(this.p, pb.ivec2(1, 0)), 0);
          this.$l.d2 = pb.textureLoad(this.src, pb.add(this.p, pb.ivec2(1, 1)), 0);
          this.$l.d3 = pb.textureLoad(this.src, pb.add(this.p, pb.ivec2(0, 1)), 0);
          // A plain 2x2 average of all channels, depth included
          pb.textureStore(this.dst, this.texel, pb.mul(pb.add(this.d0, this.d1, this.d2, this.d3), 0.25));
        });
      }
    })!;
  }
  return filterProgram;
}

/**
 * Cloud shadow map of the sun.
 * @internal
 */
export class VolumetricCloudShadowMap extends Disposable {
  private readonly _traceTexture: DRef<Texture2D>;
  private readonly _texture: DRef<Texture2D>;
  private readonly _bindGroups: Map<GPUProgram, BindGroup>;
  private readonly _uniforms: CloudShadowUniforms;
  constructor() {
    super();
    this._traceTexture = new DRef();
    this._texture = new DRef();
    this._bindGroups = new Map();
    this._uniforms = {
      rowU: new Vector4(),
      rowV: new Vector4(),
      rowDepth: new Vector4(),
      lightDir: new Vector4(),
      planetRowU: new Vector4(),
      planetRowV: new Vector4(),
      planetRowDepth: new Vector4()
    };
  }
  /** The map, after {@link VolumetricCloudShadowMap.update}: (front depth km, mean extinction, max optical depth) */
  get texture() {
    return this._texture.get();
  }
  get uniforms(): Immutable<CloudShadowUniforms> {
    return this._uniforms;
  }
  /**
   * Traces the map for this frame.
   *
   * @param sunDir - World direction towards the sun
   * @param cameraPos - World position of the camera the map is centered on
   * @param time - Seconds, drives the wind
   * @returns Whether the map is ready to sample
   */
  update(
    cloud: VolumetricCloud,
    resources: VolumetricCloudResources,
    atmosphere: AtmosphereParams,
    settings: CloudShadowSettings,
    sunDir: Immutable<Vector3>,
    cameraPos: Immutable<Vector3>,
    time: number
  ) {
    if (!resources.baseNoise || !resources.detailNoise || !resources.weatherMap) {
      return false;
    }
    const traceRes = Math.max(8, Math.min(Math.floor(512 * settings.resolutionScale), MAX_RESOLUTION)) & ~1;
    const res = traceRes >> 1;
    this._ensureTextures(traceRes, res);
    const R = atmosphere.plantRadius;
    const scale = atmosphere.cameraHeightScale;
    const extent = settings.extent;
    // The map covers twice the extent on each side, with the light twice the extent away and the
    // far plane at twice that.
    const halfWidth = 2 * extent;
    const lightDistance = 2 * extent;
    const farDepth = 2 * lightDistance;
    // Direction the light travels
    const dir = new Vector3(-sunDir.x, -sunDir.y, -sunDir.z).inplaceNormalize();
    // Anchored on the ground under the camera, snapped
    const camPlanet = new Vector3(cameraPos.x * scale, R + cameraPos.y * scale, cameraPos.z * scale);
    const up = Vector3.normalize(camPlanet);
    const lookAt = Vector3.scale(up, R);
    lookAt.setXYZ(
      Math.floor((lookAt.x + 0.5 * SNAP_LENGTH) / SNAP_LENGTH) * SNAP_LENGTH,
      Math.floor((lookAt.y + 0.5 * SNAP_LENGTH) / SNAP_LENGTH) * SNAP_LENGTH,
      Math.floor((lookAt.z + 0.5 * SNAP_LENGTH) / SNAP_LENGTH) * SNAP_LENGTH
    );
    const lightPos = Vector3.sub(lookAt, Vector3.scale(dir, lightDistance));
    const ref = Math.abs(dir.y) > 0.99 ? Vector3.axisPZ() : Vector3.axisPY();
    const axisX = Vector3.cross(ref, dir).inplaceNormalize();
    const axisY = Vector3.cross(dir, axisX).inplaceNormalize();
    // Snap so the planet origin lands on a texel of the filtered map
    const grid = traceRes / 4;
    for (const axis of [axisX, axisY]) {
      const c = -Vector3.dot(lightPos, axis) / halfWidth;
      const snapped = Math.round(c * grid) / grid;
      lightPos.subBy(Vector3.scale(axis, (snapped - c) * halfWidth));
    }
    // Sample count, doubled towards the horizon
    const count = Math.max(4, Math.min(16 * settings.raySampleCountScale, RAY_SAMPLE_MAX_COUNT));
    const horizon = Math.min(1, Math.max(0, 0.2 / Math.max(1e-6, Math.abs(Vector3.dot(up, sunDir)))));
    const sampleCount = Math.max(
      1,
      Math.round(count + (RAY_SAMPLE_HORIZON_MULTIPLIER - 1) * count * horizon)
    );

    const device = getDevice();
    const trace = getTraceProgram();
    const bindGroup = this._bindGroup(trace);
    bindGroup.setValue('cloud', buildCloudParams(cloud, atmosphere, time, Matrix4x4.identity(), R));
    bindGroup.setValue('lightPos', new Vector4(lightPos.x, lightPos.y, lightPos.z, halfWidth));
    bindGroup.setValue('axisX', new Vector4(axisX.x, axisX.y, axisX.z, 0));
    bindGroup.setValue('axisY', new Vector4(axisY.x, axisY.y, axisY.z, 0));
    bindGroup.setValue('lightDir', new Vector4(dir.x, dir.y, dir.z, sampleCount));
    bindGroup.setValue(
      'params',
      new Vector4(settings.strength, settings.depthBias * 0.001, farDepth * 0.001, traceRes)
    );
    bindGroup.setTexture('weatherMap', resources.weatherMap, fetchSampler('repeat_linear'));
    // Their own samplers: the predefined ones leave the w axis clamped
    bindGroup.setTexture('baseNoise', resources.baseNoise);
    bindGroup.setTexture('detailNoise', resources.detailNoise);
    bindGroup.setTexture('dst', this._traceTexture.get()!);
    device.setProgram(trace);
    device.setBindGroup(0, bindGroup);
    device.compute(Math.ceil(traceRes / 8), Math.ceil(traceRes / 8), 1);
    // One 2x2 downsample
    const filter = getFilterProgram();
    const filterBindGroup = this._bindGroup(filter);
    filterBindGroup.setTexture('src', this._traceTexture.get()!, fetchSampler('clamp_nearest_nomip'));
    filterBindGroup.setValue('size', res);
    filterBindGroup.setTexture('dst', this._texture.get()!);
    device.setProgram(filter);
    device.setBindGroup(0, filterBindGroup);
    device.compute(Math.ceil(res / 8), Math.ceil(res / 8), 1);

    // World to map: planet = world * scale + (0, R, 0), relative to the near plane origin
    const base = new Vector3(-lightPos.x, R - lightPos.y, -lightPos.z);
    const u = this._uniforms;
    const k = 0.5 / halfWidth;
    u.rowU.setXYZW(
      axisX.x * scale * k,
      axisX.y * scale * k,
      axisX.z * scale * k,
      0.5 + Vector3.dot(base, axisX) * k
    );
    u.rowV.setXYZW(
      axisY.x * scale * k,
      axisY.y * scale * k,
      axisY.z * scale * k,
      0.5 + Vector3.dot(base, axisY) * k
    );
    u.rowDepth.setXYZW(
      dir.x * scale * 0.001,
      dir.y * scale * 0.001,
      dir.z * scale * 0.001,
      Vector3.dot(base, dir) * 0.001
    );
    u.lightDir.setXYZW(dir.x, dir.y, dir.z, farDepth * 0.001);
    u.planetRowU.setXYZW(axisX.x * k, axisX.y * k, axisX.z * k, 0.5 - Vector3.dot(lightPos, axisX) * k);
    u.planetRowV.setXYZW(axisY.x * k, axisY.y * k, axisY.z * k, 0.5 - Vector3.dot(lightPos, axisY) * k);
    u.planetRowDepth.setXYZW(
      dir.x * 0.001,
      dir.y * 0.001,
      dir.z * 0.001,
      -Vector3.dot(lightPos, dir) * 0.001
    );
    return true;
  }
  protected onDispose() {
    super.onDispose();
    this._traceTexture.dispose();
    this._texture.dispose();
    for (const bindGroup of this._bindGroups.values()) {
      bindGroup.dispose();
    }
    this._bindGroups.clear();
  }
  private _ensureTextures(traceRes: number, res: number) {
    const device = getDevice();
    if (this._traceTexture.get()?.width !== traceRes) {
      const tex = device.createTexture2D('rgba16f', traceRes, traceRes, {
        writable: true,
        mipmapping: false
      })!;
      tex.name = 'VolumetricCloudShadowTrace';
      this._traceTexture.set(tex);
    }
    if (this._texture.get()?.width !== res) {
      const tex = device.createTexture2D('rgba16f', res, res, {
        writable: true,
        mipmapping: false,
        samplerOptions: { addressU: 'clamp', addressV: 'clamp', mipFilter: 'none' }
      })!;
      tex.name = 'VolumetricCloudShadowMap';
      this._texture.set(tex);
    }
  }
  private _bindGroup(program: GPUProgram) {
    let bindGroup = this._bindGroups.get(program);
    if (!bindGroup) {
      bindGroup = getDevice().createBindGroup(program.bindGroupLayouts[0]);
      this._bindGroups.set(program, bindGroup);
    }
    return bindGroup;
  }
}
