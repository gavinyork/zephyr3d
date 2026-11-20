import { DRef } from '@zephyr3d/base';
import type {
  BindGroup,
  GPUDataBuffer,
  GPUProgram,
  PBInsideFunctionScope,
  StructuredBuffer
} from '@zephyr3d/device';
import { getDevice } from '../../app/api';
import type { ParticleLUT } from './particle_lut';
import { PARTICLE_LUT_SIZE } from './particle_lut';
import { ParticleChannel } from './particle_random';
import type { ParticleSimParams } from './particle_sim';
import { PARTICLE_INSTANCE_FLOATS, PARTICLE_SHAPE_IDS, PARTICLE_STATE_FLOATS } from './particle_sim';

/** Threads per workgroup */
const WORKGROUP_SIZE = 64;
/** Most workgroups along one dimension of a dispatch (the WebGPU default limit) */
const MAX_GROUPS_X = 65535;
/** vec4 of the float parameters, see GpuParticleSim.packParams */
const PARAM_VEC4S = 16;

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
   */
  step(p: ParticleSimParams, lut: ParticleLUT) {
    const count = p.count;
    if (count <= 0) {
      return;
    }
    const device = getDevice();
    const key = `${p.shapeType}:${p.worldSpace ? 1 : 0}`;
    const program = GpuParticleSim.getProgram(p.shapeType, p.worldSpace, key);
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
  }
  /** The program of a shape and space, built once and shared by every emitter */
  private static getProgram(shapeType: number, worldSpace: boolean, key: string) {
    let program = this._programs.get(key);
    if (!program) {
      program = buildProgram(shapeType, worldSpace);
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

/** Builds the simulation program of a shape and space */
function buildProgram(shapeType: number, worldSpace: boolean): GPUProgram {
  const program = getDevice().buildComputeProgram({
    label: `ParticleSim${shapeType}${worldSpace ? 'W' : 'L'}`,
    workgroupSize: [WORKGROUP_SIZE, 1, 1],
    compute(pb) {
      this.pInts = pb.uvec4[3]().uniform(0);
      // 0-3: world matrix columns; 4: (delta, dt); 5: (inherit, drag); 6: (gravity, size scale);
      // 7: (air, aspect); 8: (radius, thickness, angle, arc); 9: (box half size, edge length);
      // 10: (randomize direction, 0, 0, 0); 11: (life min, max, speed min, max);
      // 12: (size min, max, rotation min, max); 13: (angular velocity min, max, 0, 0);
      // 14: color A; 15: color B
      this.pParams = pb.vec4[PARAM_VEC4S]().uniform(0);
      this.pLut = pb.vec4[PARTICLE_LUT_SIZE * 2]().uniform(0);
      this.pState = pb.vec4[0]().storageBuffer(0);
      this.pInstances = pb.vec4[0]().storageBuffer(0);
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
          // Integrate: forces, then drag toward the air, then move
          this.$l.p6 = this.pParams.at(6);
          this.$l.p7 = this.pParams.at(7);
          this.$l.nvel = pb.add(this.s1.xyz, pb.mul(this.p6.xyz, this.stepDt));
          this.$l.decay = pb.exp(pb.mul(pb.neg(this.pParams.at(5).w), this.stepDt));
          this.nvel = pb.add(this.p7.xyz, pb.mul(pb.sub(this.nvel, this.p7.xyz), this.decay));
          this.s0 = pb.vec4(
            pb.add(this.s0.xyz, pb.mul(this.nvel, this.stepDt)),
            pb.add(this.s0.w, this.stepDt)
          );
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
    throw new Error('Failed to build the particle simulation program');
  }
  return program;
}
