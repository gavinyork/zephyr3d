import { ImGui } from '@zephyr3d/imgui';
import type { SceneNode } from '@zephyr3d/scene';
import { PHYSICS_PRESETS, type PhysicsPreset } from '../commands/physicscommands';

/**
 * Draws the "Add Physics" submenu and the "Remove Physics" item for a node,
 * inside an open menu or popup.
 */
export function drawPhysicsMenus(
  node: SceneNode,
  onPreset: (preset: PhysicsPreset) => void,
  onRemove: () => void
) {
  if (ImGui.BeginMenu('Add Physics')) {
    drawPhysicsPresetItems(onPreset);
    ImGui.EndMenu();
  }
  if (node.physics && ImGui.MenuItem('Remove Physics')) {
    onRemove();
  }
}

/** Draws the physics presets directly into the current menu or popup. */
export function drawPhysicsPresetItems(onPreset: (preset: PhysicsPreset) => void) {
  for (const preset of PHYSICS_PRESETS) {
    if (ImGui.MenuItem(preset.label)) {
      onPreset(preset);
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip(preset.description);
    }
  }
}
