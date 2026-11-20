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
  ParticleCollisionModule,
  ParticleEmissionModule,
  ParticleForcesModule,
  ParticleOverLifeModule,
  ParticleShapeModule,
  ParticleStartModule
} from './particle_modules';
import { PARTICLE_NOISE_MAX, PARTICLE_NOISE_PERIOD } from './particle_noise';
import { ParticleLUT } from './particle_lut';
import { particleHash, particleRandom, particleSeedHash } from './particle_random';
import {
  CpuParticleSim,
  PARTICLE_COLLISION_IDS,
  PARTICLE_INSTANCE_FLOATS,
  PARTICLE_SHAPE_IDS,
  ParticleSimParams
} from './particle_sim';
import { ParticleWindow } from './particle_window';
import { GpuParticleSim } from './particle_gpu';
import { getDevice } from '../../app/api';
import { warnUnsupported } from '../../utility/unsupported';

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
const tmpBox = new Float64Array(6);

/**
 * Directions the three noise potentials scroll in, so the field changes shape over time instead of
 * sliding along
 */
const NOISE_SCROLL = [
  [0.6, 0.64, 0.48],
  [-0.48, 0.6, 0.64],
  [0.64, -0.48, 0.6]
];
/** Starting offsets of the potentials in noise cells, keeping them unrelated */
const NOISE_START = [0, 0, 0, 89.3, 31.7, 157.1, 201.9, 113.3, 47.9];
/**
 * Largest gust factor of the scene wind's noises (about [-1, 1]), with a margin, for the bounds
 * of the GPU simulation
 */
const WIND_NOISE_MAX = 1.1;

/**
 * A particle emitter: quads born from a shape, moved by forces, drawn with a
 * {@link ParticleSpriteMaterial}.
 *
 * @remarks
 * Parameters live in modules (`emission`, `shape`, `start`, `overLife`, `forces`, `collision`,
 * `bounds`) whose fields can be changed at any time; they are read every frame. Curves over the
 * life bake when assigned, so assign them again after changing one.
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
  /** Collisions */
  readonly collision: ParticleCollisionModule;
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
  /** Offsets of the noise potentials in cells, scrolled each step */
  private readonly _noiseOffset: Float64Array;
  private readonly _window: ParticleWindow;
  private readonly _lut: ParticleLUT;
  private readonly _params: ParticleSimParams;
  private _cpu: Nullable<CpuParticleSim>;
  private _gpu: Nullable<GpuParticleSim>;
  /** World bounds of the particles drawn, valid when _hasBounds */
  private readonly _boundsMin: Float64Array;
  private readonly _boundsMax: Float64Array;
  private _hasBounds: boolean;
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
    this.collision = new ParticleCollisionModule();
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
    this._noiseOffset = new Float64Array(NOISE_START);
    this._window = new ParticleWindow();
    this._params = new ParticleSimParams();
    this._cpu = null;
    this._gpu = null;
    this._boundsMin = new Float64Array(3);
    this._boundsMax = new Float64Array(3);
    this._hasBounds = false;
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
    return this.resolveBackend().gpu ? 'gpu' : 'cpu';
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
    this._hasBounds = false;
    this.invalidateBoundingVolume();
  }
  /** Which backend simulates, and with how many slots */
  private resolveBackend(): { gpu: boolean; capacity: number } {
    const wantsGPU =
      this._simulation === 'gpu' ||
      (this._simulation === 'auto' && this._maxParticles >= ParticleEmitter.AUTO_GPU_THRESHOLD);
    const device = getDevice();
    if (wantsGPU && device.type === 'webgpu') {
      // The instance buffer is the larger one and is bound whole as storage
      const maxSlots = Math.floor(
        device.getDeviceCaps().shaderCaps.maxStorageBufferSize / (PARTICLE_INSTANCE_FLOATS * 4)
      );
      return { gpu: true, capacity: Math.min(this._maxParticles, maxSlots) };
    }
    if (this._simulation === 'gpu') {
      warnUnsupported(
        "GPU particle simulation (ParticleEmitter.simulation 'gpu')",
        'WebGPU',
        `simulating on the CPU with at most ${ParticleEmitter.cpuFallbackMaxParticles} particles`
      );
    }
    return {
      gpu: false,
      capacity: wantsGPU
        ? Math.min(this._maxParticles, Math.max(1, ParticleEmitter.cpuFallbackMaxParticles))
        : this._maxParticles
    };
  }
  /** (Re)creates the simulation and the buffers for the backend and capacity */
  private ensureBuffers() {
    const { gpu, capacity } = this.resolveBackend();
    const current = gpu ? this._gpu : this._cpu;
    if (current && current.capacity === capacity && this._primitive.get()) {
      return;
    }
    this._window.clear();
    this._numDraw = 0;
    this._hasBounds = false;
    this._gpu?.dispose();
    this._gpu = null;
    this._cpu = null;
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
    // Written by the compute shader on the GPU, uploaded every frame on the CPU
    const instances = primitive.createAndSetVertexBuffer(
      ['tex0_f32x4', 'tex1_f32x4', 'tex2_f32x4', 'tex3_f32x4'],
      new Float32Array(capacity * PARTICLE_INSTANCE_FLOATS),
      'instance',
      gpu ? { storage: true } : { dynamic: true }
    );
    if (gpu) {
      this._gpu = new GpuParticleSim(capacity, instances);
    } else {
      this._cpu = new CpuParticleSim(capacity);
    }
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
    const capacity = (this._gpu ?? this._cpu)!.capacity;
    const win = this._window;
    this._simTime += dt;
    win.expire(this._simTime);
    this.scrollNoise(dt);
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
    const lifeMax = Math.max(this.start.lifetime.upper, 1e-3);
    const gpu = this._gpu;
    if (gpu) {
      // The GPU's particles are never read back: each batch keeps a box they cannot leave
      win.push(births, this._simTime + lifeMax, this.getBatchBox(dt, delta, lifeMax));
    } else {
      win.push(births, this._simTime + lifeMax);
    }
    this.fillParams(dt, delta, firstNew, spread);
    if (gpu) {
      gpu.step(
        this._params,
        this._lut,
        this.collision.mode === 'sdf' ? (this.scene?.sdf.global ?? null) : null
      );
      if (output) {
        this._numDraw = win.size;
        this._hasBounds = this.getGpuBounds();
        this.invalidateBoundingVolume();
      }
    } else {
      const cpu = this._cpu!;
      cpu.step(this._params, this._lut, output);
      if (output) {
        this._numDraw = cpu.numInstances;
        if (this._numDraw > 0) {
          this._primitive
            .get()!
            .getVertexBuffer('texCoord0')!
            .bufferSubData(0, cpu.instances, 0, this._numDraw * PARTICLE_INSTANCE_FLOATS);
          for (let i = 0; i < 3; i++) {
            this._boundsMin[i] = cpu.boundsMin[i];
            this._boundsMax[i] = cpu.boundsMax[i];
          }
        }
        this._hasBounds = this._numDraw > 0;
        this.invalidateBoundingVolume();
      }
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
  /** Largest scale of the emitter's axes */
  private getScale() {
    const m = this.worldMatrix;
    return Math.max(
      Math.hypot(m[0], m[1], m[2]),
      Math.hypot(m[4], m[5], m[6]),
      Math.hypot(m[8], m[9], m[10])
    );
  }
  /** Advances the scroll of the noise potentials by a step */
  private scrollNoise(dt: number) {
    const noise = this.forces.noise;
    const cells = noise.scrollSpeed * noise.frequency * dt;
    if (!cells || !Number.isFinite(cells)) {
      return;
    }
    const o = this._noiseOffset;
    for (let i = 0; i < 9; i++) {
      // The noise repeats every period cells along each axis
      o[i] = (o[i] + NOISE_SCROLL[Math.floor(i / 3)][i % 3] * cells) % PARTICLE_NOISE_PERIOD;
    }
  }
  /** The scene's wind if it moves the particles */
  private getWind() {
    return this.forces.windInfluence !== 0 ? (this.scene?.env.wind ?? null) : null;
  }
  /**
   * Speed no particle born now exceeds over its life, and how far the forces can take it beyond
   * that, in world units
   * @returns [speed bound, distance added by the accelerations over the life]
   */
  private getSpeedBound(dt: number, delta: Vector3, life: number): [number, number] {
    const scale = this.getScale();
    const inherit =
      this._space === 'world' && dt > 0
        ? (Math.abs(this.inheritVelocity) * Math.hypot(delta.x, delta.y, delta.z)) / dt
        : 0;
    const forces = this.forces;
    const air = forces.airVelocity;
    let airSpeed = Math.hypot(air.x, air.y, air.z);
    const wind = this.getWind();
    if (wind) {
      airSpeed +=
        Math.abs(forces.windInfluence) *
        ParticleForcesModule.WIND_SPEED *
        wind.strength *
        (1 + WIND_NOISE_MAX * (wind.gustStrength + wind.detailStrength));
    }
    const g = forces.gravity;
    const accel = Math.hypot(g.x, g.y, g.z) + PARTICLE_NOISE_MAX * Math.max(0, forces.noise.strength) * scale;
    // Drag pulls toward the air's velocity, so the speed stays within the start speed plus
    // twice the air's, plus what the accelerations add
    const speed = this.start.speed.maxAbs * scale + inherit + 2 * airSpeed;
    return [speed, 0.5 * accel * life * life];
  }
  /**
   * Box the particles born in this step stay in: in world space around where the emitter was
   * over the step for world particles, around the emitter's origin for local ones
   */
  private getBatchBox(dt: number, delta: Vector3, life: number) {
    const shape = this.shape;
    let extent = 0;
    switch (shape.type) {
      case 'sphere':
      case 'hemisphere':
      case 'circle':
      case 'cone':
        extent = Math.abs(shape.radius);
        break;
      case 'box':
        extent = 0.5 * Math.hypot(shape.boxSize.x, shape.boxSize.y, shape.boxSize.z);
        break;
      case 'edge':
        extent = 0.5 * Math.abs(shape.length);
        break;
    }
    const [speed, fall] = this.getSpeedBound(dt, delta, life);
    let r = extent * this.getScale() + speed * life + fall;
    if (this.collision.mode !== 'none') {
      // Pushed out of surfaces by up to its radius
      r +=
        0.5 *
        Math.abs(this.collision.radiusScale) *
        this.start.size.maxAbs *
        this._lut.maxSize *
        this.getScale();
    }
    if (this._space === 'world') {
      const m = this.worldMatrix;
      for (let i = 0; i < 3; i++) {
        const p1 = m[12 + i];
        const p0 = p1 - delta[i];
        tmpBox[i] = Math.min(p0, p1) - r;
        tmpBox[3 + i] = Math.max(p0, p1) + r;
      }
    } else {
      tmpBox[0] = tmpBox[1] = tmpBox[2] = -r;
      tmpBox[3] = tmpBox[4] = tmpBox[5] = r;
    }
    return tmpBox;
  }
  /** Conservative world bounds of the GPU's particles: their batches' boxes and the quads */
  private getGpuBounds() {
    if (!this._window.getBounds(tmpBox)) {
      return false;
    }
    if (this._space === 'local') {
      const m = this.worldMatrix;
      for (let i = 0; i < 3; i++) {
        tmpBox[i] += m[12 + i];
        tmpBox[3 + i] += m[12 + i];
      }
    }
    const size = this.start.size.maxAbs * this._lut.maxSize * this.getScale();
    const width = size * Math.abs(this.start.aspect);
    let reach = 0.5 * Math.hypot(width, size);
    const p = this._params;
    if (p.stretchLength > 0 || p.stretchSpeed > 0) {
      const life = Math.max(this.start.lifetime.upper, 1e-3);
      const [speed, fall] = this.getSpeedBound(
        p.dt,
        tmpVec3c.setXYZ(p.delta[0], p.delta[1], p.delta[2]),
        life
      );
      // The accelerations' speed at the end of the life is twice their average
      reach = Math.hypot(width, size * p.stretchLength + (speed + (2 * fall) / life) * p.stretchSpeed);
    }
    for (let i = 0; i < 3; i++) {
      this._boundsMin[i] = tmpBox[i] - reach;
      this._boundsMax[i] = tmpBox[3 + i] + reach;
    }
    return true;
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
    p.capacity = (this._gpu ?? this._cpu)!.capacity;
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
    // Noise is part of the effect: it scales with the emitter
    const noise = this.forces.noise;
    const noiseScale = worldSpace ? p.sizeScale : 1;
    p.noiseStrength = Math.max(0, noise.strength) * noiseScale;
    p.noiseFrequency = Math.max(0, noise.frequency) / Math.max(noiseScale, 1e-6);
    p.noiseOffset.set(this._noiseOffset);
    // The scene's wind blows along the ground
    const wind = this.getWind();
    p.wind = wind;
    if (wind) {
      const [wx, wz] = wind.directionXZ;
      const k = this.forces.windInfluence * ParticleForcesModule.WIND_SPEED;
      tmpVec3c.setXYZ(wx * k, 0, wz * k);
      if (!worldSpace) {
        this.invWorldMatrix.transformVectorAffine(tmpVec3c, tmpVec3c);
      }
      p.windScale[0] = tmpVec3c.x;
      p.windScale[1] = tmpVec3c.y;
      p.windScale[2] = tmpVec3c.z;
    } else {
      p.windScale.fill(0);
    }
    const collision = this.collision;
    p.collisionMode = PARTICLE_COLLISION_IDS[collision.mode] ?? PARTICLE_COLLISION_IDS.none;
    p.bounce = Math.min(Math.max(collision.bounce, 0), 1);
    p.friction = Math.min(Math.max(collision.friction, 0), 1);
    p.lifetimeLoss = Math.max(collision.lifetimeLoss, 0);
    p.radiusFactor = 0.5 * Math.abs(collision.radiusScale) * (worldSpace ? p.sizeScale : 1);
    // The plane, dot(n, p) = d in world space, in simulation space
    const pn = collision.planeNormal;
    let nlen = Math.hypot(pn.x, pn.y, pn.z);
    let nx = nlen > 1e-9 ? pn.x / nlen : 0;
    let ny = nlen > 1e-9 ? pn.y / nlen : 1;
    let nz = nlen > 1e-9 ? pn.z / nlen : 0;
    let d = collision.planeHeight;
    if (!worldSpace) {
      // dot(n, M p + t) = d  =>  dot(M^T n, p) = d - dot(n, t)
      d -= nx * m[12] + ny * m[13] + nz * m[14];
      const lx = m[0] * nx + m[1] * ny + m[2] * nz;
      const ly = m[4] * nx + m[5] * ny + m[6] * nz;
      const lz = m[8] * nx + m[9] * ny + m[10] * nz;
      nlen = Math.max(Math.hypot(lx, ly, lz), 1e-9);
      nx = lx / nlen;
      ny = ly / nlen;
      nz = lz / nlen;
      d /= nlen;
    }
    p.plane[0] = nx;
    p.plane[1] = ny;
    p.plane[2] = nz;
    p.plane[3] = d;
    if (!worldSpace) {
      const inv = this.invWorldMatrix;
      for (let i = 0; i < 16; i++) {
        p.invWorld[i] = inv[i];
      }
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
    if (this._hasBounds && this._numDraw > 0) {
      box.minPoint.setXYZ(this._boundsMin[0], this._boundsMin[1], this._boundsMin[2]);
      box.maxPoint.setXYZ(this._boundsMax[0], this._boundsMax[1], this._boundsMax[2]);
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
    this._gpu?.dispose();
    this._gpu = null;
    this._cpu = null;
  }
}
