import {
  Gpu,
  ShaderProgram,
  Geometry,
  TransformFeedback,
} from '../../graphics';
import { OceanField } from '../ocean-field';
import { Sample, SampleGetter } from './sample';
import { vs, fs } from '../programs/sampler';

export abstract class SamplerBase<T> {
  protected readonly gpu: Gpu;
  protected readonly program: ShaderProgram;
  protected readonly getter: SampleGetter<T>;
  protected get geometry(): Geometry {
    if (!this._geometry) {
      this._geometry = this.createGeometry();
    }
    return this._geometry;
  }
  protected get transformFeedback(): TransformFeedback {
    if (!this._transformFeedback) {
      this._transformFeedback = this.createTransformFeedback();
    }
    return this._transformFeedback;
  }

  private _geometry: Geometry;
  private _transformFeedback: TransformFeedback;

  constructor(protected readonly oceanField: OceanField) {
    this.gpu = oceanField['gpu'];
    this.program = this.gpu.createShaderProgram(vs, fs, ['outSample']);
    this.getter = this.createSampleGetter();
  }

  sample(...args: unknown[]): Sample<T> {
    this.setProgram(...args);
    this.gpu.beginTransformFeedback(
      this.transformFeedback,
      WebGL2RenderingContext.POINTS
    );
    this.gpu.drawGeometry(this.geometry);
    this.gpu.endTransformFeedback();

    return new Sample(this.gpu, this.getter);
  }

  sampleAsync(...args: unknown[]): Promise<T> {
    return this.sample(...args).toPromise();
  }

  dispose(): void {
    this.gpu.destroyProgram(this.program);
    this.gpu.destroyGeometry(this._geometry);
    this.gpu.destroyTransfromFeedback(this._transformFeedback);
  }

  protected setProgram(...args: unknown[]) {
    this.gpu.setProgram(this.program);
    this.gpu.setProgramTextures(
      this.program,
      ['dx_hy_dz_dxdz0', 'dx_hy_dz_dxdz1', 'dx_hy_dz_dxdz2'],
      [
        this.oceanField.dataMaps[0],
        this.oceanField.dataMaps[2],
        this.oceanField.dataMaps[4],
      ]
    );
    for (let i = 0; i < this.oceanField.params.cascades.length; i++) {
      this.gpu.setProgramVariable(
        this.program,
        `sizes[${i}]`,
        'float',
        this.oceanField.params.cascades[i].size
      );
      this.gpu.setProgramVariable(
        this.program,
        `croppinesses[${i}]`,
        'float',
        this.oceanField.params.cascades[i].croppiness
      );
    }
  }

  protected abstract createGeometry(): Geometry;
  protected abstract createTransformFeedback(): TransformFeedback;
  protected abstract createSampleGetter(): SampleGetter<T>;
}
