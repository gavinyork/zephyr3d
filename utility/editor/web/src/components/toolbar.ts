import { ImGui } from '@zephyr3d/imgui';

export class ToolBar {
  private _tools: { label: string; id: string }[];
  constructor() {
    this._tools = [];
  }
  get tools() {
    return this._tools;
  }
  render() {
    if (ImGui.BeginMainMenuBar()) {
      ImGui.EndMainMenuBar();
    }
  }
}
