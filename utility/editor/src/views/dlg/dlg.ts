import type { Interpolator } from '@zephyr3d/base';
import { DlgCurveEditor } from './curveeditordlg';
import type { DBSceneInfo } from '../../storage/db';
import { DlgMessage } from './messagedlg';
import { DlgPromptName } from './newscenedlg';
import { DlgOpenScene } from './openscenedlg';
import { DlgRampTextureCreator } from './ramptexturedlg';
import { DlgRename } from './renamedlg';
import { DlgExportScene } from './exportscenedlg';
import { DlgSelectAnimation } from './selectanimationdlg';
import { DlgMessageBoxEx } from './messageexdlg';
import { DlgEditColorTrack } from './editcolortrackdlg';
import { DialogRenderer } from '../../components/modal';
import { ImGui } from '@zephyr3d/imgui';

export class Dialog {
  public static messageBox(title: string, message: string, width?: number, height?: number) {
    return new DlgMessage(`${title}##Dialog`, message, width, height).showModal();
  }
  public static async messageBoxEx(
    title: string,
    message: string,
    buttons?: string[],
    width?: number,
    height?: number
  ) {
    return new DlgMessageBoxEx(title, message, buttons, width, height).showModal();
  }
  public static async batchExportScene(
    title: string,
    scene: DBSceneInfo[],
    width?: number,
    height?: number
  ): Promise<DBSceneInfo[]> {
    return new DlgExportScene(title, scene, width, height).showModal();
  }
  public static async openScene(
    title: string,
    scene: DBSceneInfo[],
    width?: number,
    height?: number
  ): Promise<string> {
    return new DlgOpenScene(title, scene, width, height).showModal();
  }
  public static async promptName(
    title: string,
    defaultName?: string,
    width?: number,
    height?: number
  ): Promise<string> {
    return new DlgPromptName(title, defaultName, width, height).showModal();
  }
  public static async rename(title: string, name: string, width?: number): Promise<string> {
    return new DlgRename(title, width, name).showModal();
  }
  public static async editCurve(
    title: string,
    interpolator: Interpolator,
    width?: number,
    height?: number
  ): Promise<Interpolator> {
    const existing = DialogRenderer.findModeless(title);
    if (existing >= 0) {
      ImGui.SetWindowFocus(title);
      return DialogRenderer.getModeless(existing).promise;
    } else {
      return new DlgCurveEditor(title, width, height, interpolator).show();
    }
  }
  public static editColorTrack(
    title: string,
    useAlpha: boolean,
    rgbInterpolator: Interpolator,
    alphaInterpolator: Interpolator,
    width?: number,
    height?: number
  ) {
    return new DlgEditColorTrack(
      title,
      useAlpha,
      rgbInterpolator,
      alphaInterpolator,
      width,
      height
    ).showModal();
  }
  public static async createRampTexture(
    title: string,
    useAlpha: boolean,
    rgbInterpolator: Interpolator,
    alphaInterpolator: Interpolator,
    width?: number,
    height?: number
  ): Promise<{ data: Uint8ClampedArray; name: string }> {
    return new DlgRampTextureCreator(
      title,
      useAlpha,
      rgbInterpolator,
      alphaInterpolator,
      width,
      height
    ).showModal();
  }
  public static async selectAnimationAndTrack(
    title: string,
    animationNames: string[],
    width?: number
  ): Promise<{ animationName: string; trackName: string }> {
    return new DlgSelectAnimation(title, animationNames, width).showModal();
  }
}
