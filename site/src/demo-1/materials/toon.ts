import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import { DrawContext, MeshMaterial, applyMaterialMixins, mixinAlbedoColor, mixinLambert } from '@zephyr3d/scene';

export class ToonMaterial extends applyMaterialMixins(MeshMaterial, mixinAlbedoColor, mixinLambert) {
  static FEATURE_PARALLAX_MODE = this.defineFeature();
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
      this.optionChanged(false);
    }
  }
  get edgeThickness(): number {
    return this._edgeThickness;
  }
  set edgeThickness(val: number) {
    if (val !== this._edgeThickness) {
      this._edgeThickness = val;
      this.optionChanged(false);
    }
  }
  beginDraw(pass: number, ctx: DrawContext): boolean {
    if (pass === 0) {
      this.stateSet.useRasterizerState().setCullMode('front');
    } else {
      this.stateSet.defaultRasterizerState();
    }
    return super.beginDraw(pass, ctx);
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      if (pass > 0) {
        bindGroup.setValue('bands', this._bands);
      } else {
        bindGroup.setValue('edge', this._edgeThickness);
      }
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.pos = pb.vec3().attrib('position');
    scope.$inputs.normal = pb.vec3().attrib('normal');
    if (this.pass === 0) {
      scope.edge = pb.float().uniform(2);
      const vertexPos = pb.add(scope.$inputs.pos, pb.mul(scope.$inputs.normal, scope.edge));
      this.helper.processPositionAndNormal(scope, vertexPos);
    } else {
      this.helper.processPositionAndNormal(scope);
    }
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const that = this;
    const pb = scope.$builder;
    if (this.needFragmentColor()){
      scope.$l.albedo = that.calculateAlbedoColor(scope, scope.texCoords);
      if (this.pass === 0) {
        this.outputFragmentColor(scope, pb.vec4(0, 0, 0, scope.albedo.a));
      } else {
        scope.bands = pb.float().uniform(2);
        scope.$l.normal = this.calculateNormal(scope);
        scope.$l.litColor = this.lambertLight(scope, scope.normal, scope.albedo);
        scope.$l.litIntensity = pb.add(scope.litColor.r, scope.litColor.g, scope.litColor.b, 0.00001);
        scope.$l.albedoIntensity = pb.add(scope.albedo.r, scope.albedo.g, scope.albedo.g, 0.00001);
        scope.$l.intensity = pb.clamp(pb.div(scope.litIntensity, scope.albedoIntensity), 0, 1);
        scope.intensity = pb.div(pb.ceil(pb.mul(scope.intensity, scope.bands)), scope.bands);
        scope.litColor = pb.mul(pb.vec3(scope.intensity), scope.albedo.rgb);
        this.outputFragmentColor(scope, pb.vec4(scope.litColor, scope.albedo.a));
      }
    } else {
      this.outputFragmentColor(scope, null);
    }
  }
}
