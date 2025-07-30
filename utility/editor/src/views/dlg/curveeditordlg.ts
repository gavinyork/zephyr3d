import type { Interpolator } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { CurveEditor } from '../../components/curveeditor';

export class DlgCurveEditor extends DialogRenderer<boolean> {
  private labels: string[];
  private channel: [number];
  private editor: CurveEditor;
  private onPreview: (value: number[]) => void;
  constructor(
    id: string,
    onPreview: (value: number[]) => void,
    width: number,
    height: number,
    interpolator: Interpolator
  ) {
    super(id, width, height);
    this.onPreview = onPreview;
    this.editor = new CurveEditor(interpolator);
    this.editor.on('preview_position', this.preview, this);
    if (interpolator && interpolator.target !== 'number') {
      this.labels = ['x', 'y', 'z'];
      this.channel = [0];
    }
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
  get curveEditor() {
    return this.editor;
  }
  preview(value: { key: number; value: number[] }) {
    if (this.onPreview) {
      this.onPreview(value.value);
    }
  }
  public doRender(): void {
    this.editor.renderSettings();
    if (
      ImGui.BeginChild(
        'Canvas',
        new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing()),
        false,
        ImGui.WindowFlags.NoScrollbar | ImGui.WindowFlags.NoScrollWithMouse
      )
    ) {
      const canvasSize = ImGui.GetContentRegionAvail();
      this.editor.renderCurveView(canvasSize);
    }
    ImGui.EndChild();
    ImGui.Columns(2, 'ButtonLayout', false);
    if (ImGui.Button('Ok')) {
      const edited = this.editor.changed;
      this.editor.off('preview_position', this.preview, this);
      this.close(edited);
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.editor.off('preview_position', this.preview, this);
      this.close(false);
    }
    if (this.labels) {
      ImGui.SameLine();
      if (ImGui.Combo('Channel', this.channel, this.labels)) {
        this.editor.channel = this.channel[0];
      }
    }
    ImGui.NextColumn();
  }
}
