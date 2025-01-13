import { Interpolator } from '@zephyr3d/base';
import { DlgCurveEditor } from './curveeditor';
import type { DBSceneInfo } from '../../storage/db';
import { DlgMessage } from './messagedlg';
import { DlgPromptName } from './newscenedlg';
import { DlgOpenScene } from './openscenedlg';
import { Texture2D } from '@zephyr3d/device';
import { DlgRampTextureCreator } from './ramptexture';

export class Dialog {
  public static messageBox(title: string, message: string, width?: number, height?: number) {
    new DlgMessage(`${title}##Dialog`, message, true, width, height);
  }
  public static async openScene(
    title: string,
    scene: DBSceneInfo[],
    width?: number,
    height?: number
  ): Promise<string> {
    return new Promise<string>((resolve) => {
      new DlgOpenScene(title, true, scene, width, height, resolve);
    });
  }
  public static async promptName(title: string, width?: number, height?: number): Promise<string> {
    return new Promise((resolve) => {
      new DlgPromptName(title, true, width, height, resolve);
    });
  }
  public static async editCurve(title: string, width?: number, height?: number): Promise<Interpolator> {
    return new Promise((resolve) => {
      new DlgCurveEditor(title, true, width, height, resolve);
    });
  }
  public static async createRampTexture(
    title: string,
    width?: number,
    height?: number
  ): Promise<Uint8ClampedArray> {
    return new Promise((resolve) => {
      new DlgRampTextureCreator(title, true, width, height, resolve);
    });
  }
}
