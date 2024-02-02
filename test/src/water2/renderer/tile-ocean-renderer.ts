import { mat4, vec3 } from 'gl-matrix';
import { BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, switchMap, debounceTime } from 'rxjs/operators';
import { isEqual } from 'lodash-es';

import { Geometry, Gpu, Mesh, ShaderProgram, Camera } from '../graphics';
import { OceanField } from '../ocean';
import { ThreadWorker } from '../utils';

import vs from './programs/tile-vertex.glsl';
import fs from './programs/fragment.glsl';

// @ts-ignore:
import { createPlane } from '../graphics/mesh';

//declare const createPlane: (resolution: number) => Mesh;

export interface TileOceanRendererSettings {
  tiles: number;
  resolution: number;
  size: number;
}

const defaultSettings: Readonly<TileOceanRendererSettings> = {
  tiles: 1,
  resolution: 256,
  size: 100.0,
};

export class TileOceanRenderer {
  private readonly shader: ShaderProgram;
  private readonly worker: ThreadWorker<number, Mesh>;
  private readonly settings$ = new BehaviorSubject<TileOceanRendererSettings>({
    ...defaultSettings,
  });
  private geometry: Geometry;

  public constructor(private readonly gpu: Gpu) {
    this.shader = this.gpu.createShaderProgram(vs, fs);
    this.worker = new ThreadWorker<number, Mesh>((resolution) => {
      const cache: Map<number, Mesh> =
        self['tileOceanRendererCache'] ??
        (self['tileOceanRendererCache'] = new Map<number, Mesh>());

      if (!cache.has(resolution)) {
        cache.set(resolution, createPlane(resolution));
      }

      return cache.get(resolution);
    });

    this.settings$
      .pipe(
        debounceTime(10),
        distinctUntilChanged(isEqual),
        switchMap((e: TileOceanRendererSettings) =>
          this.worker.process(e.resolution)
        )
      )
      .subscribe((mesh: Mesh) => {
        if (this.geometry) {
          this.gpu.destroyGeometry(this.geometry);
        }
        this.geometry = this.gpu.createGeometry(mesh);
      });
  }

  public render(camera: Camera, oceanField: OceanField) {
    const settings = this.getSettings();
    this.gpu.setViewport(
      0,
      0,
      this.gpu.context.canvas.width,
      this.gpu.context.canvas.height
    );
    this.gpu.setProgram(this.shader);
    this.gpu.setProgramTextures(
      this.shader,
      [
        'dx_hy_dz_dxdz0',
        'sx_sz_dxdx_dzdz0',
        'dx_hy_dz_dxdz1',
        'sx_sz_dxdx_dzdz1',
        'dx_hy_dz_dxdz2',
        'sx_sz_dxdx_dzdz2',
      ],
      oceanField.dataMaps
    );
    for (let i = 0; i < oceanField.params.cascades.length; i++) {
      this.gpu.setProgramVariable(
        this.shader,
        `sizes[${i}]`,
        'float',
        oceanField.params.cascades[i].size
      );
      this.gpu.setProgramVariable(
        this.shader,
        `croppinesses[${i}]`,
        'float',
        oceanField.params.cascades[i].croppiness
      );
    }
    this.gpu.setProgramVariable(this.shader, 'scale', 'float', settings.size);
    this.gpu.setProgramVariable(
      this.shader,
      'foamSpreading',
      'float',
      oceanField.params.foamSpreading
    );
    this.gpu.setProgramVariable(
      this.shader,
      'foamContrast',
      'float',
      oceanField.params.foamContrast
    );
    this.gpu.setProgramVariable(this.shader, 'viewMat', 'mat4', camera.view);
    this.gpu.setProgramVariable(
      this.shader,
      'projMat',
      'mat4',
      camera.projection
    );
    this.gpu.setProgramVariable(this.shader, 'pos', 'vec3', camera.position);

    if (this.geometry) {
      const transform = mat4.create();
      for (let i = 0; i < settings.tiles; i++) {
        for (let j = 0; j < settings.tiles; j++) {
          mat4.fromTranslation(
            transform,
            vec3.fromValues(i * settings.size, 0.0, j * settings.size)
          );
          this.gpu.setProgramVariable(
            this.shader,
            'worldMat',
            'mat4',
            transform
          );
          this.gpu.drawGeometry(this.geometry);
        }
      }
    }
  }

  public getSettings(): Readonly<TileOceanRendererSettings> {
    return this.settings$.value;
  }

  public setSettings(settings: Partial<TileOceanRendererSettings>): void {
    this.settings$.next({ ...this.settings$.value, ...settings });
  }
}
