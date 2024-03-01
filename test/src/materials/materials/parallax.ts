import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { DrawContext, MeshMaterial, applyMaterialMixins, mixinAlbedoColor, mixinBlinnPhong, mixinLambert } from '@zephyr3d/scene';

export type ParallaxMappingMode = 'basic'|'steep'|'relief'|'occlusion';
//const ITERATIONS = 32;
export class ParallaxMapMaterial extends applyMaterialMixins(MeshMaterial, mixinAlbedoColor, mixinBlinnPhong) {
  static FEATURE_PARALLAX_MODE = this.defineFeature();
  private _parallaxScale: number;
  private _minLayers: number;
  private _maxLayers: number;
  constructor() {
    super();
    this._parallaxScale = 0.1;
    this._minLayers = 10;
    this._maxLayers = 30;
    this.useFeature(ParallaxMapMaterial.FEATURE_PARALLAX_MODE, 'occlusion');
  }
  get mode(): ParallaxMappingMode {
    return this.featureUsed<ParallaxMappingMode>(ParallaxMapMaterial.FEATURE_PARALLAX_MODE);
  }
  set mode(val: ParallaxMappingMode) {
    this.useFeature(ParallaxMapMaterial.FEATURE_PARALLAX_MODE, val);
  }
  get parallaxScale(): number {
    return this._parallaxScale;
  }
  set parallaxScale(val: number) {
    if (val !== this._parallaxScale){
      this._parallaxScale = val;
      this.optionChanged(false);
    }
  }
  get minParallaxLayers(): number {
    return this._minLayers;
  }
  set minParallaxLayers(val: number) {
    if (val !== this._minLayers){
      this._minLayers = val;
      this.optionChanged(false);
    }
  }
  get maxParallaxLayers(): number {
    return this._maxLayers;
  }
  set maxParallaxLayers(val: number) {
    if (val !== this._maxLayers){
      this._maxLayers = val;
      this.optionChanged(false);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      bindGroup.setValue('parallaxScale', -this._parallaxScale);
      bindGroup.setValue('parallaxMinLayers', this._minLayers);
      bindGroup.setValue('parallaxMaxLayers', this._maxLayers);
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    scope.$inputs.pos = scope.$builder.vec3().attrib('position');
    this.helper.transformVertexAndNormal(scope);
  }
  sampleNormalMap(scope: PBInsideFunctionScope, texCoords: PBShaderExp) {
    const pb = scope.$builder;
    if (pb.getDevice().type === 'webgpu'){
      return pb.textureSampleGrad(this.getNormalTextureUniform(scope), texCoords, scope.dx, scope.dy);
    } else {
      return this.sampleNormalTexture(scope, texCoords);
    }
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const that = this;
    const pb = scope.$builder;
    if (this.needFragmentColor()){
      scope.parallaxScale = pb.float().uniform(2);
      scope.parallaxMinLayers = pb.float().uniform(2);
      scope.parallaxMaxLayers = pb.float().uniform(2);
      pb.func('parallaxMapping', [pb.vec3('V'), pb.vec2('uv')], function(){
        if (pb.getDevice().type === 'webgpu'){
          this.$l.dx = pb.dpdx(this.uv);
          this.$l.dy = pb.dpdy(this.uv);
        }
        if (that.mode === 'basic'){
          this.$l.initialHeight = that.sampleNormalMap(this, this.uv).a;
          this.$l.offset = pb.mul(this.V.xy, this.parallaxScale, this.initialHeight);
          this.$return(pb.sub(this.uv, this.offset));
        } else {
          this.$l.numLayers = pb.mix(this.parallaxMaxLayers, this.parallaxMinLayers, pb.abs(this.V.z));
          this.$l.layerHeight = pb.div(1, this.numLayers);
          this.$l.currentLayerHeight = pb.float(0);
          this.$l.dtex = pb.div(pb.mul(this.V.xy, this.parallaxScale), pb.mul(this.V.z, this.numLayers));
          this.$l.currentTextureCoords = this.uv;
          this.$l.heightFromTexture = that.sampleNormalMap(this, this.currentTextureCoords).a;
          this.$while(pb.greaterThan(this.heightFromTexture, this.currentLayerHeight), function(){
            this.currentLayerHeight = pb.add(this.currentLayerHeight, this.layerHeight);
            this.currentTextureCoords = pb.sub(this.currentTextureCoords, this.dtex);
            this.heightFromTexture = that.sampleNormalMap(this, this.currentTextureCoords).a;
          });
          if (that.mode === 'steep'){
            this.$return(this.currentTextureCoords);
          } else if (that.mode === 'relief'){
            this.$l.deltaTexCoord = pb.div(this.dtex, 2);
            this.$l.deltaHeight = pb.div(this.layerHeight, 2);
            this.currentTextureCoords = pb.add(this.currentTextureCoords, this.deltaTexCoord);
            this.currentLayerHeight = pb.sub(this.currentLayerHeight, this.deltaHeight);
            const SEARCH_STEPS = 5;
            this.$for(pb.int('i'), 0, SEARCH_STEPS, function(){
              this.deltaTexCoord = pb.div(this.deltaTexCoord, 2);
              this.deltaHeight = pb.div(this.deltaHeight, 2);
              this.heightFromTexture = that.sampleNormalMap(this, this.currentTextureCoords).a;
              this.$if(pb.greaterThan(this.heightFromTexture, this.currentLayerHeight), function(){
                this.currentTextureCoords = pb.sub(this.currentTextureCoords, this.deltaTexCoord);
                this.currentLayerHeight = pb.add(this.currentLayerHeight, this.deltaHeight);
              }).$else(function(){
                this.currentTextureCoords = pb.add(this.currentTextureCoords, this.deltaTexCoord);
                this.currentLayerHeight =pb.sub(this.currentLayerHeight, this.deltaHeight);
              });
            });
            this.$return(this.currentTextureCoords);
          } else if (that.mode === 'occlusion'){
            this.$l.prevTCoords = pb.add(this.currentTextureCoords, this.dtex);
            this.$l.nextH = pb.sub(this.heightFromTexture, this.currentLayerHeight);
            this.$l.prevH = pb.add(pb.sub(that.sampleNormalMap(this, this.prevTCoords).a, this.currentLayerHeight), this.layerHeight);
            this.$l.weight = pb.div(this.nextH, pb.sub(this.nextH, this.prevH));
            this.currentTextureCoords = pb.add(pb.mul(this.prevTCoords, this.weight), pb.mul(this.currentTextureCoords, pb.sub(1, this.weight)));
            this.$return(this.currentTextureCoords);
          } else {
            this.$return(this.uv);
          }
        }
      });
      pb.func('calcUV', [pb.vec3('worldPos'), pb.vec3('worldNormal'), pb.vec3('viewPos'), pb.vec2('uv')], function(){
        this.$l.texDx = pb.dpdx(this.uv);
        this.$l.texDy = pb.dpdy(this.uv);
        this.$l.sigmaX = pb.dpdx(this.worldPos);
        this.$l.sigmaY = pb.dpdy(this.worldPos);
        this.$l.vR1 = pb.cross(this.sigmaY, this.worldNormal);
        this.$l.vR2 = pb.cross(this.worldNormal, this.sigmaX);
        this.$l.fDet = pb.dot(this.sigmaX, this.vR1);
        this.$l.projVscr = pb.div(pb.vec2(pb.dot(this.vR1, this.viewPos), pb.dot(this.vR2, this.viewPos)), this.fDet);
        this.$l.projVtex = pb.vec3(pb.add(pb.mul(this.texDx, this.projVscr.x), pb.mul(this.texDy, this.projVscr.y)), pb.dot(this.worldNormal, this.viewPos));
        this.$return(pb.getGlobalScope().parallaxMapping(this.projVtex, this.uv));
      });
      scope.$l.viewVec = this.calculateViewVector(scope);
      scope.$l.TBN = this.calculateTBN(scope);
      scope.$l.texCoords = scope.calcUV(this.helper.getWorldPosition(scope).xyz, pb.normalize(this.helper.getWorldNormal(scope)), pb.normalize(this.helper.getCameraPosition(scope)), this.getNormalTexCoord(scope));
      scope.$l.normal = pb.sub(pb.mul(this.sampleNormalTexture(scope, scope.texCoords).rgb, 2), pb.vec3(1));
      scope.$l.normal = pb.mul(scope.TBN, scope.normal);
      scope.$l.viewVec = that.calculateViewVector(scope);
      scope.$l.albedo = that.calculateAlbedoColor(scope, scope.texCoords);
      scope.$l.litColor = this.blinnPhongLight(scope, scope.normal, scope.viewVec, scope.albedo);
      this.outputFragmentColor(scope, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, null);
    }
  }
}
