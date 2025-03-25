import { Application, ClipmapTerrain, DRef } from '@zephyr3d/scene';
import type { EditTool } from './edittool';
import type { Vector3 } from '@zephyr3d/base';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import { ImGui } from '@zephyr3d/imgui';
import { ImageList } from '../../components/imagelist';

export class TerrainEditTool implements EditTool {
  private _terrain: DRef<ClipmapTerrain>;
  private _disposed: boolean;
  private _brushImageList: ImageList;
  constructor(terrain: ClipmapTerrain) {
    this._terrain = new DRef(terrain);
    this._disposed = false;
    this._brushImageList = new ImageList();
    for (let i = 0; i < 1; i++) {
      this._brushImageList.addImage(Application.instance.device.createTexture2D('rgba8unorm', 1, 1));
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
      ImGui.BeginChild('BrushList', new ImGui.ImVec2(0, 60));
      this._brushImageList.render(ImGui.GetContentRegionAvail());
      ImGui.EndChild();
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
