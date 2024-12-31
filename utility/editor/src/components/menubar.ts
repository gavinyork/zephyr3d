import { makeEventTarget } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { getFrameHeight } from '../views/misc';
import type { BaseView } from '../views/baseview';

export type MenuItemOptions = {
  label: string;
  shortCut?: string;
  id?: string;
  checked?: boolean;
  subMenus?: MenuItemOptions[];
};

export type MenuBarOptions = {
  items: MenuItemOptions[];
};

let UID = 0;
export class MenubarView extends makeEventTarget(Object)<{
  action: [id: string, item: MenuItemOptions];
}>() {
  private _map: Map<string, { item: MenuItemOptions; parent: MenuItemOptions }>;
  private _options: MenuBarOptions;
  constructor(options?: MenuBarOptions) {
    super();
    this._map = null;
    this._options = null;
    this.create(options);
  }
  get height() {
    return getFrameHeight();
  }
  get options() {
    return this._options;
  }
  set options(options: MenuBarOptions) {
    this.create(options);
  }
  private create(options: MenuBarOptions) {
    this._map = new Map();
    this._options = { items: (options?.items ?? []).map((val) => this.copyItem(val)) };
    if (this._options.items.length > 0) {
      const queue: { item: MenuItemOptions; parent: MenuItemOptions }[] = this._options.items.map((item) => ({
        item,
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
    }
  }
  addMenuItem(parentId: string, label: string, id: string, shortCut?: string): string {
    if (id === null || id === undefined) {
      id = this.uniqueId();
    }
    if (this._map.has(id)) {
      throw new Error(`Menu item with id ${id} already exists`);
    }
    const newItem = { label, id, shortCut };
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
  registerShortcuts(view: BaseView<any>) {
    const menuItems = this._options.items.slice();
    while (menuItems.length > 0) {
      const item = menuItems.shift();
      if (item.shortCut) {
        view.registerShortcut(item.shortCut, () => {
          this.dispatchEvent('action', item.id, item);
        });
      }
      if (item.subMenus) {
        menuItems.push(...item.subMenus);
      }
    }
  }
  unregisterShortcuts(view: BaseView<any>) {
    const menuItems = this._options.items.slice();
    while (menuItems.length > 0) {
      const item = menuItems.shift();
      if (item.shortCut) {
        view.unregisterShortcut(item.shortCut);
      }
      if (item.subMenus) {
        menuItems.push(...item.subMenus);
      }
    }
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
      if (item.label === '-') {
        ImGui.Separator();
      } else if (ImGui.MenuItem(`${item.label}##${item.id}`, item.shortCut ?? null, !!item.checked)) {
        this.dispatchEvent('action', item.id, item);
      }
    }
  }
  private uniqueId(): string {
    return `id${++UID}`;
  }
  private copyItem(item: MenuItemOptions): MenuItemOptions {
    return {
      label: item.label,
      id: item.id,
      shortCut: item.shortCut,
      subMenus: item.subMenus?.map((subItem) => this.copyItem(subItem))
    };
  }
}
