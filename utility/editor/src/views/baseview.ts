import type { BaseController } from '../controllers/basecontroller';
import type { BaseModel } from '../models/basemodel';

export abstract class BaseView<
  Model extends BaseModel,
  Controller extends BaseController<Model, BaseView<Model, Controller>>
> {
  private readonly _controller: Controller;
  private readonly _shortcuts: Map<string, { handler: (shortcut: string) => void; repeatable: boolean }>;
  constructor(controller: Controller) {
    this._controller = controller;
    this._shortcuts = new Map();
  }
  get controller() {
    return this._controller;
  }
  registerShortcut(key: string, handler: (shortcut: string) => void, repeatable?: boolean) {
    this._shortcuts.set(key, { handler, repeatable: !!repeatable });
  }
  unregisterShortcut(key: string) {
    this._shortcuts.delete(key);
  }
  shortcut(ev: Event): boolean {
    if (ev.type === 'keydown') {
      const e = ev as KeyboardEvent;
      const shortcut = this.getShortcutString(e);
      if (this._shortcuts.has(shortcut)) {
        ev.preventDefault();
        const info = this._shortcuts.get(shortcut);
        if (info.handler && (info.repeatable || !e.repeat)) {
          info.handler(shortcut);
        }
      }
    }
    return false;
  }
  private getShortcutString(event: KeyboardEvent) {
    const keys: string[] = [];
    if (event.ctrlKey) {
      keys.push('Ctrl');
    }
    if (event.altKey) {
      keys.push('Alt');
    }
    if (event.shiftKey) {
      keys.push('Shift');
    }
    if (event.metaKey) {
      keys.push('Meta');
    }
    const code = event.code;
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
      let key: string;
      if (code === 'Space') {
        key = 'Space';
      }
      if (code === 'Escape') {
        key = 'Esc';
      } else if (code === 'Slash') {
        key = '/';
      } else if (code === 'Semicolon') {
        key = ';';
      } else if (code === 'Equal') {
        key = '=';
      } else if (code === 'Minus') {
        key = '-';
      } else if (code === 'BracketLeft') {
        key = '[';
      } else if (code === 'BracketRight') {
        key = ']';
      } else if (code === 'Backslash') {
        key = '\\';
      } else if (code === 'Quote') {
        key = "'";
      } else if (code === 'Comma') {
        key = ',';
      } else if (code === 'Period') {
        key = '.';
      } else if (code === 'Backquote') {
        key = '`';
      } else if (code.startsWith('Arrow')) {
        key = code.slice(5);
      } else if (code.startsWith('Numpad')) {
        key = code.slice(6);
      } else if (code.startsWith('Key')) {
        key = code.slice(3);
      } else if (code.startsWith('Digit')) {
        key = code.slice(5);
      } else {
        key = event.key;
      }
      keys.push(key);
    }
    return keys.join('+');
  }
  activate() {
    this.onActivate();
  }
  deactivate() {
    this.onDeactivate();
  }
  abstract render();
  update(_dt: number) {}
  protected onActivate() {}
  protected onDeactivate() {}
}
