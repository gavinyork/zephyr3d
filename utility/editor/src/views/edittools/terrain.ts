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
  private _brushAngle: number;
  private _brushStrength: number;
  private _brushImageList: ImageList;
  private _editList: string[];
  private _editSelected: number;
  constructor(terrain: ClipmapTerrain) {
    this._terrain = new DRef(terrain);
    this._brushSize = 10;
    this._brushAngle = 0;
    this._brushStrength = 1;
    this._disposed = false;
    this._brushImageList = new ImageList();
    this._editList = ['raise', 'smooth', 'level', 'copy', 'texture'];
    this._editSelected = -1;
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
  renderEditSection() {
    ImGui.BeginChild(
      'EditChild',
      new ImGui.ImVec2(
        0,
        2 * ImGui.GetStyle().WindowPadding.y + ImGui.GetStyle().ItemSpacing.y + 2 * ImGui.GetFrameHeight()
      ),
      true
    );
    ImGui.Text('Edit');
    const sel = [this._editSelected] as [number];
    if (ImGui.Combo('Edit', sel, this._editList)) {
      this._editSelected = sel[0];
    }
    ImGui.EndChild();
  }
  renderBrushSection() {
    ImGui.BeginChild(
      'Brush',
      new ImGui.ImVec2(
        0,
        60 +
          4 * ImGui.GetStyle().ItemSpacing.y +
          2 * ImGui.GetStyle().WindowPadding.y +
          4 * ImGui.GetFrameHeight()
      ),
      true
    );
    ImGui.Text('Brush settings');
    ImGui.BeginChild('BrushList', new ImGui.ImVec2(0, 60));
    this._brushImageList.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    const brushSize = [this._brushSize] as [number];
    if (ImGui.SliderFloat('Size', brushSize, 0, 100, '%.1f', ImGui.SliderFlags.None)) {
      this._brushSize = brushSize[0];
    }
    const brushAngle = [this._brushAngle] as [number];
    if (ImGui.SliderFloat('Rotation', brushAngle, 0, 360, '%.1f', ImGui.SliderFlags.None)) {
      this._brushAngle = brushAngle[0];
    }
    const brushStrength = [this._brushStrength] as [number];
    if (ImGui.SliderFloat('Strength', brushStrength, 0, 16, '%.1f', ImGui.SliderFlags.None)) {
      this._brushStrength = brushStrength[0];
    }
    ImGui.EndChild();
  }
  render(): void {
    if (ImGui.Begin('Terrain Tools', null, ImGui.WindowFlags.AlwaysAutoResize | ImGui.WindowFlags.NoResize)) {
      ImGui.Dummy(new ImGui.ImVec2(300, 0));
      this.renderBrushSection();
      this.renderEditSection();
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
