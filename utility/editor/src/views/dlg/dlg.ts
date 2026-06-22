import type { GenericConstructor, Interpolator, VFS } from '@zephyr3d/base';
import type { MeshMaterial, SharedModel } from '@zephyr3d/scene';
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
import { DlgPBRMaterialEditor } from './materialeditor';
import { DlgMaterialInstanceEditor } from './materialinstanceeditor';
import { DlgImport } from './importdlg';
import { DlgMaterialFunctionEditor } from './materialfunceditor';
import { DlgImportOptions } from './importoptionsdlg';
import { DlgOpenFolder } from './openfolderdlg';
import { DlgCreateProject, type CreateProjectResult } from './createprojectdlg';
import { ProjectService } from '../../core/services/project';

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
  public static async promptImportOptions(
    title: string,
    vfs: VFS,
    models: SharedModel[],
    names: string[],
    width?: number,
    height?: number
  ) {
    return DlgImportOptions.promptImportOptions(title, vfs, models, names, width, height);
  }
  public static async promptImport(title: string, vfs: VFS, width?: number, height?: number) {
    return DlgImport.promptImport(`${title}##Dialog`, vfs, width, height);
  }
  public static async editMaterial(
    title: string,
    outputName: string,
    type: GenericConstructor<MeshMaterial>,
    path: string,
    width?: number,
    height?: number
  ) {
    if (path) {
      try {
        if (await ProjectService.VFS.exists(path)) {
          const stat = await ProjectService.VFS.stat(path);
          if (stat.isFile) {
            const content = JSON.parse(
              (await ProjectService.VFS.readFile(path, { encoding: 'utf8' })) as string
            ) as { type?: string };
            if (content.type === 'PBRBluePrintMaterialInstance') {
              return DlgMaterialInstanceEditor.editMaterialInstance(title, path, width, height);
            }
          }
        }
      } catch {
        // Fall back to the graph editor if the file is not a material json yet.
      }
    }
    return DlgPBRMaterialEditor.editPBRMaterial(title, outputName, type, path, width, height);
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
    rootDir: string,
    filter: string,
    width: number,
    height: number,
    defaultName?: string
  ): Promise<string | null> {
    return DlgSaveFile.saveFile(title, vfs, rootDir, filter, width, height, defaultName);
  }
  public static async openFile(
    title: string,
    vfs: VFS,
    rootDir: string,
    filter: string | null,
    multi: boolean,
    width: number,
    height: number
  ) {
    return DlgOpenFile.openFile(title, vfs, rootDir, filter, multi, width, height);
  }
  public static async openFolder(
    title: string,
    vfs: VFS,
    rootDir: string,
    multi: boolean,
    width: number,
    height: number
  ) {
    return DlgOpenFolder.openFolder(title, vfs, rootDir, multi, width, height);
  }
  public static async openFromList(
    title: string,
    names: string[],
    ids: string[],
    extraActionLabel?: string,
    width?: number,
    height?: number
  ): Promise<string> {
    return DlgOpen.openFromList(title, names, ids, extraActionLabel, width, height);
  }
  public static async promptName(
    title: string,
    hint?: string,
    defaultName?: string,
    width?: number
  ): Promise<string> {
    return DlgPromptName.promptName(title, hint, defaultName, width);
  }
  public static async createProject(
    title: string,
    defaultName?: string,
    defaultDirectory?: string,
    directoryPlaceholder?: string,
    directoryPickerTitle?: string,
    confirmLabel?: string,
    width?: number
  ): Promise<CreateProjectResult | null> {
    return DlgCreateProject.createProject(
      title,
      defaultName,
      defaultDirectory,
      directoryPlaceholder,
      directoryPickerTitle,
      confirmLabel,
      width
    );
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
