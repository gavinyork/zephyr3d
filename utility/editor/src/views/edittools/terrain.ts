import { ClipmapTerrain, DRef } from '@zephyr3d/scene';
import type { EditTool } from './edittool';
import type { Vector3 } from '@zephyr3d/base';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import { ImGui } from '@zephyr3d/imgui';
import { ImageList } from '../../components/imagelist';
import { Editor } from '../../core/editor';

export class TerrainEditTool implements EditTool {
  private _terrain: DRef<ClipmapTerrain>;
  private _disposed: boolean;
  private _brushSize: number;
  private _brushStrength: number;
  private _brushImageList: ImageList;
  constructor(terrain: ClipmapTerrain) {
    this._terrain = new DRef(terrain);
    this._brushSize = 10;
    this._brushStrength = 1;
    this._disposed = false;
    this._brushImageList = new ImageList();
    for (const name in Editor.instance.getBrushes()) {
      this._brushImageList.addImage(Editor.instance.getBrushes()[name].get());
    }
    this._brushImageList.selected = 0;
  }
  handlePointerEvent(evt: PointerEvent, hitObject: any, hitPos: Vector3): boolean {
    return false;
  }
  handleKeyboardEvent(evt: KeyboardEvent): boolean {
    return false;
  }
  render(): void {
    if (ImGui.Begin('Terrain Tools')) {
      ImGui.BeginSection('Brush settings');
      ImGui.BeginChild('BrushList', new ImGui.ImVec2(0, 60));
      this._brushImageList.render(ImGui.GetContentRegionAvail());
      ImGui.EndChild();
      const brushSize = [this._brushSize] as [number];
      if (ImGui.SliderFloat('Brush size', brushSize, 0, 100, '%.1f', ImGui.SliderFlags.None)) {
        this._brushSize = brushSize[0];
      }
      const brushStrength = [this._brushStrength] as [number];
      if (ImGui.SliderFloat('Brush strength', brushStrength, 0, 16, '%.1f', ImGui.SliderFlags.None)) {
        this._brushStrength = brushStrength[0];
      }
      ImGui.EndSection(1);
    }
    ImGui.End();
  }
  getSubMenuItems(): MenuItemOptions[] {
    return [];
  }
  getToolBarItems(): ToolBarItem[] {
    return [];
  }
  getTarget(): any {
    return this._terrain.get();
  }
  get disposed(): boolean {
    return this._disposed;
  }
  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      this._terrain.dispose();
    }
  }
}
