import { ImGui } from '@zephyr3d/imgui';
import { SceneModel } from '../models/scenemodel';
import { EmptyView } from './emptyview';
import { PostGizmoRenderer } from './gizmo/postgizmo';

export class SceneView extends EmptyView<SceneModel> {
  private _postGizmoRenderer: PostGizmoRenderer;
  constructor(model: SceneModel) {
    super(model);
    this.drawBackground = false;
    this._postGizmoRenderer = new PostGizmoRenderer(this.model.camera, null);
    this.menubar.options = {
      items: [
        ...this.menubar.options.items,
        {
          label: 'Edit',
          subMenus: [
            {
              label: 'Undo',
              id: 'UNDO'
            },
            {
              label: 'Redo',
              id: 'REDO'
            },
            {
              label: '-'
            },
            {
              label: 'Translate',
              id: 'TRANSLATE'
            },
            {
              label: 'Rotate',
              id: 'ROTATE'
            },
            {
              label: 'Scale',
              id: 'SCALE'
            },
            {
              label: '-'
            },
            {
              label: 'Delete',
              id: 'DELETE'
            }
          ]
        }
      ]
    }
  }
  render() {
    const displaySize = ImGui.GetIO().DisplaySize;
    const frameHeight = ImGui.GetFrameHeight();
    this.model.camera.viewport = [0, frameHeight, displaySize.x, displaySize.y - frameHeight * 2];
    this.model.camera.scissor = [0, frameHeight, displaySize.x, displaySize.y - frameHeight * 2];
    this.model.camera.aspect = this.model.camera.viewport[2] / this.model.camera.viewport[3];
    this.model.camera.render(this.model.scene, this.model.compositor);
    super.render();
  }
  protected onActivate(): void {
    super.onActivate();
    this.menubar.on('action', this.handleSceneAction, this);
    this.model.scene.on('startrender', (scene, camera, compositor) => {
      if (this._postGizmoRenderer && (this._postGizmoRenderer.node || this._postGizmoRenderer.drawGrid)) {
        compositor.appendPostEffect(this._postGizmoRenderer);
      }
    });
    this.model.scene.on('endrender', (scene, camera, compositor) => {
      if ((this._postGizmoRenderer && this._postGizmoRenderer.node) || this._postGizmoRenderer.drawGrid) {
        compositor.removePostEffect(this._postGizmoRenderer);
      }
    });
  }
  protected onDeactivate(): void {
    super.onDeactivate();
    this.menubar.off('action', this.handleSceneAction, this);
  }
  private handleSceneAction(action: string) {
    switch (action) {
      case 'UNDO':
        console.log('Undo');
        break;
      case 'REDO':
        console.log('Redo');
        break;
      case 'TRANSLATE':
        console.log('Translate');
        break;
      case 'ROTATE':
        console.log('Rotate');
        break;
      case 'SCALE':
        console.log('Scale');
        break;
      case 'DELETE':
        console.log('Delete');
        break;
      default:
        console.log('Unknown action');
        break;
    }
  }
}
