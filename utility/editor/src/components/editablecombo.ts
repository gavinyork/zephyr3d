import { ImGui } from '@zephyr3d/imgui';

export function renderEditableCombo(
  label: string,
  value: [string],
  items: string[],
  width: number,
  readonly: boolean = false,
  placeholder = 'Enter or select...'
): boolean {
  let changed = false;

  ImGui.PushID(label);

  ImGui.SetNextItemWidth(width);

  const displayText = value[0] || placeholder;
  const comboFlags = readonly ? ImGui.ComboFlags.NoArrowButton : ImGui.ComboFlags.None;

  if (ImGui.BeginCombo('##combo', displayText, comboFlags)) {
    if (!readonly) {
      ImGui.SetNextItemWidth(-1);
      ImGui.SetKeyboardFocusHere();
      if (ImGui.InputText('##edit_input', value, undefined, ImGui.InputTextFlags.AutoSelectAll)) {
        changed = true;
      }
      const inputFocused = ImGui.IsItemFocused();
      if (inputFocused && ImGui.IsKeyPressed(ImGui.GetKeyIndex(ImGui.Key.Enter))) {
        ImGui.CloseCurrentPopup();
      }
      if (ImGui.IsKeyReleased(ImGui.GetKeyIndex(ImGui.Key.Escape))) {
        ImGui.CloseCurrentPopup();
      }
      if (items.length > 0) {
        ImGui.Separator();
        //ImGui.TextDisabled('Or select:');
      }
    }
    for (let i = 0; i < items.length; i++) {
      ImGui.PushID(i);
      const isSelected = value[0] === items[i];

      ImGui.Selectable(items[i], isSelected);
      if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
        value[0] = items[i];
        changed = true;
        ImGui.CloseCurrentPopup();
      }

      if (isSelected) {
        ImGui.SetItemDefaultFocus();
      }

      ImGui.PopID();
    }

    ImGui.EndCombo();
  }

  ImGui.PopID();
  return changed;
}
