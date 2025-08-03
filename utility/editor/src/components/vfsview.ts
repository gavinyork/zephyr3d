import type { VFS } from '@zephyr3d/base';
import { DockPannel, ResizeDirection } from './dockpanel';
import type { ProjectInfo } from '../core/services/project';
import { VFSRenderer } from './vfsrenderer';

export class VFSView {
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
    if (this._panel.begin('##VFSView')) {
      this._renderer.render();
    }
    this._panel.end();
  }
  dispose() {
    this._renderer.dispose();
    this._renderer = null;
  }
}
