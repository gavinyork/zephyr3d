import type { BindGroup, PBGlobalScope, PBInsideFunctionScope, Texture2D } from '@zephyr3d/device';
import { BaseTerrainBrush } from './base';
import { fetchSampler } from '@zephyr3d/scene';
import type { Vector4 } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';

export abstract class TerrainHeightBrush extends BaseTerrainBrush {
  private readonly _sourceHeightMap: DRef<Texture2D>;
  constructor() {
    super();
    this._sourceHeightMap = new DRef();
  }
  get sourceHeightMap() {
    return this._sourceHeightMap.get();
  }
  set sourceHeightMap(tex: Texture2D) {
    this._sourceHeightMap.set(tex);
  }
  getOriginHeightMap(scope: PBInsideFunctionScope) {
    return scope.sourceHeightMap;
  }
  protected setupBrushUniforms(scope: PBGlobalScope): void {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.sourceHeightMap = pb.tex2D().uniform(0);
    }
  }
  protected applyUniformValues(bindGroup: BindGroup, _region: Vector4): void {
    bindGroup.setTexture('sourceHeightMap', this._sourceHeightMap.get(), fetchSampler('clamp_nearest_nomip'));
  }
}
