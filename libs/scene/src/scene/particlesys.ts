import type { Matrix4x4 } from '@zephyr3d/base';
import { applyMixins, nextPowerOf2, DRef } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { Scene } from './scene';
import { GraphNode } from './graph_node';
import type { BoundingVolume } from '../utility';
import { BoundingBox } from '../utility/bounding_volume';
import { mixinDrawable } from '../render/drawable_mixin';
import type { Drawable, DrawContext, MorphData, MorphInfo, PickTarget } from '../render';
import { Primitive } from '../render';
import { QUEUE_OPAQUE } from '../values';
import { ParticleMaterial, type MeshMaterial } from '../material';
import { getDevice } from '../app/api';

const tmpVec3 = new Vector3();

type Particle = {
  position: Vector3;
  velocity: Vector3;
  size1: number;
  size2: number;
  rotation: number;
  lifeSpan: number;
  acceleartion: number;
};

type ParticleNode = {
  particle: Particle;
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
  private static readonly updateFuncMap: WeakMap<ParticleSystem, () => void> = new WeakMap();
  private readonly _activeParticleList: ParticleNode[];
  private _maxParticleCount: number;
  private _emitInterval: number;
  private _emitCount: number;
  private _startTick: number;
  private _startEmitTime: number;
  private _lastUpdateTime: number;
  private _numEmitCount: number;
  private readonly _delay: number;
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
  private _instanceData: Float32Array<ArrayBuffer>;
  /**
   * Creates a new ParticleSystem node
   * @param scene - Which scene the node belongs to
   */
  constructor(scene: Scene) {
    super(scene);
    this._activeParticleList = [];
    this._maxParticleCount = 100;
    this._emitInterval = 100;
    this._emitCount = 1;
    this._gravity = Vector3.zero();
    this._wind = Vector3.zero();
    this._startEmitTime = 0;
    this._lastUpdateTime = 0;
    this._numEmitCount = 0;
    this._scalar = 1;
    this._airResistence = false;
    this._startTick = 0;
    this._delay = 0;
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
  }
  /** Material of the particle system node */
  get material(): ParticleMaterial {
    return this._material.get();
  }
  set material(material: ParticleMaterial) {
    this._material.set(material);
  }
  /** Maximum particle count */
  get maxParticleCount(): number {
    return this._maxParticleCount;
  }
  set maxParticleCount(value: number) {
    if (value !== this._maxParticleCount) {
      this._maxParticleCount = value;
      this.invalidateBoundingVolume();
    }
  }
  /** Particle emit interval in ms */
  get emitInterval(): number {
    return this._emitInterval;
  }
  set emitInterval(value: number) {
    if (value !== this._emitInterval) {
      this._emitInterval = Math.max(value, 1);
      this._startEmitTime = 0;
    }
  }
  /** How many particles should be emitted one time */
  get emitCount(): number {
    return this._emitCount;
  }
  set emitCount(value: number) {
    this._emitCount = value;
  }
  /** Gravity force */
  get gravity(): Vector3 {
    return this._gravity;
  }
  set gravity(value: Vector3) {
    if (!value.equalsTo(this._gravity)) {
      this._gravity.set(value);
      this.invalidateBoundingVolume();
    }
  }
  /** Wind force */
  get wind(): Vector3 {
    return this._wind;
  }
  set wind(value: Vector3) {
    if (!value.equalsTo(this._wind)) {
      this._wind.set(value);
      this.invalidateBoundingVolume();
    }
  }
  /** Particle scalar */
  get scalar(): number {
    return this._scalar;
  }
  set scalar(value: number) {
    if (value !== this._scalar) {
      this._scalar = value;
      this.invalidateBoundingVolume();
    }
  }
  /** Particle aspect ratio */
  get aspect(): number {
    return this._material.get().aspect;
  }
  set aspect(value: number) {
    this._material.get().aspect = value;
  }
  /** true if particle effected by wind */
  get airResistence(): boolean {
    return this._airResistence;
  }
  set airResistence(value: boolean) {
    this._airResistence = value;
  }
  /** Minimum particle rotation angle in radians */
  get particleRotationMin(): number {
    return this._particleRotationMin;
  }
  set particleRotationMin(value: number) {
    this._particleRotationMin = value;
  }
  /** Maximum particle rotation angle in radians */
  get particleRotationMax(): number {
    return this._particleRotationMax;
  }
  set particleRotationMax(value: number) {
    this._particleRotationMax = value;
  }
  /** Particle jitter speed */
  get jitterSpeed(): number {
    return this._jitterSpeed;
  }
  set jitterSpeed(value: number) {
    this._jitterSpeed = value;
  }
  /** Particle jitter power */
  get jitterPower(): number {
    return this._material.get().jitterPower;
  }
  set jitterPower(value: number) {
    this._material.get().jitterPower = value;
  }
  /** Particle emitter shape */
  get emitterShape(): EmitterShape {
    return this._emitterShape;
  }
  set emitterShape(value: EmitterShape) {
    this._emitterShape = value;
  }
  /** Particle emitter behavior */
  get emitterBehavior(): EmitterBehavior {
    return this._emitterBehavior;
  }
  set emitterBehavior(value: EmitterBehavior) {
    this._emitterBehavior = value;
  }
  /** Minimum cone radius of emitter */
  get emitterConeRadiusMin(): number {
    return this._emitterConeRadiusMin;
  }
  set emitterConeRadiusMin(value: number) {
    this._emitterConeRadiusMin = value;
  }
  /** Maximum cone radius of emitter */
  get emitterConeRadiusMax(): number {
    return this._emitterConeRadiusMax;
  }
  set emitterConeRadiusMax(value: number) {
    this._emitterConeRadiusMax = value;
  }
  /** Minimum particle velocity */
  get particleVelocityMin(): number {
    return this._particleVelocityMin;
  }
  set particleVelocityMin(value: number) {
    this._particleVelocityMin = value;
  }
  /** Maximum particle velocity */
  get particleVelocityMax(): number {
    return this._particleVelocityMax;
  }
  set particleVelocityMax(value: number) {
    this._particleVelocityMax = value;
  }
  /** Minimum particle life */
  get particleLifeMin(): number {
    return this._particleLifeMin;
  }
  set particleLifeMin(value: number) {
    this._particleLifeMin = value;
  }
  /** Maximum particle life */
  get particleLifeMax(): number {
    return this._particleLifeMax;
  }
  set particleLifeMax(value: number) {
    this._particleLifeMax = value;
  }
  /** Minimum particle start size */
  get particleSize1Min(): number {
    return this._particleSize1Min;
  }
  set particleSize1Min(value: number) {
    this._particleSize1Min = value;
  }
  /** Maximum particle start size */
  get particleSize1Max(): number {
    return this._particleSize1Max;
  }
  set particleSize1Max(value: number) {
    this._particleSize1Max = value;
  }
  /** Minimum particle end size */
  get particleSize2Min(): number {
    return this._particleSize2Min;
  }
  set particleSize2Min(value: number) {
    this._particleSize2Min = value;
  }
  /** Maximum particle end size */
  get particleSize2Max(): number {
    return this._particleSize2Max;
  }
  set particleSize2Max(value: number) {
    this._particleSize2Max = value;
  }
  /** Minimum particle acceleration */
  get particleAccelMin(): number {
    return this._particleAccelMin;
  }
  set particleAccelMin(value: number) {
    this._particleAccelMin = value;
  }
  /** Maximum particle acceleration */
  get particleAccelMax(): number {
    return this._particleAccelMax;
  }
  set particleAccelMax(value: number) {
    this._particleAccelMax = value;
  }
  /** Minimum emitter shape size */
  get emitterShapeSizeMin(): Vector3 {
    return this._emitterShapeSizeMin;
  }
  set emitterShapeSizeMin(value: Vector3) {
    this._emitterShapeSizeMin.set(value);
  }
  /** Maximum emitter shape size */
  get emitterShapeSizeMax(): Vector3 {
    return this._emitterShapeSizeMax;
  }
  set emitterShapeSizeMax(value: Vector3) {
    this._emitterShapeSizeMax.set(value);
  }
  /** Whether particles are directional */
  get directional(): boolean {
    return this._material.get().directional;
  }
  set directional(val: boolean) {
    this._material.get().directional = val;
  }
  /** Whether particles are in world space */
  get worldSpace(): boolean {
    return !!(this.flags & PS_WORLDSPACE);
  }
  set worldSpace(value: boolean) {
    if (value) {
      this.flags |= PS_WORLDSPACE;
    } else {
      this.flags &= ~PS_WORLDSPACE;
    }
  }
  /** @internal */
  get flags(): number {
    return this._flags;
  }
  set flags(value: number) {
    this._flags = value;
  }
  /** @internal */
  computeBoundingVolume(): BoundingVolume {
    return this._wsBoundingBox;
  }
  /** @internal */
  private initParticle(p?: Particle): Particle {
    p =
      p ??
      ({
        position: new Vector3(),
        velocity: new Vector3()
      } as Particle);
    this.getParticleInitialPosition(p.position, p.velocity);
    p.size1 = this._particleSize1Min + Math.random() * (this._particleSize1Max - this._particleSize1Min);
    p.size2 = this._particleSize2Min + Math.random() * (this._particleSize2Max - this._particleSize2Min);
    p.rotation =
      this._particleRotationMin + Math.random() * (this._particleRotationMax - this._particleRotationMin);
    p.lifeSpan = Math.max(
      this._particleLifeMin + Math.random() * (this._particleLifeMax - this._particleLifeMin),
      0.01
    );
    p.acceleartion =
      this._particleAccelMin + Math.random() * (this._particleAccelMax - this._particleAccelMin);
    return p;
  }
  private getParticleInitialPosition(pos: Vector3, vel: Vector3) {
    if (this._emitterShape === 'point') {
      pos.setXYZ(0, 0, 0);
      const coneRadius =
        this._emitterConeRadiusMin +
        Math.random() * (this._emitterConeRadiusMax - this._emitterConeRadiusMin);
      vel.x = -coneRadius + Math.random() * 2 * coneRadius;
      vel.y = 1;
      vel.z = -coneRadius + Math.random() * 2 * coneRadius;
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
          const alpha = Math.PI * Math.random();
          const theta = Math.PI * 2 * Math.random();
          const r = Math.sin(alpha);
          const y = Math.cos(alpha);
          const x = Math.sin(theta) * r;
          const z = Math.cos(theta) * r;
          pos.x = x * shapeSizeX;
          pos.y = y * shapeSizeY;
          pos.z = z * shapeSizeZ;
          vel.x = pos.x;
          vel.y = pos.y;
          vel.z = pos.z;
          if (this._emitterBehavior === 'volume') {
            const t = Math.random();
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
          if (this._emitterBehavior === 'volume') {
            const t = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
            if (t !== 0) {
              x /= t;
              y /= t;
              z /= t;
            }
          }
          pos.x = x * shapeSizeX;
          pos.y = y * shapeSizeY;
          pos.z = z * shapeSizeZ;
          const coneRadius =
            this._emitterConeRadiusMin +
            (this._emitterConeRadiusMax - this._emitterConeRadiusMin) * Math.random();
          vel.x = -coneRadius + Math.random() * 2 * coneRadius;
          vel.y = 1;
          vel.z = -coneRadius + Math.random() * 2 * coneRadius;
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
            const t = Math.random();
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
          const scale = Math.random();
          const s = Math.sin(alpha);
          const c = Math.cos(alpha);
          pos.x = s * scale * shapeSizeX;
          pos.y = (2 - 2 * scale) * shapeSizeY;
          pos.z = c * scale * shapeSizeZ;
          const t = (shapeSizeY * shapeSizeY) / Math.hypot(shapeSizeY * shapeSizeY + shapeSizeX + shapeSizeX);
          vel.x = s * shapeSizeX * t;
          vel.y = -t * shapeSizeY;
          vel.z = c * shapeSizeX * t;
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
        .get()
        .createAndSetVertexBuffer(
          'position_f32x4',
          new Float32Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3])
        );
      this._primitive.get().createAndSetIndexBuffer(new Uint16Array([0, 1, 2, 3]));
      this._primitive.get().primitiveType = 'triangle-strip';
    }
    if (!this._instanceData || this._instanceData.length < this._maxParticleCount * 10) {
      this._primitive.get().removeVertexBuffer('texCoord0');
      this._instanceData = new Float32Array(nextPowerOf2(this._maxParticleCount) * 10);
      this._primitive
        .get()
        .createAndSetVertexBuffer(['tex0_f32x3', 'tex1_f32x4', 'tex2_f32x3'], this._instanceData, 'instance');
    }
  }
  update() {
    const tick = getDevice().frameInfo.elapsedOverall;
    if (this._startTick === 0) {
      this._startTick = tick;
    }
    if (this._delay > 0 && tick - this._startTick < this._delay) {
      return;
    }
    if (this._lastUpdateTime === 0) {
      this._lastUpdateTime = tick;
    }
    const updateElapsed = tick - this._lastUpdateTime;
    this.invalidateBoundingVolume();
    const elapsedInSecond = updateElapsed * 0.001;
    this._lastUpdateTime = tick;
    for (let i = this._activeParticleList.length - 1; i >= 0; i--) {
      const node = this._activeParticleList[i];
      const p = node.particle;
      node.elapsedTime += elapsedInSecond;
      const age = node.elapsedTime / p.lifeSpan;
      if (age >= 1) {
        this._activeParticleList.splice(i, 1);
      } else {
        p.velocity.x += this._gravity.x * elapsedInSecond;
        p.velocity.y += this._gravity.y * elapsedInSecond;
        p.velocity.z += this._gravity.z * elapsedInSecond;
        if (this._airResistence) {
          p.velocity.x += (this._wind.x - p.velocity.x) * elapsedInSecond;
          p.velocity.y += (this._wind.y - p.velocity.y) * elapsedInSecond;
          p.velocity.z += (this._wind.z - p.velocity.z) * elapsedInSecond;
        }
        const len = p.velocity.length;
        if (len > 0.0001) {
          const s = 1 + (elapsedInSecond * p.acceleartion) / len;
          p.velocity.scaleBy(s < 0 ? 0 : s);
        }
        p.position.x += p.velocity.x * elapsedInSecond * this._scalar;
        p.position.y += p.velocity.y * elapsedInSecond * this._scalar;
        p.position.z += p.velocity.z * elapsedInSecond * this._scalar;
        node.jitterAngle = (node.elapsedTime + p.lifeSpan * node.ageBias) * this._jitterSpeed;
        node.size = Math.max(p.size1 + p.size2 * age, 0);
        node.rotation += p.rotation * elapsedInSecond;
      }
    }
    let newParticleCount = 0;
    if (this._startEmitTime === 0) {
      newParticleCount = this._emitCount > this._maxParticleCount ? this._maxParticleCount : this._emitCount;
      this._numEmitCount = 1;
      this._startEmitTime = tick;
    } else {
      const emitElapsed = tick - this._startEmitTime;
      const count = ((emitElapsed / this._emitInterval) >> 0) + 1;
      if (count > this._numEmitCount) {
        newParticleCount = this._emitCount;
        this._numEmitCount = count;
        if (this._activeParticleList.length + newParticleCount > this._maxParticleCount) {
          newParticleCount = this._maxParticleCount - this._activeParticleList.length;
        }
      }
    }
    if (newParticleCount > 0) {
      this.newParticle(newParticleCount, this.worldMatrix);
    }
    this.resizeVertexBuffers();
    this._wsBoundingBox.beginExtend();
    let n = 0;
    const worldSpace = !!(this._flags & PS_WORLDSPACE);
    const invWorldMatrix = this.invWorldMatrix;
    for (const p of this._activeParticleList) {
      if (worldSpace) {
        invWorldMatrix.transformPointAffine(p.particle.position, tmpVec3);
        this._instanceData[n++] = tmpVec3.x;
        this._instanceData[n++] = tmpVec3.y;
        this._instanceData[n++] = tmpVec3.z;
        this._wsBoundingBox.extend(tmpVec3);
      } else {
        this._instanceData[n++] = p.particle.position.x;
        this._instanceData[n++] = p.particle.position.y;
        this._instanceData[n++] = p.particle.position.z;
        this._wsBoundingBox.extend(p.particle.position);
      }
      this._instanceData[n++] = p.size;
      this._instanceData[n++] = p.rotation;
      this._instanceData[n++] = p.jitterAngle;
      this._instanceData[n++] = p.elapsedTime / p.particle.lifeSpan;
      if (worldSpace) {
        invWorldMatrix.transformVectorAffine(p.particle.velocity, tmpVec3);
        this._instanceData[n++] = tmpVec3.x;
        this._instanceData[n++] = tmpVec3.y;
        this._instanceData[n++] = tmpVec3.z;
      } else {
        this._instanceData[n++] = p.particle.velocity.x;
        this._instanceData[n++] = p.particle.velocity.y;
        this._instanceData[n++] = p.particle.velocity.z;
      }
    }
    let maxParticleSize = Math.max(
      Math.abs(this.particleSize1Min),
      Math.abs(this.particleSize1Max),
      Math.abs(this.particleSize2Min),
      Math.abs(this.particleSize2Max)
    );
    invWorldMatrix.decompose(tmpVec3, null, null);
    const scale = Math.max(Math.abs(tmpVec3.x), Math.abs(tmpVec3.y), Math.abs(tmpVec3.z));
    maxParticleSize *= scale;
    if (this._jitterSpeed !== 0 && this.jitterPower !== 0) {
      maxParticleSize += 2 * Math.abs(this.jitterPower);
    }
    this._wsBoundingBox.minPoint.x -= maxParticleSize;
    this._wsBoundingBox.minPoint.y -= maxParticleSize;
    this._wsBoundingBox.minPoint.z -= maxParticleSize;
    this._wsBoundingBox.maxPoint.x += maxParticleSize;
    this._wsBoundingBox.maxPoint.y += maxParticleSize;
    this._wsBoundingBox.maxPoint.z += maxParticleSize;
    this._primitive.get().getVertexBuffer('texCoord0').bufferSubData(0, this._instanceData);
  }
  newParticle(num: number, worldMatrix: Matrix4x4) {
    for (let i = 0; i < num; i++) {
      const particle = this.initParticle();
      particle.size1 *= this._scalar;
      particle.size2 *= this._scalar;
      particle.size2 -= particle.size1;
      const node: ParticleNode = {
        particle,
        elapsedTime: 0,
        rotation: 0,
        size: particle.size1,
        ageBias: Math.random(),
        jitterAngle: 0
      };
      if (this._flags & PS_WORLDSPACE) {
        worldMatrix.transformPointAffine(particle.position, particle.position);
        worldMatrix.transformVectorAffine(particle.velocity, particle.velocity);
      }
      this._activeParticleList.push(node);
    }
  }
  /**
   * {@inheritDoc Drawable.getPickTarget }
   */
  getPickTarget(): PickTarget {
    return this._pickTarget;
  }
  /**
   * {@inheritDoc Drawable.getMorphData}
   */
  getMorphData(): MorphData {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo(): MorphInfo {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getQueueType}
   */
  getQueueType(): number {
    return this._material.get()?.getQueueType() ?? QUEUE_OPAQUE;
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit(): boolean {
    return !this._material.get()?.supportLighting();
  }
  /**
   * {@inheritDoc Drawable.needSceneColor}
   */
  needSceneColor(): boolean {
    return this._material.get()?.needSceneColor();
  }
  /**
   * {@inheritDoc Drawable.needSceneDepth}
   */
  needSceneDepth(): boolean {
    return this._material.get()?.needSceneDepth();
  }
  /**
   * {@inheritDoc Drawable.getMaterial}
   */
  getMaterial(): MeshMaterial {
    return this._material.get();
  }
  /**
   * {@inheritDoc Drawable.getPrimitive}
   */
  getPrimitive(): Primitive {
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
  draw(ctx: DrawContext) {
    if (this._activeParticleList.length > 0) {
      this.bind(ctx);
      this._material.get().draw(this._primitive.get(), ctx, this._activeParticleList.length);
    }
  }
  /**
   * {@inheritDoc SceneNode.onDispose}
   */
  onDispose() {
    super.onDispose();
    this._primitive.dispose();
    this._material.dispose();
    const func = ParticleSystem.updateFuncMap.get(this);
    if (func) {
      this._scene.off('update', func);
    }
  }
  protected _onDetached(): void {
    super._onDetached();
    const func = ParticleSystem.updateFuncMap.get(this);
    if (func) {
      this._scene.off('update', func);
    }
  }
  protected _onAttached(): void {
    super._onAttached();
    let func = ParticleSystem.updateFuncMap.get(this);
    if (!func) {
      func = this.update.bind(this);
      ParticleSystem.updateFuncMap.set(this, func);
    }
    this._scene.on('update', func);
  }
}
