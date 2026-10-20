import type { Vector2, Vector3 } from '@zephyr3d/base';
import { degree2radian, Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  Texture2D
} from '@zephyr3d/device';
import { CopyBlitter, fetchSampler } from '@zephyr3d/scene';
import { HydraulicTerrainCompute } from './hydrauliccompute';
import { WindTerrainCompute } from './windcompute';

export type TerrainErosionMode = 'hydraulic' | 'thermal' | 'wind';

export interface TerrainErosionOptions {
  rainRate: number;
  evaporation: number;
  capacity: number;
  erosionRate: number;
  depositionRate: number;
  maxErosion: number;
  /** Angle of repose in degrees. */
  talus: number;
  thermalRate: number;
  /** Direction toward which sediment travels, in degrees in the X/Z plane. */
  windDirection: number;
  windSpeed: number;
  transportRate: number;
  /** Temporal memory of the upstream catchment area, from zero to 0.98. */
  flowPersistence: number;
  /** Preference for steepest descent when routing water, from one to four. */
  channeling: number;
}

export interface TerrainErosionApplyParams {
  mode: TerrainErosionMode;
  heightMap: Texture2D;
  mask: Texture2D;
  region: Vector4;
  scale: Vector3;
  brushCenter: Vector2;
  brushSize: number;
  brushStrength: number;
  /** Brush rotation in radians, matching the other terrain brushes. */
  brushRotation: number;
  iterations: number;
  options?: Partial<TerrainErosionOptions>;
}

const WORKGROUP_SIZE = 8;
const STEP_SECONDS = 1 / 60;
const DIRECTIONS: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
];
const CHANNELS = ['x', 'y', 'z', 'w'];

function bounded(value: number, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
}

/**
 * Terrain erosion with a full precision stroke cache. Hydraulic erosion keeps
 * runoff and suspended sediment across updates, wind retains airborne sand,
 * and thermal erosion transfers soil between neighbours. The terrain can remain r16f.
 */
export class TerrainErosionCompute {
  private readonly _device: AbstractDevice;
  private readonly _blitter: CopyBlitter;
  private readonly _programs: GPUProgram[];
  private readonly _groups: BindGroup[];
  private _state: Texture2D[];
  private _flux: Texture2D;
  private _output: Texture2D;
  private _defaultMask: Texture2D;
  private _workingHeight: Texture2D;
  private _heightSource: Texture2D;
  private _importHeight: boolean;
  private _hydraulic: HydraulicTerrainCompute;
  private _wind: WindTerrainCompute;

  constructor(device: AbstractDevice) {
    this._device = device;
    this._blitter = new CopyBlitter();
    this._programs = [];
    this._groups = [];
    this._state = [];
    this._flux = null;
    this._output = null;
    this._defaultMask = null;
    this._workingHeight = null;
    this._heightSource = null;
    this._importHeight = true;
    this._hydraulic = null;
    this._wind = null;
  }

  static isSupported(device: AbstractDevice) {
    return device.type === 'webgpu';
  }

  apply(params: TerrainErosionApplyParams): boolean {
    const device = this._device;
    const strength = bounded(params.brushStrength, 0, 0, 1);
    const iterations = Math.floor(bounded(params.iterations, 0, 0, 64));
    const width = params.region.z - params.region.x;
    const depth = params.region.w - params.region.y;
    if (
      !TerrainErosionCompute.isSupported(device) ||
      !params.heightMap ||
      !Number.isFinite(params.brushCenter.x) ||
      !Number.isFinite(params.brushCenter.y) ||
      !Number.isFinite(params.brushSize) ||
      !strength ||
      !iterations ||
      !(params.brushSize > 0) ||
      !Number.isFinite(params.region.x) ||
      !Number.isFinite(params.region.y) ||
      !Number.isFinite(params.region.z) ||
      !Number.isFinite(params.region.w) ||
      !(width > 0) ||
      !(depth > 0) ||
      !Number.isFinite(params.scale.y) ||
      Math.abs(params.scale.y) < 1e-6
    ) {
      return false;
    }
    if (params.mode === 'hydraulic') {
      this._hydraulic ??= new HydraulicTerrainCompute(device);
      return this._hydraulic.apply(params);
    }
    if (params.mode === 'wind') {
      this._wind ??= new WindTerrainCompute(device);
      return this._wind.apply(params);
    }

    const cellX = width / params.heightMap.width;
    const cellZ = depth / params.heightMap.height;
    const cell = Math.min(cellX, cellZ);
    const angle = Number.isFinite(params.brushRotation) ? params.brushRotation : 0;
    const halfSize = params.brushSize * Math.SQRT1_2;
    const extent = halfSize * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
    // Include a one-cell halo. Its zero mask makes the ROI a closed boundary.
    const x = Math.max(0, Math.floor((params.brushCenter.x - extent - params.region.x) / cellX) - 1);
    const y = Math.max(0, Math.floor((params.brushCenter.y - extent - params.region.y) / cellZ) - 1);
    const right = Math.min(
      params.heightMap.width,
      Math.ceil((params.brushCenter.x + extent - params.region.x) / cellX) + 1
    );
    const bottom = Math.min(
      params.heightMap.height,
      Math.ceil((params.brushCenter.y + extent - params.region.y) / cellZ) + 1
    );
    if (right <= x || bottom <= y) {
      return false;
    }

    this.prepare(right - x, bottom - y);
    if (
      this._heightSource !== params.heightMap ||
      this._workingHeight?.width !== params.heightMap.width ||
      this._workingHeight?.height !== params.heightMap.height
    ) {
      this._workingHeight?.dispose();
      this._workingHeight = device.createTexture2D('r32f', params.heightMap.width, params.heightMap.height, {
        mipmapping: false
      });
      this._workingHeight.name = 'TerrainErosionWorkingHeight';
      this._heightSource = params.heightMap;
      this._importHeight = true;
    }
    const options = params.options ?? {};
    const mode = params.mode === 'thermal' ? 1 : 2;
    const rainRate = bounded(options.rainRate, 0.18, 0, 10) * STEP_SECONDS;
    const evaporation = bounded(options.evaporation, 0.02, 0, 1);
    const capacity = bounded(options.capacity, 0.35, 0, 10);
    const erosionRate = bounded(options.erosionRate, 0.35, 0, 1);
    const depositionRate = bounded(options.depositionRate, 0.2, 0, 1);
    const maxErosion = bounded(options.maxErosion, cell * 0.05, 0, cell * 0.5);
    const talus = Math.tan(degree2radian(bounded(options.talus, 30, 0, 85)));
    const windAngle = degree2radian(bounded(options.windDirection, 0, -36000, 36000));
    const flow = new Vector4(
      mode,
      rainRate,
      evaporation,
      bounded(options.thermalRate, 0.35, 0, 1) * strength
    );
    const soil = new Vector4(capacity, erosionRate * strength, depositionRate, maxErosion);
    const wind = new Vector4(
      Math.cos(windAngle),
      Math.sin(windAngle),
      bounded(options.windSpeed, 0.5, 0, 4),
      bounded(options.transportRate, 0.35, 0, 1) * strength
    );
    const geometry = new Vector4(cellX, cellZ, talus, strength);

    device.pushDeviceStates();
    try {
      if (this._importHeight) {
        this._blitter.viewport = null;
        this._blitter.scissor = null;
        this._blitter.blit(params.heightMap, this._workingHeight, fetchSampler('clamp_nearest_nomip'));
        this._importHeight = false;
      }
      const init = this._groups[0];
      init.setTexture('heightMap', this._workingHeight);
      init.setTexture('mask', params.mask ?? this._defaultMask, fetchSampler('clamp_linear_nomip'));
      init.setTexture('stateOut', this._state[0]);
      init.setValue('origin', new Vector4(x, y, params.region.x, params.region.y));
      init.setValue('brush', new Vector4(params.brushCenter.x, params.brushCenter.y, halfSize, angle));
      init.setValue('geometry', new Vector4(cellX, cellZ, params.scale.y, strength));
      this.dispatch(this._programs[0], init);

      for (let index = 0; index < 2; index++) {
        const flux = this._groups[1 + index];
        flux.setTexture('stateIn', this._state[index]);
        flux.setTexture('fluxOut', this._flux);
        flux.setValue('flow', flow);
        flux.setValue('soil', soil);
        flux.setValue('wind', wind);
        flux.setValue('geometry', geometry);
        const update = this._groups[3 + index];
        update.setTexture('stateIn', this._state[index]);
        update.setTexture('fluxIn', this._flux);
        update.setTexture('stateOut', this._state[1 - index]);
        update.setValue('flow', flow);
        update.setValue('soil', soil);
        update.setValue('geometry', geometry);
      }
      for (let i = 0; i < iterations; i++) {
        const index = i % 2;
        this.dispatch(this._programs[1], this._groups[1 + index]);
        this.dispatch(this._programs[2], this._groups[3 + index]);
      }

      const resolve = this._groups[5];
      resolve.setTexture('stateIn', this._state[iterations % 2]);
      resolve.setTexture('heightOut', this._output);
      resolve.setValue('heightScale', params.scale.y);
      this.dispatch(this._programs[3], resolve);
      // Device viewports use a bottom origin, while textureLoad uses a top
      // origin on WebGPU. Keep the ROI's texel centres at the original rows.
      this._blitter.viewport = [x, params.heightMap.height - bottom, right - x, bottom - y];
      this._blitter.scissor = [x, params.heightMap.height - bottom, right - x, bottom - y];
      this._blitter.blit(this._output, this._workingHeight, fetchSampler('clamp_nearest_nomip'));
      this._blitter.blit(this._output, params.heightMap, fetchSampler('clamp_nearest_nomip'));
    } finally {
      device.popDeviceStates();
    }
    return true;
  }

  /** Reimport external height edits on the next stamp, preserving allocations. */
  invalidate() {
    this._importHeight = true;
    this._hydraulic?.invalidate();
    this._wind?.invalidate();
  }

  /** Release both the local simulation area and the full precision height cache. */
  reset() {
    this._hydraulic?.reset();
    this._wind?.reset();
    this.releaseLocal();
    this._workingHeight?.dispose();
    this._workingHeight = null;
    this._heightSource = null;
    this._importHeight = true;
  }

  private releaseLocal() {
    for (const state of this._state) {
      state.dispose();
    }
    this._state = [];
    this._flux?.dispose();
    this._flux = null;
    this._output?.dispose();
    this._output = null;
  }

  dispose() {
    this.reset();
    this._hydraulic?.dispose();
    this._hydraulic = null;
    this._wind?.dispose();
    this._wind = null;
    for (const group of this._groups) {
      group.dispose();
    }
    for (const program of this._programs) {
      program.dispose();
    }
    this._groups.length = 0;
    this._programs.length = 0;
    this._defaultMask?.dispose();
    this._defaultMask = null;
  }

  private dispatch(program: GPUProgram, group: BindGroup) {
    this._device.setProgram(program);
    this._device.setBindGroup(0, group);
    this._device.compute(
      Math.ceil(this._output.width / WORKGROUP_SIZE),
      Math.ceil(this._output.height / WORKGROUP_SIZE),
      1
    );
  }

  private prepare(width: number, height: number) {
    const device = this._device;
    if (!this._programs.length) {
      this._programs.push(
        createInitProgram(device),
        createFluxProgram(device),
        createUpdateProgram(device),
        createResolveProgram(device)
      );
      for (const programIndex of [0, 1, 1, 2, 2, 3]) {
        this._groups.push(device.createBindGroup(this._programs[programIndex].bindGroupLayouts[0]));
      }
      this._defaultMask = device.createTexture2D('rgba8unorm', 1, 1, { mipmapping: false });
      this._defaultMask.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1);
    }
    if (this._output?.width !== width || this._output?.height !== height) {
      this.releaseLocal();
      const options = { mipmapping: false, writable: true };
      this._state = [
        device.createTexture2D('rgba32f', width, height, options),
        device.createTexture2D('rgba32f', width, height, options)
      ];
      this._flux = device.createTexture2D('rgba32f', width, height, options);
      this._output = device.createTexture2D('r32f', width, height, options);
      this._state[0].name = 'TerrainErosionState0';
      this._state[1].name = 'TerrainErosionState1';
      this._flux.name = 'TerrainErosionFlux';
      this._output.name = 'TerrainErosionOutput';
    }
  }
}

function guardInvocation(scope: PBInsideFunctionScope, texture: string) {
  const pb = scope.$builder;
  scope.$l.p = pb.ivec2(scope.$builtins.globalInvocationId.xy);
  scope.$l.size = pb.ivec2(pb.textureDimensions(scope[texture]));
  scope.$if(pb.any(pb.greaterThanEqual(scope.p, scope.size)), function () {
    this.$return();
  });
}

function declareSimulation(scope: PBGlobalScope) {
  const pb = scope.$builder;
  scope.stateIn = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
  // flow: mode, rainfall/step, evaporation, thermal transfer fraction
  scope.flow = pb.vec4().uniform(0);
  // soil: capacity, erosion fraction, deposition fraction, maximum world height/step
  scope.soil = pb.vec4().uniform(0);
  // geometry: cell width, cell depth, tan(angle of repose), brush strength
  scope.geometry = pb.vec4().uniform(0);
  pb.func('stateAt', [pb.ivec2('q')], function () {
    this.$l.dim = pb.ivec2(pb.textureDimensions(this.stateIn, 0));
    this.$if(
      pb.or(pb.any(pb.lessThan(this.q, pb.ivec2(0))), pb.any(pb.greaterThanEqual(this.q, this.dim))),
      function () {
        this.$return(pb.vec4(0));
      }
    );
    this.$return(pb.textureLoad(this.stateIn, this.q, 0));
  });
}

function createInitProgram(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'TerrainErosionInit',
    workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE, 1],
    compute(pb) {
      this.heightMap = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.mask = pb.tex2D().uniform(0);
      this.stateOut = pb.texStorage2D.rgba32float().storage(0);
      this.origin = pb.vec4().uniform(0);
      this.brush = pb.vec4().uniform(0);
      this.geometry = pb.vec4().uniform(0);
      pb.main(function () {
        guardInvocation(this, 'stateOut');
        this.$l.texel = pb.add(this.p, pb.ivec2(this.origin.xy));
        this.$l.world = pb.add(this.origin.zw, pb.mul(pb.add(pb.vec2(this.texel), 0.5), this.geometry.xy));
        this.$l.relative = pb.sub(this.world, this.brush.xy);
        this.$l.c = pb.cos(this.brush.w);
        this.$l.s = pb.sin(this.brush.w);
        this.$l.local = pb.vec2(
          pb.add(pb.mul(this.c, this.relative.x), pb.mul(this.s, this.relative.y)),
          pb.sub(pb.mul(this.c, this.relative.y), pb.mul(this.s, this.relative.x))
        );
        this.$l.uv = pb.add(pb.div(this.local, pb.mul(this.brush.z, 2)), 0.5);
        this.$l.weight = pb.float(0);
        this.$if(
          pb.and(
            pb.all(pb.greaterThanEqual(this.uv, pb.vec2(0))),
            pb.all(pb.lessThanEqual(this.uv, pb.vec2(1)))
          ),
          function () {
            this.weight = pb.clamp(pb.textureSampleLevel(this.mask, this.uv, 0).r, 0, 1);
          }
        );
        this.$l.height = pb.mul(pb.textureLoad(this.heightMap, this.texel, 0).r, this.geometry.z);
        pb.textureStore(this.stateOut, pb.uvec2(this.p), pb.vec4(this.height, 0, 0, this.weight));
      });
    }
  });
}

function createFluxProgram(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'TerrainErosionFlux',
    workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE, 1],
    compute(pb) {
      declareSimulation(this);
      this.wind = pb.vec4().uniform(0);
      this.fluxOut = pb.texStorage2D.rgba32float().storage(0);
      pb.main(function () {
        guardInvocation(this, 'fluxOut');
        this.$l.own = this.stateAt(this.p);
        this.$l.water = pb.add(this.own.y, pb.mul(this.flow.y, this.own.w, this.geometry.w));
        this.$l.outgoing = pb.vec4(0);
        this.$l.maxDrop = pb.float(0);
        for (let i = 0; i < 4; i++) {
          const direction = DIRECTIONS[i];
          const distance = direction[0] ? this.geometry.x : this.geometry.y;
          this.$l.neighbor = this.stateAt(pb.add(this.p, pb.ivec2(...direction)));
          this.$l.edge = pb.min(this.own.w, this.neighbor.w);
          this.$l.drop = pb.sub(this.own.x, this.neighbor.x);
          this.maxDrop = pb.max(this.maxDrop, pb.mul(pb.max(this.drop, 0), this.edge));
          this.$if(pb.lessThan(this.flow.x, 0.5), function () {
            this.$l.neighborWater = pb.add(
              this.neighbor.y,
              pb.mul(this.flow.y, this.neighbor.w, this.geometry.w)
            );
            this.outgoing[CHANNELS[i]] = pb.mul(
              pb.max(pb.sub(pb.add(this.own.x, this.water), pb.add(this.neighbor.x, this.neighborWater)), 0),
              this.edge,
              pb.div(pb.min(this.geometry.x, this.geometry.y), distance),
              0.25
            );
          }).$else(function () {
            this.$l.excess = pb.max(pb.sub(this.drop, pb.mul(this.geometry.z, distance)), 0);
            this.outgoing[CHANNELS[i]] = pb.mul(this.excess, this.edge, this.flow.w, 0.25);
            this.$if(pb.greaterThan(this.flow.x, 1.5), function () {
              // Saltation travels downwind. Windward/uphill faces are sheltered;
              // downhill faces expose loose material. A flat bed stays flat.
              this.$l.alignment = pb.max(pb.dot(this.wind.xy, pb.vec2(...direction)), 0);
              this.$l.slope = pb.div(this.drop, distance);
              this.$l.exposure = pb.clamp(pb.add(0.25, this.slope), 0, 1);
              this.outgoing[CHANNELS[i]] = pb.mul(
                pb.max(this.drop, 0),
                this.edge,
                this.alignment,
                this.exposure,
                this.wind.z,
                this.wind.w,
                0.25
              );
            });
          });
        }
        this.$l.sum = pb.dot(this.outgoing, pb.vec4(1));
        this.$l.limit = pb.min(this.soil.w, pb.mul(this.maxDrop, 0.25));
        this.$if(pb.lessThan(this.flow.x, 0.5), function () {
          this.limit = pb.mul(this.water, 0.5);
        });
        this.outgoing = pb.mul(this.outgoing, pb.min(1, pb.div(this.limit, pb.max(this.sum, 1e-8))));
        pb.textureStore(this.fluxOut, pb.uvec2(this.p), this.outgoing);
      });
    }
  });
}

function createUpdateProgram(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'TerrainErosionUpdate',
    workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE, 1],
    compute(pb) {
      declareSimulation(this);
      this.fluxIn = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.stateOut = pb.texStorage2D.rgba32float().storage(0);
      pb.func('fluxAt', [pb.ivec2('q')], function () {
        this.$l.dim = pb.ivec2(pb.textureDimensions(this.fluxIn, 0));
        this.$if(
          pb.or(pb.any(pb.lessThan(this.q, pb.ivec2(0))), pb.any(pb.greaterThanEqual(this.q, this.dim))),
          function () {
            this.$return(pb.vec4(0));
          }
        );
        this.$return(pb.textureLoad(this.fluxIn, this.q, 0));
      });
      pb.main(function () {
        guardInvocation(this, 'stateOut');
        this.$l.own = this.stateAt(this.p);
        this.$l.outgoing = pb.dot(this.fluxAt(this.p), pb.vec4(1));
        this.$l.incoming = pb.float(0);
        this.$l.sedimentIncoming = pb.float(0);
        this.$l.slope = pb.float(0);
        for (let i = 0; i < 4; i++) {
          const direction = DIRECTIONS[i];
          const distance = direction[0] ? this.geometry.x : this.geometry.y;
          const opposite = i ^ 1;
          this.$l.q = pb.add(this.p, pb.ivec2(...direction));
          this.$l.neighbor = this.stateAt(this.q);
          this.$l.transfer = this.fluxAt(this.q)[CHANNELS[opposite]];
          this.incoming = pb.add(this.incoming, this.transfer);
          this.$l.neighborWater = pb.add(
            this.neighbor.y,
            pb.mul(this.flow.y, this.neighbor.w, this.geometry.w)
          );
          this.sedimentIncoming = pb.add(
            this.sedimentIncoming,
            pb.mul(this.neighbor.z, pb.div(this.transfer, pb.max(this.neighborWater, 1e-8)))
          );
          this.slope = pb.max(
            this.slope,
            pb.mul(
              pb.div(pb.abs(pb.sub(this.own.x, this.neighbor.x)), distance),
              pb.min(this.own.w, this.neighbor.w)
            )
          );
        }
        this.$l.height = pb.add(this.own.x, pb.sub(this.incoming, this.outgoing));
        this.$l.water = pb.float(0);
        this.$l.sediment = pb.float(0);
        this.$if(pb.lessThan(this.flow.x, 0.5), function () {
          this.$l.oldWater = pb.add(this.own.y, pb.mul(this.flow.y, this.own.w, this.geometry.w));
          this.water = pb.max(pb.add(pb.sub(this.oldWater, this.outgoing), this.incoming), 0);
          this.sediment = pb.max(
            pb.add(
              pb.mul(this.own.z, pb.sub(1, pb.div(this.outgoing, pb.max(this.oldWater, 1e-8)))),
              this.sedimentIncoming
            ),
            0
          );
          this.$l.speed = pb.div(pb.add(this.outgoing, this.incoming), pb.max(this.oldWater, 1e-8));
          this.$l.capacity = pb.mul(this.soil.x, this.slope, this.speed, this.water);
          this.$l.exchange = pb.float(0);
          this.$if(pb.greaterThan(this.sediment, this.capacity), function () {
            this.exchange = pb.neg(pb.mul(pb.sub(this.sediment, this.capacity), this.soil.z));
          }).$else(function () {
            this.exchange = pb.min(
              pb.min(pb.mul(pb.sub(this.capacity, this.sediment), this.soil.y), this.soil.w),
              pb.mul(this.slope, pb.min(this.geometry.x, this.geometry.y), 0.25)
            );
          });
          this.height = pb.sub(this.own.x, this.exchange);
          this.sediment = pb.add(this.sediment, this.exchange);
          this.water = pb.mul(this.water, pb.sub(1, this.flow.z));
          // Dry cells deposit their load; water evaporation removes no soil.
          this.$l.settled = pb.mul(this.sediment, this.flow.z);
          this.height = pb.add(this.height, this.settled);
          this.sediment = pb.sub(this.sediment, this.settled);
        });
        pb.textureStore(
          this.stateOut,
          pb.uvec2(this.p),
          pb.vec4(this.height, this.water, this.sediment, this.own.w)
        );
      });
    }
  });
}

function createResolveProgram(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'TerrainErosionResolve',
    workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE, 1],
    compute(pb) {
      this.stateIn = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.heightOut = pb.texStorage2D.r32float().storage(0);
      this.heightScale = pb.float().uniform(0);
      pb.main(function () {
        guardInvocation(this, 'heightOut');
        this.$l.state = pb.textureLoad(this.stateIn, this.p, 0);
        // Closing each stamp deposits all remaining suspended material locally.
        pb.textureStore(
          this.heightOut,
          pb.uvec2(this.p),
          pb.vec4(pb.div(pb.add(this.state.x, this.state.z), this.heightScale))
        );
      });
    }
  });
}
