import { ClipmapTerrain, DRef } from '@zephyr3d/scene';
import type { EditTool } from './edittool';
import type { Vector3 } from '@zephyr3d/base';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';

export class TerrainEditTool implements EditTool {
  private _terrain: DRef<ClipmapTerrain>;
  private _disposed: boolean;
  constructor(terrain: ClipmapTerrain) {
    this._terrain = new DRef(terrain);
    this._disposed = false;
  }
  handlePointerEvent(evt: PointerEvent, hitObject: any, hitPos: Vector3): boolean {
    return false;
  }
  handleKeyboardEvent(evt: KeyboardEvent): boolean {
    return false;
  }
  render(): void {}
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
