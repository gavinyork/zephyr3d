import { ImGui } from '@zephyr3d/imgui';
import { eventBus } from '../core/eventbus';

let isDragging = null;

export function enableWorkspaceDragging(object: unknown, type: string, payload: unknown) {
  if (ImGui.BeginDragDropSource()) {
    ImGui.SetDragDropPayload(type, payload);
    ImGui.EndDragDropSource();
    if (isDragging !== object) {
      isDragging = object;
      eventBus.dispatchEvent('workspace_drag_start');
    }
  } else if (isDragging === object) {
    isDragging = null;
    eventBus.dispatchEvent('workspace_drag_end');
  }
}
