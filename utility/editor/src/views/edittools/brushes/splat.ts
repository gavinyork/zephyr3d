import type {
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  Texture2DArray
} from '@zephyr3d/device';
import { ClipmapTerrainMaterial, fetchSampler } from '@zephyr3d/scene';
import { BaseTerrainBrush } from './base';
import { DRef } from '@zephyr3d/base';
import type { TerrainEditTool } from '../terrain';
import { ImGui } from '@zephyr3d/imgui';

/** Layers of the splat map array, 4 detail layer weights each */
const NUM_SPLAT_LAYERS = ClipmapTerrainMaterial.MAX_DETAIL_MAP_COUNT >> 2;

export class TerrainTextureBrush extends BaseTerrainBrush {
  private _detailIndex: number;
  private _outputLayer: number;
  private readonly _sourceSplatMap: DRef<Texture2DArray | Texture2D>;
  constructor() {
    super();
    this._detailIndex = -1;
    this._outputLayer = 0;
    this._sourceSplatMap = new DRef();
  }
  getName(): string {
    return 'texture';
  }
  get detailIndex() {
    return this._detailIndex;
  }
  set detailIndex(val: number) {
    this._detailIndex = val;
  }
  /** The splat map layer this pass writes; the brush runs once per layer, see brushFragment */
  set outputLayer(val: number) {
    this._outputLayer = val;
  }
  get sourceSplatMap() {
    return this._sourceSplatMap.get();
  }
  set sourceSplatMap(tex: Texture2DArray | Texture2D) {
    this._sourceSplatMap.set(tex);
  }
  renderSettings(tool: TerrainEditTool): void {
    ImGui.BeginChild(
      'Detail',
      new ImGui.ImVec2(
        0,
        60 * 2 +
          3 * ImGui.GetFrameHeight() +
          2 * ImGui.GetStyle().WindowPadding.y +
          3 * ImGui.GetStyle().ItemSpacing.y
      ),
      true
    );
    ImGui.Text('Detail Albedo');
    ImGui.BeginChild('AlbedoList', new ImGui.ImVec2(0, 60));
    tool.detailAlbedo.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    ImGui.Text('Detail Normal');
    ImGui.BeginChild('NormalList', new ImGui.ImVec2(0, 60));
    tool.detailNormal.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    const disabled = tool.detailAlbedo.selected < 0;
    if (disabled) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
      ImGui.InputFloat('UVScale', [0] as [number], 1, 10, undefined, ImGui.InputTextFlags.ReadOnly);
      ImGui.PopStyleVar();
    } else {
      const uvScale = [tool.terrain.material.getDetailMapUVScale(tool.detailAlbedo.selected)] as [number];
      if (ImGui.DragFloat('UVScale', uvScale, 1, 0, 1000, undefined)) {
        tool.terrain.material.setDetailMapUVScale(tool.detailAlbedo.selected, uvScale[0]);
      }
    }
    ImGui.EndChild();
  }
  protected brushFragment(
    scope: PBInsideFunctionScope,
    mask: PBShaderExp,
    strength: PBShaderExp,
    heightMapUV: PBShaderExp
  ) {
    // Weight blended painting as UE landscape: the paint adds weight to the target layer and the
    // others give way in proportion (LandscapeEditLayersWeightmaps.usf, PerformFinalWeightBlendingPS
    // divides every weight by the sum). The sum is kept at what the texel had rather than forced
    // to 1: identical to UE's normalization for weights summing to 1 (every terrain starts that
    // way), while weights painted by the old brush, which normalized the vector length, keep their
    // look where the brush does not reach instead of changing over the whole brush rectangle.
    // The weights span every splat map layer, so the brush runs once per layer, each pass writing
    // its own layer's 4 weights.
    const pb = scope.$builder;
    scope.$l.paintAmount = pb.clamp(pb.mul(strength, mask), 0, 1);
    scope.$l.weightSum = pb.float(0);
    scope.$l.outputValue = pb.vec4(0);
    for (let layer = 0; layer < NUM_SPLAT_LAYERS; layer++) {
      scope.$l[`splat${layer}`] = pb.textureArraySampleLevel(scope.sourceSplatMap, heightMapUV, layer, 0);
      scope.weightSum = pb.add(scope.weightSum, pb.dot(scope[`splat${layer}`], pb.vec4(1)));
      scope.$if(pb.equal(scope.outputLayer, layer), function () {
        this.outputValue = this[`splat${layer}`];
      });
    }
    scope.$if(pb.equal(scope.outputLayer, scope.targetLayer), function () {
      this.outputValue.setAt(this.channel, pb.add(this.outputValue.at(this.channel), this.paintAmount));
    });
    // A texel without any weight gets the UE result, the painted layer alone
    scope.$l.keepSum = pb.select(pb.float(1), scope.weightSum, pb.greaterThan(scope.weightSum, 1e-5));
    return pb.mul(
      scope.outputValue,
      pb.div(scope.keepSum, pb.max(pb.add(scope.weightSum, scope.paintAmount), 1e-5))
    );
  }
  protected setupBrushUniforms(scope: PBGlobalScope) {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.sourceSplatMap = pb.tex2DArray().uniform(0);
      scope.outputLayer = pb.int().uniform(0);
      scope.targetLayer = pb.int().uniform(0);
      scope.channel = pb.int().uniform(0);
    }
  }
  protected applyUniformValues(bindGroup: BindGroup) {
    bindGroup.setValue('outputLayer', this._outputLayer);
    bindGroup.setValue('targetLayer', this._detailIndex >> 2);
    bindGroup.setValue('channel', this._detailIndex & 3);
    bindGroup.setTexture('sourceSplatMap', this._sourceSplatMap.get(), fetchSampler('clamp_nearest_nomip'));
  }
}
