import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinAlbedoColor } from './mixins/albedocolor';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';

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
    scope.$l.oPos = this.helper.resolveVertexPosition(scope);
    scope.$l.wPos = pb.mul(this.helper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1));
    this.helper.pipeWorldPosition(scope, scope.wPos);
    this.helper.setClipSpacePosition(scope, pb.mul(this.helper.getViewProjectionMatrix(scope), scope.wPos));
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    let color = this.calculateAlbedoColor(scope);
    if (this.vertexColor) {
      color = scope.$builder.mul(color, this.getVertexColor(scope));
    }
    this.outputFragmentColor(scope, this.needFragmentColor() ? color : null);
  }
}
