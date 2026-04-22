import { Disposable, type VFS } from '@zephyr3d/base';
import { DockPannel, ResizeDirection } from './dockpanel';
import { VFSRenderer } from './vfsrenderer';
import { ImGui } from '@zephyr3d/imgui';
import { renderLogView } from './logview';
import type { Editor } from '../core/editor';

export class BottomView extends Disposable {
  private readonly _panel: DockPannel;
  private _renderer: VFSRenderer;

  constructor(vfs: VFS, left: number, top: number, width: number, height: number, editor?: Editor) {
    super();
    this._renderer = new VFSRenderer(vfs, [], 200, { editor });
    this._panel = new DockPannel(left, top, width, height, 8, 0, 99999, ResizeDirection.Top, 200, 600);
  }

  get panel() {
    return this._panel;
  }
  get renderer() {
    return this._renderer;
  }
  render() {
    if (this._panel.begin('##BottomPanel')) {
      if (ImGui.BeginTabBar('##BottomTabBar')) {
        if (ImGui.BeginTabItem('Content Browser##VFSView')) {
          this._renderer.render();
          ImGui.EndTabItem();
        }
        if (ImGui.BeginTabItem('Log View##LogView')) {
          renderLogView();
          ImGui.EndTabItem();
        }
        ImGui.EndTabBar();
      }
    }
    this._panel.end();
  }
  protected onDispose() {
    super.onDispose();
    this._renderer.dispose();
  }
}
