import { ImGui } from '@zephyr3d/imgui';

export function renderMultiSelectedCombo(
  id: string,
  label: string,
  items: { text: string; selected: boolean }[],
  hint?: (selected: string[]) => string
) {
  let changed = false;
  items = items ?? [];
  const selected = items.filter((val) => val.selected).map((val) => val.text);
  const numSelected = selected.length;
  const text = hint
    ? hint(selected)
    : numSelected === 0
    ? 'Select items...'
    : numSelected === 1
    ? selected[0]
    : `${numSelected} items selected`;
  if (ImGui.BeginCombo(id, text)) {
    if (ImGui.Selectable('Select All') && numSelected < items.length) {
      items.forEach((val) => (val.selected = true));
      changed = true;
    }
    if (ImGui.Selectable('Clear All') && numSelected > 0) {
      items.forEach((val) => (val.selected = false));
      changed = true;
    }
    ImGui.Separator();
    for (let i = 0; i < items.length; i++) {
      ImGui.PushID(i);
      const item = items[i];
      if (ImGui.Selectable(item.text, item.selected, ImGui.SelectableFlags.DontClosePopups)) {
        item.selected = !item.selected;
        changed = true;
      }
      ImGui.PopID();
    }
    ImGui.EndCombo();
  }
  ImGui.SameLine(0, ImGui.GetStyle().ItemInnerSpacing.x);
  ImGui.TextUnformatted(label);
  return changed;
}
