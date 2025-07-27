import { ImGui } from '@zephyr3d/imgui';
import { DockPannel, ResizeDirection } from './dockpanel';
import { SceneHierarchy } from './scenehierarchy';
import type { Scene } from '@zephyr3d/scene';
import { AssetHierarchy } from './assethierarchy';

export class Tab {
  private _panel: DockPannel;
  private _sceneHierarchy: SceneHierarchy;
  private _assetHierarchy: AssetHierarchy;
  constructor(scene: Scene, left: number, top: number, width: number, height: number) {
    this._sceneHierarchy = new SceneHierarchy(scene);
    this._assetHierarchy = new AssetHierarchy();
    this._panel = new DockPannel(left, top, width, height, 8, 200, 600, ResizeDirection.Right);
  }
  get width() {
    return this._panel.width;
  }
  set width(val: number) {
    this._panel.width = val;
  }
  get height() {
    return this._panel.height;
  }
  set height(val: number) {
    this._panel.height = val;
  }
  get sceneHierarchy() {
    return this._sceneHierarchy;
  }
  get assetHierarchy() {
    return this._assetHierarchy;
  }
  render() {
    if (this._panel.begin('##SceneTabPanel')) {
      if (ImGui.BeginTabBar('##SceneTabBar')) {
        if (ImGui.BeginTabItem('Scene##SceneHierarchy')) {
          this._sceneHierarchy.render();
          ImGui.EndTabItem();
        }
        if (ImGui.BeginTabItem('Assets##SceneAssets')) {
          this._assetHierarchy.render();
          ImGui.EndTabItem();
        }
        ImGui.EndTabBar();
      }
    }
    this._panel.end();
  }
}
