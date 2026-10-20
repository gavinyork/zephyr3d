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
import type { TerrainErosionApplyParams } from './erosioncompute';

const GROUP_SIZE = 8;
const DIRECTIONS: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
];
const NEIGHBORS: Array<[number, number]> = [...DIRECTIONS, [-1, -1], [1, -1], [-1, 1], [1, 1]];

function limit(value: number, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
}

/** Wind carries eroded soil over crests before depositing it on sheltered slopes. */
export class WindTerrainCompute {
  private readonly _device: AbstractDevice;
  private readonly _blitter = new CopyBlitter();
  private readonly _programs: GPUProgram[] = [];
  private readonly _groups: BindGroup[] = [];
  private _working: Texture2D;
  private _source: Texture2D;
  private _state: Texture2D[] = [];
  private _flux: Texture2D;
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
    const options = params.options ?? {};
    const speed = limit(options.windSpeed, 0.5, 0, 4);
    const transport = limit(options.transportRate, 0.35, 0, 1);
    const strength = limit(params.brushStrength, 0, 0, 1);
    if (!speed || !transport || !strength) {
      return false;
    }
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
      this._working.name = 'WindWorkingHeight';
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
    const margin = Math.max(16, Math.ceil((extent / cell) * 0.25));
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
    const windAngle = degree2radian(limit(options.windDirection, 0, -36000, 36000));
    const wind = new Vector4(Math.cos(windAngle), Math.sin(windAngle), speed, transport);
    const geometry = new Vector4(dx, dz, params.scale.y, strength);
    const brush = new Vector4(params.brushCenter.x, params.brushCenter.y, halfSize, angle);
    const maxErosion = limit(options.maxErosion, cell * 0.05, 0, cell * 0.5);
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
        const flux = this._groups[1 + index];
        flux.setTexture('stateIn', this._state[index]);
        flux.setTexture('fluxOut', this._flux);
        const update = this._groups[3 + index];
        update.setTexture('stateIn', this._state[index]);
        update.setTexture('fluxIn', this._flux);
        update.setTexture('stateOut', this._state[1 - index]);
        for (const group of [flux, update]) {
          group.setTexture('mask', params.mask ?? this._white, fetchSampler('clamp_linear_nomip'));
          group.setValue('origin', origin);
          group.setValue('brush', brush);
          group.setValue('geometry', geometry);
          group.setValue('wind', wind);
          group.setValue('maxErosion', maxErosion);
        }
      }
      const iterations = Math.floor(limit(params.iterations, 8, 1, 64));
      for (let i = 0; i < iterations; i++) {
        this.dispatch(1, this._groups[1 + this._index]);
        this.dispatch(2, this._groups[3 + this._index]);
        this._index = 1 - this._index;
      }
      const resolve = this._groups[5];
      resolve.setTexture('stateIn', this._state[this._index]);
      resolve.setTexture('heightOut', this._output);
      resolve.setValue('heightScale', params.scale.y);
      this.dispatch(3, resolve);
      // Texture rows have a top origin; the device viewport has a bottom origin.
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
      createResolve(this._device)
    );
    for (const index of [0, 1, 1, 2, 2, 3]) {
      this._groups.push(this._device.createBindGroup(this._programs[index].bindGroupLayouts[0]));
    }
    this._white = this._device.createTexture2D('rgba8unorm', 1, 1, { mipmapping: false });
    this._white.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1);
  }

  private resizeAndImport(x: number, y: number, width: number, height: number, geometry: Vector4) {
    const previous = this._state;
    const previousFlux = this._flux;
    const previousOutput = this._output;
    const old = previous[this._index];
    const previousValid = this._valid;
    const previousX = this._originX;
    const previousY = this._originY;
    const options = { mipmapping: false, writable: true };
    this._state = [
      this._device.createTexture2D('rgba32f', width, height, options),
      this._device.createTexture2D('rgba32f', width, height, options)
    ];
    this._flux = this._device.createTexture2D('rgba32f', width, height, options);
    this._output = this._device.createTexture2D('r32f', width, height, options);
    this._state[0].name = 'WindState0';
    this._state[1].name = 'WindState1';
    this._flux.name = 'WindSedimentFlux';
    this._output.name = 'WindBedOutput';
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
    for (const texture of previous) {
      texture.dispose();
    }
    previousFlux?.dispose();
    previousOutput?.dispose();
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
    for (const texture of this._state) {
      texture.dispose();
    }
    this._state = [];
    this._flux?.dispose();
    this._flux = null;
    this._output?.dispose();
    this._output = null;
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

function declareWind(scope: PBGlobalScope) {
  const pb = scope.$builder;
  scope.stateIn = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
  scope.mask = pb.tex2D().uniform(0);
  scope.origin = pb.vec4().uniform(0);
  scope.brush = pb.vec4().uniform(0);
  scope.geometry = pb.vec4().uniform(0);
  scope.wind = pb.vec4().uniform(0);
  scope.maxErosion = pb.float().uniform(0);
  pb.func('stateAt', [pb.ivec2('q')], function () {
    this.$l.size = pb.ivec2(pb.textureDimensions(this.stateIn, 0));
    this.$l.clamped = pb.clamp(this.q, pb.ivec2(0), pb.sub(this.size, pb.ivec2(1)));
    this.$l.value = pb.textureLoad(this.stateIn, this.clamped, 0);
    this.$if(pb.any(pb.compNotEqual(this.q, this.clamped)), function () {
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
  pb.func('slopeAt', [pb.ivec2('q')], function () {
    this.$l.own = this.stateAt(this.q).x;
    this.$l.upwind = pb.ivec2(pb.neg(pb.sign(this.wind.xy)));
    // Include the cell itself in the windward difference. Central differences
    // cannot see an isolated peak and let it survive while its support erodes.
    this.$l.dx = pb.div(
      pb.sub(this.own, this.stateAt(pb.add(this.q, pb.ivec2(this.upwind.x, 0))).x),
      this.geometry.x
    );
    this.$l.dz = pb.div(
      pb.sub(this.own, this.stateAt(pb.add(this.q, pb.ivec2(0, this.upwind.y))).x),
      this.geometry.y
    );
    this.$return(pb.dot(pb.vec2(this.dx, this.dz), pb.abs(this.wind.xy)));
  });
  pb.func('erosionAt', [pb.ivec2('q')], function () {
    this.$l.own = this.stateAt(this.q);
    // A positive gradient rises into the wind: exposed windward faces erode.
    this.$l.slope = pb.max(this.slopeAt(this.q), 0);
    this.$l.cell = pb.min(this.geometry.x, this.geometry.y);
    this.$l.power = pb.mul(this.wind.z, this.wind.w);
    // Match the default rate while keeping entrainment bounded when the user
    // raises wind power beyond what one conservative transport step can carry.
    this.$l.drive = pb.div(pb.mul(this.power, 2), pb.add(this.power, 0.175));
    this.$l.capacity = pb.mul(this.cell, 0.5, this.drive, pb.add(0.02, this.slope));
    this.$l.unsaturated = pb.max(pb.sub(1, pb.div(this.own.y, pb.max(this.capacity, 1e-8))), 0);
    this.$l.rate = pb.mul(
      this.cell,
      this.drive,
      this.slope,
      pb.clamp(pb.add(0.25, this.slope), 0, 1),
      0.0035,
      this.unsaturated
    );
    this.$l.relief = pb.float(0);
    for (const [x, y] of DIRECTIONS) {
      this.relief = pb.max(
        this.relief,
        pb.abs(pb.sub(this.own.x, this.stateAt(pb.add(this.q, pb.ivec2(x, y))).x))
      );
    }
    this.$return(
      pb.mul(
        pb.min(pb.min(this.maxErosion, pb.mul(this.cell, 0.02)), pb.min(this.rate, pb.mul(this.relief, 0.1))),
        this.brushAt(this.q),
        this.geometry.w
      )
    );
  });
}

function createImport(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'WindImport',
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
    label: 'WindTransport',
    workgroupSize: [GROUP_SIZE, GROUP_SIZE, 1],
    compute(pb) {
      declareWind(this);
      this.fluxOut = pb.texStorage2D.rgba32float().storage(0);
      pb.main(function () {
        guard(this, 'fluxOut');
        this.$l.own = this.stateAt(this.p);
        this.$l.eroded = this.erosionAt(this.p);
        this.$l.available = pb.add(this.own.y, this.eroded);
        this.$l.route = pb.div(this.wind.xy, this.geometry.xy);
        this.$l.sum = pb.dot(pb.abs(this.route), pb.vec2(1));
        // Cap the total outgoing load, including diagonal winds. Transport is
        // independent of bed slope, so sand can pass over a summit.
        this.$l.fraction = pb.mul(0.6, pb.min(1, pb.div(pb.mul(this.wind.z, this.wind.w), 0.175)));
        this.$l.transport = pb.mul(
          this.route,
          pb.div(pb.mul(this.available, this.fraction), pb.max(this.sum, 1e-8))
        );
        // Two signed axis fluxes leave room for this step's erosion. The next
        // pass can predict neighbouring bed support without another dispatch.
        pb.textureStore(this.fluxOut, pb.uvec2(this.p), pb.vec4(this.transport, this.eroded, 0));
      });
    }
  });
}

function createUpdate(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'WindExchange',
    workgroupSize: [GROUP_SIZE, GROUP_SIZE, 1],
    compute(pb) {
      declareWind(this);
      this.fluxIn = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.stateOut = pb.texStorage2D.rgba32float().storage(0);
      pb.func('fluxAt', [pb.ivec2('q')], function () {
        this.$l.size = pb.ivec2(pb.textureDimensions(this.fluxIn, 0));
        this.$if(
          pb.or(pb.any(pb.lessThan(this.q, pb.ivec2(0))), pb.any(pb.greaterThanEqual(this.q, this.size))),
          function () {
            this.$return(pb.vec4(0));
          }
        );
        this.$return(pb.textureLoad(this.fluxIn, this.q, 0));
      });
      pb.main(function () {
        guard(this, 'stateOut');
        this.$l.own = this.stateAt(this.p);
        this.$l.flux = this.fluxAt(this.p);
        this.$l.eroded = this.flux.z;
        this.$l.load = pb.sub(pb.add(this.own.y, this.eroded), pb.dot(pb.abs(this.flux.xy), pb.vec2(1)));
        for (const [x, y] of DIRECTIONS) {
          this.load = pb.add(
            this.load,
            pb.max(pb.neg(pb.dot(this.fluxAt(pb.add(this.p, pb.ivec2(x, y))).xy, pb.vec2(x, y))), 0)
          );
        }
        this.load = pb.max(this.load, 0);
        this.$l.shelter = pb.clamp(pb.div(pb.neg(this.slopeAt(this.p)), 0.4), 0, 1);
        this.$l.activity = pb.min(1, pb.div(pb.mul(this.wind.z, this.wind.w), 0.175));
        this.$l.bed = pb.sub(this.own.x, this.eroded);
        this.$l.support = this.bed;
        this.$l.repose = pb.add(this.bed, pb.mul(pb.length(this.geometry.xy), 0.7));
        for (const [x, y] of NEIGHBORS) {
          this.$l.q = pb.add(this.p, pb.ivec2(x, y));
          this.$l.neighborBed = pb.sub(this.stateAt(this.q).x, this.fluxAt(this.q).z);
          this.support = pb.max(this.support, this.neighborBed);
          this.repose = pb.min(
            this.repose,
            pb.add(this.neighborBed, pb.mul(pb.length(pb.mul(pb.vec2(x, y), this.geometry.xy)), 0.7))
          );
        }
        // Deposit only where neighbouring beds still support the material
        // after their own erosion, without steepening the bed past the sand's
        // angle of repose. Unsettled sand keeps travelling downwind.
        this.$l.depositLimit = pb.min(
          pb.mul(pb.min(this.geometry.x, this.geometry.y), 0.025),
          pb.min(
            pb.mul(pb.max(pb.sub(this.support, this.bed), 0), 0.25),
            pb.max(pb.sub(this.repose, this.bed), 0)
          )
        );
        this.$l.deposited = pb.min(
          pb.mul(
            this.load,
            pb.add(0.005, pb.mul(this.shelter, 0.25)),
            this.brushAt(this.p),
            this.geometry.w,
            this.activity
          ),
          pb.min(this.depositLimit, pb.max(pb.sub(this.maxErosion, this.eroded), 0))
        );
        pb.textureStore(
          this.stateOut,
          pb.uvec2(this.p),
          pb.vec4(
            pb.add(pb.sub(this.own.x, this.eroded), this.deposited),
            pb.sub(this.load, this.deposited),
            0,
            0
          )
        );
      });
    }
  });
}

function createResolve(device: AbstractDevice) {
  return device.buildComputeProgram({
    label: 'WindPublish',
    workgroupSize: [GROUP_SIZE, GROUP_SIZE, 1],
    compute(pb) {
      this.stateIn = pb.tex2D().sampleType('unfilterable-float').noSampler().uniform(0);
      this.heightOut = pb.texStorage2D.r32float().storage(0);
      this.heightScale = pb.float().uniform(0);
      pb.main(function () {
        guard(this, 'heightOut');
        // Suspended sand remains in state between batches and leaves with wind
        // at the open boundary. Publishing must not dump it onto the crest.
        pb.textureStore(
          this.heightOut,
          pb.uvec2(this.p),
          pb.vec4(pb.div(pb.textureLoad(this.stateIn, this.p, 0).x, this.heightScale))
        );
      });
    }
  });
}
