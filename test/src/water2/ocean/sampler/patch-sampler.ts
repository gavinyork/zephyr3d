import { vec2, vec3 } from 'gl-matrix';

import { Geometry, TransformFeedback, Mesh } from '../../graphics';
import { OceanField } from '../ocean-field';
import { Sample, SampleGetter } from './sample';
import { SamplerBase } from './sampler.base';

export class PatchSampler extends SamplerBase<vec3[]> {
  private readonly readBuffer: Float32Array;
  private origin = vec2.create();
  private size: number = 1;

  constructor(
    oceanField: OceanField,
    private readonly patchResolution: number = 4
  ) {
    super(oceanField);
    this.readBuffer = new Float32Array(3 * this.patchResolution ** 2);
  }

  sample(origin: vec2, size: number = 10): Sample<vec3[]> {
    vec2.copy(this.origin, origin);
    this.size = size;
    return super.sample(origin, size);
  }

  sampleAsync(origin: vec2, size: number = 10): Promise<vec3[]> {
    return this.sample(origin, size).toPromise();
  }

  protected createGeometry(): Geometry {
    return this.gpu.createGeometry(
      this.createPatchMesh(this.patchResolution, 1.0),
      WebGL2RenderingContext.POINTS
    );
  }

  protected createTransformFeedback(): TransformFeedback {
    return this.gpu.createTransformFeedback(12 * this.patchResolution ** 2);
  }

  protected setProgram() {
    super.setProgram();
    this.gpu.setProgramVariable(this.program, 'origin', 'vec2', this.origin);
    this.gpu.setProgramVariable(this.program, 'size', 'float', this.size);
  }

  protected createSampleGetter(): SampleGetter<vec3[]> {
    return () => {
      this.gpu.readTransformFeedback(this.transformFeedback, [this.readBuffer]);
      const patch: vec3[] = [];
      for (let i = 0; i < this.patchResolution ** 2; i++) {
        const point = vec3.fromValues(
          this.readBuffer[i * 3],
          this.readBuffer[i * 3 + 1],
          this.readBuffer[i * 3 + 2]
        );
        patch.push(point);
      }
      return patch;
    };
  }

  private createPatchMesh(resolution: number, size: number): Mesh {
    const vertices: vec2[] = [];
    const delta = size / (resolution - 1);
    const offset = vec2.fromValues(-size * 0.5, -size * 0.5);

    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const vertex = vec2.fromValues(j * delta, i * delta);
        vec2.add(vertex, vertex, offset);
        vertices.push(vertex);
      }
    }

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
      vertexData: Float32Array.from(vertices.map((v) => [...v]).flat()),
    };
  }
}
