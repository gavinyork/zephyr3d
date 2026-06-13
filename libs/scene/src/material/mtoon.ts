import type { Immutable } from '@zephyr3d/base';
import { Vector2, Vector3 } from '@zephyr3d/base';
import type {
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet
} from '@zephyr3d/device';
import type { DrawContext, Primitive } from '../render';
import { applyMaterialMixins, MeshMaterial } from './meshmaterial';
import { mixinAlbedoColor } from './mixins/albedocolor';
import { mixinLambert } from './mixins/lightmodel/lambert';
import { mixinTextureProps } from './mixins/texture';
import { QUEUE_OPAQUE, QUEUE_TRANSPARENT, RENDER_PASS_TYPE_LIGHT } from '../values';
import { ShaderHelper } from './shader/helper';

/**
 * MToonMaterial outline width mode.
 *
 * @public
 */
export type MToonOutlineWidthMode = 'none' | 'worldCoordinates' | 'screenCoordinates';

type RuntimeMaterialPassMethods = {
  bind(device: DrawContext['device'], pass: number): boolean;
  draw(primitive: Primitive, ctx: DrawContext, numInstances?: number): void;
};

const ToonMaterialBase = applyMaterialMixins(
  MeshMaterial,
  mixinAlbedoColor,
  mixinLambert,
  mixinTextureProps('shadeMultiply'),
  mixinTextureProps('shadingShift'),
  mixinTextureProps('matcap'),
  mixinTextureProps('rimMultiply'),
  mixinTextureProps('outlineWidthMultiply'),
  mixinTextureProps('uvAnimationMask'),
  mixinTextureProps('emissive')
);

/**
 * MToonMaterial is a material that implements the MToon shader, which is a stylized shader commonly used for rendering anime-style characters. It supports features such as rim lighting, matcap, and outline rendering.
 *
 * @public
 */
export class MToonMaterial extends ToonMaterialBase {
  private static readonly FEATURE_OUTLINE_WIDTH_MODE = this.defineFeature();
  private static readonly FEATURE_OUTLINE_TANGENT_NORMALS = this.defineFeature();
  private readonly _shadeColorFactor: Vector3;
  private readonly _matcapFactor: Vector3;
  private readonly _parametricRimColorFactor: Vector3;
  private readonly _outlineColorFactor: Vector3;
  private readonly _uvAnimationScroll: Vector2;
  private readonly _emissiveColor: Vector3;
  private _shadingShiftFactor: number;
  private _shadingShiftTextureScale: number;
  private _shadingToonyFactor: number;
  private _giEqualizationFactor: number;
  private _parametricRimFresnelPowerFactor: number;
  private _parametricRimLiftFactor: number;
  private _rimLightingMixFactor: number;
  private _outlineWidthFactor: number;
  private _outlineLightingMixFactor: number;
  private _uvAnimationRotationSpeedFactor: number;
  private _emissiveStrength: number;
  private _transparentWithZWrite: boolean;
  private _renderQueueOffsetNumber: number;
  constructor() {
    super();
    this._shadeColorFactor = new Vector3(0, 0, 0);
    this._matcapFactor = new Vector3(1, 1, 1);
    this._parametricRimColorFactor = new Vector3(0, 0, 0);
    this._outlineColorFactor = new Vector3(0, 0, 0);
    this._uvAnimationScroll = new Vector2(0, 0);
    this._emissiveColor = new Vector3(0, 0, 0);
    this._shadingShiftFactor = 0;
    this._shadingShiftTextureScale = 1;
    this._shadingToonyFactor = 0.9;
    this._giEqualizationFactor = 0.9;
    this._parametricRimFresnelPowerFactor = 5;
    this._parametricRimLiftFactor = 0;
    this._rimLightingMixFactor = 1;
    this._outlineWidthFactor = 0;
    this._outlineLightingMixFactor = 1;
    this._uvAnimationRotationSpeedFactor = 0;
    this._emissiveStrength = 1;
    this._transparentWithZWrite = false;
    this._renderQueueOffsetNumber = 0;
    this.outlineWidthMode = 'none';
    this.outlineUsesTangentNormals = false;
  }
  get shadeColorFactor(): Immutable<Vector3> {
    return this._shadeColorFactor;
  }
  set shadeColorFactor(val: Immutable<Vector3>) {
    this._shadeColorFactor.set(val);
    this.uniformChanged();
  }
  get shadingShiftFactor(): number {
    return this._shadingShiftFactor;
  }
  set shadingShiftFactor(val: number) {
    if (val !== this._shadingShiftFactor) {
      this._shadingShiftFactor = val;
      this.uniformChanged();
    }
  }
  get shadingShiftTextureScale(): number {
    return this._shadingShiftTextureScale;
  }
  set shadingShiftTextureScale(val: number) {
    if (val !== this._shadingShiftTextureScale) {
      this._shadingShiftTextureScale = val;
      this.uniformChanged();
    }
  }
  get shadingToonyFactor(): number {
    return this._shadingToonyFactor;
  }
  set shadingToonyFactor(val: number) {
    const toony = Math.min(Math.max(val, 0), 0.99);
    if (toony !== this._shadingToonyFactor) {
      this._shadingToonyFactor = toony;
      this.uniformChanged();
    }
  }
  get giEqualizationFactor(): number {
    return this._giEqualizationFactor;
  }
  set giEqualizationFactor(val: number) {
    const factor = Math.min(Math.max(val, 0), 1);
    if (factor !== this._giEqualizationFactor) {
      this._giEqualizationFactor = factor;
      this.uniformChanged();
    }
  }
  get matcapFactor(): Immutable<Vector3> {
    return this._matcapFactor;
  }
  set matcapFactor(val: Immutable<Vector3>) {
    this._matcapFactor.set(val);
    this.uniformChanged();
  }
  get parametricRimColorFactor(): Immutable<Vector3> {
    return this._parametricRimColorFactor;
  }
  set parametricRimColorFactor(val: Immutable<Vector3>) {
    this._parametricRimColorFactor.set(val);
    this.uniformChanged();
  }
  get parametricRimFresnelPowerFactor(): number {
    return this._parametricRimFresnelPowerFactor;
  }
  set parametricRimFresnelPowerFactor(val: number) {
    if (val !== this._parametricRimFresnelPowerFactor) {
      this._parametricRimFresnelPowerFactor = val;
      this.uniformChanged();
    }
  }
  get parametricRimLiftFactor(): number {
    return this._parametricRimLiftFactor;
  }
  set parametricRimLiftFactor(val: number) {
    if (val !== this._parametricRimLiftFactor) {
      this._parametricRimLiftFactor = val;
      this.uniformChanged();
    }
  }
  get rimLightingMixFactor(): number {
    return this._rimLightingMixFactor;
  }
  set rimLightingMixFactor(val: number) {
    const factor = Math.min(Math.max(val, 0), 1);
    if (factor !== this._rimLightingMixFactor) {
      this._rimLightingMixFactor = factor;
      this.uniformChanged();
    }
  }
  get outlineWidthMode(): MToonOutlineWidthMode {
    return this.featureUsed<MToonOutlineWidthMode>(MToonMaterial.FEATURE_OUTLINE_WIDTH_MODE);
  }
  set outlineWidthMode(val: MToonOutlineWidthMode) {
    if (val !== 'none' && this.numPasses < 2) {
      this.numPasses = 2;
    }
    this.useFeature(MToonMaterial.FEATURE_OUTLINE_WIDTH_MODE, val);
    this.numPasses = val === 'none' ? 1 : 2;
  }
  get outlineWidthFactor(): number {
    return this._outlineWidthFactor;
  }
  set outlineWidthFactor(val: number) {
    if (val !== this._outlineWidthFactor) {
      this._outlineWidthFactor = val;
      this.uniformChanged();
    }
  }
  get outlineColorFactor(): Immutable<Vector3> {
    return this._outlineColorFactor;
  }
  set outlineColorFactor(val: Immutable<Vector3>) {
    this._outlineColorFactor.set(val);
    this.uniformChanged();
  }
  get outlineLightingMixFactor(): number {
    return this._outlineLightingMixFactor;
  }
  set outlineLightingMixFactor(val: number) {
    const factor = Math.min(Math.max(val, 0), 1);
    if (factor !== this._outlineLightingMixFactor) {
      this._outlineLightingMixFactor = factor;
      this.uniformChanged();
    }
  }
  get outlineUsesTangentNormals(): boolean {
    return !!this.featureUsed<boolean>(MToonMaterial.FEATURE_OUTLINE_TANGENT_NORMALS);
  }
  set outlineUsesTangentNormals(val: boolean) {
    this.useFeature(MToonMaterial.FEATURE_OUTLINE_TANGENT_NORMALS, !!val);
  }
  get transparentWithZWrite(): boolean {
    return this._transparentWithZWrite;
  }
  set transparentWithZWrite(val: boolean) {
    if (!!val !== this._transparentWithZWrite) {
      this._transparentWithZWrite = !!val;
      this.uniformChanged();
    }
  }
  get renderQueueOffsetNumber(): number {
    return this._renderQueueOffsetNumber;
  }
  set renderQueueOffsetNumber(val: number) {
    const offset = Math.trunc(val);
    if (offset !== this._renderQueueOffsetNumber) {
      this._renderQueueOffsetNumber = offset;
      this.uniformChanged();
    }
  }
  get uvAnimationScrollXSpeedFactor(): number {
    return this._uvAnimationScroll.x;
  }
  set uvAnimationScrollXSpeedFactor(val: number) {
    if (val !== this._uvAnimationScroll.x) {
      this._uvAnimationScroll.x = val;
      this.uniformChanged();
    }
  }
  get uvAnimationScrollYSpeedFactor(): number {
    return this._uvAnimationScroll.y;
  }
  set uvAnimationScrollYSpeedFactor(val: number) {
    if (val !== this._uvAnimationScroll.y) {
      this._uvAnimationScroll.y = val;
      this.uniformChanged();
    }
  }
  get uvAnimationRotationSpeedFactor(): number {
    return this._uvAnimationRotationSpeedFactor;
  }
  set uvAnimationRotationSpeedFactor(val: number) {
    if (val !== this._uvAnimationRotationSpeedFactor) {
      this._uvAnimationRotationSpeedFactor = val;
      this.uniformChanged();
    }
  }
  get emissiveColor(): Immutable<Vector3> {
    return this._emissiveColor;
  }
  set emissiveColor(val: Immutable<Vector3>) {
    this._emissiveColor.set(val);
    this.uniformChanged();
  }
  get emissiveStrength(): number {
    return this._emissiveStrength;
  }
  set emissiveStrength(val: number) {
    if (val !== this._emissiveStrength) {
      this._emissiveStrength = val;
      this.uniformChanged();
    }
  }
  clone(): MToonMaterial {
    const other = new MToonMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this) {
    super.copyFrom(other);
    this.shadeColorFactor = other.shadeColorFactor;
    this.shadingShiftFactor = other.shadingShiftFactor;
    this.shadingShiftTextureScale = other.shadingShiftTextureScale;
    this.shadingToonyFactor = other.shadingToonyFactor;
    this.giEqualizationFactor = other.giEqualizationFactor;
    this.matcapFactor = other.matcapFactor;
    this.parametricRimColorFactor = other.parametricRimColorFactor;
    this.parametricRimFresnelPowerFactor = other.parametricRimFresnelPowerFactor;
    this.parametricRimLiftFactor = other.parametricRimLiftFactor;
    this.rimLightingMixFactor = other.rimLightingMixFactor;
    this.outlineWidthMode = other.outlineWidthMode;
    this.outlineWidthFactor = other.outlineWidthFactor;
    this.outlineColorFactor = other.outlineColorFactor;
    this.outlineLightingMixFactor = other.outlineLightingMixFactor;
    this.outlineUsesTangentNormals = other.outlineUsesTangentNormals;
    this.transparentWithZWrite = other.transparentWithZWrite;
    this.renderQueueOffsetNumber = other.renderQueueOffsetNumber;
    this.uvAnimationScrollXSpeedFactor = other.uvAnimationScrollXSpeedFactor;
    this.uvAnimationScrollYSpeedFactor = other.uvAnimationScrollYSpeedFactor;
    this.uvAnimationRotationSpeedFactor = other.uvAnimationRotationSpeedFactor;
    this.emissiveColor = other.emissiveColor;
    this.emissiveStrength = other.emissiveStrength;
  }
  getQueueType() {
    return this.isTransparentPass(0) ? QUEUE_TRANSPARENT : QUEUE_OPAQUE;
  }
  passToHash(pass: number): string {
    return super.passToHash(pass > 0 ? 1 : 0);
  }
  isTransparentPass(pass: number, ctx?: DrawContext): boolean {
    return pass === 0 && super.isTransparentPass(pass, ctx);
  }
  protected updateRenderStates(pass: number, stateSet: RenderStateSet, ctx: DrawContext): void {
    super.updateRenderStates(pass, stateSet, ctx);
    if (pass > 0) {
      stateSet.useRasterizerState().cullMode = 'front';
      stateSet.defaultBlendingState();
      stateSet.useDepthState().enableTest(true).enableWrite(true).setCompareFunc('lt');
    } else if (this._transparentWithZWrite && this.isTransparentPass(pass, ctx)) {
      stateSet.useDepthState().enableTest(true).enableWrite(true);
    }
  }
  draw(primitive: Primitive, ctx: DrawContext, numInstances = 0): void {
    const material = this as unknown as RuntimeMaterialPassMethods;
    if (this.numPasses > 1 && ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT && !ctx.lightBlending) {
      // Draw the inflated hull first so the regular pass hides interior outline fragments.
      material.bind(ctx.device, 1);
      this.drawPrimitive(1, primitive, ctx, numInstances);
      material.bind(ctx.device, 0);
      this.drawPrimitive(0, primitive, ctx, numInstances);
    } else {
      (MeshMaterial.prototype as unknown as RuntimeMaterialPassMethods).draw.call(
        this,
        primitive,
        ctx,
        numInstances
      );
    }
  }
  drawPrimitive(pass: number, primitive: Primitive, ctx: DrawContext, numInstances: number): void {
    if (pass > 0 && (ctx.renderPass!.type !== RENDER_PASS_TYPE_LIGHT || ctx.lightBlending)) {
      return;
    }
    super.drawPrimitive(pass, primitive, ctx, numInstances);
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColorInput(ctx)) {
      bindGroup.setValue('shadeColorFactor', this._shadeColorFactor);
      bindGroup.setValue('shadingShiftFactor', this._shadingShiftFactor);
      bindGroup.setValue('shadingShiftTextureScale', this._shadingShiftTextureScale);
      bindGroup.setValue('shadingToonyFactor', this._shadingToonyFactor);
      bindGroup.setValue('giEqualizationFactor', this._giEqualizationFactor);
      bindGroup.setValue('matcapFactor', this._matcapFactor);
      bindGroup.setValue('parametricRimColorFactor', this._parametricRimColorFactor);
      bindGroup.setValue('parametricRimFresnelPowerFactor', this._parametricRimFresnelPowerFactor);
      bindGroup.setValue('parametricRimLiftFactor', this._parametricRimLiftFactor);
      bindGroup.setValue('rimLightingMixFactor', this._rimLightingMixFactor);
      bindGroup.setValue('uvAnimationScroll', this._uvAnimationScroll);
      bindGroup.setValue('uvAnimationRotationSpeedFactor', this._uvAnimationRotationSpeedFactor);
      bindGroup.setValue('emissiveColor', this._emissiveColor);
      bindGroup.setValue('emissiveStrength', this._emissiveStrength);
    } else if (pass > 0 && this.outlineWidthMultiplyTexture && this.usesAnimatedUV()) {
      bindGroup.setValue('uvAnimationScroll', this._uvAnimationScroll);
      bindGroup.setValue('uvAnimationRotationSpeedFactor', this._uvAnimationRotationSpeedFactor);
    }
    if (pass > 0) {
      bindGroup.setValue('outlineWidthFactor', this._outlineWidthFactor);
      if (this.outlineWidthMultiplyTexture) {
        bindGroup.setTexture(
          'outlineWidthTex',
          this.outlineWidthMultiplyTexture,
          this.outlineWidthMultiplyTextureSampler
        );
        if (this.uvAnimationMaskTexture && this.usesAnimatedUV()) {
          bindGroup.setTexture(
            'uvAnimationMaskTex',
            this.uvAnimationMaskTexture,
            this.uvAnimationMaskTextureSampler
          );
        }
        if (this.outlineWidthMultiplyTexCoordMatrix) {
          bindGroup.setValue('outlineWidthTextureMatrix', this.outlineWidthMultiplyTexCoordMatrix);
        }
      }
    }
    if (pass > 0 && ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
      bindGroup.setValue('outlineColorFactor', this._outlineColorFactor);
      bindGroup.setValue('outlineLightingMixFactor', this._outlineLightingMixFactor);
    }
  }
  private usesAnimatedUV(): boolean {
    return (
      this._uvAnimationScroll.x !== 0 ||
      this._uvAnimationScroll.y !== 0 ||
      this._uvAnimationRotationSpeedFactor !== 0
    );
  }
  private applyUVAnimation(scope: PBInsideFunctionScope, uv: PBShaderExp): PBShaderExp {
    if (!this.usesAnimatedUV()) {
      return uv;
    }
    const pb = scope.$builder;
    const funcName = 'Z_mtoonUVAnimation';
    const that = this;
    if (!scope.uvAnimationScroll) {
      scope.uvAnimationScroll = pb.vec2().uniform(2);
    }
    if (!scope.uvAnimationRotationSpeedFactor) {
      scope.uvAnimationRotationSpeedFactor = pb.float().uniform(2);
    }
    if (that.uvAnimationMaskTexture && pb.shaderKind !== 'fragment' && !scope.uvAnimationMaskTex) {
      scope.uvAnimationMaskTex = pb.tex2D().uniform(2);
    }
    pb.func(funcName, [pb.vec2('uv')], function () {
      this.$l.mask = that.uvAnimationMaskTexture
        ? pb.shaderKind === 'fragment'
          ? pb.textureSample(that.getUvAnimationMaskTextureUniform(this), this.uv).b
          : pb.textureSampleLevel(this.uvAnimationMaskTex, this.uv, 0).b
        : pb.float(1);
      this.$l.time = ShaderHelper.getElapsedTime(this);
      this.$l.rotation = pb.mul(this.time, this.uvAnimationRotationSpeedFactor, this.mask);
      this.$l.c = pb.cos(this.rotation);
      this.$l.s = pb.sin(this.rotation);
      this.$l.centeredUv = pb.sub(this.uv, pb.vec2(0.5));
      this.$l.rotatedUv = pb.add(
        pb.vec2(
          pb.add(pb.mul(this.c, this.centeredUv.x), pb.mul(this.s, this.centeredUv.y)),
          pb.add(pb.mul(pb.neg(this.s), this.centeredUv.x), pb.mul(this.c, this.centeredUv.y))
        ),
        pb.vec2(0.5)
      );
      this.$return(pb.add(this.rotatedUv, pb.mul(this.uvAnimationScroll, this.time, this.mask)));
    });
    return pb.getGlobalScope()[funcName](uv);
  }
  private getMToonBaseUV(scope: PBInsideFunctionScope): PBShaderExp {
    return this.albedoTexture
      ? this.applyUVAnimation(scope, this.getAlbedoTexCoord(scope))
      : scope.$builder.vec2(0);
  }
  private getMToonNormalUV(scope: PBInsideFunctionScope): PBShaderExp {
    return this.normalTexture
      ? this.applyUVAnimation(scope, this.getNormalTexCoord(scope))
      : scope.$builder.vec2(0);
  }
  private sampleAlbedo(scope: PBInsideFunctionScope, uv: PBShaderExp): PBShaderExp {
    return this.calculateAlbedoColor(scope, uv);
  }
  private sampleShadeColor(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return this.shadeMultiplyTexture
      ? pb.mul(
          scope.shadeColorFactor,
          this.sampleShadeMultiplyTexture(
            scope,
            this.applyUVAnimation(scope, this.getShadeMultiplyTexCoord(scope))
          ).rgb
        )
      : scope.shadeColorFactor;
  }
  private sampleNormal(scope: PBInsideFunctionScope, uv: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    if (!this.normalTexture) {
      return pb.normalize(scope.$inputs.wNorm);
    }
    scope.$l.TBN = this.calculateTBN(scope, scope.$inputs.worldPos, scope.$inputs.wNorm);
    scope.$l.normalTex = pb.sub(pb.mul(this.sampleNormalTexture(scope, uv).rgb, 2), pb.vec3(1));
    scope.normalTex = pb.mul(scope.normalTex, pb.vec3(pb.vec3(this.getUniformNormalScale(scope)).xx, 1));
    return pb.normalize(pb.mul(scope.TBN, scope.normalTex));
  }
  private calculateMToonDirectLighting(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    normal: PBShaderExp,
    baseColor: PBShaderExp,
    shadeColor: PBShaderExp,
    shadingShift: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'Z_mtoonDirectLighting';
    pb.func(
      funcName,
      [
        pb.vec3('worldPos'),
        pb.vec3('normal'),
        pb.vec3('baseColor'),
        pb.vec3('shadeColor'),
        pb.float('shadingShift')
      ],
      function () {
        this.$l.directColor = pb.vec3(0);
        that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, extra, shadow) {
          this.$l.lightAtten = that.calculateLightAttenuation(this, type, this.worldPos, posRange, dirCutoff);
          this.$l.lightDir = that.calculateLightDirection(this, type, this.worldPos, posRange, dirCutoff);
          this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
          this.$l.NoL = pb.dot(this.normal, this.lightDir);
          this.$l.shiftedShading = pb.add(this.NoL, this.shadingShift);
          this.$l.shading = pb.clamp(
            pb.div(
              pb.sub(this.shiftedShading, pb.add(-1, this.shadingToonyFactor)),
              pb.max(pb.sub(2, pb.mul(this.shadingToonyFactor, 2)), 0.00001)
            ),
            0,
            1
          );
          this.$l.lightDiffuse = pb.mix(this.shadeColor, this.baseColor, this.shading);
          if (shadow) {
            this.$l.shadowValue = that.calculateShadow(this, this.worldPos, pb.clamp(this.NoL, 0, 1));
            this.lightDiffuse = pb.mix(this.shadeColor, this.lightDiffuse, this.shadowValue);
          }
          this.directColor = pb.add(this.directColor, pb.mul(this.lightDiffuse, this.lightColor));
        });
        this.$return(this.directColor);
      }
    );
    return pb.getGlobalScope()[funcName](worldPos, normal, baseColor, shadeColor, shadingShift);
  }
  private calculateMToonGI(
    scope: PBInsideFunctionScope,
    normal: PBShaderExp,
    baseColor: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    if (!this.needCalculateEnvLight()) {
      return pb.vec3(0);
    }
    scope.$l.rawGi = this.getEnvLightIrradiance(scope, normal);
    scope.$l.uniformGi = pb.mul(
      pb.add(
        this.getEnvLightIrradiance(scope, pb.vec3(0, 1, 0)),
        this.getEnvLightIrradiance(scope, pb.vec3(0, -1, 0))
      ),
      0.5
    );
    scope.$l.gi = pb.mix(scope.rawGi, scope.uniformGi, scope.giEqualizationFactor);
    return pb.mul(scope.gi, baseColor);
  }
  private calculateMToonRim(
    scope: PBInsideFunctionScope,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    uv: PBShaderExp,
    lighting: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    scope.$l.rim = pb.vec3(0);
    if (this.matcapTexture) {
      scope.$l.worldViewX = pb.normalize(pb.vec3(viewVec.z, 0, pb.neg(viewVec.x)));
      scope.$l.worldViewY = pb.normalize(pb.cross(viewVec, scope.worldViewX));
      scope.$l.matcapUv = pb.add(
        pb.mul(pb.vec2(pb.dot(scope.worldViewX, normal), pb.dot(scope.worldViewY, normal)), 0.495),
        pb.vec2(0.5)
      );
      scope.rim = pb.add(
        scope.rim,
        pb.mul(scope.matcapFactor, this.sampleMatcapTexture(scope, scope.matcapUv).rgb)
      );
    }
    scope.$l.NoV = pb.clamp(pb.dot(normal, viewVec), 0, 1);
    scope.$l.parametricRim = pb.pow(
      pb.clamp(pb.add(pb.sub(1, scope.NoV), scope.parametricRimLiftFactor), 0, 1),
      pb.max(scope.parametricRimFresnelPowerFactor, 0.00001)
    );
    scope.rim = pb.add(scope.rim, pb.mul(scope.parametricRimColorFactor, scope.parametricRim));
    if (this.rimMultiplyTexture) {
      scope.rim = pb.mul(
        scope.rim,
        this.sampleRimMultiplyTexture(scope, this.applyUVAnimation(scope, this.getRimMultiplyTexCoord(scope)))
          .rgb
      );
    }
    return pb.mul(scope.rim, pb.mix(pb.vec3(1), lighting, scope.rimLightingMixFactor));
  }
  private calculateMToonEmission(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return this.emissiveTexture
      ? pb.mul(
          scope.emissiveColor,
          scope.emissiveStrength,
          this.sampleEmissiveTexture(scope, this.applyUVAnimation(scope, this.getEmissiveTexCoord(scope))).rgb
        )
      : pb.mul(scope.emissiveColor, scope.emissiveStrength);
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    if (this.pass > 0 && this.outlineUsesTangentNormals) {
      scope.$l.oOutlineNorm = ShaderHelper.resolveVertexTangent(scope).xyz;
    }
    scope.$l.worldNormal = pb.normalize(
      pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz
    );
    scope.$l.worldOutlineNormal =
      this.pass > 0 && this.outlineUsesTangentNormals
        ? pb.normalize(pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oOutlineNorm, 0)).xyz)
        : scope.worldNormal;
    scope.$l.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    if (this.pass > 0) {
      scope.outlineWidthFactor = pb.float().uniform(2);
      scope.$l.width = scope.outlineWidthFactor;
      if (this.outlineWidthMultiplyTexture) {
        scope.outlineWidthTex = pb.tex2D().uniform(2);
        const uvIndex = this.outlineWidthMultiplyTexCoordIndex;
        const semantic = `texCoord${uvIndex}` as any;
        if (!scope.$getVertexAttrib(semantic)) {
          scope.$inputs[semantic] = pb.vec2().attrib(semantic);
        }
        if (this.outlineWidthMultiplyTexCoordMatrix) {
          scope.outlineWidthTextureMatrix = pb.mat4().uniform(2);
          scope.$l.outlineUv = pb.mul(
            scope.outlineWidthTextureMatrix,
            pb.vec4(this.applyUVAnimation(scope, scope.$inputs[semantic]), 0, 1)
          ).xy;
        } else {
          scope.$l.outlineUv = this.applyUVAnimation(scope, scope.$inputs[semantic]);
        }
        scope.width = pb.mul(scope.width, pb.textureSampleLevel(scope.outlineWidthTex, scope.outlineUv, 0).g);
      }
      if (this.outlineWidthMode === 'worldCoordinates') {
        scope.worldPos = pb.add(scope.worldPos, pb.mul(scope.worldOutlineNormal, scope.width));
      } else if (this.outlineWidthMode === 'screenCoordinates') {
        scope.$l.clipNormalPos = pb.mul(
          ShaderHelper.getViewProjectionMatrix(scope),
          pb.vec4(pb.add(scope.worldPos, scope.worldOutlineNormal), 1)
        );
        scope.$l.clipPos = pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.worldPos, 1));
        scope.$l.screenNormal = pb.sub(
          pb.div(scope.clipNormalPos.xy, pb.max(scope.clipNormalPos.w, 0.00001)),
          pb.div(scope.clipPos.xy, pb.max(scope.clipPos.w, 0.00001))
        );
        scope.screenNormal = pb.normalize(
          pb.mul(
            scope.screenNormal,
            pb.vec2(1, pb.div(ShaderHelper.getRenderSize(scope).x, ShaderHelper.getRenderSize(scope).y))
          )
        );

        //scope.clipPos.xy = pb.add(scope.clipPos.xy, pb.mul(scope.screenNormal, scope.width, scope.clipPos.w));
        scope.clipPos = pb.vec4(
          pb.add(scope.clipPos.xy, pb.mul(scope.screenNormal, scope.width, scope.clipPos.w)),
          scope.clipPos.zw
        );
        scope.$outputs.worldPos = scope.worldPos;
        scope.$outputs.wNorm = scope.worldOutlineNormal;
        ShaderHelper.setClipSpacePosition(scope, scope.clipPos);
        return;
      }
    }
    scope.$outputs.worldPos = scope.worldPos;
    scope.$outputs.wNorm = this.pass > 0 ? scope.worldOutlineNormal : scope.worldNormal;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColorInput()) {
      scope.shadeColorFactor = pb.vec3().uniform(2);
      scope.shadingShiftFactor = pb.float().uniform(2);
      scope.shadingShiftTextureScale = pb.float().uniform(2);
      scope.shadingToonyFactor = pb.float().uniform(2);
      scope.giEqualizationFactor = pb.float().uniform(2);
      scope.matcapFactor = pb.vec3().uniform(2);
      scope.parametricRimColorFactor = pb.vec3().uniform(2);
      scope.parametricRimFresnelPowerFactor = pb.float().uniform(2);
      scope.parametricRimLiftFactor = pb.float().uniform(2);
      scope.rimLightingMixFactor = pb.float().uniform(2);
      scope.uvAnimationScroll = pb.vec2().uniform(2);
      scope.uvAnimationRotationSpeedFactor = pb.float().uniform(2);
      scope.emissiveColor = pb.vec3().uniform(2);
      scope.emissiveStrength = pb.float().uniform(2);
      if (this.pass > 0) {
        scope.outlineColorFactor = pb.vec3().uniform(2);
        scope.outlineLightingMixFactor = pb.float().uniform(2);
        scope.$l.albedo = this.sampleAlbedo(scope, this.getMToonBaseUV(scope));
        scope.$l.outlineLighting = pb.mix(pb.vec3(1), scope.albedo.rgb, scope.outlineLightingMixFactor);
        this.outputFragmentColor(
          scope,
          scope.$inputs.worldPos,
          pb.vec4(pb.mul(scope.outlineColorFactor, scope.outlineLighting), scope.albedo.a)
        );
      } else {
        scope.$l.uv = this.getMToonBaseUV(scope);
        scope.$l.albedo = this.sampleAlbedo(scope, scope.uv);
        if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
          scope.$l.normal = this.sampleNormal(scope, this.getMToonNormalUV(scope));
          scope.$l.shadingShift = scope.shadingShiftFactor;
          if (this.shadingShiftTexture) {
            scope.shadingShift = pb.add(
              scope.shadingShift,
              pb.mul(
                this.sampleShadingShiftTexture(
                  scope,
                  this.applyUVAnimation(scope, this.getShadingShiftTexCoord(scope))
                ).r,
                scope.shadingShiftTextureScale
              )
            );
          }
          scope.$l.shadeColor = this.sampleShadeColor(scope);
          scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
          scope.$l.directLighting = this.calculateMToonDirectLighting(
            scope,
            scope.$inputs.worldPos,
            scope.normal,
            scope.albedo.rgb,
            scope.shadeColor,
            scope.shadingShift
          );
          scope.$l.giLighting = this.calculateMToonGI(scope, scope.normal, scope.albedo.rgb);
          scope.$l.lighting = pb.max(scope.directLighting, scope.giLighting);
          scope.$l.rim = this.calculateMToonRim(scope, scope.normal, scope.viewVec, scope.uv, scope.lighting);
          scope.$l.emission = this.calculateMToonEmission(scope);
          scope.$l.outColor = pb.vec4(
            pb.add(scope.directLighting, scope.giLighting, scope.rim, scope.emission),
            scope.albedo.a
          );
          this.outputFragmentColor(
            scope,
            scope.$inputs.worldPos,
            scope.outColor,
            pb.vec4(1, 1, 0, 1),
            pb.vec4(pb.add(pb.mul(scope.normal, 0.5), pb.vec3(0.5)), 1)
          );
        } else {
          this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.albedo);
        }
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}
