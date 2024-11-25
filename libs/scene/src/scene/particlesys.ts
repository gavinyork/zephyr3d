import { applyMixins, Vector4 } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { Scene } from './scene';
import { GraphNode } from './graph_node';
import type { BoundingBox, BoundingVolume } from '../utility';
import { mixinDrawable } from '../render/drawable_mixin';
import type { Drawable, DrawContext, PickTarget, Primitive } from '../render';
import type { GPUDataBuffer, Texture2D } from '@zephyr3d/device';
import { QUEUE_OPAQUE } from '../values';
import type { MeshMaterial } from '../material';

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
  next: ParticleNode;
};

const PS_DIRECTIONAL = 1 << 7;
const PS_WORLDSPACE = 1 << 8;

export type EmitterShape = 'point' | 'sphere' | 'box' | 'cylinder' | 'cone';
export type EmitterBehavior = 'surface' | 'volume';
export type ParticleDirection = 'none' | 'velocity' | 'vertical' | 'horizontal';

export class ParticleSystem extends applyMixins(GraphNode, mixinDrawable) implements Drawable {
  private _activeParticleList: ParticleNode;
  private _freeParticleList: ParticleNode;
  private _maxParticleCount: number;
  private _updateInterval: number;
  private _emitInterval: number;
  private _emitCount: number;
  private _activeParticleCount: number;
  private _startTick: number;
  private _startEmitTime: number;
  private _lastUpdateTime: number;
  private _numEmitCount: number;
  private _delay: number;
  private _airResistence: boolean;
  private _needUpdateVertexArray: boolean;
  private _paused: boolean;
  private _transparency: number;
  private _blendMode: number;
  private _colorMultiplier: number;
  private _directionType: ParticleDirection;
  private _flags: number;
  private _gravity: Vector3;
  private _wind: Vector3;
  private _scalar: number;
  private _aspect: number;
  private _particleRotation: number;
  private _particleRotationVar: number;
  private _jitterSpeed: number;
  private _jitterPower: number;
  private _emitterShape: EmitterShape;
  private _emitterBehavior: EmitterBehavior;
  private _emitterConeRadius: number;
  private _emitterConeRadiusVar: number;
  private _particleVelocity: number;
  private _particleVelocityVar: number;
  private _particleLife: number;
  private _particleLifeVar: number;
  private _particleSize1: number;
  private _particleSize1Var: number;
  private _particleSize2: number;
  private _particleSize2Var: number;
  private _particleAccel: number;
  private _particleAccelVar: number;
  private _emitterShapeSize: Vector3;
  private _emitterShapeSizeVar: Vector3;
  private _colorValue: Vector4;
  private _primitive: Primitive;
  private _material: MeshMaterial;
  private _wsBoundingBox: BoundingBox;
  private _instanceColor: Vector4;
  private _pickTarget: PickTarget;
  constructor(scene: Scene) {
    super(scene);
    this._activeParticleList = null;
    this._freeParticleList = null;
    this._maxParticleCount = 100;
    this._emitInterval = 100;
    this._emitCount = 1;
    this._activeParticleCount = 0;
    this._gravity = Vector3.zero();
    this._wind = Vector3.zero();
    this._startEmitTime = 0;
    this._lastUpdateTime = 0;
    this._numEmitCount = 0;
    this._scalar = 1;
    this._aspect = 1;
    this._airResistence = false;
    this._updateInterval = 50;
    this._needUpdateVertexArray = false;
    this._paused = true;
    this._startTick = 0;
    this._delay = 0;
    this._blendMode = 0;
    this._particleRotation = 0;
    this._particleRotationVar = 0;
    this._jitterSpeed = 1;
    this._jitterPower = 0;
    this._emitterShape = 'point';
    this._emitterBehavior = 'surface';
    this._emitterConeRadius = 0;
    this._emitterConeRadiusVar = 0.1;
    this._emitterShapeSize = Vector3.one();
    this._emitterShapeSizeVar = Vector3.zero();
    this._colorValue = Vector4.one();
    this._particleVelocity = 0.2;
    this._particleVelocityVar = 0.2;
    this._particleLife = 1;
    this._particleLifeVar = 0.5;
    this._particleSize1 = 0.4;
    this._particleSize1Var = 0.1;
    this._particleSize2 = 0;
    this._particleSize2Var = 0.1;
    this._particleAccel = -0.01;
    this._particleAccelVar = -0.01;
    this._transparency = 1;
    this._colorMultiplier = 1;
    this._directionType = 'none';
    this._instanceColor = Vector4.zero();
    this._pickTarget = { node: this };
    this._flags = PS_WORLDSPACE;
    this._primitive = null;
    this._material = null;
    this._wsBoundingBox = null;
  }
  set maxParticleCount(value: number) {
    if (value !== this._maxParticleCount) {
      this._maxParticleCount = value;
      this.invalidateBoundingVolume();
    }
  }
  get maxParticleCount(): number {
    return this._maxParticleCount;
  }
  set updateInterval(value: number) {
    this._updateInterval = value;
  }
  get updateInterval(): number {
    return this._updateInterval;
  }
  set emitInterval(value: number) {
    if (value !== this._emitInterval) {
      this._emitInterval = Math.max(value, 1);
      this._startEmitTime = 0;
    }
  }
  get emitInterval(): number {
    return this._emitInterval;
  }
  set emitCount(value: number) {
    this._emitCount = value;
  }
  get emitCount(): number {
    return this._emitCount;
  }
  set gravity(value: Vector3) {
    if (!value.equalsTo(this._gravity)) {
      this._gravity.set(value);
      this.invalidateBoundingVolume();
    }
  }
  get gravity(): Vector3 {
    return this._gravity;
  }
  set wind(value: Vector3) {
    if (!value.equalsTo(this._wind)) {
      this._wind.set(value);
      this.invalidateBoundingVolume();
    }
  }
  get wind(): Vector3 {
    return this._wind;
  }
  set scalar(value: number) {
    if (value !== this._scalar) {
      this._scalar = value;
      this.invalidateBoundingVolume();
    }
  }
  get scalar(): number {
    return this._scalar;
  }
  set aspect(value: number) {
    this._aspect = value;
  }
  get aspect(): number {
    return this._aspect;
  }
  set airResistence(value: boolean) {
    this._airResistence = value;
  }
  get airResistence(): boolean {
    return this._airResistence;
  }
  set particleRotation(value: number) {
    this._particleRotation = value;
  }
  get particleRotation(): number {
    return this._particleRotation;
  }
  set particleRotationVar(value: number) {
    this._particleRotationVar = value;
  }
  get particleRotationVar(): number {
    return this._particleRotationVar;
  }
  set jitterSpeed(value: number) {
    this._jitterSpeed = value;
  }
  get jitterSpeed(): number {
    return this._jitterSpeed;
  }
  set jitterPower(value: number) {
    this._jitterPower = value;
  }
  get jitterPower(): number {
    return this._jitterPower;
  }
  set emitterShape(value: EmitterShape) {
    this._emitterShape = value;
  }
  get emitterShape(): EmitterShape {
    return this._emitterShape;
  }
  set emitterBehavior(value: EmitterBehavior) {
    this._emitterBehavior = value;
  }
  get emitterBehavior(): EmitterBehavior {
    return this._emitterBehavior;
  }
  set emitterConeRadius(value: number) {
    this._emitterConeRadius = value;
  }
  get emitterConeRadius(): number {
    return this._emitterConeRadius;
  }
  set emitterConeRadiusVar(value: number) {
    this._emitterConeRadiusVar = value;
  }
  get emitterConeRadiusVar(): number {
    return this._emitterConeRadiusVar;
  }
  set particleVelocity(value: number) {
    this._particleVelocity = value;
  }
  get particleVelocity(): number {
    return this._particleVelocity;
  }
  set particleVelocityVar(value: number) {
    this._particleVelocityVar = value;
  }
  get particleVelocityVar(): number {
    return this._particleVelocityVar;
  }
  set particleLife(value: number) {
    this._particleLife = value;
  }
  get particleLife(): number {
    return this._particleLife;
  }
  set particleLifeVar(value: number) {
    this._particleLifeVar = value;
  }
  get particleLifeVar(): number {
    return this._particleLifeVar;
  }
  set particleSize1(value: number) {
    this._particleSize1 = value;
  }
  get particleSize1(): number {
    return this._particleSize1;
  }
  set particleSize1Var(value: number) {
    this._particleSize1Var = value;
  }
  get particleSize1Var(): number {
    return this._particleSize1Var;
  }
  set particleSize2(value: number) {
    this._particleSize2 = value;
  }
  get particleSize2(): number {
    return this._particleSize2;
  }
  set particleSize2Var(value: number) {
    this._particleSize2Var = value;
  }
  get particleSize2Var(): number {
    return this._particleSize2Var;
  }
  set particleAccel(value: number) {
    this._particleAccel = value;
  }
  get particleAccel(): number {
    return this._particleAccel;
  }
  set particleAccelVar(value: number) {
    this._particleAccelVar = value;
  }
  get particleAccelVar(): number {
    return this._particleAccelVar;
  }
  set emitterShapeSize(value: Vector3) {
    this._emitterShapeSize.set(value);
  }
  get emitterShapeSize(): Vector3 {
    return this._emitterShapeSize;
  }
  set emitterShapeSizeVar(value: Vector3) {
    this._emitterShapeSizeVar.set(value);
  }
  get emitterShapeSizeVar(): Vector3 {
    return this._emitterShapeSizeVar;
  }
  set colorValue(value: Vector4) {
    this._colorValue = value;
  }
  get colorValue(): Vector4 {
    return this._colorValue;
  }
  set directionType(value: ParticleDirection) {
    this._directionType = value;
    if (this._directionType === 'none') {
      this.flags &= ~PS_DIRECTIONAL;
    } else {
      this.flags |= PS_DIRECTIONAL;
    }
  }
  get directionType(): ParticleDirection {
    return this._directionType;
  }
  set worldSpace(value: boolean) {
    if (value) {
      this.flags |= PS_WORLDSPACE;
    } else {
      this.flags &= ~PS_WORLDSPACE;
    }
  }
  get worldSpace(): boolean {
    return !!(this.flags & PS_WORLDSPACE);
  }
  set flags(value: number) {
    if (value !== this._flags) {
      this._flags = value;
      this._needUpdateVertexArray = true;
    }
  }
  get flags(): number {
    return this._flags;
  }
  set transparency(value: number) {
    this._transparency = value;
  }
  get transparency(): number {
    return this._transparency;
  }
  set blendMode(value: number) {
    this._blendMode = value;
  }
  get blendMode(): number {
    return this._blendMode;
  }
  set colorMultiplier(value: number) {
    this._colorMultiplier = value;
  }
  get colorMultiplier(): number {
    return this._colorMultiplier;
  }
  pause() {
    this._paused = true;
  }
  resume() {
    this._paused = false;
  }
  /** @internal */
  computeBoundingVolume(): BoundingVolume {
    if (!this._wsBoundingBox) {
      return null;
    }
    if (this._flags & PS_WORLDSPACE) {
      return this._wsBoundingBox.transform(this.invWorldMatrix);
    }
    return this._wsBoundingBox;
  }
  /** @internal */
  private initParticle(p: Particle, emitTime: number) {
    this.getParticleInitialPosition(p.position, p.velocity);
    p.size1 = this._particleSize1 + Math.random() * this._particleSize1Var;
    p.size2 = this._particleSize2 + Math.random() * this._particleSize2Var;
    p.rotation = this._particleRotation + Math.random() * this._particleRotationVar;
    p.lifeSpan = this._particleLife + Math.random() * this._particleLifeVar;
    p.acceleartion = this._particleAccel + Math.random() * this._particleAccelVar;
  }
  private getParticleInitialPosition(pos: Vector3, vel: Vector3) {
    if (this._emitterShape === 'point') {
      pos.setXYZ(0, 0, 0);
      const coneRadius = this._emitterConeRadius + Math.random() * this._emitterConeRadiusVar;
      vel.x = -coneRadius + Math.random() * 2 * coneRadius;
      vel.y = 1;
      vel.z = -coneRadius + Math.random() * 2 * coneRadius;
    } else {
      const shapeSizeX = this._emitterShapeSize.x + this._emitterShapeSizeVar.x * Math.random();
      const shapeSizeY = this._emitterShapeSize.y + this._emitterShapeSizeVar.y * Math.random();
      const shapeSizeZ = this._emitterShapeSize.z + this._emitterShapeSizeVar.z * Math.random();
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
          const coneRadius = this._emitterConeRadius + this._emitterConeRadiusVar * Math.random();
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
          const coneRadius = this._emitterConeRadius + this._emitterConeRadiusVar * Math.random();
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
          const t = (shapeSizeY * shapeSizeY) / Math.sqrt(shapeSizeY * shapeSizeY + shapeSizeX + shapeSizeX);
          vel.x = s * shapeSizeX * t;
          vel.y = -t * shapeSizeY;
          vel.z = c * shapeSizeX * t;
          break;
        }
      }
    }
    vel.inplaceNormalize();
    vel.scaleBy(this._particleVelocity + Math.random() * this._particleVelocityVar);
  }
  /**
   * {@inheritDoc Drawable.getInstanceColor}
   */
  getInstanceColor(): Vector4 {
    return this._instanceColor;
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
  getMorphData(): Texture2D {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo(): GPUDataBuffer<unknown> {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getQueueType}
   */
  getQueueType(): number {
    return this._material?.getQueueType() ?? QUEUE_OPAQUE;
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit(): boolean {
    return !this._material?.supportLighting();
  }
  /**
   * {@inheritDoc Drawable.needSceneColor}
   */
  needSceneColor(): boolean {
    return this._material?.needSceneColor();
  }
  /**
   * {@inheritDoc Drawable.getMaterial}
   */
  getMaterial(): MeshMaterial {
    return this._material;
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext) {
    this.bind(ctx);
    this._material.draw(this._primitive, ctx);
  }
}
