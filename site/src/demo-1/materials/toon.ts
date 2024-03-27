import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import { DrawContext, MeshMaterial, ShaderHelper, applyMaterialMixins, mixinAlbedoColor, mixinLambert } from '@zephyr3d/scene';

export class ToonMaterial extends applyMaterialMixins(MeshMaterial, mixinAlbedoColor, mixinLambert) {
  private _bands: number;
  private _edgeThickness: number;
  constructor() {
    super();
    this._bands = 4;
    this._edgeThickness = 0.5;
    this.numPasses = 2;
  }
  get bands(): number {
    return this._bands;
  }
  set bands(val: number) {
    if (val !== this._bands) {
      this._bands = val;
      this.uniformChanged();
    }
  }
  get edgeThickness(): number {
    return this._edgeThickness;
  }
  set edgeThickness(val: number) {
    if (val !== this._edgeThickness) {
      this._edgeThickness = val;
      this.uniformChanged();
    }
  }
  protected updateRenderStates(pass: number, ctx: DrawContext): void {
    super.updateRenderStates(pass, ctx);
    this.getRenderStateSet(pass).useRasterizerState().cullMode = pass === 0 ? 'front' : 'back';
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (pass > 0) {
      if (this.needFragmentColor(ctx)) {
        bindGroup.setValue('bands', this._bands);
      }
    } else {
      bindGroup.setValue('edge', this._edgeThickness);
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    if (this.pass === 0) {
      scope.edge = pb.float().uniform(2);
      scope.oPos = pb.add(scope.oPos, pb.mul(scope.oNorm, scope.edge));
    }
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
    scope.$outputs.wNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const that = this;
    const pb = scope.$builder;
    scope.$l.albedo = that.calculateAlbedoColor(scope, scope.texCoords);
    if (this.needFragmentColor()){
      if (this.pass === 0) {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(0, 0, 0, scope.albedo.a));
      } else {
        scope.bands = pb.float().uniform(2);
        scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.wNorm);
        scope.$l.litColor = this.lambertLight(scope, scope.$inputs.worldPos, scope.normal, scope.albedo);
        scope.$l.litIntensity = pb.add(scope.litColor.r, scope.litColor.g, scope.litColor.b, 0.00001);
        scope.$l.albedoIntensity = pb.add(scope.albedo.r, scope.albedo.g, scope.albedo.g, 0.00001);
        scope.$l.intensity = pb.clamp(pb.div(scope.litIntensity, scope.albedoIntensity), 0, 1);
        scope.intensity = pb.div(pb.ceil(pb.mul(scope.intensity, scope.bands)), scope.bands);
        scope.litColor = pb.mul(pb.vec3(scope.intensity), scope.albedo.rgb);
        this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}
