import { vec2, vec3 } from 'gl-matrix';
import { animationFrames } from 'rxjs';

import { createCube, createCylinder, createDonut, createDuck } from './bodies';
import { CameraControllerInterface } from './controller';
import { Gpu, Gizmos, Geometry } from './graphics';
import { Cubemap } from './graphics/gpu';
import {
  OceanField,
} from './ocean';
import { World } from './physics';
import {
  PlateOceanRenderer,
  ProjectedGridRenderer,
  QuadTreeOceanRenderer,
  SkyboxRenderer,
  TileOceanRenderer,
} from './renderer';

export class Viewport {
  public readonly tileRenderer: TileOceanRenderer;
  public readonly plateRenderer: PlateOceanRenderer;
  public readonly projectedGridRenderer: ProjectedGridRenderer;
  public readonly quadTreeRenderer: QuadTreeOceanRenderer;
  public readonly skyboxRenderer: SkyboxRenderer;

  constructor(
    private readonly gpu: Gpu,
    private readonly oceanField: OceanField,
    private readonly cameraController: CameraControllerInterface,
    private readonly skybox: Cubemap
  ) {
    this.tileRenderer = new TileOceanRenderer(this.gpu);
    this.plateRenderer = new PlateOceanRenderer(this.gpu);
    this.projectedGridRenderer = new ProjectedGridRenderer(this.gpu);
    this.quadTreeRenderer = new QuadTreeOceanRenderer(this.gpu);
    this.skyboxRenderer = new SkyboxRenderer(this.gpu);
  }

  render(type: 'tile' | 'plate' | 'grid' | 'quad-tree') {
    const { width, height } = this.gpu.context.canvas;

    this.gpu.setViewport(0, 0, width, height);
    this.gpu.setRenderTarget(null);
    this.gpu.clearRenderTarget();

    this.renderSkybox();
    this.renderOcean(this.oceanField, type);
  }

  private renderSkybox() {
    this.skyboxRenderer.render(this.cameraController.camera, this.skybox);
  }

  private renderOcean(
    field: OceanField,
    type: 'tile' | 'plate' | 'grid' | 'quad-tree'
  ) {
    if (type === 'tile') {
      this.tileRenderer.render(this.cameraController.camera, field);
    } else if (type === 'grid') {
      this.projectedGridRenderer.render(this.cameraController.camera, field);
    } else if (type === 'quad-tree') {
      this.quadTreeRenderer.render(
        this.cameraController.camera,
        field,
        this.skybox
      );
    } else {
      this.plateRenderer.render(this.cameraController.camera, field);
    }
  }
}
