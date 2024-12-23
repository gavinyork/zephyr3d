import { makeEventTarget } from '@zephyr3d/base';
import type { DocumentType } from '../components/common';
import type { SceneNode } from '@zephyr3d/scene';
import type { TRS } from '../types';

type EventBusEventMap = {
  error: [msg: string];
  resize: [width: number, height: number];
  update: [frameElapsed: number];
  switch_module: [name: string, ...args: any[]];
  input_event: [ev: Event, type: string];
  workspace_drag_start: [];
  workspace_drag_drop: [type: string, data: unknown];
  action: [action: string];
  action_doc_request_new: [type: DocumentType];
  action_doc_post_new: [type: DocumentType, name: string, uuid: string];
  action_doc_request_open: [];
  action_doc_request_save: [];
  action_doc_request_close: [];
  action_doc_post_close: [];
  action_doc_request_new_scene: [name: string];
  node_transform: [node: SceneNode, oldTransform: TRS, newTransform: TRS];
};

export class EventBus extends makeEventTarget(Object)<EventBusEventMap>() {}
export const eventBus = new EventBus();
