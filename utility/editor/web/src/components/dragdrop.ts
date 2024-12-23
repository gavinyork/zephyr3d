import { ImGui } from '@zephyr3d/imgui';
import { eventBus } from '../core/eventbus';

let isDragging = false;

export function enableWorkspaceDragging(type: string, payload: unknown) {
  if (ImGui.BeginDragDropSource()) {
    ImGui.SetDragDropPayload(type, payload);
    ImGui.EndDragDropSource();
    if (!isDragging) {
      isDragging = true;
      eventBus.dispatchEvent('workspace_drag_start');
    }
  } else if (isDragging) {
    isDragging = false;
    eventBus.dispatchEvent('workspace_drag_end');
  }
}
