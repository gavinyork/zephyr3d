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
          2 * ImGui.GetFrameHeight() +
          2 * ImGui.GetStyle().WindowPadding.y +
          2 * ImGui.GetStyle().ItemSpacing.y
      ),
      true
    );
    ImGui.Text('Grass Textures');
    ImGui.BeginChild('GrassTextureList', new ImGui.ImVec2(0, 60));
    tool.grassAlbedo.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    const layer = tool.grassAlbedo.selected;
    if (layer >= 0) {
      const grassRenderer = tool.terrain.grassRenderer;
      const bladeSize = [grassRenderer.getBladeWidth(layer), grassRenderer.getBladeHeight(layer)] as [
        number,
        number
      ];
      if (ImGui.SliderFloat2('BladeSize', bladeSize, 0, 10)) {
        grassRenderer.setBladeSize(layer, bladeSize[0], bladeSize[1]);
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
