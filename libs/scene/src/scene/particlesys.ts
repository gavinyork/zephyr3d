import type { Immutable, Matrix4x4, Nullable } from '@zephyr3d/base';
import { applyMixins, nextPowerOf2, DRef } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { Scene } from './scene';
import { GraphNode } from './graph_node';
import { BoundingBox } from '../utility/bounding_volume';
import { mixinDrawable } from '../render/drawable_mixin';
import type { Drawable, DrawContext, PickTarget, RenderQueue } from '../render';
import { Primitive } from '../render';
import { QUEUE_OPAQUE } from '../values';
import { ParticleMaterial } from '../material';

const tmpVec3 = new Vector3();
const tmpSpawnOffset = new Vector3();

/** A live particle; dead ones go back to a pool and are reused */
type Particle = {
  position: Vector3;
  velocity: Vector3;
  /** Size at birth */
  size1: number;
  /** End size minus birth size */
  size2: number;
  /** Rotation speed in radians per second */
  angularVelocity: number;
  lifeSpan: number;
  /** Acceleration along the direction of motion */
  acceleration: number;
  elapsedTime: number;
  size: number;
  rotation: number;
  ageBias: number;
  jitterAngle: number;
};

const PS_WORLDSPACE = 1 << 8;

/**
 * Particle emitter shape
 * @public
 */
export type EmitterShape = 'point' | 'sphere' | 'box' | 'cylinder' | 'cone';
/**
 * Particle emitter behavior
 * @public
 */
export type EmitterBehavior = 'surface' | 'volume';

/**
 * Particle system class
 * @public
 */
export class ParticleSystem extends applyMixins(GraphNode, mixinDrawable) implements Drawable {
  private readonly _activeParticleList: Particle[];
  private readonly _freeParticles: Particle[];
  private _maxParticleCount: number;
  private _emitInterval: number;
  private _emitCount: number;
  /** Whether the first batch has gone out since emission (re)started */
  private _emitStarted: boolean;
  /** Seconds since the first batch went out */
  private _emitTime: number;
  /** Batches emitted since the first one, including it */
  private _numEmitCount: number;
  /** World position of the emitter at the end of the last update, see _hasPrevWorldPos */
  private readonly _prevWorldPos: Vector3;
  private _hasPrevWorldPos: boolean;
  private _airResistence: boolean;
  private _flags: number;
  private readonly _gravity: Vector3;
  private readonly _wind: Vector3;
  private _scalar: number;
  private _particleRotationMin: number;
  private _particleRotationMax: number;
  private _jitterSpeed: number;
  private _emitterShape: EmitterShape;
  private _emitterBehavior: EmitterBehavior;
  private _emitterConeRadiusMin: number;
  private _emitterConeRadiusMax: number;
  private _particleVelocityMin: number;
  private _particleVelocityMax: number;
  private _particleLifeMin: number;
  private _particleLifeMax: number;
  private _particleSize1Min: number;
  private _particleSize1Max: number;
  private _particleSize2Min: number;
  private _particleSize2Max: number;
  private _particleAccelMin: number;
  private _particleAccelMax: number;
  private readonly _emitterShapeSizeMin: Vector3;
  private readonly _emitterShapeSizeMax: Vector3;
  private readonly _primitive: DRef<Primitive>;
  private readonly _material: DRef<ParticleMaterial>;
  private readonly _wsBoundingBox: BoundingBox;
  private readonly _pickTarget: PickTarget;
  private _instanceData: Nullable<Float32Array<ArrayBuffer>>;
  /**
   * Creates a new ParticleSystem node
   * @param scene - Which scene the node belongs to
   */
  constructor(scene: Scene) {
    super(scene);
    this._activeParticleList = [];
    this._freeParticles = [];
    this._maxParticleCount = 100;
    this._emitInterval = 100;
    this._emitCount = 1;
    this._gravity = Vector3.zero();
    this._wind = Vector3.zero();
    this._emitStarted = false;
    this._emitTime = 0;
    this._numEmitCount = 0;
    this._prevWorldPos = new Vector3();
    this._hasPrevWorldPos = false;
    this._scalar = 1;
    this._airResistence = false;
    this._particleRotationMin = 0;
    this._particleRotationMax = 0;
    this._jitterSpeed = 1;
    this._emitterShape = 'point';
    this._emitterBehavior = 'surface';
    this._emitterConeRadiusMin = 0;
    this._emitterConeRadiusMax = 0.1;
    this._emitterShapeSizeMin = Vector3.one();
    this._emitterShapeSizeMax = Vector3.one();
    this._particleVelocityMin = 2;
    this._particleVelocityMax = 3;
    this._particleLifeMin = 1;
    this._particleLifeMax = 1.5;
    this._particleSize1Min = 0.4;
    this._particleSize1Max = 0.5;
    this._particleSize2Min = 0;
    this._particleSize2Max = 0.1;
    this._particleAccelMin = -0.01;
    this._particleAccelMax = -0.02;
    this._pickTarget = { node: this };
    this._flags = PS_WORLDSPACE;
    this._primitive = new DRef();
    this._wsBoundingBox = new BoundingBox();
    this._instanceData = null;
    this._material = new DRef(new ParticleMaterial());
    scene.queueUpdateNode(this);
  }
  /** Material of the particle system node */
  get material() {
    return this._material.get();
  }
  set material(material: Nullable<ParticleMaterial>) {
    this._material.set(material);
  }
  /** Maximum particle count */
  get maxParticleCount() {
    return this._maxParticleCount;
  }
  set maxParticleCount(value) {
    if (value !== this._maxParticleCount) {
      this._maxParticleCount = value;
      this.invalidateBoundingVolume();
    }
  }
  /** Particle emit interval in ms; batches due within a frame all go out, spread over it */
  get emitInterval() {
    return this._emitInterval;
  }
  set emitInterval(value) {
    if (value !== this._emitInterval) {
      this._emitInterval = Math.max(value, 1);
      this._emitStarted = false;
    }
  }
  /** How many particles should be emitted one time */
  get emitCount() {
    return this._emitCount;
  }
  set emitCount(value) {
    this._emitCount = value;
  }
  /** Gravity force */
  get gravity(): Immutable<Vector3> {
    return this._gravity;
  }
  set gravity(value: Immutable<Vector3>) {
    if (!value.equalsTo(this._gravity)) {
      this._gravity.set(value);
      this.invalidateBoundingVolume();
    }
  }
  /** Wind force */
  get wind(): Immutable<Vector3> {
    return this._wind;
  }
  set wind(value: Immutable<Vector3>) {
    if (!value.equalsTo(this._wind)) {
      this._wind.set(value);
      this.invalidateBoundingVolume();
    }
  }
  /** Particle scalar */
  get scalar() {
    return this._scalar;
  }
  set scalar(value) {
    if (value !== this._scalar) {
      this._scalar = value;
      this.invalidateBoundingVolume();
    }
  }
  /** Particle aspect ratio */
  get aspect() {
    return this._material.get()!.aspect;
  }
  set aspect(value) {
    this._material.get()!.aspect = value;
  }
  /** true if particle effected by wind */
  get airResistence() {
    return this._airResistence;
  }
  set airResistence(value) {
    this._airResistence = value;
  }
  /**
   * Minimum particle rotation speed in radians per second. Particles start upright and turn in the
   * plane of their quad; each picks a speed between the minimum and the maximum.
   */
  get particleRotationMin() {
    return this._particleRotationMin;
  }
  set particleRotationMin(value) {
    this._particleRotationMin = value;
  }
  /** Maximum particle rotation speed in radians per second, see particleRotationMin */
  get particleRotationMax() {
    return this._particleRotationMax;
  }
  set particleRotationMax(value) {
    this._particleRotationMax = value;
  }
  /** Particle jitter speed */
  get jitterSpeed() {
    return this._jitterSpeed;
  }
  set jitterSpeed(value) {
    this._jitterSpeed = value;
  }
  /** Particle jitter power */
  get jitterPower() {
    return this._material.get()!.jitterPower;
  }
  set jitterPower(value) {
    this._material.get()!.jitterPower = value;
  }
  /** Particle emitter shape */
  get emitterShape() {
    return this._emitterShape;
  }
  set emitterShape(value) {
    this._emitterShape = value;
  }
  /** Particle emitter behavior */
  get emitterBehavior() {
    return this._emitterBehavior;
  }
  set emitterBehavior(value) {
    this._emitterBehavior = value;
  }
  /**
   * Minimum cone radius of emitter. For the point and box shapes the initial direction is
   * (x, 1, z) normalized, with (x, z) spread evenly over the ring between the minimum and the
   * maximum radius, so a non-zero minimum gives a hollow cone. The cylinder shape spreads its
   * vertical direction by it.
   */
  get emitterConeRadiusMin() {
    return this._emitterConeRadiusMin;
  }
  set emitterConeRadiusMin(value) {
    this._emitterConeRadiusMin = value;
  }
  /** Maximum cone radius of emitter, see emitterConeRadiusMin */
  get emitterConeRadiusMax() {
    return this._emitterConeRadiusMax;
  }
  set emitterConeRadiusMax(value) {
    this._emitterConeRadiusMax = value;
  }
  /** Minimum particle velocity */
  get particleVelocityMin() {
    return this._particleVelocityMin;
  }
  set particleVelocityMin(value) {
    this._particleVelocityMin = value;
  }
  /** Maximum particle velocity */
  get particleVelocityMax() {
    return this._particleVelocityMax;
  }
  set particleVelocityMax(value) {
    this._particleVelocityMax = value;
  }
  /** Minimum particle life */
  get particleLifeMin() {
    return this._particleLifeMin;
  }
  set particleLifeMin(value) {
    this._particleLifeMin = value;
  }
  /** Maximum particle life */
  get particleLifeMax() {
    return this._particleLifeMax;
  }
  set particleLifeMax(value) {
    this._particleLifeMax = value;
  }
  /** Minimum particle start size */
  get particleSize1Min() {
    return this._particleSize1Min;
  }
  set particleSize1Min(value) {
    this._particleSize1Min = value;
  }
  /** Maximum particle start size */
  get particleSize1Max() {
    return this._particleSize1Max;
  }
  set particleSize1Max(value) {
    this._particleSize1Max = value;
  }
  /** Minimum particle end size */
  get particleSize2Min() {
    return this._particleSize2Min;
  }
  set particleSize2Min(value) {
    this._particleSize2Min = value;
  }
  /** Maximum particle end size */
  get particleSize2Max() {
    return this._particleSize2Max;
  }
  set particleSize2Max(value) {
    this._particleSize2Max = value;
  }
  /** Minimum particle acceleration */
  get particleAccelMin() {
    return this._particleAccelMin;
  }
  set particleAccelMin(value) {
    this._particleAccelMin = value;
  }
  /** Maximum particle acceleration */
  get particleAccelMax() {
    return this._particleAccelMax;
  }
  set particleAccelMax(value) {
    this._particleAccelMax = value;
  }
  /** Minimum emitter shape size */
  get emitterShapeSizeMin() {
    return this._emitterShapeSizeMin;
  }
  set emitterShapeSizeMin(value) {
    this._emitterShapeSizeMin.set(value);
  }
  /** Maximum emitter shape size */
  get emitterShapeSizeMax() {
    return this._emitterShapeSizeMax;
  }
  set emitterShapeSizeMax(value) {
    this._emitterShapeSizeMax.set(value);
  }
  /** Whether particles are directional */
  get directional() {
    return this._material.get()!.directional;
  }
  set directional(val) {
    this._material.get()!.directional = val;
  }
  /**
   * Whether particles are in world space. Changing it carries the live particles over to the new
   * space, so they keep their place.
   */
  get worldSpace() {
    return !!(this.flags & PS_WORLDSPACE);
  }
  set worldSpace(value) {
    if (value === this.worldSpace) {
      return;
    }
    if (this._activeParticleList.length > 0) {
      const m = value ? this.worldMatrix : this.invWorldMatrix;
      for (const p of this._activeParticleList) {
        m.transformPointAffine(p.position, p.position);
        m.transformVectorAffine(p.velocity, p.velocity);
      }
    }
    if (value) {
      this.flags |= PS_WORLDSPACE;
    } else {
      this.flags &= ~PS_WORLDSPACE;
    }
  }
  /** @internal */
  get flags() {
    return this._flags;
  }
  /** @internal */
  set flags(value) {
    this._flags = value;
  }
  /** @internal */
  computeBoundingVolume() {
    return this._wsBoundingBox;
  }
  /** Sets up a particle at its birth, in the local space of the emitter */
  private initParticle(p: Particle) {
    this.getParticleInitialPosition(p.position, p.velocity);
    p.size1 = this._particleSize1Min + Math.random() * (this._particleSize1Max - this._particleSize1Min);
    p.size2 = this._particleSize2Min + Math.random() * (this._particleSize2Max - this._particleSize2Min);
    p.size1 *= this._scalar;
    p.size2 = p.size2 * this._scalar - p.size1;
    p.angularVelocity =
      this._particleRotationMin + Math.random() * (this._particleRotationMax - this._particleRotationMin);
    p.lifeSpan = Math.max(
      this._particleLifeMin + Math.random() * (this._particleLifeMax - this._particleLifeMin),
      0.01
    );
    p.acceleration =
      this._particleAccelMin + Math.random() * (this._particleAccelMax - this._particleAccelMin);
    p.elapsedTime = 0;
    p.size = p.size1;
    p.rotation = 0;
    p.ageBias = Math.random();
    p.jitterAngle = 0;
  }
  /**
   * Initial direction (x, 1, z) with (x, z) spread evenly over the ring between the minimum and the
   * maximum cone radius
   */
  private getConeDirection(vel: Vector3) {
    const r0 = this._emitterConeRadiusMin * this._emitterConeRadiusMin;
    const r1 = this._emitterConeRadiusMax * this._emitterConeRadiusMax;
    const r = Math.sqrt(r0 + Math.random() * (r1 - r0));
    const phi = Math.random() * Math.PI * 2;
    vel.x = Math.cos(phi) * r;
    vel.y = 1;
    vel.z = Math.sin(phi) * r;
  }
  private getParticleInitialPosition(pos: Vector3, vel: Vector3) {
    if (this._emitterShape === 'point') {
      pos.setXYZ(0, 0, 0);
      this.getConeDirection(vel);
    } else {
      const shapeSizeX = Math.max(
        this._emitterShapeSizeMin.x +
          (this._emitterShapeSizeMax.x - this._emitterShapeSizeMin.x) * Math.random(),
        0.01
      );
      const shapeSizeY = Math.max(
        this._emitterShapeSizeMin.y +
          (this._emitterShapeSizeMax.y - this._emitterShapeSizeMin.y) * Math.random(),
        0.01
      );
      const shapeSizeZ = Math.max(
        this._emitterShapeSizeMin.z +
          (this._emitterShapeSizeMax.z - this._emitterShapeSizeMin.z) * Math.random(),
        0.01
      );
      switch (this._emitterShape) {
        case 'sphere': {
          // Uniform on the unit sphere: the height, not the polar angle, is uniform
          const y = Math.random() * 2 - 1;
          const r = Math.sqrt(Math.max(1 - y * y, 0));
          const theta = Math.PI * 2 * Math.random();
          const x = Math.sin(theta) * r;
          const z = Math.cos(theta) * r;
          pos.x = x * shapeSizeX;
          pos.y = y * shapeSizeY;
          pos.z = z * shapeSizeZ;
          vel.x = pos.x;
          vel.y = pos.y;
          vel.z = pos.z;
          if (this._emitterBehavior === 'volume') {
            // Uniform in the ball
            const t = Math.cbrt(Math.random());
            pos.x *= t;
            pos.y *= t;
            pos.z *= t;
          }
          break;
        }
        case 'box': {
          let x = Math.random() * 2 - 1;
          let y = Math.random() * 2 - 1;
          let z = Math.random() * 2 - 1;
          if (this._emitterBehavior === 'surface') {
            // Uniform on the surface: pick a face by its area, then put the point on it
            const areaX = shapeSizeY * shapeSizeZ;
            const areaY = shapeSizeX * shapeSizeZ;
            const areaZ = shapeSizeX * shapeSizeY;
            const u = Math.random() * (areaX + areaY + areaZ);
            const side = Math.random() < 0.5 ? -1 : 1;
            if (u < areaX) {
              x = side;
            } else if (u < areaX + areaY) {
              y = side;
            } else {
              z = side;
            }
          }
          pos.x = x * shapeSizeX;
          pos.y = y * shapeSizeY;
          pos.z = z * shapeSizeZ;
          this.getConeDirection(vel);
          break;
        }
        case 'cylinder': {
          const alpha = Math.random() * Math.PI * 2;
          let x = Math.sin(alpha);
          let z = Math.cos(alpha);
          const y = Math.random() * 2 - 1;
          const coneRadius =
            this._emitterConeRadiusMin +
            (this._emitterConeRadiusMax - this._emitterConeRadiusMin) * Math.random();
          vel.x = x * shapeSizeX;
          vel.y = (-coneRadius + Math.random() * 2 * coneRadius) * shapeSizeY;
          vel.z = z * shapeSizeZ;
          if (this._emitterBehavior === 'volume') {
            // Uniform over the cross section
            const t = Math.sqrt(Math.random());
            x *= t;
            z *= t;
          }
          pos.x = x * shapeSizeX;
          pos.y = y * shapeSizeY;
          pos.z = z * shapeSizeZ;
          break;
        }
        case 'cone': {
          const alpha = Math.random() * Math.PI * 2;
          // Distance from the apex as a fraction of the slant; the surface widens linearly with it
          const scale = Math.sqrt(Math.random());
          const s = Math.sin(alpha);
          const c = Math.cos(alpha);
          pos.x = s * scale * shapeSizeX;
          pos.y = (2 - 2 * scale) * shapeSizeY;
          pos.z = c * scale * shapeSizeZ;
          vel.x = s * shapeSizeX;
          vel.y = -shapeSizeY;
          vel.z = c * shapeSizeX;
          break;
        }
      }
    }
    vel.inplaceNormalize();
    vel.scaleBy(
      this._particleVelocityMin + Math.random() * (this._particleVelocityMax - this._particleVelocityMin)
    );
  }
  resizeVertexBuffers() {
    if (!this._primitive.get()) {
      this._primitive.set(new Primitive());
      this._primitive
        .get()!
        .createAndSetVertexBuffer(
          'position_f32x4',
          new Float32Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3])
        );
      this._primitive.get()!.createAndSetIndexBuffer(new Uint16Array([0, 1, 2, 3]));
      this._primitive.get()!.primitiveType = 'triangle-strip';
    }
    if (!this._instanceData || this._instanceData.length < this._maxParticleCount * 10) {
      this._primitive.get()!.removeVertexBuffer('texCoord0');
      this._instanceData = new Float32Array(nextPowerOf2(this._maxParticleCount) * 10);
      this._primitive
        .get()!
        .createAndSetVertexBuffer(['tex0_f32x3', 'tex1_f32x4', 'tex2_f32x3'], this._instanceData, 'instance');
    }
  }
  update(_frameId: number, _elapsedInSeconds: number, deltaInSeconds: number) {
    if (!this.attached) {
      return;
    }
    this.scene!.queueUpdateNode(this);
    const animationSet = this._animationSet.get();
    if (animationSet && animationSet.numAnimations > 0) {
      animationSet.update(deltaInSeconds);
    }
    this.invalidateBoundingVolume();
    // Step the live particles, compacting the survivors in place to keep their drawing order
    const list = this._activeParticleList;
    let numAlive = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (this.stepParticle(p, deltaInSeconds)) {
        list[numAlive++] = p;
      } else {
        this._freeParticles.push(p);
      }
    }
    list.length = numAlive;
    this.emitParticles(deltaInSeconds);
    this.getWorldPosition(this._prevWorldPos);
    this._hasPrevWorldPos = true;
    this.resizeVertexBuffers();
    this._wsBoundingBox.beginExtend();
    let n = 0;
    const worldSpace = !!(this._flags & PS_WORLDSPACE);
    const invWorldMatrix = this.invWorldMatrix;
    const instanceData = this._instanceData!;
    for (const p of this._activeParticleList) {
      if (worldSpace) {
        invWorldMatrix.transformPointAffine(p.position, tmpVec3);
        instanceData[n++] = tmpVec3.x;
        instanceData[n++] = tmpVec3.y;
        instanceData[n++] = tmpVec3.z;
        this._wsBoundingBox.extend(tmpVec3);
      } else {
        instanceData[n++] = p.position.x;
        instanceData[n++] = p.position.y;
        instanceData[n++] = p.position.z;
        this._wsBoundingBox.extend(p.position);
      }
      instanceData[n++] = p.size;
      instanceData[n++] = p.rotation;
      instanceData[n++] = p.jitterAngle;
      instanceData[n++] = p.elapsedTime / p.lifeSpan;
      if (worldSpace) {
        invWorldMatrix.transformVectorAffine(p.velocity, tmpVec3);
        instanceData[n++] = tmpVec3.x;
        instanceData[n++] = tmpVec3.y;
        instanceData[n++] = tmpVec3.z;
      } else {
        instanceData[n++] = p.velocity.x;
        instanceData[n++] = p.velocity.y;
        instanceData[n++] = p.velocity.z;
      }
    }
    // Sizes are in world units: the scalar scales them at birth, and a quad of a size turned
    // any way reaches half its diagonal from its center
    const material = this._material.get();
    const maxParticleSize =
      Math.max(
        Math.abs(this.particleSize1Min),
        Math.abs(this.particleSize1Max),
        Math.abs(this.particleSize2Min),
        Math.abs(this.particleSize2Max)
      ) * Math.abs(this._scalar);
    let pad = 0.5 * maxParticleSize * Math.hypot(material?.aspect ?? 1, 1);
    invWorldMatrix.decompose(tmpVec3, null, null);
    const scale = Math.max(Math.abs(tmpVec3.x), Math.abs(tmpVec3.y), Math.abs(tmpVec3.z));
    pad *= scale;
    // Jitter moves the particle by jitterPower in the local space, even when it does not swing
    pad += Math.abs(material?.jitterPower ?? 0);
    this._wsBoundingBox.minPoint.x -= pad;
    this._wsBoundingBox.minPoint.y -= pad;
    this._wsBoundingBox.minPoint.z -= pad;
    this._wsBoundingBox.maxPoint.x += pad;
    this._wsBoundingBox.maxPoint.y += pad;
    this._wsBoundingBox.maxPoint.z += pad;
    if (n > 0) {
      this._primitive.get()!.getVertexBuffer('texCoord0')!.bufferSubData(0, instanceData, 0, n);
    }
  }
  /**
   * Emits particles at once, regardless of the emit interval and count
   * @param num - Number of particles, capped by the room left under maxParticleCount
   * @param worldMatrix - World matrix of the emitter, which places the particles in world space
   */
  newParticle(num: number, worldMatrix: Matrix4x4) {
    this.spawnParticles(num, worldMatrix, null, 0);
  }
  /**
   * Emits the batches due by now. Each batch goes out at its own time within the frame: its
   * particles are aged by the time since then, and in world space they start where the emitter
   * was at that time, so a moving emitter leaves an even trail instead of one clump per frame.
   */
  private emitParticles(deltaInSeconds: number) {
    const worldMatrix = this.worldMatrix;
    if (!this._emitStarted) {
      // The first batch goes out at once
      this._emitStarted = true;
      this._emitTime = 0;
      this._numEmitCount = 1;
      this.spawnParticles(this._emitCount, worldMatrix, null, 0);
      return;
    }
    this._emitTime += deltaInSeconds;
    const interval = this._emitInterval * 0.001;
    const due = Math.floor(this._emitTime / interval) + 1;
    if (due <= this._numEmitCount) {
      return;
    }
    // Batches that would all have died by now are skipped, which bounds the catch up after a long frame
    const lifeMax = Math.max(this._particleLifeMin, this._particleLifeMax, 0.01);
    const first = Math.max(this._numEmitCount, Math.floor((this._emitTime - lifeMax) / interval) + 1);
    this._numEmitCount = due;
    if (this._emitCount <= 0) {
      return;
    }
    const trail = !!(this._flags & PS_WORLDSPACE) && this._hasPrevWorldPos && deltaInSeconds > 0;
    if (trail) {
      this.getWorldPosition(tmpVec3);
    }
    for (let k = first; k < due && this._activeParticleList.length < this._maxParticleCount; k++) {
      // Seconds since batch k went out
      const age = Math.max(this._emitTime - k * interval, 0);
      let offset: Nullable<Vector3> = null;
      if (trail) {
        // Back along the path the emitter took over this frame, by the share of the frame since then
        const t = Math.min(age / deltaInSeconds, 1);
        offset = tmpSpawnOffset.setXYZ(
          (this._prevWorldPos.x - tmpVec3.x) * t,
          (this._prevWorldPos.y - tmpVec3.y) * t,
          (this._prevWorldPos.z - tmpVec3.z) * t
        );
      }
      this.spawnParticles(this._emitCount, worldMatrix, offset, age);
    }
  }
  /**
   * Emits particles
   * @param num - Number of particles, capped by the room left under maxParticleCount
   * @param worldMatrix - World matrix of the emitter
   * @param offset - World space offset of the birth positions, world space particles only
   * @param age - Seconds the particles have lived by now
   */
  private spawnParticles(
    num: number,
    worldMatrix: Immutable<Matrix4x4>,
    offset: Nullable<Vector3>,
    age: number
  ) {
    // The instance buffer holds maxParticleCount particles; emission is capped at that as well
    num = Math.min(num, this._maxParticleCount - this._activeParticleList.length);
    const worldSpace = !!(this._flags & PS_WORLDSPACE);
    for (let i = 0; i < num; i++) {
      const p: Particle = this._freeParticles.pop() ?? {
        position: new Vector3(),
        velocity: new Vector3(),
        size1: 0,
        size2: 0,
        angularVelocity: 0,
        lifeSpan: 0,
        acceleration: 0,
        elapsedTime: 0,
        size: 0,
        rotation: 0,
        ageBias: 0,
        jitterAngle: 0
      };
      this.initParticle(p);
      if (worldSpace) {
        worldMatrix.transformPointAffine(p.position, p.position);
        worldMatrix.transformVectorAffine(p.velocity, p.velocity);
        if (offset) {
          p.position.addBy(offset);
        }
      }
      if (this.stepParticle(p, age)) {
        this._activeParticleList.push(p);
      } else {
        this._freeParticles.push(p);
      }
    }
  }
  /**
   * Advances a particle
   * @param p - The particle
   * @param dt - Seconds to advance
   * @returns false if the particle has died
   */
  private stepParticle(p: Particle, dt: number) {
    p.elapsedTime += dt;
    const age = p.elapsedTime / p.lifeSpan;
    if (age >= 1) {
      return false;
    }
    const v = p.velocity;
    v.x += this._gravity.x * dt;
    v.y += this._gravity.y * dt;
    v.z += this._gravity.z * dt;
    if (this._airResistence) {
      v.x += (this._wind.x - v.x) * dt;
      v.y += (this._wind.y - v.y) * dt;
      v.z += (this._wind.z - v.z) * dt;
    }
    const len = v.length;
    if (len > 0.0001) {
      const s = 1 + (dt * p.acceleration) / len;
      v.scaleBy(s < 0 ? 0 : s);
    }
    p.position.x += v.x * dt * this._scalar;
    p.position.y += v.y * dt * this._scalar;
    p.position.z += v.z * dt * this._scalar;
    p.jitterAngle = (p.elapsedTime + p.lifeSpan * p.ageBias) * this._jitterSpeed;
    p.size = Math.max(p.size1 + p.size2 * age, 0);
    p.rotation = p.angularVelocity * p.elapsedTime;
    return true;
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
   * {@inheritDoc SceneNode.isParticleSystem}
   */
  isParticleSystem(): this is ParticleSystem {
    return true;
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext, renderQueue: Nullable<RenderQueue>) {
    if (this._activeParticleList.length > 0) {
      this.bind(ctx, renderQueue);
      this._material.get()!.draw(this._primitive.get()!, ctx, this._activeParticleList.length);
    }
  }
  /**
   * {@inheritDoc SceneNode.onDispose}
   */
  onDispose() {
    super.onDispose();
    this._primitive.dispose();
    this._material.dispose();
    this._activeParticleList.length = 0;
    this._freeParticles.length = 0;
  }
}
