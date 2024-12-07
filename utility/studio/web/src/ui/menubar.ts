import type { MenuBarOptions } from '@zephyr3d/inspector';
import { MenubarView } from '@zephyr3d/inspector';
import type { DocumentType } from './common';
import { eventBus } from '../eventbus';

const fileMenus = [
  {
    label: 'File',
    subMenus: [
      {
        label: 'New',
        subMenus: [
          {
            label: 'Scene',
            id: 'NEW_DOC'
          }
        ]
      },
      {
        label: 'Open',
        id: 'OPEN_DOC'
      },
      {
        label: 'Save',
        id: 'SAVE_DOC'
      },
      {
        label: 'Close',
        id: 'CLOSE_DOC'
      }
    ]
  }
];

const sceneMenus = [
  {
    label: 'Edit',
    subMenus: [
      {
        label: 'Box',
        id: 'ADD_BOX'
      },
      {
        label: 'Sphere',
        id: 'ADD_SPHERE'
      },
      {
        label: 'Plane',
        id: 'ADD_PLANE'
      },
      {
        label: 'Cylinder',
        id: 'ADD_CYLINDER'
      }
    ]
  }
];

export class Menubar {
  private _menubar: MenubarView;
  private _docType: DocumentType;
  constructor() {
    this._docType = 'none';
    this._menubar = this.createMenu(this._docType);
    eventBus.on('action_doc_post_new', this.onDocChanged, this);
    eventBus.on('action_doc_post_close', this.onDocClosed, this);
  }
  dispose() {
    eventBus.off('action_doc_post_new', this.onDocChanged, this);
  }
  get docType() {
    return this._docType;
  }
  set docType(val) {
    if (val !== this._docType) {
      this._docType = val;
      this._menubar = this.createMenu(this._docType);
    }
  }
  render() {
    this._menubar.render();
  }
  private onDocChanged(type: DocumentType) {
    this.docType = type;
  }
  private onDocClosed() {
    this.docType = 'none';
  }
  private createMenu(mode: DocumentType): MenubarView {
    let menuList: MenuBarOptions = null;
    switch (mode) {
      case 'scene':
        menuList = { items: [...fileMenus, ...sceneMenus] };
        break;
      default:
        menuList = { items: [...fileMenus] };
        break;
    }
    const menubar = new MenubarView(menuList);
    menubar.on('action', (id: string) => {
      switch (id) {
        case 'NEW_DOC':
          eventBus.dispatchEvent('action_doc_request_new', 'scene');
          break;
        case 'CLOSE_DOC':
          eventBus.dispatchEvent('action_doc_request_close', this._docType);
          break;
      }
    });
    return menubar;
  }
}
