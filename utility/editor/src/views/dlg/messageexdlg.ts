import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { convertEmojiString } from '../../helpers/emoji';

export class DlgMessageBoxEx extends DialogRenderer<string> {
  private _text: string;
  private _color: ImGui.ImVec4;
  private _icon: string;
  private readonly _buttons: string[];
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
    return new DlgMessageBoxEx(title, message, buttons, width, height, mask, color, icon).showModal();
  }
  constructor(
    id?: string,
    message?: string,
    buttons?: string[],
    width?: number,
    height?: number,
    mask?: boolean,
    color?: ImGui.ImVec4,
    icon?: string
  ) {
    super(id ?? 'MessageBox', width ?? 300, height ?? 0, mask, true, true, true);
    this._text = message ?? '';
    this._color = color;
    this._icon = icon;
    this._buttons = buttons ? buttons.slice() : ['Ok'];
  }
  get text() {
    return this._text;
  }
  set text(val) {
    this._text = val;
  }
  get buttons() {
    return this._buttons;
  }
  doRender(): void {
    if (this._icon) {
      ImGui.TextUnformatted(convertEmojiString(this._icon));
      ImGui.SameLine();
    }
    if (this._color) {
      ImGui.PushStyleColor(ImGui.Col.Text, this._color);
    }
    ImGui.TextWrapped(this._text);
    if (this._color) {
      ImGui.PopStyleColor();
    }
    for (const btn of this._buttons) {
      if (ImGui.Button(btn)) {
        this.close(btn);
      }
      ImGui.SameLine();
    }
  }
}
