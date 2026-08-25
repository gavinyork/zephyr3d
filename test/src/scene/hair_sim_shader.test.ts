import { ProgramBuilder } from '../../../libs/device/src';
import { createHairSimulationProgram } from '../../../libs/scene/src/animation/hair/gpu_hair_simulation';

/**
 * Generates the WGSL of the hair solver and pins how node motion is injected.
 *
 * The solver works in local space and brings the node's frame-to-frame motion
 * in through `relativeTransform`. Both the current and the previous stored
 * position must go through that matrix: the translation then cancels in the
 * velocity term and the strand keeps its world position, to be dragged along by
 * the pinned root. Transforming only one of the two turns the node's own motion
 * into strand velocity, which integrates frame over frame - a small drag winds
 * the velocity up until the strands stream out to full extension.
 */
function generateSolverSource(): string {
  let source = '';
  const device: any = {
    type: 'webgpu',
    getDeviceCaps() {
      return { shaderCaps: { supportShaderF16: false } };
    },
    buildComputeProgram(options: any) {
      const builder = new ProgramBuilder(device);
      const result = builder.buildCompute(options);
      if (!result) {
        throw new Error(builder.lastError ?? 'hair solver shader generation failed');
      }
      source = result[0];
      return { bindGroupLayouts: result[1], name: '' };
    }
  };
  createHairSimulationProgram(device, 64);
  return source;
}

describe('GPU hair solver shader', () => {
  const source = generateSolverSource();

  test('transforms both stored positions by the node motion', () => {
    const currentTransform = source.match(
      /current = \((\w+)\.relativeTransform \* vec4<f32>\(current,1\.0\)\)\.xyz;/
    );
    const previousTransform = source.match(
      /previous = \((\w+)\.relativeTransform \* vec4<f32>\(previous,1\.0\)\)\.xyz;/
    );
    expect(currentTransform).not.toBeNull();
    expect(previousTransform).not.toBeNull();
  });

  test('integrates velocity from the transformed positions', () => {
    const transformIndex = source.indexOf('.relativeTransform * vec4<f32>(current,1.0)');
    const velocityIndex = source.indexOf('(current - previous)');
    expect(transformIndex).toBeGreaterThan(-1);
    expect(velocityIndex).toBeGreaterThan(transformIndex);
  });

  test('stores the transformed position as the verlet history', () => {
    // prevPoints must receive the re-expressed current position; writing the
    // untransformed one would mix coordinate frames across the frame boundary.
    const transformIndex = source.indexOf('.relativeTransform * vec4<f32>(current,1.0)');
    const historyWrite = source.match(/\.prevPoints\[\w+\] = current\.x;/);
    expect(historyWrite).not.toBeNull();
    expect(source.indexOf(historyWrite![0])).toBeGreaterThan(transformIndex);
  });
});
