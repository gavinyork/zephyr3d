import { Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  Texture2D
} from '@zephyr3d/device';
import { CopyBlitter, fetchSampler } from '@zephyr3d/scene';
import type { TerrainErosionApplyParams } from './erosioncompute';

const GROUP_SIZE = 8;
const CHANNELS = ['x', 'y', 'z', 'w'];
const DIRECTIONS: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, 1],
  [1, -1],
  [-1, 1]
];

function limit(value: number, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
}

/** Persistent rainfall/runoff simulation, with an open drainage margin around the brush. */
export class HydraulicTerrainCompute {
  private readonly _device: AbstractDevice;
  private readonly _blitter = new CopyBlitter();
  private readonly _programs: GPUProgram[] = [];
  private readonly _groups: BindGroup[] = [];
  private _working: Texture2D;
  private _source: Texture2D;
  private _state: Texture2D[] = [];
  private _flux: Texture2D[] = [];
  private _areaFlux: Texture2D[] = [];
  private _incision: Texture2D;
  private _output: Texture2D;
  private _white: Texture2D;
  private _originX = 0;
  private _originY = 0;
  private _index = 0;
  private _valid = false;
  private _import = true;
  private _transform = '';

  constructor(device: AbstractDevice) {
    this._device = device;
  }

  invalidate() {
    this._valid = false;
    this._import = true;
  }

  reset() {
    this.releaseArea();
    this._working?.dispose();
    this._working = null;
    this._source = null;
    this.invalidate();
  }

  dispose() {
    this.reset();
    this._white?.dispose();
    this._white = null;
    for (const group of this._groups) {
      group.dispose();
    }
    for (const program of this._programs) {
      program.dispose();
    }
    this._groups.length = 0;
    this._programs.length = 0;
  }

  apply(params: TerrainErosionApplyParams) {
    const device = this._device;
    this.preparePrograms();
    const target = params.heightMap;
    const transform = `${params.region.x},${params.region.y},${params.region.z},${params.region.w},${params.scale.y}`;
    if (this._transform !== transform) {
      this.invalidate();
      this._transform = transform;
    }
    if (
      target !== this._source ||
      this._working?.width !== target.width ||
      this._working?.height !== target.height
    ) {
      this.reset();
      this._source = target;
      this._working = device.createTexture2D('r32f', target.width, target.height, { mipmapping: false });
      this._working.name = 'HydraulicWorkingHeight';
    }
    const dx = (params.region.z - params.region.x) / target.width;
    const dz = (params.region.w - params.region.y) / target.height;
    const cell = Math.min(dx, dz);
    const angle = Number.isFinite(params.brushRotation) ? params.brushRotation : 0;
    const halfSize = params.brushSize * Math.SQRT1_2;
    const extent = halfSize * (Math.abs(Math.sin(angle)) + Math.abs(Math.cos(angle)));
    const brushLeft = Math.max(0, Math.floor((params.brushCenter.x - extent - params.region.x) / dx));
    const brushTop = Math.max(0, Math.floor((params.brushCenter.y - extent - params.region.y) / dz));
    const brushRight = Math.min(
      target.width,
      Math.ceil((params.brushCenter.x + extent - params.region.x) / dx)
    );
    const brushBottom = Math.min(
      target.height,
      Math.ceil((params.brushCenter.y + extent - params.region.y) / dz)
    );
    if (brushLeft >= brushRight || brushTop >= brushBottom) {
      return false;
    }
    const margin = Math.max(24, Math.ceil((extent / cell) * 0.4));
    const x = Math.max(0, brushLeft - margin);
    const y = Math.max(0, brushTop - margin);
    const right = Math.min(target.width, brushRight + margin);
    const bottom = Math.min(target.height, brushBottom + margin);
    const fits =
      this._valid &&
      brushLeft >= this._originX + Math.min(8, this._originX) &&
      brushTop >= this._originY + Math.min(8, this._originY) &&
      brushRight <=
        this._originX + this._output.width - Math.min(8, target.width - this._originX - this._output.width) &&
      brushBottom <=
        this._originY +
          this._output.height -
          Math.min(8, target.height - this._originY - this._output.height);
    const options = params.options ?? {};
    const strength = limit(params.brushStrength, 0, 0, 1);
    const geometry = new Vector4(dx, dz, params.scale.y, strength);
    const brush = new Vector4(params.brushCenter.x, params.brushCenter.y, halfSize, angle);
    const flow = new Vector4(
      limit(options.rainRate, 0.18, 0, 10) / 60,
      limit(options.evaporation, 0.002, 0, 0.5),
      limit(options.flowPersistence, 0.8, 0, 0.98),
      limit(options.channeling, 4, 1, 4)
    );
    const soil = new Vector4(
      limit(options.capacity, 0.7, 0, 10),
      limit(options.erosionRate, 0.45, 0, 1),
      limit(options.depositionRate, 0.12, 0, 1),
      limit(options.maxErosion, cell * 0.035, 0, cell * 0.25)
    );
    device.pushDeviceStates();
    try {
      if (this._import) {
        this._blitter.viewport = null;
        this._blitter.scissor = null;
        this._blitter.blit(target, this._working, fetchSampler('clamp_nearest_nomip'));
        this._import = false;
      }
      if (!fits) {
        this.resizeAndImport(x, y, right - x, bottom - y, geometry);
      }
      const origin = new Vector4(this._originX, this._originY, params.region.x, params.region.y);
      for (let index = 0; index < 2; index++) {
        const fluxGroup = this._groups[1 + index];
        fluxGroup.setTexture('stateIn', this._state[index]);
        fluxGroup.setTexture('flux0Out', this._flux[0]);
        fluxGroup.setTexture('flux1Out', this._flux[1]);
        fluxGroup.setTexture('area0Out', this._areaFlux[0]);
        fluxGroup.setTexture('area1Out', this._areaFlux[1]);
        const updateGroup = this._groups[3 + index];
        updateGroup.setTexture('stateIn', this._state[index]);
        updateGroup.setTexture('flux0In', this._flux[0]);
        updateGroup.setTexture('flux1In', this._flux[1]);
        updateGroup.setTexture('area0In', this._areaFlux[0]);
        updateGroup.setTexture('area1In', this._areaFlux[1]);
        updateGroup.setTexture('stateOut', this._state[1 - index]);
        updateGroup.setTexture('incisionIn', this._incision);
        const incisionGroup = this._groups[6 + index];
        incisionGroup.setTexture('stateIn', this._state[index]);
        incisionGroup.setTexture('incisionOut', this._incision);
        for (const group of [fluxGroup, updateGroup, incisionGroup]) {
          group.setTexture('mask', params.mask ?? this._white, fetchSampler('clamp_linear_nomip'));
          group.setValue('origin', origin);
          group.setValue('brush', brush);
          group.setValue('geometry', geometry);
          group.setValue('flow', flow);
        }
        updateGroup.setValue('soil', soil);
        incisionGroup.setValue('soil', soil);
      }
      const iterations = Math.floor(limit(params.iterations, 8, 1, 128));
      for (let i = 0; i < iterations; i++) {
        this.dispatch(1, this._groups[1 + this._index]);
        this.dispatch(4, this._groups[6 + this._index]);
        this.dispatch(2, this._groups[3 + this._index]);
        this._index = 1 - this._index;
      }
      const resolve = this._groups[5];
      resolve.setTexture('stateIn', this._state[this._index]);
      resolve.setTexture('heightOut', this._output);
      resolve.setValue('heightScale', params.scale.y);
      this.dispatch(3, resolve);
      this._blitter.viewport = [
        this._originX,
        target.height - this._originY - this._output.height,
        this._output.width,
        this._output.height
      ];
      this._blitter.scissor = this._blitter.viewport;
      this._blitter.blit(this._output, this._working, fetchSampler('clamp_nearest_nomip'));
      this._blitter.blit(this._output, target, fetchSampler('clamp_nearest_nomip'));
    } finally {
      device.popDeviceStates();
    }
    return true;
  }

  private preparePrograms() {
    if (this._programs.length) {
      return;
    }
    this._programs.push(
      createImport(this._device),
      createFlux(this._device),
      createUpdate(this._device),
      createResolve(this._device),
      createStreamPower(this._device)
    );
    for (const index of [0, 1, 1, 2, 2, 3, 4, 4]) {
      this._groups.push(this._device.createBindGroup(this._programs[index].bindGroupLayouts[0]));
    }
    this._white = this._device.createTexture2D('rgba8unorm', 1, 1, { mipmapping: false });
    this._white.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1);
  }

  private resizeAndImport(x: number, y: number, width: number, height: number, geometry: Vector4) {
    const previous = this._state;
    const previousFlux = this._flux;
    const previousArea = this._areaFlux;
    const previousOutput = this._output;
    const previousIncision = this._incision;
    const old = previous[this._index];
    const previousValid = this._valid;
    const previousX = this._originX;
    const previousY = this._originY;
    const options = { mipmapping: false, writable: true };
    this._state = [
      this._device.createTexture2D('rgba32f', width, height, options),
      this._device.createTexture2D('rgba32f', width, height, options)
    ];
    this._flux = [
      this._device.createTexture2D('rgba32f', width, height, options),
      this._device.createTexture2D('rgba32f', width, height, options)
    ];
    this._areaFlux = [
      this._device.createTexture2D('rgba32f', width, height, options),
      this._device.createTexture2D('rgba32f', width, height, options)
    ];
    this._output = this._device.createTexture2D('r32f', width, height, options);
    this._incision = this._device.createTexture2D('r32f', width, height, options);
    this._incision.name = 'HydraulicStreamPower';
    this._state[0].name = 'HydraulicState0';
    this._state[1].name = 'HydraulicState1';
    this._flux[0].name = 'HydraulicFluxCardinal';
    this._flux[1].name = 'HydraulicFluxDiagonal';
    this._output.name = 'HydraulicBedOutput';
    this._areaFlux[0].name = 'HydraulicCatchmentCardinal';
    this._areaFlux[1].name = 'HydraulicCatchmentDiagonal';
    this._originX = x;
    this._originY = y;
    this._index = 0;
    const group = this._groups[0];
    group.setTexture('heightMap', this._working);
    group.setTexture('previousState', previousValid ? old : this._working);
    group.setTexture('stateOut', this._state[0]);
    group.setValue('source', new Vector4(x, y, geometry.z, previousValid ? 1 : 0));
    group.setValue('previousOrigin', new Vector4(previousX, previousY, 0, 0));
    this.dispatch(0, group);
    this._valid = true;
    for (const texture of [...previous, ...previousFlux, ...previousArea]) {
      texture.dispose();
    }
    previousOutput?.dispose();
    previousIncision?.dispose();
  }

  private dispatch(index: number, group: BindGroup) {
    this._device.setProgram(this._programs[index]);
    this._device.setBindGroup(0, group);
    this._device.compute(
      Math.ceil(this._output.width / GROUP_SIZE),
      Math.ceil(this._output.height / GROUP_SIZE),
      1
    );
  }

  private releaseArea() {
    for (const texture of [...this._state, ...this._flux, ...this._areaFlux]) {
      texture.dispose();
    }
    this._state = [];
    this._flux = [];
    this._areaFlux = [];
    this._output?.dispose();
    this._output = null;
    this._incision?.dispose();
    this._incision = null;
    this._valid = false;
  }
}

function guard(scope: PBInsideFunctionScope, texture: string) {
  const pb = scope.$builder;
  scope.$l.p = pb.ivec2(scope.$builtins.globalInvocationId.xy);
  scope.$l.dim = pb.ivec2(pb.textureDimensions(scope[texture]));
  scope.$if(pb.any(pb.greaterThanEqual(scope.p, scope.dim)), function () {
    this.$return();
  });
}

function declareHydrology(scope: PBGlobalScope) {
  const pb = scope.$builder;
  scope.stateIn = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
  scope.mask = pb.tex2D().uniform(0);
  scope.origin = pb.vec4().uniform(0);
  scope.brush = pb.vec4().uniform(0);
  scope.geometry = pb.vec4().uniform(0);
  scope.flow = pb.vec4().uniform(0);
  pb.func('stateAt', [pb.ivec2('q')], function () {
    this.$l.size = pb.ivec2(pb.textureDimensions(this.stateIn, 0));
    this.$l.clamped = pb.clamp(this.q, pb.ivec2(0), pb.sub(this.size, pb.ivec2(1)));
    this.$l.value = pb.textureLoad(this.stateIn, this.clamped, 0);
    this.$if(pb.any(pb.compNotEqual(this.q, this.clamped)), function () {
      // Ghost cells retain the boundary bed but have no water: water head can
      // drain without inventing a terrain cliff at the map's rectangular edge.
      this.value = pb.vec4(this.value.x, 0, 0, 0);
    });
    this.$return(this.value);
  });
  pb.func('brushAt', [pb.ivec2('q')], function () {
    this.$l.world = pb.add(
      this.origin.zw,
      pb.mul(pb.add(pb.vec2(pb.add(this.q, pb.ivec2(this.origin.xy))), 0.5), this.geometry.xy)
    );
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
      pb.and(pb.all(pb.greaterThanEqual(this.uv, pb.vec2(0))), pb.all(pb.lessThanEqual(this.uv, pb.vec2(1)))),
      function () {
        // Keep an arbitrary imported square mask from making a hard erosion wall.
        this.$l.edge = pb.sub(
          1,
          pb.max(pb.abs(pb.sub(pb.mul(this.uv.x, 2), 1)), pb.abs(pb.sub(pb.mul(this.uv.y, 2), 1)))
        );
        this.weight = pb.mul(
          pb.clamp(pb.textureSampleLevel(this.mask, this.uv, 0).r, 0, 1),
          pb.smoothStep(0, 0.3, this.edge)
        );
      }
    );
    this.$return(this.weight);
  });
}

function createImport(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'HydraulicImport',
    workgroupSize: [GROUP_SIZE, GROUP_SIZE, 1],
    compute(pb) {
      this.heightMap = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.previousState = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.stateOut = pb.texStorage2D.rgba32float().storage(0);
      this.source = pb.vec4().uniform(0);
      this.previousOrigin = pb.vec4().uniform(0);
      pb.main(function () {
        guard(this, 'stateOut');
        this.$l.global = pb.add(this.p, pb.ivec2(this.source.xy));
        this.$l.value = pb.vec4(
          pb.mul(pb.textureLoad(this.heightMap, this.global, 0).r, this.source.z),
          0,
          0,
          0
        );
        this.$l.old = pb.sub(this.global, pb.ivec2(this.previousOrigin.xy));
        this.$if(
          pb.and(
            pb.greaterThan(this.source.w, 0.5),
            pb.and(
              pb.all(pb.greaterThanEqual(this.old, pb.ivec2(0))),
              pb.all(pb.lessThan(this.old, pb.ivec2(pb.textureDimensions(this.previousState, 0))))
            )
          ),
          function () {
            this.value = pb.textureLoad(this.previousState, this.old, 0);
          }
        );
        pb.textureStore(this.stateOut, pb.uvec2(this.p), this.value);
      });
    }
  });
}

function createFlux(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'HydraulicRunoff',
    workgroupSize: [GROUP_SIZE, GROUP_SIZE, 1],
    compute(pb) {
      declareHydrology(this);
      this.flux0Out = pb.texStorage2D.rgba32float().storage(0);
      this.flux1Out = pb.texStorage2D.rgba32float().storage(0);
      this.area0Out = pb.texStorage2D.rgba32float().storage(0);
      this.area1Out = pb.texStorage2D.rgba32float().storage(0);
      pb.main(function () {
        guard(this, 'flux0Out');
        this.$l.own = this.stateAt(this.p);
        this.$l.weight = this.brushAt(this.p);
        this.$l.water = pb.add(this.own.y, pb.mul(this.flow.x, this.weight, this.geometry.w));
        this.$l.flux0 = pb.vec4(0);
        this.$l.flux1 = pb.vec4(0);
        this.$l.sum = pb.float(0);
        this.$l.area0 = pb.vec4(0);
        this.$l.area1 = pb.vec4(0);
        this.$l.areaSum = pb.float(0);
        for (let i = 0; i < 8; i++) {
          const [x, y] = DIRECTIONS[i];
          const distance = pb.length(pb.mul(pb.vec2(x, y), this.geometry.xy));
          this.$l.q = pb.add(this.p, pb.ivec2(x, y));
          this.$l.neighbor = this.stateAt(this.q);
          this.$l.neighborWater = pb.add(
            this.neighbor.y,
            pb.mul(this.flow.x, this.brushAt(this.q), this.geometry.w)
          );
          this.$l.gradient = pb.max(
            pb.div(
              pb.sub(pb.add(this.own.x, this.water), pb.add(this.neighbor.x, this.neighborWater)),
              distance
            ),
            0
          );
          this.$l.bedGradient = pb.max(pb.div(pb.sub(this.own.x, this.neighbor.x), distance), 0);
          this.$l.bedRoute = pb.div(pb.pow(this.bedGradient, this.flow.w), distance);
          this[i < 4 ? 'area0' : 'area1'][CHANNELS[i % 4]] = this.bedRoute;
          this.areaSum = pb.add(this.areaSum, this.bedRoute);
          // Equalization bound is as important as the available-water bound:
          // moving a fixed fraction on an almost level lake causes checkerboards.
          this.$l.route = pb.min(
            pb.mul(this.gradient, distance, 0.1),
            pb.mul(pb.pow(this.gradient, this.flow.w), 0.5)
          );
          this[i < 4 ? 'flux0' : 'flux1'][CHANNELS[i % 4]] = this.route;
          this.sum = pb.add(this.sum, this.route);
        }
        // A bounded transport fraction prevents water or sediment from becoming
        // negative even on very steep terrain and non-square heightmap pixels.
        this.$l.factor = pb.min(1, pb.div(pb.mul(this.water, 0.55), pb.max(this.sum, 1e-12)));
        pb.textureStore(this.flux0Out, pb.uvec2(this.p), pb.mul(this.flux0, this.factor));
        pb.textureStore(this.flux1Out, pb.uvec2(this.p), pb.mul(this.flux1, this.factor));
        this.$l.areaFactor = pb.div(this.own.w, pb.max(this.areaSum, 1e-12));
        pb.textureStore(this.area0Out, pb.uvec2(this.p), pb.mul(this.area0, this.areaFactor));
        pb.textureStore(this.area1Out, pb.uvec2(this.p), pb.mul(this.area1, this.areaFactor));
      });
    }
  });
}

function createUpdate(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'HydraulicIncision',
    workgroupSize: [GROUP_SIZE, GROUP_SIZE, 1],
    compute(pb) {
      declareHydrology(this);
      this.flux0In = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.flux1In = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.area0In = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.area1In = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.incisionIn = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.stateOut = pb.texStorage2D.rgba32float().storage(0);
      this.soil = pb.vec4().uniform(0);
      pb.func('fluxAt', [pb.ivec2('q'), pb.int('index')], function () {
        this.$l.size = pb.ivec2(pb.textureDimensions(this.stateIn, 0));
        this.$if(
          pb.or(pb.any(pb.lessThan(this.q, pb.ivec2(0))), pb.any(pb.greaterThanEqual(this.q, this.size))),
          function () {
            this.$return(pb.vec4(0));
          }
        );
        this.$if(pb.equal(this.index, 0), function () {
          this.$return(pb.textureLoad(this.flux0In, this.q, 0));
        });
        this.$return(pb.textureLoad(this.flux1In, this.q, 0));
      });
      pb.func('areaAt', [pb.ivec2('q'), pb.int('index')], function () {
        this.$l.size = pb.ivec2(pb.textureDimensions(this.stateIn, 0));
        this.$if(
          pb.or(pb.any(pb.lessThan(this.q, pb.ivec2(0))), pb.any(pb.greaterThanEqual(this.q, this.size))),
          function () {
            this.$return(pb.vec4(0));
          }
        );
        this.$if(pb.equal(this.index, 0), function () {
          this.$return(pb.textureLoad(this.area0In, this.q, 0));
        });
        this.$return(pb.textureLoad(this.area1In, this.q, 0));
      });
      pb.main(function () {
        guard(this, 'stateOut');
        this.$l.own = this.stateAt(this.p);
        this.$l.weight = this.brushAt(this.p);
        this.$l.oldWater = pb.add(this.own.y, pb.mul(this.flow.x, this.weight, this.geometry.w));
        this.$l.outgoing = pb.add(
          pb.dot(this.fluxAt(this.p, 0), pb.vec4(1)),
          pb.dot(this.fluxAt(this.p, 1), pb.vec4(1))
        );
        this.$l.incoming = pb.float(0);
        this.$l.loadIncoming = pb.float(0);
        this.$l.areaIncoming = pb.float(0);
        this.$l.downhill = pb.float(0);
        this.$l.lower = this.own.x;
        for (let i = 0; i < 8; i++) {
          const [x, y] = DIRECTIONS[i];
          const opposite = i ^ 1;
          const distance = pb.length(pb.mul(pb.vec2(x, y), this.geometry.xy));
          this.$l.q = pb.add(this.p, pb.ivec2(x, y));
          this.$l.neighbor = this.stateAt(this.q);
          this.$l.transfer = this.fluxAt(this.q, Math.floor(opposite / 4))[CHANNELS[opposite % 4]];
          this.incoming = pb.add(this.incoming, this.transfer);
          this.areaIncoming = pb.add(
            this.areaIncoming,
            this.areaAt(this.q, Math.floor(opposite / 4))[CHANNELS[opposite % 4]]
          );
          this.$l.neighborWater = pb.add(
            this.neighbor.y,
            pb.mul(this.flow.x, this.brushAt(this.q), this.geometry.w)
          );
          this.loadIncoming = pb.add(
            this.loadIncoming,
            pb.mul(this.neighbor.z, pb.div(this.transfer, pb.max(this.neighborWater, 1e-8)))
          );
          this.$l.localOut = this.areaAt(this.p, Math.floor(i / 4))[CHANNELS[i % 4]];
          this.downhill = pb.add(
            this.downhill,
            pb.mul(this.localOut, pb.max(pb.div(pb.sub(this.own.x, this.neighbor.x), distance), 0))
          );
          this.lower = pb.min(this.lower, this.neighbor.x);
        }
        this.$l.water = pb.max(pb.add(pb.sub(this.oldWater, this.outgoing), this.incoming), 0);
        this.$l.sediment = pb.max(
          pb.add(
            pb.mul(this.own.z, pb.sub(1, pb.div(this.outgoing, pb.max(this.oldWater, 1e-8)))),
            this.loadIncoming
          ),
          0
        );
        // Contributing area follows the bed, independently of standing water.
        // This preserves stream incision feedback as runoff merges downstream.
        this.$l.areaSource = pb.mul(this.weight, pb.min(1, pb.mul(this.flow.x, 20000)));
        this.$l.discharge = pb.mix(
          pb.min(pb.add(this.areaSource, this.areaIncoming), 65536),
          this.own.w,
          this.flow.z
        );
        this.$l.runoff = pb.max(pb.sub(pb.sqrt(this.discharge), 1), 0);
        this.$l.rain = pb.sqrt(pb.max(pb.div(this.flow.x, 0.003), 0));
        this.downhill = pb.div(this.downhill, pb.max(this.own.w, 1e-8));
        this.$l.capacity = pb.mul(
          this.soil.x,
          this.runoff,
          this.downhill,
          pb.min(this.geometry.x, this.geometry.y),
          0.15
        );
        // Filter the erosion rate, preserving the bed's existing relief. This
        // gives streams a finite width without diffusing the entire hillside.
        this.$l.incision = pb.mul(pb.textureLoad(this.incisionIn, this.p, 0).r, 0.5);
        for (const [x, y] of DIRECTIONS.slice(0, 4)) {
          this.$l.samplePos = pb.clamp(
            pb.add(this.p, pb.ivec2(x, y)),
            pb.ivec2(0),
            pb.sub(this.dim, pb.ivec2(1))
          );
          this.incision = pb.add(
            this.incision,
            pb.mul(pb.textureLoad(this.incisionIn, this.samplePos, 0).r, 0.125)
          );
        }
        this.$l.exchange = pb.mul(
          pb.min(pb.min(this.incision, this.soil.w), pb.mul(pb.sub(this.own.x, this.lower), 0.1)),
          this.weight,
          this.geometry.w
        );
        this.$l.deposit = pb.mul(
          pb.min(pb.mul(pb.max(pb.sub(this.sediment, this.capacity), 0), this.soil.z), this.soil.w),
          pb.sub(1, pb.smoothStep(0.02, 0.15, this.downhill)),
          this.weight,
          this.geometry.w
        );
        this.exchange = pb.sub(this.exchange, this.deposit);
        this.$l.height = pb.sub(this.own.x, this.exchange);
        this.sediment = pb.max(pb.add(this.sediment, this.exchange), 0);
        this.water = pb.mul(this.water, pb.sub(1, this.flow.y));
        pb.textureStore(
          this.stateOut,
          pb.uvec2(this.p),
          pb.vec4(this.height, this.water, this.sediment, this.discharge)
        );
      });
    }
  });
}

function createStreamPower(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'HydraulicStreamPower',
    workgroupSize: [GROUP_SIZE, GROUP_SIZE, 1],
    compute(pb) {
      declareHydrology(this);
      this.incisionOut = pb.texStorage2D.r32float().storage(0);
      this.soil = pb.vec4().uniform(0);
      pb.main(function () {
        guard(this, 'incisionOut');
        this.$l.own = this.stateAt(this.p);
        this.$l.slopeSum = pb.float(0);
        this.$l.routeSum = pb.float(0);
        for (const [x, y] of DIRECTIONS) {
          const distance = pb.length(pb.mul(pb.vec2(x, y), this.geometry.xy));
          this.$l.neighbor = this.stateAt(pb.add(this.p, pb.ivec2(x, y)));
          this.$l.slope = pb.max(pb.div(pb.sub(this.own.x, this.neighbor.x), distance), 0);
          this.$l.route = pb.div(pb.pow(this.slope, this.flow.w), distance);
          this.slopeSum = pb.add(this.slopeSum, pb.mul(this.slope, this.route));
          this.routeSum = pb.add(this.routeSum, this.route);
        }
        this.$l.slope = pb.div(this.slopeSum, pb.max(this.routeSum, 1e-12));
        this.$l.runoff = pb.max(pb.sub(pb.sqrt(this.own.w), 1), 0);
        this.$l.rain = pb.sqrt(pb.max(pb.div(this.flow.x, 0.003), 0));
        this.$l.global = pb.vec2(pb.add(this.p, pb.ivec2(this.origin.xy)));
        // Smooth bed resistance changes guide tributaries without adding noise
        // to height or changing when the brush's working region moves.
        this.$l.resistance = pb.add(
          0.88,
          pb.mul(
            0.12,
            pb.sin(pb.add(pb.mul(this.global.x, 0.37), pb.sin(pb.mul(this.global.y, 0.23)))),
            pb.sin(pb.add(pb.mul(this.global.y, 0.41), pb.sin(pb.mul(this.global.x, 0.19))))
          )
        );
        this.$l.rate = pb.mul(
          this.runoff,
          this.slope,
          this.soil.y,
          pb.div(this.soil.x, 0.7),
          pb.min(this.geometry.x, this.geometry.y),
          0.001,
          this.rain,
          this.resistance
        );
        pb.textureStore(this.incisionOut, pb.uvec2(this.p), pb.vec4(this.rate));
      });
    }
  });
}

function createResolve(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'HydraulicPublish',
    workgroupSize: [GROUP_SIZE, GROUP_SIZE, 1],
    compute(pb) {
      this.stateIn = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.heightOut = pb.texStorage2D.r32float().storage(0);
      this.heightScale = pb.float().uniform(0);
      pb.main(function () {
        guard(this, 'heightOut');
        pb.textureStore(
          this.heightOut,
          pb.uvec2(this.p),
          pb.vec4(pb.div(pb.textureLoad(this.stateIn, this.p, 0).x, this.heightScale))
        );
      });
    }
  });
}
