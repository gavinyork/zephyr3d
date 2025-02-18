import { MeshMaterial } from './meshmaterial';
import type { BindGroup, PBFunctionScope, Texture2D } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render';
import type { Clonable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import { DRef } from '../app';

/**
 * Particle material
 * @public
 */
export class ParticleMaterial extends MeshMaterial implements Clonable<ParticleMaterial> {
  private static FEATURE_ALPHA_MAP = this.defineFeature();
  private static FEATURE_RAMP_MAP = this.defineFeature();
  private _params: Vector4;
  private _alphaMap: DRef<Texture2D>;
  private _rampMap: DRef<Texture2D>;
  constructor() {
    super();
    this.cullMode = 'none';
    this.blendMode = 'blend';
    this._params = new Vector4(0, 1, 0, 0);
    this._alphaMap = new DRef();
    this._rampMap = new DRef();
  }
  clone(): ParticleMaterial {
    const other = new ParticleMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this): void {
    super.copyFrom(other);
    this.jitterPower = other.jitterPower;
    this.aspect = other.aspect;
    this.directional = other.directional;
  }
  supportInstancing(): boolean {
    return false;
  }
  get alphaMap(): Texture2D {
    return this._alphaMap.get();
  }
  set alphaMap(tex: Texture2D) {
    if (tex !== this._alphaMap.get()) {
      this._alphaMap.set(tex);
      this.useFeature(ParticleMaterial.FEATURE_ALPHA_MAP, !!this._alphaMap.get());
      this.uniformChanged();
    }
  }
  get rampMap(): Texture2D {
    return this._rampMap.get();
  }
  set rampMap(tex: Texture2D) {
    if (tex !== this._rampMap.get()) {
      this._rampMap.set(tex);
      this.useFeature(ParticleMaterial.FEATURE_RAMP_MAP, !!this._rampMap.get());
      this.uniformChanged();
    }
  }
  get jitterPower() {
    return this._params.x;
  }
  set jitterPower(val: number) {
    if (val !== this._params.x) {
      this._params.x = val;
      this.uniformChanged();
    }
  }
  get aspect() {
    return this._params.y;
  }
  set aspect(val: number) {
    if (val !== this._params.y) {
      this._params.y = val;
      this.uniformChanged();
    }
  }
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
