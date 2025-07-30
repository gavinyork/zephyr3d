import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { RampTextureCreator } from '../../components/ramptexture';
import type { Interpolator } from '@zephyr3d/base';

export class DlgRampTextureCreator extends DialogRenderer<{ data: Uint8ClampedArray; name: string }> {
  private _name: string;
  private _creator: RampTextureCreator;
  constructor(
    id: string,
    useAlpha: boolean,
    rgbInterpolator: Interpolator,
    alphaInterpolator: Interpolator,
    width: number,
    height: number
  ) {
    super(id, width, height);
    this._name = 'ramp texture';
    this._creator = new RampTextureCreator(useAlpha, rgbInterpolator, alphaInterpolator);
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
  close(result: { data: Uint8ClampedArray; name: string }) {
    this._creator.dispose();
    super.close(result);
  }
  doRender(): void {
    const name = [this._name] as [string];
    if (ImGui.InputText('Asset Name', name)) {
      this._name = name[0];
    }
    const height = ImGui.GetContentRegionAvail().y - ImGui.GetFrameHeightWithSpacing();
    if (ImGui.BeginChild('Creator', new ImGui.ImVec2(0, height), false, ImGui.WindowFlags.NoScrollbar)) {
      this._creator.render();
    }
    ImGui.EndChild();
    if (ImGui.Button('Ok')) {
      const data = new Uint8ClampedArray(256 * 4);
      this._creator.fillTextureData(true, data);
      this.close({ data, name: this._name });
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }
}
