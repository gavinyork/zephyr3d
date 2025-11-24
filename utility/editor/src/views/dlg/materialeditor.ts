import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { PBRMaterialEditor } from '../../components/blueprint/material/pbr';
import { DlgMessageBoxEx } from './messageexdlg';
import { ProjectService } from '../../core/services/project';

export class DlgPBRMaterialEditor extends DialogRenderer<void> {
  private readonly editor: PBRMaterialEditor;
  private path: string;
  constructor(id: string, width: number, height: number, outputName: string, path: string) {
    super(id, width, height, false, false, false, false);
    this.path = path;
    this.editor = new PBRMaterialEditor(id, outputName);
  }
  public static async editPBRMaterial(
    title: string,
    outptuName: string,
    path: string,
    width?: number,
    height?: number
  ): Promise<void> {
    const existing = DialogRenderer.findModeless(title);
    if (existing >= 0) {
      ImGui.SetWindowFocus(title);
      return DialogRenderer.getModeless(existing).promise;
    } else {
      return new DlgPBRMaterialEditor(title, width, height, outptuName, path).show();
    }
  }
  public async show(): Promise<void> {
    const exists = await ProjectService.VFS.exists(this.path);
    if (exists) {
      const stat = await ProjectService.VFS.stat(this.path);
      if (stat.isFile) {
        await this.editor.load(this.path);
      }
    } else {
      await this.editor.load('');
    }
    super.show();
    this.editor.open();
  }
  close(): void {
    this.editor.close();
    super.close();
  }
  public doRender(): void {
    if (
      ImGui.BeginChild(
        'NodeEditorContainer',
        new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing()),
        false,
        ImGui.WindowFlags.NoScrollbar | ImGui.WindowFlags.NoScrollWithMouse
      )
    ) {
      this.editor.render();
    }
    ImGui.EndChild();
    if (ImGui.Button('Save')) {
      this.editor.save(this.path);
    }
    ImGui.SameLine();
    if (ImGui.Button('Close')) {
      if (!this.editor.saved) {
        DlgMessageBoxEx.messageBoxEx('##SaveMaterial', 'Material has changed, do you want to save it?', [
          'Yes',
          'No',
          'Cancel'
        ]).then((value) => {
          if (value === 'Yes') {
            this.editor.save(this.path).then(() => {
              this.close();
            });
          } else if (value === 'No') {
            this.close();
          }
        });
      } else {
        this.close();
      }
    }
  }
}
