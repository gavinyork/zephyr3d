import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { RampTextureCreator } from '../../components/ramptexture';
import { Interpolator } from '@zephyr3d/base';

export class DlgRampTextureCreator extends DialogRenderer {
  private _resolve: (tex: { data: Uint8ClampedArray; name: string }) => void;
  private _name: string;
  private _creator: RampTextureCreator;
  constructor(
    id: string,
    useAlpha: boolean,
    rgbInterpolator: Interpolator,
    alphaInterpolator: Interpolator,
    width: number,
    height: number,
    resolve: (tex: { data: Uint8ClampedArray; name: string }) => void
  ) {
    super(id, width, height);
    this._resolve = resolve;
    this._name = 'ramp texture';
    this._creator = new RampTextureCreator(useAlpha, rgbInterpolator, alphaInterpolator);
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
      this._creator.dispose();
      this._resolve({ data, name: this._name });
      this.close();
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._creator.dispose();
      this._resolve(null);
      this.close();
    }
  }
}
