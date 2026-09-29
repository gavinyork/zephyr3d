import { BaseTerrainBrush } from './base';
import type { TerrainEditTool } from '../terrain';
import { ImGui } from '@zephyr3d/imgui';
import { Vector4 } from '@zephyr3d/base';
import type { GrassLayer } from '@zephyr3d/scene';

/** Rows of the procedural blade settings, see renderBladeSettings() */
const BLADE_SETTING_ROWS = 17;

export class GrassBrush extends BaseTerrainBrush {
  brush() {}
  getName(): string {
    return 'grass';
  }
  renderSettings(tool: TerrainEditTool): void {
    const grassRenderer = tool.terrain.grassRenderer;
    const selectedLayer = grassRenderer.getLayer(tool.grassAlbedo.selected);
    const rows = 8 + (selectedLayer?.kind === 'blade' ? BLADE_SETTING_ROWS : 0);
    ImGui.BeginChild(
      'GrassTexture',
      new ImGui.ImVec2(
        0,
        60 +
          rows * ImGui.GetFrameHeight() +
          2 * ImGui.GetStyle().WindowPadding.y +
          rows * ImGui.GetStyle().ItemSpacing.y
      ),
      true
    );
    const occlusion = [grassRenderer.occlusionCulling] as [boolean];
    if (ImGui.Checkbox('Terrain Occlusion Culling', occlusion)) {
      grassRenderer.occlusionCulling = occlusion[0];
    }
    const occlusionDebug = [grassRenderer.occlusionDebug] as [boolean];
    if (ImGui.Checkbox('Show Occluded In Red', occlusionDebug)) {
      grassRenderer.occlusionDebug = occlusionDebug[0];
    }
    ImGui.Text('Grass Layers');
    ImGui.BeginChild('GrassTextureList', new ImGui.ImVec2(0, 60));
    tool.grassAlbedo.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    // Dropping a texture adds a card layer; blade layers have no texture
    if (ImGui.Button('Add Blade Layer')) {
      tool.addBladeGrassLayer();
    }
    const layer = tool.grassAlbedo.selected;
    if (layer >= 0) {
      const bladeSize = [grassRenderer.getBladeWidth(layer), grassRenderer.getBladeHeight(layer)] as [
        number,
        number
      ];
      const grassLayer = grassRenderer.getLayer(layer);
      const isBlade = grassLayer?.kind === 'blade';
      if (
        isBlade
          ? ImGui.DragFloat2('BladeSize', bladeSize, 0.002, 0.001, 10)
          : ImGui.SliderFloat2('BladeSize', bladeSize, 0, 10)
      ) {
        grassRenderer.setBladeSize(layer, bladeSize[0], bladeSize[1]);
      }
      if (grassLayer) {
        if (isBlade) {
          this.renderBladeSettings(grassLayer);
        }
        const density = [grassLayer.cellsPerTexel] as [number];
        if (ImGui.SliderInt('Density', density, 1, 4)) {
          grassLayer.cellsPerTexel = density[0];
        }
        const drawDistance = [grassLayer.drawDistance] as [number];
        if (ImGui.SliderFloat('DrawDistance', drawDistance, 0, 1000)) {
          grassLayer.drawDistance = drawDistance[0];
        }
        const farDensity = [grassLayer.farDensity] as [number];
        if (ImGui.SliderFloat('FarDensity', farDensity, 0.01, 1)) {
          grassLayer.farDensity = farDensity[0];
        }
      }
    }
    ImGui.EndChild();
  }
  /** Shape and color of a procedural blade layer, BLADE_SETTING_ROWS rows */
  private renderBladeSettings(layer: GrassLayer) {
    const slider = (label: string, value: number, min: number, max: number, set: (v: number) => void) => {
      const v = [value] as [number];
      if (ImGui.SliderFloat(label, v, min, max)) {
        set(v[0]);
      }
    };
    slider('HeightRandomness', layer.heightRandomness, 0, 1, (v) => (layer.heightRandomness = v));
    slider('WidthRandomness', layer.widthRandomness, 0, 1, (v) => (layer.widthRandomness = v));
    slider('Tilt', layer.tilt, 0, 1, (v) => (layer.tilt = v));
    slider('TiltRandomness', layer.tiltRandomness, 0, 1, (v) => (layer.tiltRandomness = v));
    slider('Bend', layer.bend, -1, 1, (v) => (layer.bend = v));
    slider('BendRandomness', layer.bendRandomness, 0, 1, (v) => (layer.bendRandomness = v));
    slider('Taper', layer.taper, 0, 1, (v) => (layer.taper = v));
    slider('TipDetail', layer.tipDetail, 1, 4, (v) => (layer.tipDetail = v));
    const clumpSize = [layer.clumpSize] as [number];
    if (ImGui.DragFloat('ClumpSize', clumpSize, 0.01, 0.01, 100)) {
      layer.clumpSize = clumpSize[0];
    }
    slider('ClumpHeightVariation', layer.clumpHeightVariation, 0, 1, (v) => (layer.clumpHeightVariation = v));
    slider('ClumpPull', layer.clumpPull, 0, 1, (v) => (layer.clumpPull = v));
    slider('ClumpSameDirection', layer.clumpSameDirection, 0, 1, (v) => (layer.clumpSameDirection = v));
    slider('ClumpFaceAway', layer.clumpFaceAway, 0, 1, (v) => (layer.clumpFaceAway = v));
    slider('ClumpColorVariation', layer.clumpColorVariation, 0, 1, (v) => (layer.clumpColorVariation = v));
    slider('RootOcclusion', layer.rootOcclusion, 0, 1, (v) => (layer.rootOcclusion = v));
    const color = (label: string, value: Vector4, set: (v: Vector4) => void) => {
      const c = [value.x, value.y, value.z] as [number, number, number];
      if (ImGui.ColorEdit3(label, c)) {
        set(new Vector4(c[0], c[1], c[2], 1));
      }
    };
    color('RootColor', layer.rootColor, (v) => (layer.rootColor = v));
    color('TipColor', layer.tipColor, (v) => (layer.tipColor = v));
  }
  protected brushFragment(): void {}
}

export class EraseGrassBrush extends GrassBrush {
  getName(): string {
    return 'erase grass';
  }
}
