import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { RampTextureCreator } from '../../components/ramptexture';
import type { InterpolateData, Interpolator } from '@zephyr3d/base';

export class DlgEditColorTrack extends DialogRenderer<boolean> {
  private readonly _creator: RampTextureCreator;
  private readonly _rgbInterpolator: Interpolator;
  private readonly _alphaInterpolator: Interpolator;
  private readonly _savedRGBInputs: InterpolateData;
  private readonly _savedRGBOutputs: InterpolateData;
  private readonly _savedAlphaInputs: InterpolateData;
  private readonly _savedAlphaOutputs: InterpolateData;
  private readonly _onPreview: (value: number[]) => void;
  constructor(
    id: string,
    useAlpha: boolean,
    rgbInterpolator: Interpolator,
    alphaInterpolator: Interpolator,
    onPreview: (value: number[]) => void,
    width: number,
    height: number
  ) {
    super(id, width, height);
    this._creator = new RampTextureCreator(useAlpha, rgbInterpolator, alphaInterpolator);
    this._rgbInterpolator = rgbInterpolator;
    this._alphaInterpolator = alphaInterpolator;
    this._savedRGBInputs = rgbInterpolator.inputs.slice();
    this._savedRGBOutputs = rgbInterpolator.outputs.slice();
    this._savedAlphaInputs = alphaInterpolator ? alphaInterpolator.inputs.slice() : null;
    this._savedAlphaOutputs = alphaInterpolator ? alphaInterpolator.outputs.slice() : null;
    this._onPreview = onPreview;
    this._creator.on('preview_position', this.preview, this);
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
  get rampTextureCreator() {
    return this._creator;
  }
  preview(value: { key: number; value: number[] }) {
    if (this._onPreview) {
      this._onPreview(value.value);
    }
  }
  doRender(): void {
    const height = ImGui.GetContentRegionAvail().y - ImGui.GetFrameHeightWithSpacing();
    if (ImGui.BeginChild('Creator', new ImGui.ImVec2(0, height), false, ImGui.WindowFlags.NoScrollbar)) {
      this._creator.render();
    }
    ImGui.EndChild();
    if (ImGui.Button('Ok')) {
      const edited = this._creator.changed;
      this._creator.dispose();
      this.close(edited);
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._creator.dispose();
      this._rgbInterpolator.inputs = this._savedRGBInputs;
      this._rgbInterpolator.outputs = this._savedRGBOutputs;
      if (this._alphaInterpolator) {
        this._alphaInterpolator.inputs = this._savedAlphaInputs;
        this._alphaInterpolator.outputs = this._savedAlphaOutputs;
      }
      this.close(false);
    }
  }
}
