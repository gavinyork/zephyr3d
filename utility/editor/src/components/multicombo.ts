import { ImGui } from '@zephyr3d/imgui';

export function renderMultiSelectedCombo(
  label: string,
  items: { text: string; selected: boolean }[],
  width: number
) {
  let changed = false;
  items = items ?? [];
  const selected = items.filter((val) => val.selected);
  const numSelected = selected.length;
  const text =
    numSelected === 0
      ? 'Select items...'
      : numSelected === 1
      ? selected[0].text
      : `${numSelected} items selected`;
  ImGui.SetNextItemWidth(width);
  if (ImGui.BeginCombo(label, text)) {
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
  return changed;
}
