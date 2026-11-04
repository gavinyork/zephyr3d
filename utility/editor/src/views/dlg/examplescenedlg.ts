import { PathUtils, type VFS } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { customTextInput } from '../../components/textinput';
import {
  defaultParams,
  exampleSceneTypes,
  type ExampleParamDef,
  type ExampleParams,
  type ExampleSceneType
} from '../../helpers/examplescenes';

export type ExampleSceneRequest = {
  type: ExampleSceneType;
  /** Scene file to save to, ending with .zscn */
  scenePath: string;
  /** Directory for the generated assets of the scene */
  assetDir: string;
  params: ExampleParams;
};

/** Directory example scenes are created in */
export const EXAMPLE_SCENE_DIR = '/assets';

const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

export class DlgCreateExampleScene extends DialogRenderer<ExampleSceneRequest | null> {
  private readonly _vfs: VFS;
  private _typeIndex: number;
  private readonly _name: [string];
  private readonly _nameEdited: boolean[];
  /** Parameters per scene type, so switching types back and forth keeps the edits */
  private readonly _params: ExampleParams[];
  private _error: string;
  private _busy: boolean;
  static async createExampleScene(vfs: VFS) {
    return new DlgCreateExampleScene(vfs).showModal();
  }
  constructor(vfs: VFS) {
    super('Create Example Scene', 480, 0);
    this._vfs = vfs;
    this._typeIndex = 0;
    this._params = exampleSceneTypes.map((type) => defaultParams(type));
    this._nameEdited = [false];
    this._name = [this.defaultName()];
    this._error = '';
    this._busy = false;
  }
  private get type() {
    return exampleSceneTypes[this._typeIndex];
  }
  private defaultName() {
    return this.type.label.replace(/\s+/g, '');
  }
  doRender(): void {
    const typeIndex = [this._typeIndex] as [number];
    ImGui.SetNextItemWidth(-1);
    if (
      ImGui.Combo(
        '##ExampleSceneType',
        typeIndex,
        exampleSceneTypes.map((type) => type.label)
      )
    ) {
      this._typeIndex = typeIndex[0];
      if (!this._nameEdited[0]) {
        this._name[0] = this.defaultName();
      }
      this._error = '';
    }
    ImGui.TextWrapped(this.type.description);
    ImGui.Separator();

    if (customTextInput('Scene Name', this._name, this.defaultName())) {
      this._nameEdited[0] = true;
      this._error = '';
    }
    const name = this._name[0].trim();
    if (name) {
      ImGui.TextDisabled(
        this.type.writesAssets
          ? `Saved as ${this.scenePath(name)}, meshes in ${this.assetDir(name)}/`
          : `Saved as ${this.scenePath(name)}`
      );
    }
    ImGui.Spacing();

    const params = this._params[this._typeIndex];
    for (const def of this.type.params) {
      this.renderParam(def, params);
    }

    ImGui.Spacing();
    if (this._error) {
      ImGui.PushTextWrapPos(0);
      ImGui.TextColored(new ImGui.ImVec4(0.9, 0.25, 0.25, 1), this._error);
      ImGui.PopTextWrapPos();
    }
    if (ImGui.Button('Reset Parameters') && !this._busy) {
      this._params[this._typeIndex] = defaultParams(this.type);
    }
    ImGui.SameLine();
    if (ImGui.Button('Create') && !this._busy) {
      void this.confirm();
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel') && !this._busy) {
      this.close(null);
    }
  }
  private renderParam(def: ExampleParamDef, params: ExampleParams) {
    const id = `${def.label}##${def.key}`;
    switch (def.type) {
      case 'int': {
        const value = [Number(params[def.key])] as [number];
        if (ImGui.DragInt(id, value, 1, def.min, def.max)) {
          params[def.key] = Math.min(def.max, Math.max(def.min, Math.round(value[0])));
        }
        break;
      }
      case 'float': {
        const value = [Number(params[def.key])] as [number];
        const speed = Math.max(0.001, (def.max - def.min) / 500);
        if (ImGui.DragFloat(id, value, speed, def.min, def.max, def.format ?? '%.3f')) {
          params[def.key] = Math.min(def.max, Math.max(def.min, value[0]));
        }
        break;
      }
      case 'bool': {
        const value = [!!params[def.key]] as [boolean];
        if (ImGui.Checkbox(id, value)) {
          params[def.key] = value[0];
        }
        break;
      }
      case 'enum': {
        const index = [
          Math.max(
            0,
            def.options.findIndex((option) => option.value === params[def.key])
          )
        ] as [number];
        if (
          ImGui.Combo(
            id,
            index,
            def.options.map((option) => option.label)
          )
        ) {
          params[def.key] = def.options[index[0]].value;
        }
        break;
      }
    }
    if (def.tooltip && ImGui.IsItemHovered()) {
      ImGui.SetTooltip(def.tooltip);
    }
  }
  private scenePath(name: string) {
    return PathUtils.join(EXAMPLE_SCENE_DIR, `${name}.zscn`);
  }
  private assetDir(name: string) {
    return PathUtils.join(EXAMPLE_SCENE_DIR, name);
  }
  private async confirm() {
    const name = this._name[0].trim();
    if (!name) {
      this._error = 'Please enter a scene name';
      return;
    }
    if (INVALID_NAME_CHARS.test(name) || name.startsWith('.')) {
      this._error = 'The scene name must not contain \\ / : * ? " < > | or start with a dot';
      return;
    }
    const type = this.type;
    const scenePath = this.scenePath(name);
    const assetDir = this.assetDir(name);
    this._busy = true;
    try {
      // Never overwrite: a name that is taken has to be changed here
      if (await this._vfs.exists(scenePath)) {
        this._error = `${scenePath} already exists, please choose another name`;
        return;
      }
      if (type.writesAssets && (await this._vfs.exists(assetDir))) {
        this._error = `${assetDir} already exists, please choose another name`;
        return;
      }
    } catch (err) {
      this._error = `${err}`;
      return;
    } finally {
      this._busy = false;
    }
    this.close({ type, scenePath, assetDir, params: { ...this._params[this._typeIndex] } });
  }
}
