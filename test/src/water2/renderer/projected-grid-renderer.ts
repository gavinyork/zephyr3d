import { mat4, vec3 } from 'gl-matrix';
import { BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, switchMap, debounceTime } from 'rxjs/operators';
import { isEqual } from 'lodash-es';

import { Geometry, Gpu, Mesh, ShaderProgram, Camera } from '../graphics';
import { OceanField } from '../ocean';
import { ThreadWorker } from '../utils';

import vs from './programs/grid-vertex.glsl';
import fs from './programs/fragment.glsl';

// @ts-ignore:
import { createNDCGrid } from '../graphics/mesh';

//declare const createNDCGrid: (...args: number[]) => Mesh;

export interface ProjectedGridRendererSettings {
  resolution: number;
  aspect: number;
  margin: number;
}

const defaultSettings: Readonly<ProjectedGridRendererSettings> = {
  resolution: 512,
  aspect: 1.2,
  margin: 1.0,
};

type ThreadWorkerInput = ProjectedGridRendererSettings;

export class ProjectedGridRenderer {
  private readonly shader: ShaderProgram;
  private readonly worker: ThreadWorker<ThreadWorkerInput, Mesh>;
  private readonly settings$ =
    new BehaviorSubject<ProjectedGridRendererSettings>({ ...defaultSettings });
  private geometry: Geometry;

  public constructor(private readonly gpu: Gpu) {
    this.shader = this.gpu.createShaderProgram(vs, fs);
    this.worker = new ThreadWorker<ThreadWorkerInput, Mesh>((input) =>
      createNDCGrid(
        input.resolution,
        input.resolution / input.aspect,
        input.margin,
        input.margin / input.aspect
      )
    );

    this.settings$
      .pipe(
        debounceTime(10),
        distinctUntilChanged(isEqual),
        switchMap((e) => this.worker.process(e))
      )
      .subscribe((mesh: Mesh) => {
        if (this.geometry) {
          this.gpu.destroyGeometry(this.geometry);
        }
        this.geometry = this.gpu.createGeometry(mesh);
      });
  }

  public render(camera: Camera, oceanField: OceanField) {
    this.gpu.setViewport(
      0,
      0,
      this.gpu.context.canvas.width,
      this.gpu.context.canvas.height
    );

    const transform = mat4.create();
    mat4.copy(transform, camera.transform);
    transform[12] = transform[13] = transform[14] = 0.0;

    const invProjView = mat4.create();
    mat4.invert(invProjView, camera.projection);
    mat4.multiply(invProjView, transform, invProjView);

    this.gpu.setProgram(this.shader);
    this.gpu.setProgramVariable(
      this.shader,
      'invProjView',
      'mat4',
      invProjView
    );
    this.gpu.setProgramVariable(this.shader, 'viewMat', 'mat4', camera.view);
    this.gpu.setProgramVariable(
      this.shader,
      'projMat',
      'mat4',
      camera.projection
    );
    this.gpu.setProgramVariable(this.shader, 'pos', 'vec3', camera.position);
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

    if (this.geometry) {
      this.gpu.drawGeometry(this.geometry);
    }
  }

  public getSettings(): Readonly<ProjectedGridRendererSettings> {
    return this.settings$.value;
  }

  public setSettings(settings: Partial<ProjectedGridRendererSettings>): void {
    this.settings$.next({ ...this.settings$.value, ...settings });
  }
}
