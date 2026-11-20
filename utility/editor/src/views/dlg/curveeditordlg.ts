import type { InterpolateData, InterpolationMode, Interpolator, Nullable } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { CurveEditor } from '../../components/curveeditor';

export class DlgCurveEditor extends DialogRenderer<boolean> {
  private readonly labels: string[];
  private readonly channel: [number];
  private readonly editor: CurveEditor;
  private readonly onPreview: (value: number[]) => void;
  private readonly onChange: Nullable<() => void>;
  private readonly interpolator: Interpolator;
  private readonly savedInputs: Nullable<InterpolateData>;
  private readonly savedOutputs: Nullable<InterpolateData>;
  private readonly savedMode: Nullable<InterpolationMode>;
  constructor(
    id: string,
    onPreview: (value: number[]) => void,
    width: number,
    height: number,
    interpolator: Interpolator,
    onChange?: () => void
  ) {
    super(id, width, height);
    this.onPreview = onPreview;
    this.onChange = onChange ?? null;
    // The editor changes the curve in place: kept to put back on cancel
    this.interpolator = interpolator;
    this.savedInputs = interpolator ? interpolator.inputs.slice() : null;
    this.savedOutputs = interpolator ? interpolator.outputs.slice() : null;
    this.savedMode = interpolator ? interpolator.mode : null;
    this.editor = new CurveEditor(interpolator);
    this.editor.on('preview_position', this.preview, this);
    if (this.onChange) {
      this.editor.on('curve_changed', this.onChange);
    }
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
    height?: number,
    onChange?: () => void
  ): Promise<boolean> {
    const existing = DialogRenderer.findModeless(title);
    if (existing >= 0) {
      ImGui.SetWindowFocus(title);
      return DialogRenderer.getModeless(existing).promise;
    } else {
      return new DlgCurveEditor(title, onPreview, width, height, interpolator, onChange).show();
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
      if (this.interpolator && this.savedInputs && this.savedOutputs) {
        this.interpolator.inputs = this.savedInputs;
        this.interpolator.outputs = this.savedOutputs;
        this.interpolator.mode = this.savedMode!;
        this.onChange?.();
      }
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
