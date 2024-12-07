import { makeEventTarget } from '@zephyr3d/base';
import type { DocumentType } from './ui/common';

type EventBusEventMap = {
  action_doc_request_new: [type: DocumentType];
  action_doc_post_new: [type: DocumentType];
  action_doc_request_close: [type: DocumentType];
  action_doc_post_close: [type: DocumentType];
};

export class EventBus extends makeEventTarget(Object)<EventBusEventMap>() {}
export const eventBus = new EventBus();
