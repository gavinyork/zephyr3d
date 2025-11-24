import type { Vector3, IDisposable } from '@zephyr3d/base';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import { ClipmapTerrain } from '@zephyr3d/scene';
import { TerrainEditTool } from './terrain';
import type { Editor } from '../../core/editor';

export interface EditTool extends IDisposable {
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

export function createEditTool(editor: Editor, obj: any): EditTool {
  if (obj instanceof ClipmapTerrain) {
    return new TerrainEditTool(editor, obj);
  }
  return null;
}
