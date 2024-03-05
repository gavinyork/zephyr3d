import { Vector4 } from '@zephyr3d/base';
import type { BindGroup, PBFunctionScope, Texture2D } from '@zephyr3d/device';
import type { DrawContext, Primitive } from '@zephyr3d/scene';
import { Application, MeshMaterial, QUEUE_TRANSPARENT, RENDER_PASS_TYPE_LIGHT, ShaderHelper, applyMaterialMixins, mixinLambert } from '@zephyr3d/scene';

export class FurMaterial extends applyMaterialMixins(MeshMaterial, mixinLambert) {
  private _thickness: number;
  private _numLayers: number;
  private _alphaRepeat: number;
  private _colorStart: Vector4;
  private _colorEnd: Vector4;
  private _instancing: boolean;
  private _alphaTexture: Texture2D;
  constructor() {
    super();
    this._thickness = 0.1;
    this._numLayers = 30;
    this._colorStart = new Vector4(0, 0, 0, 1);
    this._colorEnd = new Vector4(1, 1, 1, 0.3);
    this._alphaTexture = null;
    this._alphaRepeat = 4;
    this._instancing = Application.instance.device.type !== 'webgl';
    this.numPasses = this._instancing ? 2 : 1 + this._numLayers;
  }
  get thickness(): number {
    return this._thickness;
  }
  set thickness(val: number) {
    if(val !== this._thickness) {
      this._thickness = val;
      this.optionChanged(false);
    }
  }
  get numLayers(): number {
    return this._numLayers;
  }
  set numLayers(val: number) {
    if (val !== this._numLayers) {
      this._numLayers = val;
      if (!this._instancing) {
        this.numPasses = 1 + this._numLayers;
      }
      this.optionChanged(false);
    }
  }
  get noiseRepeat(): number {
    return this._alphaRepeat;
  }
  set noiseRepeat(val: number) {
    if (val !== this._alphaRepeat) {
      this._alphaRepeat = val;
      this.optionChanged(false);
    }
  }
  get alphaTexture(): Texture2D {
    return this._alphaTexture;
  }
  set alphaTexture(tex: Texture2D) {
    this._alphaTexture = tex;
  }
  getQueueType(): number {
    return QUEUE_TRANSPARENT;
  }
  passToHash(pass: number): string {
    return super.passToHash(pass > 0 ? 1 : 0);
  }
  isTransparent(pass: number): boolean {
    return pass > 0;
  }
  isBatchable(): boolean {
    return false;
  }
  beginDraw(pass: number, ctx: DrawContext): boolean {
    if (pass > 0) {
      if (ctx.renderPass.type !== RENDER_PASS_TYPE_LIGHT) {
        return false;
      } else {
        this.blendMode = 'blend';
        this.stateSet.useRasterizerState().setCullMode('none');
      }
    } else {
      this.blendMode = 'none';
      this.stateSet.defaultRasterizerState();
    }
    return super.beginDraw(pass, ctx);
  }
  endDraw(pass: number) {
    this.blendMode = 'none';
  }
  drawPrimitive(pass: number, primitive: Primitive, ctx: DrawContext, numInstances: number): void {
    if (pass === 0 || !this._instancing) {
      primitive.draw();
    } else {
      primitive.drawInstanced(this._numLayers);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('alphaRepeat', this._alphaRepeat);
      if (pass > 0) {
        if (!this._instancing){
          bindGroup.setValue('currentLayer', pass - 1);
        }
        bindGroup.setValue('layerThickness', this._thickness);
        bindGroup.setValue('numLayers', this._numLayers);
        bindGroup.setValue('colorStart', this._colorStart);
        bindGroup.setValue('colorEnd', this._colorEnd);
        bindGroup.setTexture('alphaTex', this._alphaTexture);
      }
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.pos = pb.vec3().attrib('position');
    let vertexPos = scope.$inputs.pos;
    if (this.needFragmentColor(this.drawContext)) {
      scope.$inputs.tex = pb.vec2().attrib('texCoord0');
      scope.$inputs.normal = pb.vec3().attrib('normal');
      if (this.pass > 0) {
        if (!this._instancing){
          scope.$l.currentLayer = pb.float().uniform(2);
        }
        scope.$l.layerThickness = pb.float().uniform(2);
        scope.$l.numLayers = pb.float().uniform(2);
        scope.$l.colorStart = pb.vec4().uniform(2);
        scope.$l.colorEnd = pb.vec4().uniform(2);
        if(!this._instancing){
          scope.$l.t = pb.div(scope.currentLayer, scope.numLayers);
          scope.$l.f = pb.mul(pb.add(scope.currentLayer, 1), scope.layerThickness);
        } else {
          scope.$l.t = pb.div(pb.float(scope.$builtins.instanceIndex), scope.numLayers);
          scope.$l.f = pb.mul(pb.float(pb.add(scope.$builtins.instanceIndex, 1)), scope.layerThickness);
        }
        vertexPos = pb.add(scope.$inputs.pos, pb.mul(scope.$inputs.normal, scope.f));
        scope.$outputs.ao = pb.mix(scope.colorStart, scope.colorEnd, pb.sin(pb.mul(scope.t, Math.PI/2)));
      }
      scope.$outputs.tex = scope.$inputs.tex;
      scope.$outputs.worldNormal = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.$inputs.normal, 0)).xyz;
    }
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(vertexPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor(this.drawContext)) {
      scope.alphaRepeat = pb.float().uniform(2);
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.worldNormal);
      scope.$l.color = pb.vec4(this.lambertLight(scope, scope.$inputs.worldPos, scope.normal, scope.albedo), scope.albedo.a);
      if (this.pass > 0) {
        scope.alphaTex = pb.tex2D().uniform(2);
        scope.color = pb.mul(scope.color, scope.$inputs.ao);
        scope.color.a = pb.mul(
          scope.color.a,
          pb.textureSample(scope.alphaTex, pb.mul(scope.$inputs.tex, scope.alphaRepeat)).r
        );
      }
      this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.color);
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}
