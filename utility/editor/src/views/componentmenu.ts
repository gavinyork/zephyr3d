import { ImGui } from '@zephyr3d/imgui';
import type { SceneNode, SceneNodeComponent } from '@zephyr3d/scene';
import { getEngine, getSceneNodeComponentTypes } from '@zephyr3d/scene';
import { getAddableComponentTypes, getComponentCategory } from '../commands/componentcommands';

/** Constructor of a component the menu offers. */
export type ComponentCtor = new () => SceneNodeComponent;

/**
 * Draws "Add Component" and "Remove Component" submenus for a node, inside an
 * open menu or popup.
 */
export function drawComponentMenus(
  node: SceneNode,
  onAdd: (ctor: ComponentCtor) => void,
  onRemove: (component: SceneNodeComponent) => void
) {
  drawAddComponentMenu(onAdd);
  const manager = getEngine().resourceManager;
  const components = node.components;
  if (components.length > 0 && ImGui.BeginMenu('Remove Component')) {
    for (let i = 0; i < components.length; i++) {
      const name = manager.getClassByObject(components[i])?.name ?? components[i].constructor.name;
      if (ImGui.MenuItem(`${name}##remove_component_${i}`)) {
        onRemove(components[i]);
      }
    }
    ImGui.EndMenu();
  }
}

/** Draws the "Add Component" submenu, grouped by category. */
export function drawAddComponentMenu(onAdd: (ctor: ComponentCtor) => void, label = 'Add Component') {
  const types = getAddableComponentTypes(getSceneNodeComponentTypes());
  if (types.length === 0) {
    return;
  }
  if (ImGui.BeginMenu(label)) {
    drawAddComponentItems(types, onAdd);
    ImGui.EndMenu();
  }
}

/** Draws the component categories as submenus directly into the current menu or popup. */
export function drawAddComponentItems(
  types: ReturnType<typeof getAddableComponentTypes>,
  onAdd: (ctor: ComponentCtor) => void
) {
  const categories = new Map<string, typeof types>();
  for (const entry of types) {
    const category = getComponentCategory(entry.type);
    let list = categories.get(category);
    if (!list) {
      list = [];
      categories.set(category, list);
    }
    list.push(entry);
  }
  for (const [category, list] of categories) {
    if (ImGui.BeginMenu(category)) {
      for (const entry of list) {
        if (ImGui.MenuItem(splitWords(entry.name))) {
          onAdd(entry.type);
        }
      }
      ImGui.EndMenu();
    }
  }
}

/** RigidBody -> Rigid Body */
function splitWords(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}
