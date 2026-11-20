import type { Nullable } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import type {
  BindGroup,
  GPUDataBuffer,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  StructuredBuffer
} from '@zephyr3d/device';
import { getDevice } from '../../app/api';
import type { GlobalSDF } from '../../render/sdf/global_sdf';
import {
  declareDynamicSDFUniforms,
  declareGlobalSDFUniforms,
  GLOBAL_SDF_LEVELS,
  sampleSceneSDF
} from '../../shaders/sdf';
import { WindField } from '../wind';
import type { ParticleLUT } from './particle_lut';
import { PARTICLE_LUT_SIZE } from './particle_lut';
import { particleCurlNoiseShader } from './particle_noise';
import { ParticleChannel } from './particle_random';
import type { ParticleSimParams } from './particle_sim';
import {
  PARTICLE_COLLISION_IDS,
  PARTICLE_INSTANCE_FLOATS,
  PARTICLE_SHAPE_IDS,
  PARTICLE_STATE_FLOATS
} from './particle_sim';

/** Threads per workgroup */
const WORKGROUP_SIZE = 64;
/** Most workgroups along one dimension of a dispatch (the WebGPU default limit) */
const MAX_GROUPS_X = 65535;
/** vec4 of the float parameters, see GpuParticleSim.packParams */
const PARAM_VEC4S = 30;

/** What a program of the simulation is compiled for */
interface GpuSimVariant {
  shapeType: number;
  worldSpace: boolean;
  noise: boolean;
  wind: boolean;
  /** See PARTICLE_COLLISION_IDS */
  collision: number;
  /** Levels of the global SDF, for SDF collision */
  sdfLevels: number;
}

/**
 * What a channel adds to a particle's base hash, see particleRandom: the same wrapped product
 * as Math.imul, as a literal
 */
function channelStep(channel: number) {
  return Math.imul(channel + 1, 0x9e3779b9) >>> 0;
}

/**
 * The GPU simulation: the same steps as CpuParticleSim, one thread per particle of the window in
 * a single dispatch, writing the particle state and the instance buffer the quads are drawn
 * from. No atomics, no readback: dead particles of the window get quads of zero size, and the
 * whole window is drawn.
 * @internal
 */
export class GpuParticleSim {
  /** Slots */
  readonly capacity: number;
  /** Per slot: (position, age), (velocity, lifetime) */
  private readonly _state: DRef<GPUDataBuffer>;
  /** Instance buffer of the emitter, written here and drawn from */
  private readonly _instances: StructuredBuffer;
  private readonly _bindGroup: DRef<BindGroup>;
  private _programKey: string;
  private _lutVersion: number;
  /**
   * 0: (first serial of the window, its slot, particles in the window, slots)
   * 1: (index of the first particle born this frame, births spread over the frame, seed hash,
   *    flags: 1 newest first)
   * 2: (threads per row of the dispatch, 0, 0, 0)
   */
  private readonly _ints: Uint32Array<ArrayBuffer>;
  private readonly _floats: Float32Array<ArrayBuffer>;
  private static readonly _programs: Map<string, GPUProgram> = new Map();
  /**
   * @param capacity - Slots
   * @param instances - Instance buffer, created with storage usage, PARTICLE_INSTANCE_FLOATS
   *   floats a slot
   */
  constructor(capacity: number, instances: StructuredBuffer) {
    this.capacity = capacity;
    this._instances = instances;
    this._state = new DRef(
      getDevice().createBuffer(capacity * PARTICLE_STATE_FLOATS * 4, {
        usage: 'uniform',
        storage: true,
        dynamic: false,
        managed: false
      })
    );
    this._bindGroup = new DRef();
    this._programKey = '';
    this._lutVersion = -1;
    this._ints = new Uint32Array(12);
    this._floats = new Float32Array(PARAM_VEC4S * 4);
  }
  /** Releases the GPU resources */
  dispose() {
    this._state.dispose();
    this._bindGroup.dispose();
  }
  /**
   * Steps the window in one dispatch
   * @param p - Parameters
   * @param lut - Curves over the life
   * @param sdf - Scene field for SDF collision, null if there is none
   */
  step(p: ParticleSimParams, lut: ParticleLUT, sdf: Nullable<GlobalSDF>) {
    const count = p.count;
    if (count <= 0) {
      return;
    }
    const device = getDevice();
    const collision =
      p.collisionMode === PARTICLE_COLLISION_IDS.sdf && !sdf ? PARTICLE_COLLISION_IDS.none : p.collisionMode;
    const variant: GpuSimVariant = {
      shapeType: p.shapeType,
      worldSpace: p.worldSpace,
      noise: p.noiseStrength > 0,
      wind: !!p.wind && (p.windScale[0] !== 0 || p.windScale[1] !== 0 || p.windScale[2] !== 0),
      collision,
      sdfLevels: collision === PARTICLE_COLLISION_IDS.sdf ? sdf!.levels : 0
    };
    const key = `${variant.shapeType}:${variant.worldSpace ? 1 : 0}:${variant.noise ? 1 : 0}:${
      variant.wind ? 1 : 0
    }:${variant.collision}:${variant.sdfLevels}`;
    const program = GpuParticleSim.getProgram(variant, key);
    let bindGroup = this._bindGroup.get();
    if (!bindGroup || key !== this._programKey) {
      // A bind group per program: variants are not assumed to share a layout
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      bindGroup.setBuffer('pState', this._state.get()!);
      bindGroup.setBuffer('pInstances', this._instances);
      this._bindGroup.set(bindGroup);
      this._programKey = key;
      this._lutVersion = -1;
    }
    const groups = Math.ceil(count / WORKGROUP_SIZE);
    const groupsX = Math.min(groups, MAX_GROUPS_X);
    const groupsY = Math.ceil(groups / groupsX);
    const ints = this._ints;
    ints[0] = p.windowStart >>> 0;
    ints[1] = p.windowStart % p.capacity;
    ints[2] = count;
    ints[3] = p.capacity;
    ints[4] = p.firstNew - p.windowStart;
    ints[5] = p.numSpread;
    ints[6] = p.seedHash >>> 0;
    ints[7] = p.newestFirst ? 1 : 0;
    ints[8] = groupsX * WORKGROUP_SIZE;
    this.packParams(p);
    bindGroup.setValue('pInts', ints);
    bindGroup.setValue('pParams', this._floats);
    if (this._lutVersion !== lut.version) {
      bindGroup.setValue('pLut', lut.data);
      this._lutVersion = lut.version;
    }
    if (variant.collision === PARTICLE_COLLISION_IDS.sdf) {
      sdf!.applyBindGroup(bindGroup);
    }
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    device.compute(groupsX, groupsY, 1);
  }
  /** Packs the float parameters, in the order the shader reads them */
  private packParams(p: ParticleSimParams) {
    const f = this._floats;
    for (let i = 0; i < 16; i++) {
      f[i] = p.world[i];
    }
    const put = (v: number, x: number, y: number, z: number, w: number) => {
      f[v * 4 + 0] = x;
      f[v * 4 + 1] = y;
      f[v * 4 + 2] = z;
      f[v * 4 + 3] = w;
    };
    put(4, p.delta[0], p.delta[1], p.delta[2], p.dt);
    put(5, p.inherit[0], p.inherit[1], p.inherit[2], p.drag);
    put(6, p.gravity[0], p.gravity[1], p.gravity[2], p.sizeScale);
    put(7, p.air[0], p.air[1], p.air[2], p.aspect);
    put(8, p.radius, p.thickness, p.angle, p.arc);
    put(9, p.boxHalf[0], p.boxHalf[1], p.boxHalf[2], p.length);
    put(10, p.randomizeDirection, 0, 0, 0);
    put(11, p.lifeMin, p.lifeMax, p.speedMin, p.speedMax);
    put(12, p.sizeMin, p.sizeMax, p.rotationMin, p.rotationMax);
    put(13, p.angularMin, p.angularMax, 0, 0);
    put(14, p.colorA[0], p.colorA[1], p.colorA[2], p.colorA[3]);
    put(15, p.colorB[0], p.colorB[1], p.colorB[2], p.colorB[3]);
    put(16, p.noiseStrength, p.noiseFrequency, 0, 0);
    const no = p.noiseOffset;
    put(17, no[0], no[1], no[2], 0);
    put(18, no[3], no[4], no[5], 0);
    put(19, no[6], no[7], no[8], 0);
    put(20, p.windScale[0], p.windScale[1], p.windScale[2], 0);
    if (p.wind) {
      // The current frame of the wind
      f.set(p.wind.shaderParams.subarray(0, 16), 21 * 4);
    }
    put(25, p.plane[0], p.plane[1], p.plane[2], p.plane[3]);
    put(26, p.bounce, p.friction, p.lifetimeLoss, p.radiusFactor);
    const inv = p.invWorld;
    put(27, inv[0], inv[1], inv[2], inv[12]);
    put(28, inv[4], inv[5], inv[6], inv[13]);
    put(29, inv[8], inv[9], inv[10], inv[14]);
  }
  /** The program of a variant, built once and shared by every emitter */
  private static getProgram(variant: GpuSimVariant, key: string) {
    let program = this._programs.get(key);
    if (!program) {
      program = buildProgram(variant);
      this._programs.set(key, program);
    }
    return program;
  }
}

/** A random number of the particle in [0, 1), see particleRandom */
function rnd(scope: PBInsideFunctionScope, channel: number) {
  const pb = scope.$builder;
  return pb.getGlobalScope().pRandom(scope.base, pb.uint(channelStep(channel)));
}

/**
 * Where a particle is born and which way it goes, in the space of the emitter, the same as
 * sampleShape in particle_sim.ts: declares spos and sdir in the scope
 */
function sampleShape(scope: PBInsideFunctionScope, shapeType: number) {
  const pb = scope.$builder;
  // (radius, thickness, angle, arc)
  scope.$l.sp = scope.pParams.at(8);
  // (box half size, edge length)
  scope.$l.sb = scope.pParams.at(9);
  scope.$l.u0 = rnd(scope, ParticleChannel.Shape + 0);
  scope.$l.u1 = rnd(scope, ParticleChannel.Shape + 1);
  scope.$l.u2 = rnd(scope, ParticleChannel.Shape + 2);
  scope.$l.thick = pb.clamp(scope.sp.y, 0, 1);
  scope.$l.inner = pb.sub(1, scope.thick);
  scope.$l.spos = pb.vec3(0);
  scope.$l.sdir = pb.vec3(0, 1, 0);
  switch (shapeType) {
    case PARTICLE_SHAPE_IDS.sphere:
    case PARTICLE_SHAPE_IDS.hemisphere: {
      scope.$l.hy =
        shapeType === PARTICLE_SHAPE_IDS.sphere ? pb.sub(1, pb.mul(scope.u0, 2)) : pb.add(scope.u0, 0);
      scope.$l.rxz = pb.sqrt(pb.max(pb.sub(1, pb.mul(scope.hy, scope.hy)), 0));
      scope.$l.phi = pb.mul(scope.sp.w, scope.u1);
      scope.sdir = pb.vec3(
        pb.mul(scope.rxz, pb.cos(scope.phi)),
        scope.hy,
        pb.mul(scope.rxz, pb.sin(scope.phi))
      );
      scope.$l.inner3 = pb.mul(scope.inner, scope.inner, scope.inner);
      scope.$l.rr = pb.mul(
        scope.sp.x,
        pb.pow(pb.max(pb.add(scope.inner3, pb.mul(scope.u2, pb.sub(1, scope.inner3))), 1e-30), 1 / 3)
      );
      scope.spos = pb.mul(scope.sdir, scope.rr);
      break;
    }
    case PARTICLE_SHAPE_IDS.circle:
    case PARTICLE_SHAPE_IDS.cone: {
      scope.$l.phi = pb.mul(scope.sp.w, scope.u0);
      scope.$l.pc = pb.cos(scope.phi);
      scope.$l.ps = pb.sin(scope.phi);
      scope.$l.inner2 = pb.mul(scope.inner, scope.inner);
      scope.$l.q = pb.sqrt(pb.add(scope.inner2, pb.mul(scope.u1, pb.sub(1, scope.inner2))));
      scope.spos = pb.vec3(pb.mul(scope.pc, scope.q, scope.sp.x), 0, pb.mul(scope.ps, scope.q, scope.sp.x));
      if (shapeType === PARTICLE_SHAPE_IDS.circle) {
        scope.sdir = pb.vec3(scope.pc, 0, scope.ps);
      } else {
        scope.$l.tilt = pb.mul(scope.sp.z, scope.q);
        scope.$l.st = pb.sin(scope.tilt);
        scope.sdir = pb.vec3(pb.mul(scope.pc, scope.st), pb.cos(scope.tilt), pb.mul(scope.ps, scope.st));
      }
      break;
    }
    case PARTICLE_SHAPE_IDS.box: {
      scope
        .$if(pb.greaterThanEqual(scope.thick, 1), function () {
          this.spos = pb.mul(pb.sub(pb.mul(pb.vec3(this.u0, this.u1, this.u2), 2), pb.vec3(1)), this.sb.xyz);
        })
        .$else(function () {
          this.$l.u3 = rnd(this, ParticleChannel.Shape + 3);
          this.$l.u4 = rnd(this, ParticleChannel.Shape + 4);
          this.$l.ax = pb.mul(this.sb.y, this.sb.z);
          this.$l.ay = pb.mul(this.sb.x, this.sb.z);
          this.$l.az = pb.mul(this.sb.x, this.sb.y);
          this.$l.pick = pb.mul(this.u0, pb.add(this.ax, this.ay, this.az));
          this.$l.side = this.$choice(pb.lessThan(this.u3, 0.5), pb.float(-1), pb.float(1));
          this.$l.depth = pb.sub(1, pb.mul(this.u4, this.thick));
          this.$l.fa = pb.sub(pb.mul(this.u1, 2), 1);
          this.$l.fb = pb.sub(pb.mul(this.u2, 2), 1);
          this.$l.onFace = pb.mul(this.side, this.depth);
          this.$if(pb.lessThan(this.pick, this.ax), function () {
            this.spos = pb.mul(pb.vec3(this.onFace, this.fa, this.fb), this.sb.xyz);
          })
            .$elseif(pb.lessThan(this.pick, pb.add(this.ax, this.ay)), function () {
              this.spos = pb.mul(pb.vec3(this.fa, this.onFace, this.fb), this.sb.xyz);
            })
            .$else(function () {
              this.spos = pb.mul(pb.vec3(this.fa, this.fb, this.onFace), this.sb.xyz);
            });
        });
      break;
    }
    case PARTICLE_SHAPE_IDS.edge:
      scope.spos = pb.vec3(pb.mul(pb.sub(scope.u0, 0.5), scope.sb.w), 0, 0);
      break;
  }
  if (
    shapeType === PARTICLE_SHAPE_IDS.point ||
    shapeType === PARTICLE_SHAPE_IDS.box ||
    shapeType === PARTICLE_SHAPE_IDS.edge
  ) {
    // Even over the cap of the angle around +Y
    scope.$l.ca = rnd(scope, ParticleChannel.Shape + 5);
    scope.$l.cb = rnd(scope, ParticleChannel.Shape + 6);
    scope.$l.cosT = pb.sub(1, pb.mul(scope.ca, pb.sub(1, pb.cos(scope.sp.z))));
    scope.$l.sinT = pb.sqrt(pb.max(pb.sub(1, pb.mul(scope.cosT, scope.cosT)), 0));
    scope.$l.cphi = pb.mul(scope.cb, Math.PI * 2);
    scope.sdir = pb.vec3(
      pb.mul(scope.sinT, pb.cos(scope.cphi)),
      scope.cosT,
      pb.mul(scope.sinT, pb.sin(scope.cphi))
    );
  }
  scope.$l.randomize = pb.clamp(scope.pParams.at(10).x, 0, 1);
  scope.$if(pb.greaterThan(scope.randomize, 0), function () {
    this.$l.ry = pb.sub(1, pb.mul(rnd(this, ParticleChannel.RandomDirection), 2));
    this.$l.rrxz = pb.sqrt(pb.max(pb.sub(1, pb.mul(this.ry, this.ry)), 0));
    this.$l.rphi = pb.mul(rnd(this, ParticleChannel.RandomDirection + 1), Math.PI * 2);
    this.$l.rdir = pb.vec3(
      pb.mul(this.rrxz, pb.cos(this.rphi)),
      this.ry,
      pb.mul(this.rrxz, pb.sin(this.rphi))
    );
    this.$l.mixed = pb.mix(this.sdir, this.rdir, this.randomize);
    this.$l.mlen = pb.length(this.mixed);
    this.sdir = this.$choice(
      pb.greaterThan(this.mlen, 1e-6),
      pb.div(this.mixed, pb.max(this.mlen, 1e-6)),
      this.rdir
    );
  });
}

/** Size factor of the curve at a normalized age, linear between the samples */
function lutSize(scope: PBInsideFunctionScope, a: PBShaderExp) {
  const pb = scope.$builder;
  pb.func('pLutSize', [pb.float('a')], function () {
    this.$l.x = pb.mul(this.a, PARTICLE_LUT_SIZE - 1);
    this.$l.fl = pb.floor(this.x);
    this.$l.j0 = pb.uint(this.fl);
    this.$l.j1 = pb.min(pb.add(this.j0, 1), pb.uint(PARTICLE_LUT_SIZE - 1));
    this.$return(
      pb.mix(
        this.pLut.at(pb.add(this.j0, PARTICLE_LUT_SIZE)).x,
        this.pLut.at(pb.add(this.j1, PARTICLE_LUT_SIZE)).x,
        pb.sub(this.x, this.fl)
      )
    );
  });
  return pb.getGlobalScope().pLutSize(a) as PBShaderExp;
}

/** A point of the emitter's space in world space, using m0..m3 of the scope */
function toWorld(scope: PBInsideFunctionScope, p: PBShaderExp) {
  const pb = scope.$builder;
  return pb.add(pb.mul(scope.m0, p.x), pb.mul(scope.m1, p.y), pb.mul(scope.m2, p.z), scope.m3);
}

/** A vector of the emitter's space in world space, using m0..m2 of the scope */
function toWorldVector(scope: PBInsideFunctionScope, v: PBShaderExp) {
  const pb = scope.$builder;
  return pb.add(pb.mul(scope.m0, v.x), pb.mul(scope.m1, v.y), pb.mul(scope.m2, v.z));
}

/**
 * Collides the particle's sphere with the scene's field, in world space: npos, nvel and nage of
 * the scope are the particle after the step, r its radius in simulation units
 */
function collideSDF(scope: PBInsideFunctionScope, worldSpace: boolean, levels: number) {
  const pb = scope.$builder;
  scope.$l.wp = worldSpace ? scope.npos : toWorld(scope, scope.npos);
  scope.$l.rw = worldSpace ? scope.r : pb.mul(scope.r, scope.pParams.at(6).w);
  scope.$l.sd = sampleSceneSDF(scope, scope.wp, levels);
  scope.$if(pb.lessThan(scope.sd, scope.rw), function () {
    // Normal from the field's gradient, four samples on a tetrahedron half a finest voxel across
    this.$l.e = pb.mul(this[GLOBAL_SDF_LEVELS].at(0).w, 0.5);
    this.$l.grad = pb.vec3(0);
    for (const k of [
      [1, -1, -1],
      [-1, -1, 1],
      [-1, 1, -1],
      [1, 1, 1]
    ]) {
      const dir = pb.vec3(k[0], k[1], k[2]);
      this.grad = pb.add(
        this.grad,
        pb.mul(dir, sampleSceneSDF(this, pb.add(this.wp, pb.mul(dir, this.e)), levels))
      );
    }
    this.$l.glen = pb.length(this.grad);
    this.$l.n = this.$choice(
      pb.greaterThan(this.glen, 1e-6),
      pb.div(this.grad, pb.max(this.glen, 1e-6)),
      pb.vec3(0, 1, 0)
    );
    this.$l.vw = worldSpace ? this.nvel : toWorldVector(this, this.nvel);
    // Out of the surface, but no farther than it could have gone in this step
    this.$l.out = pb.min(pb.sub(this.rw, this.sd), pb.add(this.rw, pb.mul(pb.length(this.vw), this.stepDt)));
    this.wp = pb.add(this.wp, pb.mul(this.n, this.out));
    this.$l.vn = pb.dot(this.vw, this.n);
    this.$if(pb.lessThan(this.vn, 0), function () {
      this.$l.pc = this.pParams.at(26);
      this.vw = pb.sub(
        pb.mul(pb.sub(this.vw, pb.mul(this.n, this.vn)), pb.sub(1, this.pc.y)),
        pb.mul(this.n, this.vn, this.pc.x)
      );
      this.nage = pb.add(this.nage, pb.mul(this.pc.z, this.s1.w));
    });
    if (worldSpace) {
      this.npos = this.wp;
      this.nvel = this.vw;
    } else {
      this.$l.i0 = this.pParams.at(27);
      this.$l.i1 = this.pParams.at(28);
      this.$l.i2 = this.pParams.at(29);
      this.npos = pb.add(
        pb.mul(this.i0.xyz, this.wp.x),
        pb.mul(this.i1.xyz, this.wp.y),
        pb.mul(this.i2.xyz, this.wp.z),
        pb.vec3(this.i0.w, this.i1.w, this.i2.w)
      );
      this.nvel = pb.add(
        pb.mul(this.i0.xyz, this.vw.x),
        pb.mul(this.i1.xyz, this.vw.y),
        pb.mul(this.i2.xyz, this.vw.z)
      );
    }
  });
}

/** Builds the simulation program of a variant */
function buildProgram(variant: GpuSimVariant): GPUProgram {
  const { shapeType, worldSpace, noise, wind, collision, sdfLevels } = variant;
  const device = getDevice();
  const program = device.buildComputeProgram({
    label: `ParticleSim${shapeType}${worldSpace ? 'W' : 'L'}${noise ? 'N' : ''}${wind ? 'A' : ''}C${collision}`,
    workgroupSize: [WORKGROUP_SIZE, 1, 1],
    compute(pb) {
      this.pInts = pb.uvec4[3]().uniform(0);
      // 0-3: world matrix columns; 4: (delta, dt); 5: (inherit, drag); 6: (gravity, size scale);
      // 7: (air, aspect); 8: (radius, thickness, angle, arc); 9: (box half size, edge length);
      // 10: (randomize direction, 0, 0, 0); 11: (life min, max, speed min, max);
      // 12: (size min, max, rotation min, max); 13: (angular velocity min, max, 0, 0);
      // 14: color A; 15: color B; 16: (noise strength, frequency, 0, 0); 17-19: noise offsets;
      // 20: (wind scale, 0); 21-24: wind of this frame; 25: plane (normal, distance);
      // 26: (bounce, friction, lifetime loss, radius factor); 27-29: inverse world matrix
      // columns, with its translation in w
      this.pParams = pb.vec4[PARAM_VEC4S]().uniform(0);
      this.pLut = pb.vec4[PARTICLE_LUT_SIZE * 2]().uniform(0);
      this.pState = pb.vec4[0]().storageBuffer(0);
      this.pInstances = pb.vec4[0]().storageBuffer(0);
      if (collision === PARTICLE_COLLISION_IDS.sdf) {
        declareGlobalSDFUniforms(this, 0, sdfLevels);
        declareDynamicSDFUniforms(this, 0);
      }
      // lowbias32, unsigned arithmetic wrapping like Math.imul, see particleHash
      pb.func('pHash', [pb.uint('v')], function () {
        this.$l.x = this.v;
        this.x = pb.compXor(this.x, pb.sar(this.x, 16));
        this.x = pb.mul(this.x, pb.uint(0x7feb352d));
        this.x = pb.compXor(this.x, pb.sar(this.x, 15));
        this.x = pb.mul(this.x, pb.uint(0x846ca68b));
        this.x = pb.compXor(this.x, pb.sar(this.x, 16));
        this.$return(this.x);
      });
      // See particleRandom: the top 24 bits, exact in f32
      pb.func('pRandom', [pb.uint('base'), pb.uint('channelAdd')], function () {
        this.$return(
          pb.mul(pb.float(pb.sar(this.pHash(pb.add(this.base, this.channelAdd)), 8)), 1 / 16777216)
        );
      });
      pb.main(function () {
        this.$l.w0 = this.pInts.at(0);
        this.$l.w1 = this.pInts.at(1);
        this.$l.i = pb.add(
          this.$builtins.globalInvocationId.x,
          pb.mul(this.$builtins.globalInvocationId.y, this.pInts.at(2).x)
        );
        this.$if(pb.greaterThanEqual(this.i, this.w0.z), function () {
          this.$return();
        });
        // Serials wrap at 2^32 here and in the hash on the CPU alike
        this.$l.serial = pb.add(this.w0.x, this.i);
        this.$l.slot = pb.add(this.w0.y, this.i);
        this.$if(pb.greaterThanEqual(this.slot, this.w0.w), function () {
          this.slot = pb.sub(this.slot, this.w0.w);
        });
        this.$l.base = this.pHash(pb.compXor(this.serial, this.w1.z));
        this.$l.m0 = this.pParams.at(0).xyz;
        this.$l.m1 = this.pParams.at(1).xyz;
        this.$l.m2 = this.pParams.at(2).xyz;
        this.$l.m3 = this.pParams.at(3).xyz;
        this.$l.dt = this.pParams.at(4).w;
        this.$l.s0 = this.pState.at(pb.mul(this.slot, 2));
        this.$l.s1 = this.pState.at(pb.add(pb.mul(this.slot, 2), 1));
        this.$l.stepDt = this.dt;
        this.$if(pb.greaterThanEqual(this.i, this.w1.x), function () {
          // Born this frame, at its share f of the frame; it lives the rest of it
          this.$l.b = pb.sub(this.i, this.w1.x);
          this.$l.f = this.$choice(
            pb.lessThan(this.b, this.w1.y),
            pb.div(pb.add(pb.float(this.b), 0.5), pb.float(pb.max(this.w1.y, pb.uint(1)))),
            pb.float(1)
          );
          sampleShape(this, shapeType);
          this.$l.ls = this.pParams.at(11);
          this.$l.speed = pb.mix(this.ls.z, this.ls.w, rnd(this, ParticleChannel.Speed));
          this.$l.life = pb.mix(this.ls.x, this.ls.y, rnd(this, ParticleChannel.Lifetime));
          this.$l.bvel = pb.mul(this.sdir, this.speed);
          if (worldSpace) {
            // Where the emitter was at the time of birth: back along this frame's move
            this.$l.back = pb.sub(1, this.f);
            this.$l.bpos = pb.sub(
              pb.add(
                pb.mul(this.m0, this.spos.x),
                pb.mul(this.m1, this.spos.y),
                pb.mul(this.m2, this.spos.z),
                this.m3
              ),
              pb.mul(this.pParams.at(4).xyz, this.back)
            );
            this.bvel = pb.add(
              pb.mul(this.m0, this.bvel.x),
              pb.mul(this.m1, this.bvel.y),
              pb.mul(this.m2, this.bvel.z),
              this.pParams.at(5).xyz
            );
            this.s0 = pb.vec4(this.bpos, 0);
          } else {
            this.s0 = pb.vec4(this.spos, 0);
          }
          this.s1 = pb.vec4(this.bvel, pb.max(this.life, 1e-3));
          this.stepDt = pb.mul(pb.sub(1, this.f), this.dt);
        });
        this.$if(pb.lessThan(this.s0.w, this.s1.w), function () {
          // Accelerations: gravity and the curl noise where the particle is
          this.$l.accel = this.pParams.at(6).xyz;
          if (noise) {
            this.$l.pn = this.pParams.at(16);
            this.accel = pb.add(
              this.accel,
              pb.mul(
                particleCurlNoiseShader(
                  this,
                  pb.mul(this.s0.xyz, this.pn.y),
                  this.pParams.at(17).xyz,
                  this.pParams.at(18).xyz,
                  this.pParams.at(19).xyz
                ),
                this.pn.x
              )
            );
          }
          this.$l.nvel = pb.add(this.s1.xyz, pb.mul(this.accel, this.stepDt));
          // Drag toward the air, with the scene's wind where the particle is
          this.$l.air = this.pParams.at(7).xyz;
          if (wind) {
            this.$l.wpos = worldSpace ? this.s0.xyz : toWorld(this, this.s0.xyz);
            this.air = pb.add(
              this.air,
              pb.mul(
                this.pParams.at(20).xyz,
                WindField.shaderPush(
                  this,
                  this.wpos.xz,
                  this.pParams.at(21),
                  this.pParams.at(22),
                  this.pParams.at(23),
                  this.pParams.at(24)
                )
              )
            );
          }
          this.$l.decay = pb.exp(pb.mul(pb.neg(this.pParams.at(5).w), this.stepDt));
          this.nvel = pb.add(this.air, pb.mul(pb.sub(this.nvel, this.air), this.decay));
          this.$l.npos = pb.add(this.s0.xyz, pb.mul(this.nvel, this.stepDt));
          this.$l.nage = pb.add(this.s0.w, this.stepDt);
          if (collision !== PARTICLE_COLLISION_IDS.none) {
            // Radius of the particle's sphere, simulation units
            this.$l.r = pb.mul(
              this.pParams.at(26).w,
              pb.mix(this.pParams.at(12).x, this.pParams.at(12).y, rnd(this, ParticleChannel.Size)),
              lutSize(this, pb.min(pb.div(this.nage, this.s1.w), 1))
            );
            if (collision === PARTICLE_COLLISION_IDS.plane) {
              this.$l.plane = this.pParams.at(25);
              this.$l.pd = pb.sub(pb.dot(this.plane.xyz, this.npos), this.plane.w);
              this.$if(pb.lessThan(this.pd, this.r), function () {
                // Out of the surface, but no farther than it could have gone in this step
                this.$l.out = pb.min(
                  pb.sub(this.r, this.pd),
                  pb.add(this.r, pb.mul(pb.length(this.nvel), this.stepDt))
                );
                this.npos = pb.add(this.npos, pb.mul(this.plane.xyz, this.out));
                this.$l.vn = pb.dot(this.nvel, this.plane.xyz);
                this.$if(pb.lessThan(this.vn, 0), function () {
                  this.$l.pc = this.pParams.at(26);
                  this.nvel = pb.sub(
                    pb.mul(pb.sub(this.nvel, pb.mul(this.plane.xyz, this.vn)), pb.sub(1, this.pc.y)),
                    pb.mul(this.plane.xyz, this.vn, this.pc.x)
                  );
                  this.nage = pb.add(this.nage, pb.mul(this.pc.z, this.s1.w));
                });
              });
            } else {
              collideSDF(this, worldSpace, sdfLevels);
            }
          }
          this.s0 = pb.vec4(this.npos, this.nage);
          this.s1 = pb.vec4(this.nvel, this.s1.w);
        });
        this.pState.setAt(pb.mul(this.slot, 2), this.s0);
        this.pState.setAt(pb.add(pb.mul(this.slot, 2), 1), this.s1);
        this.$l.outIndex = this.$choice(
          pb.notEqual(pb.compAnd(this.w1.w, pb.uint(1)), pb.uint(0)),
          pb.sub(pb.sub(this.w0.z, 1), this.i),
          this.i
        );
        this.$l.o = pb.mul(this.outIndex, PARTICLE_INSTANCE_FLOATS / 4);
        this.$if(pb.greaterThanEqual(this.s0.w, this.s1.w), function () {
          // Dead: a quad of zero size
          this.pInstances.setAt(this.o, pb.vec4(0));
          this.pInstances.setAt(pb.add(this.o, 1), pb.vec4(0));
          this.pInstances.setAt(pb.add(this.o, 2), pb.vec4(0));
          this.pInstances.setAt(pb.add(this.o, 3), pb.vec4(0));
          this.$return();
        });
        this.$l.pos = this.s0.xyz;
        this.$l.vel = this.s1.xyz;
        if (!worldSpace) {
          this.pos = pb.add(
            pb.mul(this.m0, this.pos.x),
            pb.mul(this.m1, this.pos.y),
            pb.mul(this.m2, this.pos.z),
            this.m3
          );
          this.vel = pb.add(
            pb.mul(this.m0, this.vel.x),
            pb.mul(this.m1, this.vel.y),
            pb.mul(this.m2, this.vel.z)
          );
        }
        // Curves over the life, linear between the samples
        this.$l.age = this.s0.w;
        this.$l.a = pb.div(this.age, this.s1.w);
        this.$l.lx = pb.mul(this.a, PARTICLE_LUT_SIZE - 1);
        this.$l.lf = pb.floor(this.lx);
        this.$l.i0 = pb.uint(this.lf);
        this.$l.i1 = pb.min(pb.add(this.i0, 1), pb.uint(PARTICLE_LUT_SIZE - 1));
        this.$l.lt = pb.sub(this.lx, this.lf);
        this.$l.sizeFactor = pb.mix(
          this.pLut.at(pb.add(this.i0, PARTICLE_LUT_SIZE)).x,
          this.pLut.at(pb.add(this.i1, PARTICLE_LUT_SIZE)).x,
          this.lt
        );
        this.$l.p12 = this.pParams.at(12);
        this.$l.p13 = this.pParams.at(13);
        this.$l.size = pb.mul(
          pb.mix(this.p12.x, this.p12.y, rnd(this, ParticleChannel.Size)),
          this.sizeFactor,
          this.pParams.at(6).w
        );
        this.$l.rotation = pb.add(
          pb.mix(this.p12.z, this.p12.w, rnd(this, ParticleChannel.Rotation)),
          pb.mul(pb.mix(this.p13.x, this.p13.y, rnd(this, ParticleChannel.AngularVelocity)), this.age)
        );
        this.$l.color = pb.mul(
          pb.mix(this.pParams.at(14), this.pParams.at(15), rnd(this, ParticleChannel.Color)),
          pb.mix(this.pLut.at(this.i0), this.pLut.at(this.i1), this.lt)
        );
        this.pInstances.setAt(this.o, pb.vec4(this.pos, this.rotation));
        this.pInstances.setAt(
          pb.add(this.o, 1),
          pb.vec4(
            pb.mul(this.size, this.pParams.at(7).w),
            this.size,
            this.a,
            rnd(this, ParticleChannel.Material)
          )
        );
        this.pInstances.setAt(pb.add(this.o, 2), this.color);
        this.pInstances.setAt(pb.add(this.o, 3), pb.vec4(this.vel, 0));
      });
    }
  });
  if (!program) {
    throw new Error(
      `Failed to build the particle simulation program: ${device.programBuilder.lastError || 'unknown error'}`
    );
  }
  return program;
}
