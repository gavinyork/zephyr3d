import { vec2, vec3 } from 'gl-matrix';

import { Geometry, TransformFeedback, Mesh } from '../../graphics';
import { OceanField } from '../ocean-field';
import { Sample, SampleGetter } from './sample';
import { SamplerBase } from './sampler.base';

export class PointsSampler extends SamplerBase<vec3[]> {
  private readonly writeBuffer: Float32Array;
  private readonly readBuffer: Float32Array;

  constructor(
    oceanField: OceanField,
    private readonly pointsNumber: number = 1
  ) {
    super(oceanField);
    this.writeBuffer = new Float32Array(pointsNumber * 2);
    this.readBuffer = new Float32Array(pointsNumber * 3);
  }

  sample(...points: vec2[]): Sample<vec3[]> {
    this.writeBuffer.set(points.map((e) => [...e]).flat());
    this.gpu.updateGeometry(this.geometry, this.writeBuffer);
    return super.sample(...points);
  }

  sampleAsync(...points: vec2[]): Promise<vec3[]> {
    return this.sample(...points).toPromise();
  }

  protected createGeometry(): Geometry {
    return this.gpu.createGeometry(
      this.createPointsMesh(this.pointsNumber),
      WebGL2RenderingContext.POINTS
    );
  }

  protected createTransformFeedback(): TransformFeedback {
    return this.gpu.createTransformFeedback(this.pointsNumber * 12);
  }

  protected setProgram() {
    super.setProgram();
    this.gpu.setProgramVariable(this.program, 'origin', 'vec2', vec2.create());
    this.gpu.setProgramVariable(this.program, 'size', 'float', 1.0);
  }

  protected createSampleGetter(): SampleGetter<vec3[]> {
    return () => {
      this.gpu.readTransformFeedback(this.transformFeedback, [this.readBuffer]);
      const points: vec3[] = [];
      for (let i = 0; i < this.pointsNumber; i++) {
        const point = vec3.fromValues(
          this.readBuffer[i * 3],
          this.readBuffer[i * 3 + 1],
          this.readBuffer[i * 3 + 2]
        );
        points.push(point);
      }
      return points;
    };
  }

  private createPointsMesh(points: number): Mesh {
    return {
      vertexFormat: [
        {
          semantics: 'position',
          size: 2,
          type: WebGL2RenderingContext.FLOAT,
          slot: 0,
          offset: 0,
          stride: 8,
        },
      ],
      vertexData: new Float32Array(points * 2),
    };
  }
}
