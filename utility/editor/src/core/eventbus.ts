import { makeEventTarget } from '@zephyr3d/base';
import type { DBAssetInfo } from '../storage/db';

type EventBusEventMap = {
  error: [msg: string];
  resize: [width: number, height: number];
  update: [frameElapsed: number];
  shortcut: [key: string];
  switch_module: [name: string, ...args: any[]];
  input_event: [ev: Event, type: string];
  scene_add_asset: [asset: DBAssetInfo];
  workspace_drag_start: [type: string, data: any];
  workspace_drag_end: [type: string, data: any];
  workspace_drag_drop: [type: string, data: any, x: number, y: number];
  workspace_dragging: [type: string, data: any, x: number, y: number];
  action: [action: string];
};

export class EventBus extends makeEventTarget(Object)<EventBusEventMap>() {}
export const eventBus = new EventBus();
