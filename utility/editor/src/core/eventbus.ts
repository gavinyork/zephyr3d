import { makeEventTarget } from '@zephyr3d/base';

type EventBusEventMap = {
  error: [msg: string];
  resize: [width: number, height: number];
  update: [frameElapsed: number];
  scene_changed: [];
  shortcut: [key: string];
  project_closed: [uuid: string];
  project_opened: [uuid: string];
  switch_module: [name: string, ...args: any[]];
  input_event: [ev: Event, type: string];
  scene_add_asset: [asset: string];
  workspace_drag_start: [type: string, data: any];
  workspace_drag_end: [type: string, data: any];
  workspace_drag_drop: [type: string, data: any, x: number, y: number];
  workspace_dragging: [type: string, data: any, x: number, y: number];
  external_dragenter: [ev: DragEvent];
  external_dragleave: [ev: DragEvent];
  external_dragover: [ev: DragEvent];
  external_drop: [ev: DragEvent];
  action: [action: string, ...args: any];
};

export class EventBus extends makeEventTarget(Object)<EventBusEventMap>() {}
export const eventBus = new EventBus();
