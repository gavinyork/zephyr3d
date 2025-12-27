import { MeshMaterial } from './meshmaterial';
import type { BindGroup, PBFunctionScope, Texture2D } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render';
import type { Clonable } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';

/**
 * Particle material.
 *
 * - Specializes `MeshMaterial` for billboard/sprite-style particles.
 * - Provides optional alpha map (coverage/shape) and ramp map (color/alpha over lifetime or scalar).
 * - Uses blended transparency by default and disables face culling.
 * - Supports per-particle attributes via vertex inputs (position, params, velocity).
 *
 * Features:
 * - `FEATURE_ALPHA_MAP`: enables sampling an alpha coverage texture.
 * - `FEATURE_RAMP_MAP`: enables sampling a ramp/gradient texture.
 *
 * Default states:
 * - `cullMode = 'none'`
 * - `blendMode = 'blend'`
 *
 * @public
 */
export class ParticleMaterial extends MeshMaterial implements Clonable<ParticleMaterial> {
  private static readonly FEATURE_ALPHA_MAP = this.defineFeature();
  private static readonly FEATURE_RAMP_MAP = this.defineFeature();
  private readonly _params: Vector4;
  private readonly _alphaMap: DRef<Texture2D>;
  private readonly _rampMap: DRef<Texture2D>;
  constructor() {
    super();
    this.cullMode = 'none';
    this.blendMode = 'blend';
    this._params = new Vector4(0, 1, 0, 0);
    this._alphaMap = new DRef();
    this._rampMap = new DRef();
  }
  /**
   * Create a clone of this particle material, copying relevant parameters (jitter, aspect, directional).
   *
   * @returns A cloned `ParticleMaterial`.
   */
  clone(): ParticleMaterial {
    const other = new ParticleMaterial();
    other.copyFrom(this);
    return other;
  }
  /**
   * Copy base and particle-specific properties from another particle material.
   *
   * @param other - The source material to copy from.
   * @returns void
   */
  copyFrom(other: this): void {
    super.copyFrom(other);
    this.jitterPower = other.jitterPower;
    this.aspect = other.aspect;
    this.directional = other.directional;
  }
  /**
   * Particles are not instanced via material instancing. Each particle system is expected
   * to provide per-particle data through vertex attributes instead.
   *
   * @returns False always.
   */
  supportInstancing(): boolean {
    return false;
  }
  /**
   * Texture used to modulate particle alpha coverage (shape/softness).
   * When set, enables the alpha map feature and marks uniforms dirty.
   *
   * @returns The current alpha map texture or `undefined` if not set.
   */
  get alphaMap() {
    return this._alphaMap.get();
  }
  set alphaMap(tex) {
    if (tex !== this._alphaMap.get()) {
      this._alphaMap.set(tex);
      this.useFeature(ParticleMaterial.FEATURE_ALPHA_MAP, !!this._alphaMap.get());
      this.uniformChanged();
    }
  }
  /**
   * Texture used as a color/alpha ramp (e.g., over particle lifetime).
   * Sampled along U with `particleParams.w`.
   * When set, enables the ramp map feature and marks uniforms dirty.
   *
   * @returns The current ramp map texture or `undefined` if not set.
   */
  get rampMap() {
    return this._rampMap.get();
  }
  set rampMap(tex) {
    if (tex !== this._rampMap.get()) {
      this._rampMap.set(tex);
      this.useFeature(ParticleMaterial.FEATURE_RAMP_MAP, !!this._rampMap.get());
      this.uniformChanged();
    }
  }
  /**
   * Random offset strength applied to particle billboards (world-space jitter).
   * Stored in `params.x`.
   *
   * @returns The current jitter power.
   */
  get jitterPower() {
    return this._params.x;
  }
  set jitterPower(val: number) {
    if (val !== this._params.x) {
      this._params.x = val;
      this.uniformChanged();
    }
  }
  /**
   * Particle aspect scaling factor for the billboard quad.
   * Stored in `params.y`, applied to the right axis.
   *
   * @returns The current aspect scaling.
   */
  get aspect() {
    return this._params.y;
  }
  set aspect(val: number) {
    if (val !== this._params.y) {
      this._params.y = val;
      this.uniformChanged();
    }
  }
  /**
   * Whether the particle is direction-oriented.
   * - If true, billboard axes are derived from particle velocity.
   * - If false, a stable axis (based on view up) is used.
   * Stored as `params.z` (1 for true, 0 for false).
   *
   * @returns True when direction-oriented; otherwise false.
   */
  get directional() {
    return this._params.z !== 0;
  }
  set directional(b: boolean) {
    const val = b ? 1 : 0;
    if (this._params.z !== val) {
      this._params.z = val;
      this.uniformChanged();
    }
  }
  /**
   * Vertex shader hook.
   *
   * Responsibilities:
   * - Derives per-vertex billboard position in world space based on:
   *   - particle position (`texCoord0`), params (`texCoord1`), and velocity (`texCoord2`).
   *   - `params` uniform: x=jitter power, y=aspect scale, z=directional flag.
   * - Builds a right/up basis aligned with either view or velocity.
   * - Computes UVs based on vertex ID (quad corners).
   * - Outputs `zUV`, `worldPos`, and `zParticleParams`.
   *
   * @param scope - Vertex shader function scope.
   * @returns void
   */
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    pb.func('rotation2d', [pb.float('t'), pb.vec2('v')], function () {
      this.$l.s = pb.sin(this.t);
      this.$l.c = pb.cos(this.t);
      this.$l.rc1 = pb.vec3(this.c, this.s, pb.mul(pb.sub(pb.sub(1, this.c), this.s), 0.5));
      this.$l.rc2 = pb.vec3(pb.neg(this.s), this.c, pb.mul(pb.add(pb.sub(1, this.c), this.s), 0.5));
      this.$l.uv = pb.vec3(this.v, 1);
      this.$return(pb.vec2(pb.dot(this.rc1, this.uv), pb.dot(this.rc2, this.uv)));
    });
    pb.func('rotation3d', [pb.float('t'), pb.vec3('v')], function () {
      this.$l.s = pb.sin(this.t);
      this.$l.c = pb.cos(this.t);
      this.$l.rot = pb.mat3(pb.vec3(this.c, pb.neg(this.s), 0), pb.vec3(this.s, this.c, 0), pb.vec3(0, 0, 1));
      this.$return(pb.mul(this.rot, this.v));
    });
    scope.$inputs.pos = pb.vec4().attrib('position');
    scope.$inputs.particlePos = pb.vec3().attrib('texCoord0');
    scope.$inputs.particleParams = pb.vec4().attrib('texCoord1');
    scope.$inputs.particleVelocity = pb.vec3().attrib('texCoord2');
    scope.params = pb.vec4().uniform(2);

    scope.$l.vertexID = pb.int(scope.$inputs.pos.w);
    scope.$l.z = pb.normalize(scope.$inputs.particleVelocity);
    scope.$l.x = pb.vec3(pb.neg(scope.z.y), scope.z.x, 0);
    scope.$l.y = pb.cross(scope.z, scope.x);
    scope.$l.offset = pb.add(
      pb.mul(pb.sin(scope.$inputs.particleParams.z), scope.x),
      pb.mul(pb.cos(scope.$inputs.particleParams.z), scope.y)
    );
    scope.$l.jitterVec = pb.mul(scope.offset, scope.params.x);
    scope.$l.centerPosWS = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(pb.add(scope.$inputs.particlePos, scope.jitterVec), 1)
    ).xyz;
    const viewMatrix = ShaderHelper.getViewMatrix(scope);
    scope.$l.forward = pb.vec3(viewMatrix[0].z, viewMatrix[1].z, viewMatrix[2].z);
    scope.$l.axis = scope.$choice(
      pb.notEqual(scope.params.z, 0),
      scope.z,
      scope.$choice(pb.lessThan(pb.abs(scope.forward.y), 0.999), pb.vec3(0, 1, 0), pb.vec3(1, 0, 0))
    );
    scope.$l.right = pb.normalize(pb.cross(scope.axis, scope.forward));
    scope.$l.up = pb.normalize(pb.cross(scope.forward, scope.right));
    scope.$l.pos = pb.vec2();
    scope.$l.uv = pb.vec2();
    scope
      .$if(pb.equal(scope.vertexID, 0), function () {
        scope.pos = pb.vec2(-0.5, -0.5);
        scope.uv = pb.vec2(0, 0);
      })
      .$elseif(pb.equal(scope.vertexID, 1), function () {
        scope.pos = pb.vec2(0.5, -0.5);
        scope.uv = pb.vec2(0, 1);
      })
      .$elseif(pb.equal(scope.vertexID, 2), function () {
        scope.pos = pb.vec2(-0.5, 0.5);
        scope.uv = pb.vec2(1, 0);
      })
      .$else(function () {
        scope.pos = pb.vec2(0.5, 0.5);
        scope.uv = pb.vec2(1, 1);
      });
    scope.pos = pb.mul(scope.pos, scope.$inputs.particleParams.x);
    scope.centerPosWS = pb.add(
      scope.centerPosWS,
      pb.mul(scope.right, scope.pos.x, scope.params.y),
      pb.mul(scope.up, scope.pos.y)
    );
    scope.$outputs.zUV = scope.uv;
    scope.$outputs.worldPos = scope.centerPosWS;
    scope.$outputs.zParticleParams = scope.$inputs.particleParams;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.centerPosWS, 1))
    );
  }
  /**
   * Fragment shader hook.
   *
   * Responsibilities:
   * - Optionally samples:
   *   - `alphaMap` for alpha coverage (R channel).
   *   - `rampMap` along U=`particleParams.w` for color/alpha.
   * - Multiplies ramp color with computed alpha, then delegates to `outputFragmentColor`.
   * - If no color is needed (e.g., non-light pass), calls `outputFragmentColor` with null color.
   *
   * @param scope - Fragment shader function scope.
   * @returns void
   */
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    if (this.needFragmentColor()) {
      const pb = scope.$builder;
      if (this.alphaMap) {
        scope.alphaMap = pb.tex2D().uniform(2);
      }
      if (this.rampMap) {
        scope.rampMap = pb.tex2D().uniform(2);
      }
      scope.$l.alpha = this.alphaMap ? pb.textureSample(scope.alphaMap, scope.$inputs.zUV).r : pb.float(1);
      scope.$l.rampValue = this.rampMap
        ? pb.textureSample(scope.rampMap, pb.vec2(scope.$inputs.zParticleParams.w, 0))
        : pb.vec4(1);
      this.outputFragmentColor(
        scope,
        scope.$inputs.worldPos,
        pb.mul(scope.rampValue, pb.vec4(1, 1, 1, scope.alpha))
      );
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  /**
   * Submit particle-specific uniforms and textures to the bind group.
   *
   * Sets:
   * - `params` = vec4(jitterPower, aspect, directionalFlag, 0).
   * - Binds `alphaMap` and `rampMap` when fragment color is needed for the current pass.
   *
   * Also calls `super.applyUniformValues` to set common uniforms (alpha cutoff, opacity, etc.).
   *
   * @param bindGroup - The material bind group (set 2) to write to.
   * @param ctx - The current draw context.
   * @param pass - The current material pass.
   * @returns void
   */
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('params', this._params);
    if (this.needFragmentColor(ctx)) {
      if (this.alphaMap) {
        bindGroup.setTexture('alphaMap', this.alphaMap);
      }
      if (this.rampMap) {
        bindGroup.setTexture('rampMap', this.rampMap);
      }
    }
  }
}
