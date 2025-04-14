import type { Vector3 } from '@zephyr3d/base';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import type { AssetRegistry, Disposable } from '@zephyr3d/scene';
import { ClipmapTerrain } from '@zephyr3d/scene';
import { TerrainEditTool } from './terrain';

export interface EditTool extends Disposable {
  handlePointerEvent(evt: PointerEvent, hitObject: any, hitPos: Vector3): boolean;
  handleKeyboardEvent(evt: KeyboardEvent): boolean;
  render(): void;
  update(dt: number): void;
  getSubMenuItems(): MenuItemOptions[];
  getToolBarItems(): ToolBarItem[];
  getTarget(): any;
}

export function isObjectEditable(obj: any): boolean {
  return obj instanceof ClipmapTerrain;
}

export function createEditTool(obj: any, assetRegistry: AssetRegistry): EditTool {
  if (obj instanceof ClipmapTerrain) {
    return new TerrainEditTool(obj, assetRegistry);
  }
  return null;
}
