import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';

export type MenuItemOptions = {
  label: string;
  id?: string;
  checked?: boolean;
  subMenus?: MenuItemOptions[];
};

export type MenuBarOptions = {
  items: MenuItemOptions[];
};

export class MenubarView extends makeEventTarget(Object)<{
  action: [id: string, item: MenuItemOptions];
}>() {
  private _map: Map<string, { item: MenuItemOptions; parent: MenuItemOptions }>;
  private _options: MenuBarOptions;
  constructor(options?: MenuBarOptions) {
    super();
    this._map = new Map();
    this._options = { items: [] };
    if (options?.items?.length > 0) {
      // BFS iterate through the menu items and add them to the map and copy to _options
      const queue: { item: MenuItemOptions; parent: MenuItemOptions }[] = options.items.map((item) => ({
        item: this.copyItem(item),
        parent: null
      }));
      while (queue.length > 0) {
        const item = queue.shift();
        item.item.id = item.item.id ?? this.uniqueId();
        if (this._map.has(item.item.id)) {
          throw new Error(`Menu item with id ${item.item.id} already exists`);
        }
        this._map.set(item.item.id, item);
        item.item.subMenus?.forEach((subItem) => {
          queue.push({ item: subItem, parent: item.item });
        });
      }
      this._options = options;
    }
  }
  addMenuItem(parentId: string, label: string, id: string): string {
    if (id === null || id === undefined) {
      id = this.uniqueId();
    }
    if (this._map.has(id)) {
      throw new Error(`Menu item with id ${id} already exists`);
    }
    const newItem = { label, id };
    if (parentId === null) {
      this._options.items.push(newItem);
    } else {
      const parent = this._map.get(parentId);
      if (!parent) {
        throw new Error(`Parent menu item with id ${parentId} does not exist`);
      }
      const subMenus = parent.item.subMenus ?? [];
      subMenus.push(newItem);
      parent.item.subMenus = subMenus;
    }
    this._map.set(id, { item: newItem, parent: null });
    return id;
  }
  removeMenuItem(id: string) {
    const item = this._map.get(id);
    if (!item) {
      throw new Error(`Menu item with id ${id} does not exist`);
    }
    const parent = item.parent;
    if (parent) {
      const index = parent.subMenus.findIndex((subItem) => subItem.id === id);
      if (index === -1) {
        throw new Error(`Menu item with id ${id} does not exist in parent menu item`);
      }
      parent.subMenus.splice(index, 1);
    } else {
      const index = this._options.items.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new Error(`Menu item with id ${id} does not exist`);
      }
      this._options.items.splice(index, 1);
    }
    this._map.delete(id);
  }
  render() {
    if (ImGui.BeginMainMenuBar()) {
      for (const item of this._options.items) {
        this.renderItem(item);
      }
      ImGui.EndMainMenuBar();
    }
  }
  private renderItem(item: MenuItemOptions) {
    if (item.subMenus?.length > 0) {
      if (ImGui.BeginMenu(`${item.label}##${item.id}`)) {
        for (const subItem of item.subMenus) {
          this.renderItem(subItem);
        }
        ImGui.EndMenu();
      }
    } else {
      if (ImGui.MenuItem(`${item.label}##${item.id}`, null, !!item.checked)) {
        this.dispatchEvent('action', item.id, item);
      }
    }
  }
  private uniqueId(): string {
    let id = 0;
    while (this._map.has(`id${id}`)) {
      id++;
    }
    return `id${id}`;
  }
  private copyItem(item: MenuItemOptions): MenuItemOptions {
    return {
      label: item.label,
      id: item.id,
      subMenus: item.subMenus?.map((subItem) => this.copyItem(subItem))
    };
  }
}
