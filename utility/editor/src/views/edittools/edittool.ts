import type { Vector3, IDisposable } from '@zephyr3d/base';
import type { Camera } from '@zephyr3d/scene';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import type { Editor } from '../../core/editor';
import type { Command } from '../../core/command';

export interface EditTool extends IDisposable {
  handlePointerEvent(evt: PointerEvent, hitObject: any, hitPos: Vector3): boolean;
  handleKeyboardEvent(evt: KeyboardEvent): boolean;
  render(): void;
  update(dt: number): void;
  getSubMenuItems(): MenuItemOptions[];
  getToolBarItems(): ToolBarItem[];
  getTarget(): any;
}
export interface EditToolContext {
  executeCommand<T>(command: Command<T>): Promise<T>;
  notifySceneChanged(): void;
  refreshProperties(): void;
  getCamera(): Camera | null;
  getViewportRect(): readonly [number, number, number, number] | null;
}

export function isObjectEditable(editor: Editor, obj: any, ctx: EditToolContext): boolean {
  return editor.plugins.canEditObject(obj, {
    ...ctx,
    editor
  });
}

export function createEditTool(editor: Editor, obj: any, ctx: EditToolContext): EditTool {
  return editor.plugins.createEditTool(obj, {
    ...ctx,
    editor
  });
}
