import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinAlbedoColor } from './mixins/albedocolor';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import { ShaderHelper } from './shader/helper';

/**
 * Unlit material
 * @public
 */
export class UnlitMaterial extends applyMaterialMixins(MeshMaterial, mixinVertexColor, mixinAlbedoColor) {
  static readonly FEATURE_VERTEX_COLOR = 'um_vertexcolor';
  constructor() {
    super();
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    let color = this.calculateAlbedoColor(scope);
    if (this.vertexColor) {
      color = scope.$builder.mul(color, this.getVertexColor(scope));
    }
    this.outputFragmentColor(scope, scope.$inputs.worldPos, this.needFragmentColor() ? color : null);
  }
}
