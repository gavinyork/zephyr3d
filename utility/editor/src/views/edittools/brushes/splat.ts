import {
  AbstractDevice,
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2DArray
} from '@zephyr3d/device';
import { DRef, fetchSampler } from '@zephyr3d/scene';
import { BaseTerrainBrush } from './base';

export class TerrainTextureBrush extends BaseTerrainBrush {
  private _detailIndex: number;
  private _sourceSplatMap: DRef<Texture2DArray>;
  constructor() {
    super();
    this._detailIndex = -1;
    this._sourceSplatMap = new DRef();
  }
  get detailIndex() {
    return this._detailIndex;
  }
  set detailIndex(val: number) {
    this._detailIndex = val;
  }
  get sourceSplatMap() {
    return this._sourceSplatMap.get();
  }
  set sourceSplatMap(tex: Texture2DArray) {
    this._sourceSplatMap.set(tex);
  }
  protected brushFragment(
    scope: PBInsideFunctionScope,
    mask: PBShaderExp,
    strength: PBShaderExp,
    brushUV: PBShaderExp,
    heightMapUV: PBShaderExp
  ) {
    const pb = scope.$builder;
    const maskValue = pb.textureSampleLevel(mask, brushUV, 0).r;
    scope.$l.sourceValue = pb.textureArraySampleLevel(scope.sourceSplatMap, heightMapUV, scope.layer, 0);
    scope.sourceValue.setAt(
      scope.channel,
      pb.add(scope.sourceValue.at(scope.channel), pb.mul(strength, maskValue))
    );
    return pb.normalize(scope.sourceValue);
  }
  protected setupBrushUniforms(scope: PBGlobalScope) {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.sourceSplatMap = pb.tex2DArray().uniform(0);
      scope.layer = pb.int().uniform(0);
      scope.channel = pb.int().uniform(0);
    }
  }
  protected applyUniformValues(bindGroup: BindGroup) {
    bindGroup.setValue('layer', this._detailIndex >> 2);
    bindGroup.setValue('channel', this._detailIndex & 3);
    bindGroup.setTexture('sourceSplatMap', this._sourceSplatMap.get(), fetchSampler('clamp_nearest_nomip'));
  }
  protected createRenderStates(device: AbstractDevice) {
    const renderStates = device.createRenderStateSet();
    renderStates.useDepthState().enableTest(false).enableWrite(false);
    renderStates.useRasterizerState().setCullMode('none');
    return renderStates;
  }
}
