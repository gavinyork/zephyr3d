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

export class Dialog {
  public static messageBox(title: string, message: string, width?: number, height?: number) {
    new DlgMessage(`${title}##Dialog`, message, width, height).showModal();
  }
  public static async messageBoxEx(
    title: string,
    message: string,
    buttons?: string[],
    width?: number,
    height?: number
  ) {
    return new Promise<string>((resolve) => {
      new DlgMessageBoxEx(title, message, buttons, width, height, resolve).showModal();
    });
  }
  public static async batchExportScene(
    title: string,
    scene: DBSceneInfo[],
    width?: number,
    height?: number
  ): Promise<DBSceneInfo[]> {
    return new Promise<DBSceneInfo[]>((resolve) => {
      new DlgExportScene(title, scene, width, height, resolve).showModal();
    });
  }
  public static async openScene(
    title: string,
    scene: DBSceneInfo[],
    width?: number,
    height?: number
  ): Promise<string> {
    return new Promise<string>((resolve) => {
      new DlgOpenScene(title, scene, width, height, resolve).showModal();
    });
  }
  public static async promptName(
    title: string,
    defaultName?: string,
    width?: number,
    height?: number
  ): Promise<string> {
    return new Promise((resolve) => {
      new DlgPromptName(title, defaultName, width, height, resolve).showModal();
    });
  }
  public static async rename(title: string, name: string, width?: number): Promise<string> {
    return new Promise((resolve) => {
      new DlgRename(title, width, name, resolve).showModal();
    });
  }
  public static async editCurve(
    title: string,
    interpolator: Interpolator,
    width?: number,
    height?: number
  ): Promise<Interpolator> {
    return new Promise((resolve) => {
      new DlgCurveEditor(title, width, height, interpolator, resolve).show();
    });
  }
  public static async createRampTexture(
    title: string,
    width?: number,
    height?: number
  ): Promise<{ data: Uint8ClampedArray; name: string }> {
    return new Promise((resolve) => {
      new DlgRampTextureCreator(title, width, height, resolve).showModal();
    });
  }
  public static async selectAnimationAndTrack(
    title: string,
    animationNames: string[],
    width?: number
  ): Promise<{ animationName: string; trackName: string }> {
    return new Promise((resolve) => {
      new DlgSelectAnimation(title, animationNames, width, resolve).showModal();
    });
  }
}
