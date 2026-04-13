import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import type { VFS } from '@zephyr3d/base';
import type { SaveOptions, SharedModel } from '../../loaders/model';
import { DlgSkeletonEditor } from './skeletoneditor';

export class DlgImportOptions extends DialogRenderer<SaveOptions[]> {
  protected _vfs: VFS;
  protected _models: SharedModel[];
  protected _current: number;
  protected _modelNames: string[];
  protected _options: SaveOptions[];
  public static promptImportOptions(
    title: string,
    vfs: VFS,
    models: SharedModel[],
    names: string[],
    width?: number,
    height?: number
  ) {
    return new DlgImportOptions(`${title}##Dialog`, vfs, models, names, width, height).showModal();
  }
  constructor(id: string, vfs: VFS, models: SharedModel[], names: string[], width?: number, height?: number) {
    super(id ?? 'MessageBox', width ?? 300, height ?? 0);
    this._vfs = vfs;
    this._models = models;
    this._current = 0;
    this._modelNames = names;
    this._options = models.map((model) => ({
      importMeshes: true,
      importSkeletons: model.skeletons.length > 0,
      importAnimations: model.animations.length > 0
    }));
  }
  doRender(): void {
    const selected = [this._current] as [number];
    if (ImGui.Combo('Select Model', selected, this._modelNames)) {
      this._current = selected[0];
    }
    ImGui.Separator();
    const importMeshes = [this._options[this._current].importMeshes] as [boolean];
    if (ImGui.Checkbox('Import Meshes', importMeshes)) {
      this._options[this._current].importMeshes = importMeshes[0];
    }
    const hasSkeletons = this._models[this._current].skeletons.length > 0;
    if (!hasSkeletons) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
    }
    const importSkeletons = [hasSkeletons && this._options[this._current].importSkeletons] as [boolean];
    if (ImGui.Checkbox('Import Skeletons', importSkeletons)) {
      if (hasSkeletons) {
        this._options[this._current].importSkeletons = importSkeletons[0];
      }
    }
    if (!hasSkeletons) {
      ImGui.PopStyleVar();
    }
    if (this._options[this._current].importSkeletons) {
      ImGui.SameLine();
      if (ImGui.Button('Settings...')) {
        DlgSkeletonEditor.editSkeleton('SkeletonEditor', this._models[this._current].skeletons, 500, 500);
      }
    }
    const hasAnimations = hasSkeletons && this._models[this._current].animations.length > 0;
    if (!hasAnimations) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
    }
    const importAnimations = [hasAnimations && this._options[this._current].importAnimations] as [boolean];
    if (ImGui.Checkbox('Import Animations', importAnimations)) {
      if (hasAnimations) {
        this._options[this._current].importAnimations = importAnimations[0];
      }
    }
    if (!hasAnimations) {
      ImGui.PopStyleVar();
    }
    ImGui.Separator();
    if (ImGui.Button('OK')) {
      this.close(this._options);
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }
}
