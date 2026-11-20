import type { Nullable } from '@zephyr3d/base';
import { applyMixins, DRef, Vector3 } from '@zephyr3d/base';
import type { Scene } from '../scene';
import { GraphNode } from '../graph_node';
import type { BoundingVolume } from '../../utility/bounding_volume';
import { BoundingBox } from '../../utility/bounding_volume';
import { mixinDrawable } from '../../render/drawable_mixin';
import type { Drawable, DrawContext, PickTarget, RenderQueue } from '../../render';
import { Primitive } from '../../render/primitive';
import { QUEUE_OPAQUE } from '../../values';
import { ParticleSpriteMaterial } from '../../material/particlesprite';
import {
  ParticleBoundsModule,
  ParticleEmissionModule,
  ParticleForcesModule,
  ParticleOverLifeModule,
  ParticleShapeModule,
  ParticleStartModule
} from './particle_modules';
import { ParticleLUT } from './particle_lut';
import { particleHash, particleRandom, particleSeedHash } from './particle_random';
import {
  CpuParticleSim,
  PARTICLE_INSTANCE_FLOATS,
  PARTICLE_SHAPE_IDS,
  ParticleSimParams
} from './particle_sim';
import { ParticleWindow } from './particle_window';

/**
 * Where a particle emitter simulates
 * - `auto`: on the GPU when the device is WebGPU and maxParticles is at least
 *   {@link ParticleEmitter.AUTO_GPU_THRESHOLD}, on the CPU otherwise
 * - `cpu`: on the CPU
 * - `gpu`: on the GPU, falling back to the CPU on WebGL with at most
 *   {@link ParticleEmitter.cpuFallbackMaxParticles} particles
 * @public
 */
export type ParticleSimulationMode = 'auto' | 'cpu' | 'gpu';

/**
 * Space particles live in
 * - `world`: once born they leave the emitter behind (smoke, trails)
 * - `local`: they move with the emitter (a flame on a torch)
 * @public
 */
export type ParticleSpace = 'world' | 'local';

/**
 * Order particles are drawn in. They are not sorted by depth; blended particles of different
 * colors may show the order.
 * @public
 */
export type ParticleSortOrder = 'oldest-first' | 'newest-first';

type PlayState = 'stopped' | 'playing' | 'paused';

/** Fixed step of prewarming, seconds */
const PREWARM_STEP = 1 / 30;
/** Most steps a prewarm takes; longer ones take longer steps */
const PREWARM_MAX_STEPS = 300;
/** Longest frame simulated in one step, seconds; a longer hitch slows the effect down */
const MAX_FRAME_TIME = 0.1;

const tmpVec3 = new Vector3();
const tmpVec3b = new Vector3();
const tmpVec3c = new Vector3();

/**
 * A particle emitter: quads born from a shape, moved by forces, drawn with a
 * {@link ParticleSpriteMaterial}.
 *
 * @remarks
 * Parameters live in modules (`emission`, `shape`, `start`, `overLife`, `forces`, `bounds`)
 * whose fields can be changed at any time; they are read every frame. Curves over the life bake
 * when assigned, so assign them again after changing one.
 *
 * Every random value of a particle is a hash of the seed and its birth serial, and the same
 * frame times give the same effect. Particles cannot be read back one by one: the simulation may
 * run on the GPU, and the emitter only knows them by their birth times and the lifetime bounds.
 * See {@link ParticleEmitter.aliveCount}.
 *
 * Simulation runs once a frame after scripts and physics have moved the emitter, whether it is
 * visible or not. Scaling the node scales the effect: positions, velocities and sizes, but not
 * gravity and the air's velocity, which are in world space.
 * @public
 */
export class ParticleEmitter extends applyMixins(GraphNode, mixinDrawable) implements Drawable {
  /** maxParticles from which simulation 'auto' picks the GPU */
  static readonly AUTO_GPU_THRESHOLD = 1000;
  /** Most particles an emitter that wanted the GPU simulates on the CPU instead */
  static cpuFallbackMaxParticles = 20000;
  /** Emission settings */
  readonly emission: ParticleEmissionModule;
  /** Shape particles are born from */
  readonly shape: ParticleShapeModule;
  /** Values picked at birth */
  readonly start: ParticleStartModule;
  /** Values over the life */
  readonly overLife: ParticleOverLifeModule;
  /** Forces */
  readonly forces: ParticleForcesModule;
  /** Culling bounds */
  readonly bounds: ParticleBoundsModule;
  /** Share of the emitter's velocity particles take at birth; world space only */
  inheritVelocity: number;
  /** Seconds of an emission cycle; bursts repeat every cycle */
  duration: number;
  /** Whether emission repeats its cycle; otherwise it ends after one */
  looping: boolean;
  /** Seconds from play to the first emission */
  startDelay: number;
  /** Start a looping effect as if it had been playing for a cycle already */
  prewarm: boolean;
  /** Speed of time for the effect */
  simulationSpeed: number;
  /** Play when first simulated, i.e. once in the scene */
  autoPlay: boolean;
  /** Order particles are drawn in */
  sortOrder: ParticleSortOrder;
  private _seed: number;
  private _seedHash: number;
  private _maxParticles: number;
  private _simulation: ParticleSimulationMode;
  private _space: ParticleSpace;
  private _state: PlayState;
  private _autoPlayDone: boolean;
  private _prewarmPending: boolean;
  /** Seconds since play, scaled */
  private _time: number;
  /** Clock the batches expire by; advances whenever particles move */
  private _simTime: number;
  private _emitAccum: number;
  private _pendingEmit: number;
  private readonly _window: ParticleWindow;
  private readonly _lut: ParticleLUT;
  private readonly _params: ParticleSimParams;
  private _cpu: Nullable<CpuParticleSim>;
  private _numDraw: number;
  private _frameDelta: number;
  private _lateUpdateQueued: boolean;
  private readonly _prevWorldPos: Vector3;
  private _hasPrevWorldPos: boolean;
  private readonly _primitive: DRef<Primitive>;
  private readonly _material: DRef<ParticleSpriteMaterial>;
  private readonly _worldBox: BoundingBox;
  private readonly _pickTarget: PickTarget;
  /**
   * Creates a particle emitter
   * @param scene - Scene the node belongs to
   */
  constructor(scene: Scene) {
    super(scene);
    this.emission = new ParticleEmissionModule();
    this.shape = new ParticleShapeModule();
    this.start = new ParticleStartModule();
    this._lut = new ParticleLUT();
    this.overLife = new ParticleOverLifeModule(() => this._lut.bake(this.overLife.size, this.overLife.color));
    this.forces = new ParticleForcesModule();
    this.bounds = new ParticleBoundsModule();
    this.inheritVelocity = 0;
    this.duration = 5;
    this.looping = true;
    this.startDelay = 0;
    this.prewarm = false;
    this.simulationSpeed = 1;
    this.autoPlay = true;
    this.sortOrder = 'oldest-first';
    this._seed = 1;
    this._seedHash = particleSeedHash(1);
    this._maxParticles = 1000;
    this._simulation = 'auto';
    this._space = 'world';
    this._state = 'stopped';
    this._autoPlayDone = false;
    this._prewarmPending = false;
    this._time = 0;
    this._simTime = 0;
    this._emitAccum = 0;
    this._pendingEmit = 0;
    this._window = new ParticleWindow();
    this._params = new ParticleSimParams();
    this._cpu = null;
    this._numDraw = 0;
    this._frameDelta = 0;
    this._lateUpdateQueued = false;
    this._prevWorldPos = new Vector3();
    this._hasPrevWorldPos = false;
    this._primitive = new DRef();
    this._material = new DRef(new ParticleSpriteMaterial());
    this._worldBox = new BoundingBox();
    this._pickTarget = { node: this };
  }
  /** Material of the quads */
  get material() {
    return this._material.get();
  }
  set material(material: Nullable<ParticleSpriteMaterial>) {
    this._material.set(material);
  }
  /** Random seed: the same seed and frame times give the same effect */
  get seed() {
    return this._seed;
  }
  set seed(val: number) {
    this._seed = val >>> 0;
    this._seedHash = particleSeedHash(this._seed);
  }
  /** Most particles alive at once; births beyond it are dropped. Changing it clears the particles. */
  get maxParticles() {
    return this._maxParticles;
  }
  set maxParticles(val: number) {
    val = Math.max(1, Math.floor(val) || 1);
    if (val !== this._maxParticles) {
      this._maxParticles = val;
      this.clearParticles();
    }
  }
  /** Where to simulate, see {@link ParticleSimulationMode}. Changing it clears the particles. */
  get simulation() {
    return this._simulation;
  }
  set simulation(val: ParticleSimulationMode) {
    if (val !== this._simulation) {
      this._simulation = val;
      this.clearParticles();
    }
  }
  /** Where the emitter simulates now */
  get activeSimulation(): 'cpu' | 'gpu' {
    return 'cpu';
  }
  /** Space the particles live in. Changing it clears the particles. */
  get space() {
    return this._space;
  }
  set space(val: ParticleSpace) {
    if (val !== this._space) {
      this._space = val;
      this.clearParticles();
    }
  }
  /** Whether the effect is playing (emitting, or about to; not paused) */
  get isPlaying() {
    return this._state === 'playing';
  }
  /** Whether the effect is paused */
  get isPaused() {
    return this._state === 'paused';
  }
  /** Whether emission has ended and every particle has died; also before the first play */
  get isFinished() {
    return this._state === 'stopped' && this._window.size === 0 && this._pendingEmit === 0;
  }
  /** Seconds since play, scaled by simulationSpeed */
  get time() {
    return this._time;
  }
  /**
   * Particles that may be alive: an upper bound, counting those whose lifetime may not have run
   * out yet
   */
  get aliveCount() {
    return this._window.size;
  }
  /**
   * Plays the effect: from its start when stopped (the particles alive stay), from where it was
   * when paused
   */
  play() {
    this._autoPlayDone = true;
    if (this._state === 'paused') {
      this._state = 'playing';
    } else if (this._state === 'stopped') {
      this._state = 'playing';
      this._time = 0;
      this._emitAccum = 0;
      this._prewarmPending = this.prewarm && this.looping;
    }
  }
  /** Freezes the particles and the time */
  pause() {
    this._autoPlayDone = true;
    if (this._state === 'playing') {
      this._state = 'paused';
    }
  }
  /**
   * Stops emitting; the particles alive live out their lives unless cleared
   * @param options - clear: remove the particles at once
   */
  stop(options?: { clear?: boolean }) {
    this._autoPlayDone = true;
    this._state = 'stopped';
    if (options?.clear) {
      this.clearParticles();
    }
  }
  /** Clears the particles and plays from the start */
  restart() {
    this.stop({ clear: true });
    this.play();
  }
  /**
   * Emits particles at the next simulation step, born where the emitter is then, whether playing
   * or not; dropped beyond maxParticles
   * @param count - Number of particles
   */
  emit(count: number) {
    this._pendingEmit += Math.max(0, Math.floor(count) || 0);
  }
  /** @internal */
  private clearParticles() {
    this._window.clear();
    this._pendingEmit = 0;
    this._numDraw = 0;
    this.invalidateBoundingVolume();
  }
  /** Capacity of the CPU simulation */
  private getCapacity() {
    const wantsGPU =
      this._simulation === 'gpu' ||
      (this._simulation === 'auto' && this._maxParticles >= ParticleEmitter.AUTO_GPU_THRESHOLD);
    return wantsGPU
      ? Math.min(this._maxParticles, Math.max(1, ParticleEmitter.cpuFallbackMaxParticles))
      : this._maxParticles;
  }
  /** (Re)creates the buffers for the capacity */
  private ensureBuffers() {
    const capacity = this.getCapacity();
    if (this._cpu && this._cpu.capacity === capacity && this._primitive.get()) {
      return;
    }
    this._window.clear();
    this._numDraw = 0;
    this._cpu = new CpuParticleSim(capacity);
    let primitive = this._primitive.get();
    if (!primitive) {
      primitive = new Primitive();
      // Corners (xy) and their texture coordinates (zw), V down the texture
      primitive.createAndSetVertexBuffer(
        'position_f32x4',
        new Float32Array([-0.5, -0.5, 0, 1, 0.5, -0.5, 1, 1, -0.5, 0.5, 0, 0, 0.5, 0.5, 1, 0])
      );
      primitive.createAndSetIndexBuffer(new Uint16Array([0, 1, 2, 3]));
      primitive.primitiveType = 'triangle-strip';
      this._primitive.set(primitive);
    } else {
      primitive.removeVertexBuffer('texCoord0');
    }
    primitive.createAndSetVertexBuffer(
      ['tex0_f32x4', 'tex1_f32x4', 'tex2_f32x4', 'tex3_f32x4'],
      new Float32Array(capacity * PARTICLE_INSTANCE_FLOATS),
      'instance',
      { dynamic: true }
    );
  }
  /**
   * {@inheritDoc SceneNode.update}
   */
  update(frameId: number, elapsedInSeconds: number, deltaInSeconds: number) {
    super.update(frameId, elapsedInSeconds, deltaInSeconds);
    if (!this.attached) {
      return;
    }
    const scene = this.scene!;
    scene.queueUpdateNode(this);
    this._frameDelta = deltaInSeconds;
    if (!this._lateUpdateQueued) {
      // After scripts and physics have placed the emitter, so births start where it is now
      this._lateUpdateQueued = true;
      scene.once('lateupdate', this.onLateUpdate, this);
    }
  }
  /** @internal */
  private onLateUpdate() {
    this._lateUpdateQueued = false;
    if (this.disposed || !this.attached) {
      return;
    }
    this.simulateFrame(Math.min(Math.max(this._frameDelta, 0), MAX_FRAME_TIME));
  }
  /** Simulates a frame of the given length */
  private simulateFrame(frameTime: number) {
    if (this.autoPlay && !this._autoPlayDone) {
      this.play();
    }
    this.ensureBuffers();
    const worldMatrix = this.worldMatrix;
    const pos = tmpVec3.setXYZ(worldMatrix[12], worldMatrix[13], worldMatrix[14]);
    if (!this._hasPrevWorldPos) {
      this._prevWorldPos.set(pos);
      this._hasPrevWorldPos = true;
    }
    if (this._prewarmPending) {
      this._prewarmPending = false;
      this.runPrewarm();
    }
    const dt = this._state === 'paused' ? 0 : frameTime * Math.max(0, this.simulationSpeed);
    const delta = tmpVec3b.setXYZ(
      pos.x - this._prevWorldPos.x,
      pos.y - this._prevWorldPos.y,
      pos.z - this._prevWorldPos.z
    );
    this.step(dt, delta, true);
    this._prevWorldPos.set(pos);
  }
  /** Runs the emitter in place for a cycle (at least a lifetime), so it starts out full */
  private runPrewarm() {
    const lifeMax = Math.max(this.start.lifetime.upper, 1e-3);
    const total = Math.max(this.duration, lifeMax);
    const steps = Math.min(PREWARM_MAX_STEPS, Math.ceil(total / PREWARM_STEP));
    const dt = total / steps;
    const still = tmpVec3b.setXYZ(0, 0, 0);
    for (let i = 0; i < steps; i++) {
      this.step(dt, still, false);
    }
  }
  /**
   * One simulation step: advance the time, emit, step the particles
   * @param dt - Seconds to advance, scaled
   * @param delta - How far the emitter moved in world space over the step
   * @param output - Whether to write the instances and bounds
   */
  private step(dt: number, delta: Vector3, output: boolean) {
    const cpu = this._cpu!;
    const capacity = cpu.capacity;
    const win = this._window;
    this._simTime += dt;
    win.expire(this._simTime);
    let spread = 0;
    let burst = 0;
    if (this._state === 'playing' && dt > 0) {
      const t0 = this._time;
      const t1 = t0 + dt;
      this._time = t1;
      const e0 = t0 - this.startDelay;
      const e1 = t1 - this.startDelay;
      const duration = Math.max(this.duration, 1e-3);
      const from = Math.max(e0, 0);
      const to = this.looping ? e1 : Math.min(e1, duration);
      if (to > from) {
        const distance = Math.hypot(delta.x, delta.y, delta.z);
        this._emitAccum +=
          Math.max(0, this.emission.rate) * (to - from) +
          Math.max(0, this.emission.rateOverDistance) * distance * ((to - from) / dt);
        spread = Math.floor(this._emitAccum);
        this._emitAccum -= spread;
        burst = this.countBursts(from, to, duration);
      }
    }
    let births = spread + burst + this._pendingEmit;
    this._pendingEmit = 0;
    const room = capacity - win.size;
    if (births > room) {
      births = Math.max(0, room);
      spread = Math.min(spread, births);
    }
    const firstNew = win.end;
    win.push(births, this._simTime + Math.max(this.start.lifetime.upper, 1e-3));
    this.fillParams(dt, delta, firstNew, spread);
    cpu.step(this._params, this._lut, output);
    if (output) {
      this._numDraw = cpu.numInstances;
      if (this._numDraw > 0) {
        this._primitive
          .get()!
          .getVertexBuffer('texCoord0')!
          .bufferSubData(0, cpu.instances, 0, this._numDraw * PARTICLE_INSTANCE_FLOATS);
      }
      this.invalidateBoundingVolume();
    }
    if (
      this._state === 'playing' &&
      !this.looping &&
      this._time - this.startDelay >= this.duration &&
      win.size === 0
    ) {
      this._state = 'stopped';
    }
  }
  /**
   * Number of particles the bursts emit in the emission time [from, to)
   * @param from - Start, seconds since the first cycle began
   * @param to - End
   * @param duration - Cycle length
   */
  private countBursts(from: number, to: number, duration: number) {
    let total = 0;
    const bursts = this.emission.bursts;
    for (let bi = 0; bi < bursts.length; bi++) {
      const b = bursts[bi];
      if (!(b.time < duration) || b.time < 0) {
        continue;
      }
      const interval = Math.max(b.interval, 1e-3);
      // Fires per cycle: within the cycle, and as many as asked
      let perCycle = Math.ceil((duration - b.time) / interval);
      if (b.cycles > 0) {
        perCycle = Math.min(perCycle, Math.floor(b.cycles));
      }
      const burstHash = particleHash((this._seedHash + Math.imul(bi + 1, 0x632be5ab)) >>> 0);
      const firstCycle = Math.floor(from / duration);
      const lastCycle = Math.min(Math.floor(to / duration), firstCycle + 1000);
      for (let c = firstCycle; c <= lastCycle; c++) {
        const base = c * duration + b.time;
        const j0 = Math.max(0, Math.ceil((from - base) / interval));
        const j1 = Math.min(perCycle, Math.ceil((to - base) / interval));
        for (let j = j0; j < j1; j++) {
          const lo = Math.round(Math.min(b.count.min, b.count.max));
          const hi = Math.round(Math.max(b.count.min, b.count.max));
          const r = particleRandom(burstHash, c * 4096 + j);
          total += Math.max(0, lo + Math.min(hi - lo, Math.floor(r * (hi - lo + 1))));
        }
      }
    }
    return total;
  }
  /** Fills the simulation parameters of a step */
  private fillParams(dt: number, delta: Vector3, firstNew: number, spread: number) {
    const p = this._params;
    const win = this._window;
    const worldSpace = this._space === 'world';
    const m = this.worldMatrix;
    p.dt = dt;
    p.capacity = this._cpu!.capacity;
    p.windowStart = win.start;
    p.count = win.size;
    p.firstNew = firstNew;
    p.numSpread = spread;
    p.seedHash = this._seedHash;
    p.worldSpace = worldSpace;
    p.newestFirst = this.sortOrder === 'newest-first';
    for (let i = 0; i < 16; i++) {
      p.world[i] = m[i];
    }
    p.delta[0] = delta.x;
    p.delta[1] = delta.y;
    p.delta[2] = delta.z;
    const inherit = worldSpace && dt > 0 ? this.inheritVelocity / dt : 0;
    p.inherit[0] = delta.x * inherit;
    p.inherit[1] = delta.y * inherit;
    p.inherit[2] = delta.z * inherit;
    // Gravity and air are world space: into the emitter's space for local particles
    const g = this.forces.gravity;
    const air = this.forces.airVelocity;
    if (worldSpace) {
      p.gravity[0] = g.x;
      p.gravity[1] = g.y;
      p.gravity[2] = g.z;
      p.air[0] = air.x;
      p.air[1] = air.y;
      p.air[2] = air.z;
    } else {
      const inv = this.invWorldMatrix;
      inv.transformVectorAffine(g, tmpVec3c);
      p.gravity[0] = tmpVec3c.x;
      p.gravity[1] = tmpVec3c.y;
      p.gravity[2] = tmpVec3c.z;
      inv.transformVectorAffine(air, tmpVec3c);
      p.air[0] = tmpVec3c.x;
      p.air[1] = tmpVec3c.y;
      p.air[2] = tmpVec3c.z;
    }
    p.drag = Math.max(0, this.forces.drag);
    p.sizeScale = Math.max(
      Math.hypot(m[0], m[1], m[2]),
      Math.hypot(m[4], m[5], m[6]),
      Math.hypot(m[8], m[9], m[10])
    );
    const shape = this.shape;
    p.shapeType = PARTICLE_SHAPE_IDS[shape.type] ?? PARTICLE_SHAPE_IDS.point;
    p.radius = Math.max(0, shape.radius);
    p.thickness = shape.thickness;
    p.angle = Math.min(Math.max(shape.angle, 0), Math.PI);
    p.arc = shape.arc;
    p.boxHalf[0] = Math.abs(shape.boxSize.x) * 0.5;
    p.boxHalf[1] = Math.abs(shape.boxSize.y) * 0.5;
    p.boxHalf[2] = Math.abs(shape.boxSize.z) * 0.5;
    p.length = shape.length;
    p.randomizeDirection = Math.min(Math.max(shape.randomizeDirection, 0), 1);
    const start = this.start;
    p.lifeMin = start.lifetime.min;
    p.lifeMax = start.lifetime.max;
    p.speedMin = start.speed.min;
    p.speedMax = start.speed.max;
    p.sizeMin = start.size.min;
    p.sizeMax = start.size.max;
    p.aspect = start.aspect;
    p.rotationMin = start.rotation.min;
    p.rotationMax = start.rotation.max;
    p.angularMin = start.angularVelocity.min;
    p.angularMax = start.angularVelocity.max;
    for (let i = 0; i < 4; i++) {
      p.colorA[i] = start.colorA[i];
      p.colorB[i] = start.colorB[i];
    }
    const material = this._material.get();
    if (material?.alignment === 'stretched') {
      p.stretchSpeed = Math.abs(material.stretchSpeedScale);
      p.stretchLength = Math.abs(material.stretchLengthScale);
    } else {
      p.stretchSpeed = 0;
      p.stretchLength = 0;
    }
  }
  /** World bounds of the particles, or a small box at the emitter when there are none */
  private getWorldBox() {
    const box = this._worldBox;
    const cpu = this._cpu;
    if (cpu && this._numDraw > 0) {
      box.minPoint.setXYZ(cpu.boundsMin[0], cpu.boundsMin[1], cpu.boundsMin[2]);
      box.maxPoint.setXYZ(cpu.boundsMax[0], cpu.boundsMax[1], cpu.boundsMax[2]);
    } else {
      const m = this.worldMatrix;
      box.minPoint.setXYZ(m[12] - 0.5, m[13] - 0.5, m[14] - 0.5);
      box.maxPoint.setXYZ(m[12] + 0.5, m[13] + 0.5, m[14] + 0.5);
    }
    return box;
  }
  /**
   * {@inheritDoc SceneNode.computeBoundingVolume}
   */
  computeBoundingVolume(): Nullable<BoundingVolume> {
    // Asked for by the base constructor, which attaches the node before these fields exist
    if (!this.bounds) {
      return null;
    }
    if (this.bounds.mode === 'fixed') {
      return new BoundingBox(this.bounds.box);
    }
    return this.getWorldBox().transform(this.invWorldMatrix);
  }
  /**
   * {@inheritDoc SceneNode.computeWorldBoundingVolume}
   */
  computeWorldBoundingVolume(localBV: Nullable<BoundingVolume>) {
    if (!this.bounds || this.bounds.mode === 'fixed') {
      return super.computeWorldBoundingVolume(localBV);
    }
    // The particles are measured in world space
    return new BoundingBox(this.getWorldBox());
  }
  /**
   * {@inheritDoc Drawable.getPickTarget }
   */
  getPickTarget() {
    return this._pickTarget;
  }
  /**
   * {@inheritDoc Drawable.getMorphData}
   */
  getMorphData() {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getSkinInfluenceData}
   */
  getSkinInfluenceData() {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo() {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getQueueType}
   */
  getQueueType() {
    return this._material.get()?.getQueueType() ?? QUEUE_OPAQUE;
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit() {
    return !this._material.get()?.supportLighting();
  }
  /**
   * {@inheritDoc Drawable.needSceneColor}
   */
  needSceneColor() {
    return this._material.get()?.needSceneColor() ?? false;
  }
  /**
   * {@inheritDoc Drawable.needSceneDepth}
   */
  needSceneDepth() {
    return this._material.get()?.needSceneDepth() ?? false;
  }
  /**
   * {@inheritDoc Drawable.getMaterial}
   */
  getMaterial() {
    return this._material.get();
  }
  /**
   * {@inheritDoc Drawable.getPrimitive}
   */
  getPrimitive() {
    return this._primitive.get();
  }
  /**
   * {@inheritDoc SceneNode.isParticleEmitter}
   */
  isParticleEmitter(): this is ParticleEmitter {
    return true;
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext, renderQueue: Nullable<RenderQueue>) {
    const material = this._material.get();
    const primitive = this._primitive.get();
    if (this._numDraw > 0 && material && primitive) {
      this.bind(ctx, renderQueue);
      material.draw(primitive, ctx, this._numDraw);
    }
  }
  /**
   * {@inheritDoc SceneNode.onDispose}
   */
  onDispose() {
    if (this._lateUpdateQueued) {
      this.scene?.off('lateupdate', this.onLateUpdate, this);
      this._lateUpdateQueued = false;
    }
    super.onDispose();
    this._primitive.dispose();
    this._material.dispose();
    this._cpu = null;
  }
}
