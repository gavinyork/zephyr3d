import { Vector2 } from "@zephyr3d/base";
import { BindGroup, PBFunctionScope } from "@zephyr3d/device";
import { DrawContext, MeshMaterial, RENDER_PASS_TYPE_LIGHT, ShaderHelper, applyMaterialMixins, mixinFoliage, mixinPBRMetallicRoughness, mixinPBRSpecularGlossness } from "@zephyr3d/scene";

export type ITreeMaterial = {
  textureWidth: number;
  textureHeight: number;
}

export class TreeMaterialMetallicRoughness extends applyMaterialMixins(MeshMaterial, mixinPBRMetallicRoughness, mixinFoliage) {
  private _textureSize: Vector2;
  constructor() {
    super();
    this._textureSize = Vector2.zero();
  }
  get textureWidth(): number {
    return this._textureSize.x;
  }
  set textureWidth(val: number) {
    if (val !== this._textureSize.x) {
      this._textureSize.x = val;
      this.uniformChanged();
    }
  }
  get textureHeight(): number {
    return this._textureSize.y;
  }
  set textureHeight(val: number) {
    if (val !== this._textureSize.y) {
      this._textureSize.y = val;
      this.uniformChanged();
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('albedoTextureSize', this._textureSize);
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
    scope.$l.oNorm = pb.normalize(pb.mul(scope.oPos, pb.vec3(1, 0.5, 1)));
    //scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    scope.$outputs.wNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor()) {
      scope.albedoTextureSize = pb.vec2().uniform(2);
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      scope.albedo = that.calculateFoliageAlbedo(scope, scope.albedo, pb.mul(that.getAlbedoTexCoord(scope), scope.albedoTextureSize))
      scope.$l.litColor = pb.vec3(0);
      if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        scope.$l.normalInfo = this.calculateNormalAndTBN(scope, scope.$inputs.worldPos, scope.$inputs.worldNorm);
        scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
        scope.$l.litColor = this.PBRLight(
          scope,
          scope.$inputs.worldPos,
          scope.normalInfo.normal,
          scope.viewVec,
          scope.albedo,
          scope.normalInfo.TBN
        );
      }
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}

export class TreeMaterialSpecularGlossiness extends applyMaterialMixins(MeshMaterial, mixinPBRSpecularGlossness, mixinFoliage) {
  private _textureSize: Vector2;
  constructor() {
    super();
    this._textureSize = Vector2.zero();
  }
  get textureWidth(): number {
    return this._textureSize.x;
  }
  set textureWidth(val: number) {
    if (val !== this._textureSize.x) {
      this._textureSize.x = val;
      this.uniformChanged();
    }
  }
  get textureHeight(): number {
    return this._textureSize.y;
  }
  set textureHeight(val: number) {
    if (val !== this._textureSize.y) {
      this._textureSize.y = val;
      this.uniformChanged();
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('albedoTextureSize', this._textureSize);
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
    scope.$l.oNorm = pb.normalize(pb.mul(scope.oPos, pb.vec3(1, 0.5, 1)));
    //scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    scope.$outputs.wNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor()) {
      scope.albedoTextureSize = pb.vec2().uniform(2);
      scope.$l.albedo = that.calculateAlbedoColor(scope);
      scope.albedo = that.calculateFoliageAlbedo(scope, scope.albedo, pb.mul(that.getAlbedoTexCoord(scope), scope.albedoTextureSize))
      scope.$l.litColor = pb.vec3(0);
      if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        scope.$l.normalInfo = this.calculateNormalAndTBN(scope, scope.$inputs.worldPos, scope.$inputs.worldNorm);
        scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
        scope.$l.litColor = this.PBRLight(
          scope,
          scope.$inputs.worldPos,
          scope.normalInfo.normal,
          scope.viewVec,
          scope.albedo,
          scope.normalInfo.TBN
        );
      }
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}
