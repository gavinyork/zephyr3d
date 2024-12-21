import { ImGui } from '@zephyr3d/imgui';
import { DockPannel } from './dockpanel';
import { SceneHierarchy } from './scenehierarchy';
import type { Scene } from '@zephyr3d/scene';
import { AssetHierarchy } from './assethierarchy';

export class Tab {
  private _panel: DockPannel;
  private _sceneHierarchy: SceneHierarchy;
  private _assetHierarchy: AssetHierarchy;
  constructor(scene: Scene, left: boolean, top: number, bottom: number) {
    this._sceneHierarchy = new SceneHierarchy(scene);
    this._assetHierarchy = new AssetHierarchy();
    this._panel = new DockPannel(left, top, bottom, 8, 300, 200, 600);
  }
  get width() {
    return this._panel.width;
  }
  get sceneHierarchy() {
    return this._sceneHierarchy;
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
      this._panel.end();
    }
  }
}
