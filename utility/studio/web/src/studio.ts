import { imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { MenubarView } from '@zephyr3d/inspector';

export class Studio {
  private _menubar: MenubarView;
  constructor() {
    this._menubar = new MenubarView({
      items: [
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
        },
        {
          label: 'Inspector',
          subMenus: [
            {
              label: 'Scene',
              id: 'INSPECT_SCENE'
            },
            {
              label: 'Camera',
              id: 'INSPECT_CAMERA'
            },
            {
              label: 'Lights',
              id: 'INSPECT_LIGHTS'
            },
            {
              label: 'Textures',
              id: 'INSPECT_TEXTURES'
            },
            {
              label: 'Sky',
              id: 'INSPECT_SKY'
            }
          ]
        }
      ]
    });
  }
  handleEvent(ev: Event, type?: string): boolean {
    return imGuiInjectEvent(ev, type);
  }
  resize(w: number, h: number) {}
  update(dt: number) {}
  render() {
    imGuiNewFrame();
    this._menubar.render();
    imGuiEndFrame();
  }
}
