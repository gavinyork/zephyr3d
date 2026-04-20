import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';
import { applyMaterialMixins } from '../../meshmaterial';
import type { IMixinLight } from '../lit';
import { mixinLight } from '../lit';
import type { DrawContext } from '../../../render';
import { ShaderHelper } from '../../shader/helper';
import { LIGHT_TYPE_POINT, MaterialVaryingFlags } from '../../../values';
import type { Immutable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';

/**
 * Interface for blinn-phong lighting model mixin
 * @public
 */
export type IMixinBlinnPhong = {
  shininess: number;
  scatterWrap: number;
  scatterWidth: number;
  scatterColor: Vector4;
  blinnPhongLight(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    albedo: PBShaderExp,
    outRoughness?: PBShaderExp
  ): PBShaderExp;
} & IMixinLight;

/**
 * Blinn-phong lighting model mixin
 * @param BaseCls - Class to mix in
 * @returns Mixed class
 * @public
 */
export function mixinBlinnPhong<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).blinnPhongMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinBlinnPhong };
  }
  const S = applyMaterialMixins(BaseCls, mixinLight);
  const SHININESS_UNIFORM = S.defineInstanceUniform('shininess', 'float', 'Shininess');
  let FEATURE_WRAP_LIGHTING = 0;
  const cls = class extends S implements IMixinBlinnPhong {
    protected static blinnPhongMixed = true;
    private _shininess: number;
    private _wrap: number;
    private _scatterWidth: number;
    private _scatterColor: Vector4;
    constructor() {
      super();
      this._shininess = 32;
      this._wrap = 0;
      this._scatterWidth = 0.3;
      this._scatterColor = Vector4.zero();
      this.useFeature(FEATURE_WRAP_LIGHTING, false);
    }
    copyFrom(other: this) {
      super.copyFrom(other);
      this.shininess = other.shininess;
      this.scatterWrap = other.scatterWrap;
      this.scatterColor = other.scatterColor;
      this.scatterWidth = other.scatterWidth;
    }
    /** Shininess */
    get shininess() {
      return this._shininess;
    }
    set shininess(val) {
      if (val !== this._shininess) {
        this._shininess = val;
        this.uniformChanged();
      }
    }
    /** Wrap */
    get scatterWrap() {
      return this._wrap;
    }
    set scatterWrap(wrap) {
      if (this._wrap !== wrap) {
        this._wrap = wrap;
        this.uniformChanged();
        this.useFeature(FEATURE_WRAP_LIGHTING, this._wrap !== 0);
      }
    }
    /** Scatter color */
    get scatterColor(): Immutable<Vector4> {
      return this._scatterColor;
    }
    set scatterColor(color: Immutable<Vector4>) {
      if (!color.equalsTo(this._scatterColor)) {
        this._scatterColor.set(color);
        this.uniformChanged();
      }
    }
    /** Scatter width */
    get scatterWidth() {
      return this._scatterWidth;
    }
    set scatterWidth(val) {
      if (val !== this._scatterWidth) {
        this._scatterWidth = val;
        this.uniformChanged();
      }
    }
    vertexShader(scope: PBFunctionScope) {
      super.vertexShader(scope);
      if (this.needFragmentColor() && this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING) {
        scope.$outputs.zShininess = this.getInstancedUniform(scope, SHININESS_UNIFORM);
      }
    }
    fragmentShader(scope: PBFunctionScope) {
      super.fragmentShader(scope);
      const pb = scope.$builder;
      if (this.needFragmentColor() && !(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING)) {
        scope.zShininess = pb.float().uniform(2);
        if (this.featureUsed(FEATURE_WRAP_LIGHTING)) {
          scope.zScatterWrap = pb.float().uniform(2);
          scope.zScatterWidth = pb.float().uniform(2);
          scope.zScatterColor = pb.vec4().uniform(2);
        }
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (this.needFragmentColor(ctx) && !(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)) {
        bindGroup.setValue('zShininess', this._shininess);
        if (this.featureUsed(FEATURE_WRAP_LIGHTING)) {
          bindGroup.setValue('zScatterWrap', this._wrap);
          bindGroup.setValue('zScatterWidth', this._scatterWidth);
          bindGroup.setValue('zScatterColor', this._scatterColor);
        }
      }
    }
    blinnPhongLight(
      scope: PBInsideFunctionScope,
      worldPos: PBShaderExp,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      albedo: PBShaderExp,
      outRoughness?: PBShaderExp
    ) {
      const pb = scope.$builder;
      const funcName = 'Z_blinnPhongLight';
      const that = this;
      pb.func(
        funcName,
        [
          pb.vec3('worldPos'),
          pb.vec3('normal'),
          pb.vec3('viewVec'),
          pb.vec4('albedo'),
          ...(outRoughness ? [pb.vec4('outRoughness').out()] : [])
        ],
        function () {
          if (!that.needFragmentColor()) {
            this.$return(this.albedo.rgb);
          } else {
            const shininess =
              that.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING
                ? this.$inputs.zShininess
                : this.zShininess;
            if (that.needCalculateEnvLight() && !outRoughness) {
              this.$l.diffuseColor = that.getEnvLightIrradiance(this, this.normal);
            } else {
              this.$l.diffuseColor = pb.vec3(0);
            }
            this.$l.specularColor = pb.vec3(0);
            that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, extra, shadow) {
              this.$l.diffuseScale = pb.float(1);
              this.$l.specularScale = pb.float(1);
              this.$l.sourceRadiusFactor = pb.float(0);
              this.$if(pb.equal(type, LIGHT_TYPE_POINT), function () {
                this.diffuseScale = extra.x;
                this.specularScale = extra.y;
                this.sourceRadiusFactor = pb.div(
                  extra.z,
                  pb.max(pb.distance(posRange.xyz, this.worldPos), 0.0001)
                );
              });
              this.$l.lightAtten = that.calculateLightAttenuation(
                this,
                type,
                this.worldPos,
                posRange,
                dirCutoff
              );
              this.$l.lightDir = that.calculateLightDirection(this, type, this.worldPos, posRange, dirCutoff);
              this.$l.NoL = pb.dot(this.normal, this.lightDir);
              this.$l.halfVec = pb.normalize(pb.add(this.viewVec, this.lightDir));
              this.$l.NoH = pb.clamp(pb.dot(this.normal, this.halfVec), 0, 1);
              this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
              this.$l.pointShininess = pb.div(shininess, pb.add(1, pb.mul(this.sourceRadiusFactor, 32)));
              this.$l.pointShininess = pb.max(this.pointShininess, 1);
              if (that.featureUsed(FEATURE_WRAP_LIGHTING)) {
                this.$l.NoLwrap = pb.div(pb.add(this.NoL, this.zScatterWrap), pb.add(1, this.zScatterWrap));
                this.$l.diff = pb.max(this.NoLwrap, 0);
                this.$l.scatter = pb.mul(
                  pb.smoothStep(0, this.zScatterWidth, this.NoLwrap),
                  pb.smoothStep(pb.mul(this.zScatterWidth, 2), this.zScatterWidth, this.NoLwrap)
                );
                this.$l.spec = this.$choice(
                  pb.lessThanEqual(this.NoLwrap, 0),
                  pb.float(0),
                  pb.pow(this.NoH, this.pointShininess)
                );
                this.$l.diffuse = pb.mul(
                  this.lightColor,
                  1 / Math.PI,
                  pb.add(pb.vec3(this.diff), pb.mul(this.zScatterColor.rgb, this.scatter), this.diffuseScale)
                );
                this.$l.specular = pb.mul(this.lightColor, this.spec, this.specularScale);
              } else {
                this.NoL = pb.clamp(this.NoL, 0, 1);
                this.$l.diffuse = pb.mul(this.lightColor, 1 / Math.PI, this.NoL, this.diffuseScale);
                this.$l.specular = pb.mul(
                  this.lightColor,
                  pb.pow(this.NoH, this.pointShininess),
                  this.specularScale
                );
              }
              if (shadow) {
                this.$if(pb.greaterThan(this.NoL, 0), function () {
                  this.$l.shadow = pb.vec3(that.calculateShadow(this, this.worldPos, this.NoL));
                  this.diffuse = pb.mul(this.diffuse, this.shadow);
                  this.specular = pb.mul(this.specular, this.shadow);
                });
              }
              this.diffuseColor = pb.add(this.diffuseColor, this.diffuse);
              this.specularColor = pb.add(this.specularColor, this.specular);
            });
            this.$l.litColor = pb.add(pb.mul(this.albedo.rgb, this.diffuseColor), this.specularColor);
            if (outRoughness) {
              this.$l.roughness = pb.sqrt(pb.div(2, pb.add(shininess, 2)));
              this.outRoughness = pb.vec4(
                pb.mul(this.albedo.rgb, pb.sub(1, this.roughness)),
                pb.mul(this.roughness, ShaderHelper.getCameraRoughnessFactor(this))
              );
            }
            this.$return(this.litColor);
          }
        }
      );
      return (
        outRoughness
          ? pb.getGlobalScope()[funcName](worldPos, normal, viewVec, albedo, outRoughness)
          : pb.getGlobalScope()[funcName](worldPos, normal, viewVec, albedo)
      ) as PBShaderExp;
    }
  } as unknown as T & { new (...args: any[]): IMixinBlinnPhong };
  FEATURE_WRAP_LIGHTING = cls.defineFeature();
  return cls;
}
