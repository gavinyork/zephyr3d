import { BaseTerrainBrush } from './base';
import type { TerrainEditTool } from '../terrain';
import { ImGui } from '@zephyr3d/imgui';

export class GrassBrush extends BaseTerrainBrush {
  brush() {}
  getName(): string {
    return 'grass';
  }
  renderSettings(tool: TerrainEditTool): void {
    ImGui.BeginChild(
      'GrassTexture',
      new ImGui.ImVec2(
        0,
        60 +
          7 * ImGui.GetFrameHeight() +
          2 * ImGui.GetStyle().WindowPadding.y +
          7 * ImGui.GetStyle().ItemSpacing.y
      ),
      true
    );
    const grassRenderer = tool.terrain.grassRenderer;
    const occlusion = [grassRenderer.occlusionCulling] as [boolean];
    if (ImGui.Checkbox('Terrain Occlusion Culling', occlusion)) {
      grassRenderer.occlusionCulling = occlusion[0];
    }
    const occlusionDebug = [grassRenderer.occlusionDebug] as [boolean];
    if (ImGui.Checkbox('Show Occluded In Red', occlusionDebug)) {
      grassRenderer.occlusionDebug = occlusionDebug[0];
    }
    ImGui.Text('Grass Textures');
    ImGui.BeginChild('GrassTextureList', new ImGui.ImVec2(0, 60));
    tool.grassAlbedo.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    const layer = tool.grassAlbedo.selected;
    if (layer >= 0) {
      const bladeSize = [grassRenderer.getBladeWidth(layer), grassRenderer.getBladeHeight(layer)] as [
        number,
        number
      ];
      if (ImGui.SliderFloat2('BladeSize', bladeSize, 0, 10)) {
        grassRenderer.setBladeSize(layer, bladeSize[0], bladeSize[1]);
      }
      const grassLayer = grassRenderer.getLayer(layer);
      if (grassLayer) {
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
  protected brushFragment(): void {}
}

export class EraseGrassBrush extends GrassBrush {
  getName(): string {
    return 'erase grass';
  }
}
