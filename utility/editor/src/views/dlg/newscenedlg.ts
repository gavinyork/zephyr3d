import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';

export class DlgPromptName extends ModalDialog {
  private _sceneName: string;
  private _resolve: (s: string) => void;
  constructor(id: string, open: boolean, width: number, height: number, resolve: (s: string) => void) {
    super(id, open, width, height);
    this._sceneName = '';
    this._resolve = resolve;
  }
  doRender(): void {
    const name = [this._sceneName] as [string];
    if (ImGui.InputText('Scene Name', name)) {
      this._sceneName = name[0];
    }
    if (ImGui.Button('Save')) {
      this._resolve(this._sceneName);
      this.close();
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._resolve('');
      this.close();
    }
  }
}
