import { vec2 } from 'gl-matrix';
import { cloneDeep } from 'lodash-es';
import GUI from 'lil-gui';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { OceanFieldBuildParams } from './ocean';
import {
  TileOceanRendererSettings,
  PlateOceanRendererSettings,
  ProjectedGridRendererSettings,
  QuadTreeOceanRendererSettings,
} from './renderer';

export type GuiTileRendererParams = TileOceanRendererSettings;
export type GuiPlateRendererParams = PlateOceanRendererSettings;
export type GuiProjectedGridRendererParams = ProjectedGridRendererSettings;
export type GuiQuadTreeRendererParams = QuadTreeOceanRendererSettings;

export interface GuiParams extends OceanFieldBuildParams {
  renderer: 'tile' | 'plate' | 'grid' | 'quad-tree';
  tileRenderer: GuiTileRendererParams;
  plateRenderer: GuiPlateRendererParams;
  gridRenderer: GuiProjectedGridRendererParams;
  quadTreeRenderer: GuiQuadTreeRendererParams;
}

export const defaultParams: GuiParams = {
  cascades: [
    {
      size: 450.0,
      strength: 0.8,
      croppiness: -1.2,
      minWave: 0,
      maxWave: 1.0e2,
    },
    {
      size: 103.0,
      strength: 0.8,
      croppiness: -1.5,
      minWave: 0,
      maxWave: 1.0e2,
    },
    {
      size: 13,
      strength: 0.9,
      croppiness: -1.5,
      minWave: 0,
      maxWave: 7,
    },
  ],
  resolution: 256,
  wind: vec2.fromValues(2, 2),
  alignment: 1.0e-2,
  foamSpreading: 1.2,
  foamContrast: 7.2,
  randomSeed: 0,
  tileRenderer: {
    resolution: 256,
    size: 100,
    tiles: 1,
  },
  plateRenderer: {
    rings: 512,
    segments: 512,
    delta: 0.1,
    steep: 6,
    offset: 0.45,
  },
  gridRenderer: {
    resolution: 512,
    aspect: 1.2,
    margin: 1.0,
  },
  quadTreeRenderer: {
    size: 1e4,
    maxTiers: 10,
    minWaterLevel: -10.0,
    maxWaterLevel: 10.0,
    tileResolution: 128,
    distanceFactor: 2.5,
    fixed: true,
    wired: false,
  },
  renderer: 'quad-tree',
};

export class Gui {
  public get onChange$() {
    return this._onChange$.asObservable().pipe(debounceTime(1));
  }

  public readonly params: GuiParams = cloneDeep(defaultParams);

  private _onChange$ = new Subject<GuiParams>();
  private readonly gui: GUI;

  constructor(container: HTMLElement) {
    this.gui = new GUI({ container });
    this.addControls(this.gui);
    this.gui.onChange(() => this._onChange$.next(this.params));
  }

  private reset() {
    this.gui.reset();
  }

  private addControls(gui: GUI) {
    const tiles = [1, 2, 3, 4, 5];
    const resolutions = [...Array(6).keys()].map((r) => 1 << (r + 5));
    const colors = ['#c74440', '#388c46', '#2d70b3'];
    const renderers = ['tile', 'plate', 'grid', 'quad-tree'];

    gui.add(this, 'reset').name('Reset');
    gui.add(this.params, 'resolution', resolutions).name('Map Resolution');
    gui
      .add(this.params, 'renderer', renderers)
      .name('Renderer')
      .onChange((e: GuiParams['renderer']) => {
        if (e === 'tile') {
          tileGroup.show();
          plateGroup.hide();
          gridGroup.hide();
          treeGroup.hide();
        } else if (e === 'plate') {
          plateGroup.show();
          tileGroup.hide();
          gridGroup.hide();
          treeGroup.hide();
        } else if (e === 'quad-tree') {
          treeGroup.show();
          plateGroup.hide();
          tileGroup.hide();
          gridGroup.hide();
        } else {
          gridGroup.show();
          plateGroup.hide();
          tileGroup.hide();
          treeGroup.hide();
        }
      });

    const tileGroup = gui.addFolder('Renderer options').hide();
    tileGroup
      .add(this.params.tileRenderer, 'resolution', resolutions)
      .name('Geometry resolution');
    tileGroup
      .add(this.params.tileRenderer, 'size', 0, 1000)
      .step(1)
      .name('Geometry size');
    tileGroup.add(this.params.tileRenderer, 'tiles', tiles).name('Tiles');

    const plateGroup = gui.addFolder('Renderer options').hide();
    plateGroup
      .add(this.params.plateRenderer, 'rings', 1, 512)
      .step(1)
      .name('Geometry rings');
    plateGroup
      .add(this.params.plateRenderer, 'segments', 0, 512)
      .step(1)
      .name('Geometry segments');
    plateGroup
      .add(this.params.plateRenderer, 'delta', 0.0, 1)
      .step(0.01)
      .name('Geometry delta');
    plateGroup
      .add(this.params.plateRenderer, 'steep', 0.0, 32)
      .name('Geometry steep');
    plateGroup
      .add(this.params.plateRenderer, 'offset', 0.0, 1.0)
      .step(0.01)
      .name('Geometry offset');

    const gridGroup = gui.addFolder('Renderer options').hide();
    gridGroup
      .add(this.params.gridRenderer, 'resolution', 1, 512)
      .step(1)
      .name('Resolution');
    gridGroup
      .add(this.params.gridRenderer, 'aspect', 1, 3)
      .step(0.1)
      .name('Aspect');
    gridGroup
      .add(this.params.gridRenderer, 'margin', 0.0, 6.0)
      .step(0.1)
      .name('NDC margin');

    const treeGroup = gui.addFolder('Renderer options').show();
    treeGroup
      .add(this.params.quadTreeRenderer, 'tileResolution', resolutions)
      .name('Geometry resolution');
    treeGroup
      .add(this.params.quadTreeRenderer, 'size', 0, 1000)
      .step(1)
      .name('Geometry size');
    treeGroup
      .add(this.params.quadTreeRenderer, 'maxTiers', 1, 8)
      .name('Max tier')
      .step(1);
    treeGroup
      .add(this.params.quadTreeRenderer, 'minWaterLevel', -100, 0)
      .name('Min water level');
    treeGroup
      .add(this.params.quadTreeRenderer, 'maxWaterLevel', 0, 100)
      .name('Max water level');
    treeGroup
      .add(this.params.quadTreeRenderer, 'distanceFactor', 1e-2, 10)
      .name('Distance factor');

    const wind = gui.addFolder('Wind');
    wind.add(this.params.wind, '0', 0, 31).step(1).name('X');
    wind.add(this.params.wind, '1', 0, 31).step(1).name('Y');
    gui.add(this.params, 'alignment', 0, 4).step(0.1).name('Alignment');
    gui
      .add(this.params, 'foamSpreading', 0, 2)
      .step(0.1)
      .name('Foam spreading');
    gui.add(this.params, 'foamContrast', 0, 8).step(0.1).name('Foam contrast');
    gui.add(this.params, 'randomSeed', 0, 1024).step(1).name('Random seed');

    let i = 0;
    for (const cascade of this.params.cascades) {
      const group = gui.addFolder(`Cascade ${i}`);
      (group.domElement.childNodes.item(0) as HTMLElement).style.color = colors[i++];

      group.add(cascade, 'size', 0, 1000.0).step(1).name('Size');
      group.add(cascade, 'croppiness', -2, 2).step(0.1).name('Croppiness');
      group.add(cascade, 'strength', 0, 10).step(0.1).name('Strength');
      group.add(cascade, 'minWave', 0, 1000).step(1).name('Min wave length');
      group.add(cascade, 'maxWave', 0, 1000).step(1).name('Max wave length');
    }
  }
}
