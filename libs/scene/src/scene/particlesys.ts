import { Vector4 } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { Scene } from '.';
import { Mesh } from '.';

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

const PS_WORLDSPACE = 1 << 8;

export type EmitterShape = 'point' | 'sphere' | 'box' | 'cylinder' | 'cone';
export type EmitterBehavior = 'surface' | 'volume';
export type ParticleForm = 'sprite' | 'line';
export type ParticleDirection = 'none' | 'velocity' | 'verticle' | 'horizontal';

export class ParticleSystem extends Mesh {
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
  private _particleForm: ParticleForm;
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
    this._particleForm = 'sprite';
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
    this._flags = PS_WORLDSPACE;
  }
  set maxParticleCount(value: number) {
    this._maxParticleCount = value;
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
    this._emitInterval = value;
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
    this._gravity = value;
  }
  get gravity(): Vector3 {
    return this._gravity;
  }
  set wind(value: Vector3) {
    this._wind = value;
  }
  get wind(): Vector3 {
    return this._wind;
  }
  set scalar(value: number) {
    this._scalar = value;
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
  set particleForm(value: ParticleForm) {
    this._particleForm = value;
  }
  get particleForm(): ParticleForm {
    return this._particleForm;
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
    this._emitterShapeSize = value;
  }
  get emitterShapeSize(): Vector3 {
    return this._emitterShapeSize;
  }
  set emitterShapeSizeVar(value: Vector3) {
    this._emitterShapeSizeVar = value;
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
  }
  get directionType(): ParticleDirection {
    return this._directionType;
  }
  set flags(value: number) {
    this._flags = value;
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
  set paused(value: boolean) {
    this._paused = value;
  }
  get paused(): boolean {
    return this._paused;
  }
}
