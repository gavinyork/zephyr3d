import { ImGui } from '@zephyr3d/imgui';
import { PHYSICS_LAYER_COUNT, ScenePhysicsSettings } from '@zephyr3d/scene';
import type { Nullable } from '@zephyr3d/base';
import { DialogRenderer } from '../../components/modal';
import { customTextInput } from '../../components/textinput';

/** Edited collision layers, in the form ScenePhysicsSettings saves them. */
export interface CollisionLayersResult {
  layerNames: string;
  layerMatrix: string;
}

/**
 * Names the 16 collision layers and sets which pairs collide. Works on a copy;
 * returns the result on OK, or null.
 */
export class DlgCollisionLayers extends DialogRenderer<Nullable<CollisionLayersResult>> {
  private readonly _settings: ScenePhysicsSettings;
  private readonly _names: [string][];
  public static async editCollisionLayers(
    settings: ScenePhysicsSettings
  ): Promise<Nullable<CollisionLayersResult>> {
    return new DlgCollisionLayers(settings).showModal();
  }
  constructor(source: ScenePhysicsSettings) {
    super('Collision Layers##DlgCollisionLayers', 680, 0, true, false);
    this._settings = new ScenePhysicsSettings();
    this._settings.layerNamesData = source.layerNamesData;
    this._settings.layerMatrixData = source.layerMatrixData;
    this._names = Array.from({ length: PHYSICS_LAYER_COUNT }, (_, i) => [this._settings.getLayerName(i)]);
  }
  doRender(): void {
    ImGui.TextWrapped(
      'Colliders on two layers touch only where the box at their row and column is ticked. Hover a box to see which pair it is.'
    );
    ImGui.Separator();
    const nameWidth = 160;
    const cell = ImGui.GetFrameHeight();
    const spacing = ImGui.GetStyle().ItemSpacing.x;
    // Column headers: layer numbers, newest on the right.
    ImGui.Dummy(new ImGui.ImVec2(nameWidth + 24, 0));
    for (let col = 0; col < PHYSICS_LAYER_COUNT; col++) {
      ImGui.SameLine(nameWidth + 24 + spacing + col * (cell + spacing));
      ImGui.Text(`${col}`);
      if (ImGui.IsItemHovered()) {
        ImGui.SetTooltip(this._names[col][0]);
      }
    }
    for (let row = 0; row < PHYSICS_LAYER_COUNT; row++) {
      ImGui.PushID(row);
      ImGui.AlignTextToFramePadding();
      ImGui.Text(`${row}`);
      ImGui.SameLine(24);
      // Names are applied on OK
      customTextInput('##name', this._names[row], '', undefined, nameWidth);
      // Lower triangle: each pair once.
      for (let col = 0; col <= row; col++) {
        ImGui.SameLine(nameWidth + 24 + spacing + col * (cell + spacing));
        ImGui.PushID(col);
        const value = [this._settings.getLayerCollision(row, col)] as [boolean];
        if (ImGui.Checkbox('##pair', value)) {
          this._settings.setLayerCollision(row, col, value[0]);
        }
        if (ImGui.IsItemHovered()) {
          ImGui.SetTooltip(`${this._names[row][0]}  ×  ${this._names[col][0]}`);
        }
        ImGui.PopID();
      }
      ImGui.PopID();
    }
    ImGui.Separator();
    if (ImGui.Button('Reset')) {
      for (let a = 0; a < PHYSICS_LAYER_COUNT; a++) {
        this._names[a][0] = ScenePhysicsSettings.defaultLayerName(a);
        for (let b = 0; b <= a; b++) {
          this._settings.setLayerCollision(a, b, true);
        }
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('OK')) {
      for (let i = 0; i < PHYSICS_LAYER_COUNT; i++) {
        this._settings.setLayerName(i, this._names[i][0].trim() || ScenePhysicsSettings.defaultLayerName(i));
      }
      this.close({ layerNames: this._settings.layerNamesData, layerMatrix: this._settings.layerMatrixData });
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }
}
