import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinAlbedoColor } from './mixins/albedocolor';
import { mixinVertexColor } from './mixins/vertexcolor';
import type { PBFunctionScope } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { mixinTextureProps } from './mixins/texture';

/**
 * Unlit material
 * @public
 */
export class UnlitMaterial extends applyMaterialMixins(MeshMaterial, mixinVertexColor, mixinAlbedoColor) {
  static readonly FEATURE_VERTEX_COLOR = 'um_vertexcolor';
  constructor() {
    super();
  }
  vertexShader(scope: PBFunctionScope, ctx: DrawContext) {
    super.vertexShader(scope, ctx);
    scope.$inputs.zPos = scope.$builder.vec3().attrib('position');
    this.transformVertexAndNormal(scope);
  }
  fragmentShader(scope: PBFunctionScope, ctx: DrawContext) {
    super.fragmentShader(scope, ctx);
    let color = this.calculateAlbedoColor(scope, ctx);
    if (this.vertexColor) {
      color = scope.$builder.mul(color, this.getVertexColor(scope, ctx));
    }
    this.outputFragmentColor(scope, this.needFragmentColor(ctx) ? color : null, ctx);
  }
}

