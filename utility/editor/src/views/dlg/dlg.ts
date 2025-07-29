import type { Interpolator, VFS } from '@zephyr3d/base';
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
import { DlgOpen } from './opendlg';
import { ProjectInfo } from '../../core/services/project';
import { DlgSaveFile } from './savefiledlg';

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
  public static async saveFile(title: string, vfs: VFS, project: ProjectInfo, width: number, height: number) {
    return new DlgSaveFile(title, vfs, project, width, height).showModal();
  }
  public static async openFromList(
    title: string,
    names: string[],
    ids: string[],
    width?: number,
    height?: number
  ): Promise<string> {
    return new DlgOpen(title, names, ids, width, height).showModal();
  }
  public static async promptName(
    title: string,
    hint?: string,
    defaultName?: string,
    width?: number
  ): Promise<string> {
    return new DlgPromptName(title, defaultName, hint, width).showModal();
  }
  public static async rename(title: string, name: string, width?: number): Promise<string> {
    return new DlgRename(title, width, name).showModal();
  }
  public static async editCurve(
    title: string,
    interpolator: Interpolator,
    onPreview?: (value: number[]) => void,
    width?: number,
    height?: number
  ): Promise<boolean> {
    const existing = DialogRenderer.findModeless(title);
    if (existing >= 0) {
      ImGui.SetWindowFocus(title);
      return DialogRenderer.getModeless(existing).promise;
    } else {
      return new DlgCurveEditor(title, onPreview, width, height, interpolator).show();
    }
  }
  public static editColorTrack(
    title: string,
    useAlpha: boolean,
    rgbInterpolator: Interpolator,
    alphaInterpolator: Interpolator,
    onPreview: (value: number[]) => void,
    width?: number,
    height?: number
  ) {
    const existing = DialogRenderer.findModeless(title);
    if (existing >= 0) {
      ImGui.SetWindowFocus(title);
      return DialogRenderer.getModeless(existing).promise;
    } else {
      return new DlgEditColorTrack(
        title,
        useAlpha,
        rgbInterpolator,
        alphaInterpolator,
        onPreview,
        width,
        height
      ).show();
    }
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
