import type { Immutable, Nullable } from '@zephyr3d/base';
import { Disposable, DRef, Matrix4x4, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import { getDevice } from '../../app/api';
import type { AtmosphereParams } from '../../shaders/atmosphere';
import {
  getAtmosphereParamsStruct,
  getMultiScatteringLut,
  getTransmittanceLut
} from '../../shaders/atmosphere';
import { fetchSampler } from '../../utility/misc';
import { uniformSphereSamples } from '../../values';
import {
  CLOUD_BASE_SHADOW_SAMPLE_COUNT,
  CLOUD_BASE_VIEW_SAMPLE_COUNT,
  CLOUD_SHADOW_SAMPLE_COUNT_MAX,
  CLOUD_TOP_OFFSET,
  CLOUD_VIEW_SAMPLE_COUNT_MAX,
  cloudCacheDecode,
  cloudCoverageThreshold,
  cloudDistantSkyLight,
  cloudTrace,
  getCloudParamsStruct
} from './cloud_common';
import type { VolumetricCloudResources } from './resources';
import type { VolumetricCloud } from './volumetric_cloud';

/*
 * Volumetric clouds cached over the sky hemisphere, after clayjohn's
 * godot-volumetric-cloud-demo-v2 (cloud_sky.gd): the clouds seen from below the layer depend on
 * the view direction only, so they are traced into an octahedral map of the hemisphere one block
 * per frame. Three maps rotate: one is being written while the sky blends between the two that
 * were completed last, by the progress of the one being written. Every input of a round (eye,
 * sun, time, parameters) is frozen when it starts so the blocks of one map agree.
 */

/** A rebuild needs enough steps to resolve cloud edges before the regular rounds finish. */
const REBUILD_STEP_SCALE = 0.5;
/** Margin added below the horizon dip, radians */
const HORIZON_MARGIN = Math.PI / 180;

let traceProgram: Nullable<GPUProgram>[] = [null, null, null];
let ambientProgram: Nullable<GPUProgram> = null;

function getTraceProgram(msOctaves: number) {
  let program = traceProgram[msOctaves];
  if (!program) {
    const msCount = 1 + msOctaves;
    program = getDevice().buildComputeProgram({
      label: `VolumetricCloudSkyCache${msCount}`,
      workgroupSize: [8, 8, 1],
      compute(pb) {
        const AtmosphereParams = getAtmosphereParamsStruct(pb);
        const CloudParams = getCloudParamsStruct(pb);
        this.atmo = AtmosphereParams().uniform(0);
        this.cloud = CloudParams().uniform(0);
        // (block origin x, y, cache size, step scale)
        this.block = pb.vec4().uniform(0);
        // (delta, 0, 0, 0)
        this.cacheParams = pb.vec4().uniform(0);
        this.weatherMap = pb.tex2D().uniform(0);
        this.baseNoise = pb.tex3D().uniform(0);
        this.detailNoise = pb.tex3D().uniform(0);
        this.tLut = pb.tex2D().uniform(0);
        this.msLut = pb.tex2D().uniform(0);
        this.ambientTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.dst = pb.texStorage2D.rgba16float().storage(0);
        pb.main(function () {
          this.$l.texel = pb.add(pb.uvec2(this.block.xy), this.$builtins.globalInvocationId.xy);
          this.$l.uv = pb.div(pb.add(pb.vec2(this.texel), pb.vec2(0.5)), this.block.z);
          this.$l.dir = cloudCacheDecode(this, this.uv, this.cacheParams.x);
          this.$l.ambient = pb.textureLoad(this.ambientTex, pb.ivec2(0), 0).rgb;
          // Every cache texel is traced once per round, so a fixed screen-space noise phase
          // survives the map blend as a visible grid. Sample each segment at its midpoint.
          this.$l.jitter = pb.float(0.5);
          this.$l.result = cloudTrace(
            this,
            msCount,
            this.atmo,
            this.cloud,
            this.dir,
            this.jitter,
            this.block.w,
            this.ambient,
            {
              weatherMap: this.weatherMap,
              baseNoise: this.baseNoise,
              detailNoise: this.detailNoise,
              transmittanceLut: this.tLut,
              multiScatteringLut: this.msLut
            }
          );
          pb.textureStore(this.dst, this.texel, this.result);
        });
      }
    })!;
    traceProgram[msOctaves] = program;
  }
  return program;
}

function getAmbientProgram() {
  if (!ambientProgram) {
    ambientProgram = getDevice().buildComputeProgram({
      label: 'VolumetricCloudDistantSkyLight',
      workgroupSize: [1, 1, 1],
      compute(pb) {
        const AtmosphereParams = getAtmosphereParamsStruct(pb);
        this.atmo = AtmosphereParams().uniform(0);
        this.sphereSamples = pb.vec4[64]().uniformBuffer(0);
        this.tLut = pb.tex2D().uniform(0);
        this.msLut = pb.tex2D().uniform(0);
        this.dst = pb.texStorage2D.rgba16float().storage(0);
        pb.main(function () {
          this.$l.light = cloudDistantSkyLight(this, this.atmo, this.sphereSamples, this.tLut, this.msLut);
          pb.textureStore(this.dst, pb.uvec2(0), pb.vec4(this.light, 1));
        });
      }
    })!;
  }
  return ambientProgram;
}

/** Inputs of one round, frozen when it starts. */
type RoundInputs = {
  atmosphere: AtmosphereParams;
  cloud: Record<string, Vector4 | Matrix4x4>;
  delta: number;
  msOctaves: number;
  version: number;
  sunDir: Vector3;
  cameraPos: Vector3;
};

function cloneAtmosphere(p: AtmosphereParams): AtmosphereParams {
  return {
    ...p,
    groundAlbedo: new Vector3(p.groundAlbedo),
    cameraWorldMatrix: new Matrix4x4(p.cameraWorldMatrix),
    lightDir: new Vector3(p.lightDir),
    lightColor: new Vector4(p.lightColor),
    skyViewReferential: new Matrix4x4(p.skyViewReferential)
  };
}

/**
 * Octahedral hemisphere cache of the volumetric clouds.
 * @internal
 */
export class VolumetricCloudSkyCache extends Disposable {
  private readonly _maps: DRef<Texture2D>[];
  private readonly _ambient: DRef<Texture2D>;
  /** Elevation remap each map was traced with */
  private readonly _deltas: number[];
  private _writeIndex: number;
  private _fromIndex: number;
  private _toIndex: number;
  private _frame: number;
  private _framesPerUpdate: number;
  private _resolution: number;
  private _inputs: Nullable<RoundInputs>;
  private _rebuild: boolean;
  private readonly _bindGroups: Map<GPUProgram, BindGroup>;
  private _sphereSamplesUploaded: boolean;
  /** Set when a round completed this frame, i.e. the blended sky changed source maps */
  roundCompleted: boolean;
  constructor() {
    super();
    this._maps = [new DRef(), new DRef(), new DRef()];
    this._ambient = new DRef();
    this._deltas = [0, 0, 0];
    this._writeIndex = 0;
    this._fromIndex = 1;
    this._toIndex = 2;
    this._frame = 0;
    this._framesPerUpdate = 0;
    this._resolution = 0;
    this._inputs = null;
    this._rebuild = true;
    this._bindGroups = new Map();
    this._sphereSamplesUploaded = false;
    this.roundCompleted = false;
  }
  /** Older of the two completed maps the sky blends from */
  get fromMap() {
    return this._maps[this._fromIndex].get();
  }
  /** Newer of the two completed maps the sky blends to */
  get toMap() {
    return this._maps[this._toIndex].get();
  }
  get fromDelta() {
    return this._deltas[this._fromIndex];
  }
  get toDelta() {
    return this._deltas[this._toIndex];
  }
  /** Progress of the round in flight, the weight of {@link VolumetricCloudSkyCache.toMap} */
  get blend() {
    return this._framesPerUpdate > 0 ? this._frame / this._framesPerUpdate : 1;
  }
  /** Frozen density inputs, shared with density debug slices. */
  get densityParams() {
    return this._inputs?.cloud ?? null;
  }
  /** Forces the next update to rebuild the whole cache at once. */
  invalidate() {
    this._rebuild = true;
  }
  /**
   * Advances the cache by one block, or rebuilds it at once when the inputs changed too much for
   * a gradual update.
   *
   * @param atmosphere - Current atmosphere parameters (observer frame, sun, luminance units)
   * @param cameraPos - Camera world position
   * @param time - Seconds, drives the wind
   */
  update(
    params: VolumetricCloud,
    resources: VolumetricCloudResources,
    atmosphere: AtmosphereParams,
    cameraPos: Immutable<Vector3>,
    time: number
  ) {
    this.roundCompleted = false;
    if (!resources.baseNoise || !resources.detailNoise || !resources.weatherMap) {
      return;
    }
    if (params.cacheResolution !== this._resolution || params.framesPerUpdate !== this._framesPerUpdate) {
      this._resolution = params.cacheResolution;
      this._framesPerUpdate = params.framesPerUpdate;
      for (const map of this._maps) {
        map.dispose();
      }
      this._rebuild = true;
    }
    this._ensureMaps();
    if (!this._rebuild && this._inputs && this._needsRebuild(params, atmosphere, cameraPos)) {
      this._rebuild = true;
    }
    if (this._rebuild) {
      this._rebuild = false;
      // Two rounds, as clayjohn's initialize_sky(): fills the map blended from and the one
      // blended to, then the regular rounds take over at full quality
      for (let round = 0; round < 2; round++) {
        this._startRound(params, atmosphere, cameraPos, time);
        for (let i = 0; i < this._framesPerUpdate; i++) {
          this._traceBlock(resources, i, REBUILD_STEP_SCALE);
        }
        this._completeRound();
      }
      this._startRound(params, atmosphere, cameraPos, time);
      this.roundCompleted = true;
      return;
    }
    this._traceBlock(resources, this._frame, 1);
    this._frame++;
    if (this._frame >= this._framesPerUpdate) {
      this._completeRound();
      this._startRound(params, atmosphere, cameraPos, time);
      this.roundCompleted = true;
    }
  }
  protected onDispose() {
    super.onDispose();
    for (const map of this._maps) {
      map.dispose();
    }
    this._ambient.dispose();
    for (const bindGroup of this._bindGroups.values()) {
      bindGroup.dispose();
    }
    this._bindGroups.clear();
  }
  private _ensureMaps() {
    const device = getDevice();
    for (let i = 0; i < 3; i++) {
      if (!this._maps[i].get()) {
        const tex = device.createTexture2D('rgba16f', this._resolution, this._resolution, {
          writable: true,
          // A storage binding takes a single level
          mipmapping: false,
          samplerOptions: { addressU: 'clamp', addressV: 'clamp', mipFilter: 'none' }
        })!;
        tex.name = `VolumetricCloudSkyCache${i}`;
        this._maps[i].set(tex);
      }
    }
    if (!this._ambient.get()) {
      const tex = device.createTexture2D('rgba16f', 1, 1, { writable: true, mipmapping: false })!;
      tex.name = 'VolumetricCloudDistantSkyLight';
      this._ambient.set(tex);
    }
  }
  private _needsRebuild(
    params: VolumetricCloud,
    atmosphere: AtmosphereParams,
    cameraPos: Immutable<Vector3>
  ) {
    const inputs = this._inputs!;
    if (params.version !== inputs.version || params.msOctaves !== inputs.msOctaves) {
      return true;
    }
    // A sudden sun change would otherwise fade in over two rounds
    if (Vector3.dot(atmosphere.lightDir, inputs.sunDir) < Math.cos((5 * Math.PI) / 180)) {
      return true;
    }
    // A camera jump far enough for the clouds to visibly shift: about ten texels of parallax
    // under the cloud base
    const scale = atmosphere.cameraHeightScale;
    const moved = Vector3.distance(cameraPos, inputs.cameraPos) * scale;
    return moved > params.layerBottomAltitude * 0.017;
  }
  private _bindGroup(program: GPUProgram) {
    let bindGroup = this._bindGroups.get(program);
    if (!bindGroup) {
      bindGroup = getDevice().createBindGroup(program.bindGroupLayouts[0]);
      this._bindGroups.set(program, bindGroup);
    }
    return bindGroup;
  }
  private _startRound(
    params: VolumetricCloud,
    atmosphere: AtmosphereParams,
    cameraPos: Immutable<Vector3>,
    time: number
  ) {
    const atmo = cloneAtmosphere(atmosphere);
    const R = atmo.plantRadius;
    const eyeHeight = R + atmo.observerAltitude;
    // Horizon dip of the raised observer plus a margin
    const delta = Math.acos(Math.min(1, R / eyeHeight)) + HORIZON_MARGIN;
    const bottom = R + params.layerBottomAltitude;
    const top = bottom + params.layerHeight;
    const wind = params.wind;
    const windSpeed = Math.hypot(wind.x, wind.y);
    const windDir = windSpeed > 0 ? new Vector2(wind.x / windSpeed, wind.y / windSpeed) : new Vector2(1, 0);
    const sunIlluminance = new Vector3(atmo.lightColor.x, atmo.lightColor.y, atmo.lightColor.z).scaleBy(
      atmo.lightColor.w
    );
    this._inputs = {
      atmosphere: atmo,
      cloud: {
        referential: new Matrix4x4(atmo.skyViewReferential),
        layer: new Vector4(bottom, top, R, params.tracingMaxDistance),
        march: new Vector4(
          Math.min(CLOUD_BASE_VIEW_SAMPLE_COUNT * params.viewSampleCountScale, CLOUD_VIEW_SAMPLE_COUNT_MAX),
          Math.max(
            1,
            Math.round(
              Math.min(
                CLOUD_BASE_SHADOW_SAMPLE_COUNT * params.shadowSampleCountScale,
                CLOUD_SHADOW_SAMPLE_COUNT_MAX
              )
            )
          ),
          params.shadowTracingDistance,
          params.stopTracingTransmittanceThreshold
        ),
        eye: new Vector4(0, eyeHeight, 0, 0),
        sunDir: new Vector4(
          atmo.lightDir.x,
          atmo.lightDir.y,
          atmo.lightDir.z,
          params.perSampleAtmosphericLightTransmittance ? 1 : 0
        ),
        sunIlluminance: new Vector4(sunIlluminance.x, sunIlluminance.y, sunIlluminance.z, 0),
        // UE: SkyLightCloudBottomVisibility = 1 - SkyLightCloudBottomOcclusion
        phase: new Vector4(
          params.phaseG,
          params.phaseG2,
          params.phaseBlend,
          1 - params.skyLightCloudBottomOcclusion
        ),
        ms: new Vector4(params.msContribution, params.msOcclusion, params.msEccentricity, 0),
        density: new Vector4(
          cloudCoverageThreshold(params.coverage, params.formation),
          params.density,
          params.detailErosion,
          params.anvilBias
        ),
        shape: new Vector4(
          params.shapeStrength,
          params.detailBottomErosion,
          params.coverage,
          params.baseHeightVariation
        ),
        albedo: new Vector4(params.albedo.x, params.albedo.y, params.albedo.z, 0),
        scales: new Vector4(
          1 / params.weatherMapScale,
          1 / params.baseNoiseScale,
          1 / params.detailNoiseScale,
          CLOUD_TOP_OFFSET
        ),
        // [Schneider15]: drift along the wind, rising at a tenth of its speed
        windOffset: new Vector4(wind.x * time, windSpeed * 0.1 * time, wind.y * time, 0),
        windDir: new Vector4(windDir.x, windDir.y, params.formation === 'isolated' ? 1 : 0, 0)
      },
      delta,
      msOctaves: params.msOctaves,
      version: params.version,
      sunDir: new Vector3(atmo.lightDir),
      cameraPos: new Vector3(cameraPos)
    };
    this._deltas[this._writeIndex] = delta;
    this._frame = 0;
    this._traceAmbient();
  }
  private _completeRound() {
    // The map just written becomes the newest; the oldest is written next
    const oldFrom = this._fromIndex;
    this._fromIndex = this._toIndex;
    this._toIndex = this._writeIndex;
    this._writeIndex = oldFrom;
    this._frame = 0;
  }
  private _traceAmbient() {
    const device = getDevice();
    const program = getAmbientProgram();
    const bindGroup = this._bindGroup(program);
    if (!this._sphereSamplesUploaded) {
      const data = new Float32Array(64 * 4);
      for (let i = 0; i < 64; i++) {
        data[i * 4 + 0] = uniformSphereSamples[i].x;
        data[i * 4 + 1] = uniformSphereSamples[i].y;
        data[i * 4 + 2] = uniformSphereSamples[i].z;
      }
      bindGroup.getBuffer('sphereSamples', false)!.bufferSubData(0, data);
      this._sphereSamplesUploaded = true;
    }
    bindGroup.setValue('atmo', this._inputs!.atmosphere);
    bindGroup.setTexture('tLut', getTransmittanceLut(), fetchSampler('clamp_linear_nomip'));
    bindGroup.setTexture('msLut', getMultiScatteringLut(), fetchSampler('clamp_linear_nomip'));
    bindGroup.setTexture('dst', this._ambient.get()!);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    device.compute(1, 1, 1);
  }
  private _traceBlock(resources: VolumetricCloudResources, index: number, stepScale: number) {
    const inputs = this._inputs!;
    const device = getDevice();
    const program = getTraceProgram(inputs.msOctaves);
    const bindGroup = this._bindGroup(program);
    const blocksPerSide = Math.round(Math.sqrt(this._framesPerUpdate));
    const blockSize = this._resolution / blocksPerSide;
    const bx = (index % blocksPerSide) * blockSize;
    const by = Math.floor(index / blocksPerSide) * blockSize;
    bindGroup.setValue('atmo', inputs.atmosphere);
    bindGroup.setValue('cloud', inputs.cloud);
    bindGroup.setValue('block', new Vector4(bx, by, this._resolution, stepScale));
    bindGroup.setValue('cacheParams', new Vector4(inputs.delta, 0, 0, 0));
    bindGroup.setTexture('weatherMap', resources.weatherMap!, fetchSampler('repeat_linear'));
    // Their own samplers: the predefined ones leave the w axis clamped
    bindGroup.setTexture('baseNoise', resources.baseNoise!);
    bindGroup.setTexture('detailNoise', resources.detailNoise!);
    bindGroup.setTexture('tLut', getTransmittanceLut(), fetchSampler('clamp_linear_nomip'));
    bindGroup.setTexture('msLut', getMultiScatteringLut(), fetchSampler('clamp_linear_nomip'));
    bindGroup.setTexture('ambientTex', this._ambient.get()!, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('dst', this._maps[this._writeIndex].get()!);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    const groups = Math.ceil(blockSize / 8);
    device.compute(groups, groups, 1);
  }
}
