import type { Interpolator, VFS } from '@zephyr3d/base';
import { DlgCurveEditor } from './curveeditordlg';
import { DlgMessage } from './messagedlg';
import { DlgPromptName } from './promptnamedlg';
import { DlgRampTextureCreator } from './ramptexturedlg';
import { DlgRename } from './renamedlg';
import { DlgSelectAnimation } from './selectanimationdlg';
import { DlgMessageBoxEx } from './messageexdlg';
import { DlgEditColorTrack } from './editcolortrackdlg';
import { DlgOpen } from './opendlg';
import type { ProjectInfo, ProjectSettings } from '../../core/services/project';
import { DlgSaveFile } from './savefiledlg';
import { DlgOpenFile } from './openfiledlg';
import { DlgProjectSettings } from './projectsettingsdlg';
import type { ImGui } from '@zephyr3d/imgui';
import { DlgPBMaterialEditor as DlgPBRMaterialEditor } from './materialeditor';
import { DlgImport } from './importdlg';
import { DlgMaterialFunctionEditor } from './materialfunceditor';

export class Dialog {
  public static messageBox(title: string, message: string, width?: number, height?: number) {
    return DlgMessage.messageBox(title, message, width, height ?? 0);
  }
  public static async messageBoxEx(
    title: string,
    message: string,
    buttons?: string[],
    width?: number,
    height?: number,
    mask?: boolean,
    color?: ImGui.ImVec4,
    icon?: string
  ) {
    return DlgMessageBoxEx.messageBoxEx(
      title,
      message,
      buttons,
      width,
      height ?? 0,
      mask ?? true,
      color,
      icon
    );
  }
  public static async promptImport(title: string, vfs: VFS, width?: number, height?: number) {
    return DlgImport.promptImport(`${title}##Dialog`, vfs, width, height);
  }
  public static async editMaterial(
    title: string,
    outputName: string,
    path: string,
    width?: number,
    height?: number
  ) {
    return DlgPBRMaterialEditor.editPBRMaterial(title, outputName, path, width, height);
  }
  public static async editMaterialFunction(title: string, path: string, width?: number, height?: number) {
    return DlgMaterialFunctionEditor.editMaterialFunction(title, path, width, height);
  }
  public static async editProjectSettings(
    title: string,
    vfs: VFS,
    projectInfo: ProjectInfo,
    projectSettings: ProjectSettings,
    width?: number
  ) {
    return DlgProjectSettings.editProjectSettings(title, vfs, projectInfo, projectSettings, width);
  }
  public static async saveFile(
    title: string,
    vfs: VFS,
    project: ProjectInfo,
    rootDir: string,
    filter: string,
    width: number,
    height: number
  ) {
    return DlgSaveFile.saveFile(title, vfs, project, rootDir, filter, width, height);
  }
  public static async openFile(
    title: string,
    vfs: VFS,
    project: ProjectInfo,
    rootDir: string,
    filter: string,
    width: number,
    height: number
  ) {
    return DlgOpenFile.openFile(title, vfs, project, rootDir, filter, width, height);
  }
  public static async openFromList(
    title: string,
    names: string[],
    ids: string[],
    width?: number,
    height?: number
  ): Promise<string> {
    return DlgOpen.openFromList(title, names, ids, width, height);
  }
  public static async promptName(
    title: string,
    hint?: string,
    defaultName?: string,
    width?: number
  ): Promise<string> {
    return DlgPromptName.promptName(title, hint, defaultName, width);
  }
  public static async rename(title: string, name: string, width?: number): Promise<string> {
    return DlgRename.rename(title, name, width);
  }
  public static async editCurve(
    title: string,
    interpolator: Interpolator,
    onPreview?: (value: number[]) => void,
    width?: number,
    height?: number
  ): Promise<boolean> {
    return DlgCurveEditor.editCurve(title, interpolator, onPreview, width, height);
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
    return DlgEditColorTrack.editColorTrack(
      title,
      useAlpha,
      rgbInterpolator,
      alphaInterpolator,
      onPreview,
      width,
      height
    );
  }
  public static async createRampTexture(
    title: string,
    useAlpha: boolean,
    rgbInterpolator: Interpolator,
    alphaInterpolator: Interpolator,
    width?: number,
    height?: number
  ): Promise<{ data: Uint8ClampedArray; name: string }> {
    return DlgRampTextureCreator.createRampTexture(
      title,
      useAlpha,
      rgbInterpolator,
      alphaInterpolator,
      width,
      height
    );
  }
  public static async selectAnimationAndTrack(
    title: string,
    animationNames: string[],
    width?: number
  ): Promise<{ animationName: string; trackName: string }> {
    return DlgSelectAnimation.selectAnimationAndTrack(title, animationNames, width);
  }
}
