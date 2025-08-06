import type { VFS } from '@zephyr3d/base';
import { DockPannel, ResizeDirection } from './dockpanel';
import type { ProjectInfo } from '../core/services/project';
import { VFSRenderer } from './vfsrenderer';
import { ImGui } from '@zephyr3d/imgui';

export class BottomView {
  private readonly _panel: DockPannel;
  private _renderer: VFSRenderer;

  constructor(vfs: VFS, project: ProjectInfo, left: number, top: number, width: number, height: number) {
    this._renderer = new VFSRenderer(vfs, project);
    this._panel = new DockPannel(left, top, width, height, 8, 0, 99999, ResizeDirection.Top, 200, 600);
  }

  get panel() {
    return this._panel;
  }
  render() {
    if (this._panel.begin('##BottomPanel')) {
      if (ImGui.BeginTabBar('##BottomTabBar')) {
        if (ImGui.BeginTabItem('Content Browser##VFSView')) {
          this._renderer.render();
          ImGui.EndTabItem();
        }
        ImGui.EndTabBar();
      }
    }
    this._panel.end();
  }
  dispose() {
    this._renderer.dispose();
    this._renderer = null;
  }
}
