import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import { DrawContext, MeshMaterial, applyMaterialMixins, mixinAlbedoColor, mixinLambert } from '@zephyr3d/scene';

//const ITERATIONS = 32;
export class ParallaxMapMaterial extends applyMaterialMixins(MeshMaterial, mixinAlbedoColor, mixinLambert) {
  private _depthFactor: number;
  constructor() {
    super();
    this._depthFactor = 0.05;
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      bindGroup.setValue('depthFactor', this._depthFactor);
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    scope.$inputs.pos = scope.$builder.vec3().attrib('position');
    this.helper.transformVertexAndNormal(scope);
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const that = this;
    const pb = scope.$builder;
    if (this.needFragmentColor()){
      pb.func('parallaxMapping', [pb.vec2('texCoords'), pb.vec3('viewVec')], function(){
        this.$l.heightScale = 0.2;
        this.$l.numLayers = pb.int(64);
        this.$l.layerDepth = pb.div(1, pb.float(this.numLayers));
        this.$l.currentLayerDepth = pb.float(0);
        this.$l.P = pb.mul(this.viewVec.xy, this.heightScale);
        this.$l.deltaTexCoords = pb.div(this.P, pb.float(this.numLayers));
        this.$l.currentTexCoords = this.texCoords;
        this.$l.currentDepthValue = that.sampleNormalTexture(this, this.currentTexCoords).a;
        this.$while(pb.lessThan(this.currentLayerDepth, this.currentDepthValue), function(){
          this.currentTexCoords = pb.sub(this.currentTexCoords, this.deltaTexCoords);
          this.currentDepthValue = that.sampleNormalTexture(this, this.currentTexCoords).a;
          this.currentLayerDepth = pb.add(this.currentLayerDepth, this.layerDepth);
        });
        this.$l.prevCoords = pb.add(this.currentTexCoords, this.deltaTexCoords);
        this.$l.nextH = pb.sub(this.currentDepthValue, this.currentLayerDepth);
        this.$l.prevH = pb.add(pb.sub(that.sampleNormalTexture(this, this.prevCoords).a, this.currentLayerDepth), this.layerDepth);
        this.$l.weight = pb.div(this.nextH, pb.sub(this.nextH, this.prevH));
        this.currentTexCoords = pb.add(pb.mul(this.prevCoords, this.weight), pb.mul(this.currentTexCoords, pb.sub(1, this.weight)));
        this.$return(this.currentTexCoords);
      });
      scope.$l.TBN = this.calculateTBN(scope);
      scope.$l.mW2T = pb.transpose(scope.TBN);
      scope.$l.viewVec = this.calculateViewVector(scope);
      scope.$l.viewVecTS = pb.mul(scope.mW2T, scope.viewVec);
      //scope.$l.viewVecTS = pb.vec3(pb.dot(scope.viewVec, scope.TBN[0]), pb.dot(scope.viewVec, scope.TBN[1]), pb.dot(scope.viewVec, scope.TBN[2]));
      scope.$l.texCoords = scope.parallaxMapping(this.getNormalTexCoord(scope), scope.viewVecTS);
      if (0) {
        scope.$l.albedo = that.calculateAlbedoColor(scope, scope.texCoords);
        scope.$l.normal = this.sampleNormalTexture(scope, scope.texCoords).rgb;
        this.outputFragmentColor(scope, pb.vec4(scope.normal.rgb, 1));
      } else {
        scope.$l.normal = pb.sub(pb.mul(this.sampleNormalTexture(scope, scope.texCoords).rgb, 2), pb.vec3(1));
        scope.$l.normal = pb.mul(scope.TBN, scope.normal);
        scope.$l.albedo = pb.vec4(1);//that.calculateAlbedoColor(scope, scope.texCoords);
        if (1) {
          this.outputFragmentColor(scope, pb.vec4(pb.add(pb.mul(scope.normal, 0.5), pb.vec3(0.5)), scope.albedo.a));
        } else {
          scope.$l.litColor = this.lambertLight(scope, scope.normal, scope.albedo);
          this.outputFragmentColor(scope, pb.vec4(scope.litColor, scope.albedo.a));
        }
      }
    } else {
      this.outputFragmentColor(scope, null);
    }
  }
}
