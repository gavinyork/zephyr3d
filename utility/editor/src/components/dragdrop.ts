import { ImGui } from '@zephyr3d/imgui';
import { eventBus } from '../core/eventbus';
import type { Nullable } from '@zephyr3d/base';

let isDragging: Nullable<unknown> = null;

export function enableWorkspaceDragging(
  object: unknown,
  type: string,
  payload?: () => unknown,
  renderFunc?: () => void
): boolean {
  if (ImGui.BeginDragDropSource()) {
    ImGui.SetDragDropPayload(type, payload ? payload() : null);
    if (renderFunc) {
      renderFunc();
    }
    ImGui.EndDragDropSource();
    if (isDragging !== object) {
      isDragging = object;
      eventBus.dispatchEvent('workspace_drag_start', type, payload);
    }
    return true;
  } else if (isDragging === object) {
    isDragging = null;
    eventBus.dispatchEvent('workspace_drag_end', type, payload);
  }
  return false;
}
