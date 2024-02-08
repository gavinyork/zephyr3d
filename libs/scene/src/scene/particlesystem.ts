/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
import { Vector2, Vector3 } from '@zephyr3d/base';
import { Application } from '../app';
import type { Material } from '../material';
import type { DrawContext } from '../render';
import { Primitive } from '../render';
import { GraphNode } from './graph_node';
import type { Scene } from './scene';

type Particle = {
  pos: Vector3;
  vel: Vector3;
  size1: number;
  size2: number;
  rotation: number;
  lifeSpan: number;
  accel: number;
};

type ParticleNode = {
  particle: Particle;
  elapsedTime: number;
  size: number;
  rotation: number;
  ageBias: number;
  jitterAngle: number;
};

export interface ParticleEmitter {
  initParticle(ps: ParticleSystem, particle: Particle, emitTime: number): void;
  reset(): void;
}

/** @internal */
export class ParticleSystem extends GraphNode {
  /** @internal */
  private static readonly DIRECTIONAL_PARTICLE = 1 << 0;
  /** @internal */
  private static readonly WORLDSPACE = 1 << 1;
  /** @internal */
  private _primitive: Primitive;
  /** @internal */
  private _material: Material;
  /** @internal */
  private _particles: ParticleNode[];
  /** @internal */
  private _maxParticleCount: number;
  /** @internal */
  private _activeParticleCount: number;
  /** @internal */
  private _emitInterval: number;
  /** @internal */
  private _startTick: number;
  /** @internal */
  private _flags: number;
  /** @internal */
  private _gravity: Vector3;
  /** @internal */
  private _wind: Vector3;
  /** @internal */
  private _aspect: number;
  /** @internal */
  private _jitterSpeed: number;
  /** @internal */
  private _jitterPower: number;
  /** @internal */
  private _particleRotation: Vector2;
  /** @internal */
  private _particleVelocity: Vector2;
  /** @internal */
  private _particleLife: Vector2;
  /** @internal */
  private _particleSize1: Vector2;
  /** @internal */
  private _particleSize2: Vector2;
  /** @internal */
  private _particleAcceleration: Vector2;
  /** @internal */
  private _lastUpdateTime: number;
  /** @internal */
  private _vertexData: Float32Array;

  /**
   * Creates an instance of mesh node
   * @param scene - The scene to which the mesh node belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._primitive = null;
    this._material = null;
    this._particles = [];
    this._maxParticleCount = 0;
    this._activeParticleCount = 0;
    this._emitInterval = 0.1;
    this._startTick = 0;
    this._flags = 0;
    this._gravity = Vector3.zero();
    this._wind = Vector3.zero();
    this._aspect = 1;
    this._jitterSpeed = 0;
    this._jitterPower = 0;
    this._particleRotation = Vector2.zero();
    this._particleVelocity = Vector2.zero();
    this._particleLife = Vector2.zero();
    this._particleSize1 = Vector2.zero();
    this._particleSize2 = Vector2.zero();
    this._particleAcceleration = Vector2.zero();
    this._lastUpdateTime = 0;
    this._vertexData = null;
  }
  /**
   * {@inheritDoc Drawable.isTransparency}
   */
  isTransparency(): boolean {
    return !!this._material?.isTransparent();
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit(): boolean {
    return !this._material?.supportLighting();
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext) {
    this._material.draw(this._primitive, ctx);
  }
  /** @internal */
  updatePrimitive() {
    if (!this._primitive || this._primitive.indexCount < this._maxParticleCount * 6) {
      const device = Application.instance.device;
      this._primitive.dispose();
      this._primitive = new Primitive();
      this._vertexData = new Float32Array(11 * 4 * this._maxParticleCount);
      const vertices = device.createInterleavedVertexBuffer(
        ['position_f32x4', 'tex0_f32x4', 'tex1_f32x3'],
        this._vertexData
      );
      this._primitive.setVertexBuffer(vertices);
      const indexData =
        this._maxParticleCount > 16384
          ? new Uint32Array(this._maxParticleCount * 6)
          : new Uint16Array(this._maxParticleCount * 6);
      for (let i = 0; i < this._maxParticleCount; i++) {
        indexData[i * 6 + 0] = i * 4 + 0;
        indexData[i * 6 + 1] = i * 4 + 1;
        indexData[i * 6 + 2] = i * 4 + 2;
        indexData[i * 6 + 3] = i * 4 + 0;
        indexData[i * 6 + 4] = i * 4 + 2;
        indexData[i * 6 + 5] = i * 4 + 3;
      }
      const indices = device.createIndexBuffer(indexData);
      this._primitive.setIndexBuffer(indices);
    }
  }
  /** @internal */
  update() {
    const frameInfo = Application.instance.device.frameInfo;
    const currentTime = frameInfo.frameTimestamp * 0.001;
    let elapsed = frameInfo.frameTimestamp * 0.001 - (this._lastUpdateTime || currentTime);
    if (elapsed > 1) {
      elapsed = 1;
    }
    this._lastUpdateTime = currentTime;
    let i = 0;
    const currentActiveCount = this._activeParticleCount;
    while (i < this._activeParticleCount) {
      const n = this._particles[i];
      const p = n.particle;
      n.elapsedTime += elapsed;
      if (n.elapsedTime >= p.lifeSpan) {
        const tmp = this._particles[this._activeParticleCount - 1];
        this._particles[this._activeParticleCount - 1] = this._particles[i];
        this._particles[i] = tmp;
        this._activeParticleCount--;
      } else {
        p.vel.x += this._gravity.x * elapsed;
        p.vel.y += this._gravity.y * elapsed;
        p.vel.z += this._gravity.z * elapsed;
        p.vel.x *= p.accel;
        p.vel.y *= p.accel;
        p.vel.z *= p.accel;
        p.pos.x += p.vel.x * this.scale.x * elapsed;
        p.pos.y += p.vel.y * this.scale.y * elapsed;
        p.pos.z += p.vel.z * this.scale.z * elapsed;
        n.jitterAngle = (n.elapsedTime + p.lifeSpan * n.ageBias) * this._jitterSpeed;
        n.size = p.size1 + (p.size2 * n.elapsedTime) / p.lifeSpan;
        n.rotation += p.rotation * elapsed;
        i++;
      }
    }
    const newParticleCount = currentActiveCount - this._activeParticleCount;
  }
}
