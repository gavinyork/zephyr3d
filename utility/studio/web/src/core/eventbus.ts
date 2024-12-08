import { makeEventTarget } from '@zephyr3d/base';
import type { DocumentType } from '../components/common';

type EventBusEventMap = {
  error: [msg: string];
  resize: [width: number, height: number];
  update: [frameElapsed: number];
  action_doc_request_new: [type: DocumentType];
  action_doc_post_new: [type: DocumentType, name: string, uuid: string];
  action_doc_request_close: [type: DocumentType];
  action_doc_post_close: [type: DocumentType];
};

export class EventBus extends makeEventTarget(Object)<EventBusEventMap>() {}
export const eventBus = new EventBus();
