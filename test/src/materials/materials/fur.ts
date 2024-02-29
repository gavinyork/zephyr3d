import { Vector4 } from '@zephyr3d/base';
import type { BindGroup, PBFunctionScope, Texture2D } from '@zephyr3d/device';
import type { DrawContext, Primitive } from '@zephyr3d/scene';
import { MeshMaterial, QUEUE_TRANSPARENT, RENDER_PASS_TYPE_LIGHT } from '@zephyr3d/scene';

export class FurMaterial extends MeshMaterial {
  private _thickness: number;
  private _numLayers: number;
  private _alphaRepeat: number;
  private _colorStart: Vector4;
  private _colorEnd: Vector4;
  private _colorTexture: Texture2D;
  private _alphaTexture: Texture2D;
  constructor() {
    super();
    this._thickness = 0.005;
    this._numLayers = 30;
    this._colorStart = new Vector4(1, 1, 1, 1);
    this._colorEnd = new Vector4(1, 1, 1, 0.2);
    this._colorTexture = null;
    this._alphaTexture = null;
    this._alphaRepeat = 4;
    this.numPasses = 2;
  }
  get colorTexture(): Texture2D {
    return this._colorTexture;
  }
  set colorTexture(tex: Texture2D) {
    this._colorTexture = tex;
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
    if (pass === 0) {
      primitive.draw();
    } else {
      primitive.drawInstanced(this._numLayers);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setTexture('colorTex', this._colorTexture);
      bindGroup.setValue('alphaRepeat', this._alphaRepeat);
      if (pass > 0) {
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
        scope.$l.layerThickness = pb.float().uniform(2);
        scope.$l.numLayers = pb.float().uniform(2);
        scope.$l.colorStart = pb.vec4().uniform(2);
        scope.$l.colorEnd = pb.vec4().uniform(2);
        scope.$l.t = pb.div(pb.float(scope.$builtins.instanceIndex), scope.numLayers);
        scope.$l.f = pb.mul(pb.float(pb.add(scope.$builtins.instanceIndex, 1)), scope.layerThickness);
        vertexPos = pb.add(scope.$inputs.pos, pb.mul(scope.$inputs.normal, scope.f));
        scope.$outputs.ao = pb.mix(scope.colorStart, scope.colorEnd, scope.t);
      }
      scope.$outputs.tex = scope.$inputs.tex;
    }
    scope.$l.worldPos = pb.mul(this.helper.getWorldMatrix(scope), pb.vec4(vertexPos, 1));
    this.helper.setClipSpacePosition(
      scope,
      pb.mul(this.helper.getViewProjectionMatrix(scope), scope.worldPos)
    );
    this.helper.propagateWorldPosition(scope, scope.worldPos);
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor(this.drawContext)) {
      scope.colorTex = pb.tex2D().uniform(2);
      scope.alphaRepeat = pb.float().uniform(2);
      scope.$l.color = pb.textureSample(scope.colorTex, scope.$inputs.tex);
      scope.$l.color.a = 1;
      if (this.pass > 0) {
        scope.alphaTex = pb.tex2D().uniform(2);
        scope.color = pb.mul(scope.color, scope.$inputs.ao);
        scope.color.a = pb.mul(
          scope.color.a,
          pb.textureSample(scope.alphaTex, pb.mul(scope.$inputs.tex, scope.alphaRepeat)).r
        );
        scope.color = pb.vec4(pb.mul(scope.color.rgb, scope.color.a), scope.color.a);
      }
      this.outputFragmentColor(scope, scope.color);
    } else {
      this.outputFragmentColor(scope, null);
    }
  }
}
