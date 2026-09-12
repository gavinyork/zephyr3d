import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrimitive, type GeneratedModelSpec } from '@zephyr3d/modelgen';
import { generateBuilding } from '@zephyr3d/procgen';

/**
 * Dumps generated buildings as .obj files so they can be eyeballed in any viewer.
 *
 * Skipped by default — this writes outside the repo and exists for iterating on a
 * ruleset's proportions, which is a judgement no assertion can make. Run it with:
 *
 * ```
 * PROCGEN_PREVIEW=<output directory> npx jest src/procgen/preview
 * ```
 */
const outputDir = process.env.PROCGEN_PREVIEW;

function toObj(spec: GeneratedModelSpec, name: string): string {
  const result = generatePrimitive(spec, Infinity);
  const positions = result.primitive.vertices.position.data;
  const normals = result.primitive.vertices.normal.data;
  const uvs = result.primitive.vertices.texCoord0.data;
  const indices = result.primitive.indices;

  const lines: string[] = [`# ${name}`, `# ${result.vertexCount} vertices, ${result.indexCount / 3} triangles`];
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${positions[i].toFixed(5)} ${positions[i + 1].toFixed(5)} ${positions[i + 2].toFixed(5)}`);
  }
  for (let i = 0; i < uvs.length; i += 2) {
    lines.push(`vt ${uvs[i].toFixed(5)} ${uvs[i + 1].toFixed(5)}`);
  }
  for (let i = 0; i < normals.length; i += 3) {
    lines.push(`vn ${normals[i].toFixed(5)} ${normals[i + 1].toFixed(5)} ${normals[i + 2].toFixed(5)}`);
  }
  for (let i = 0; i < indices.length; i += 3) {
    // OBJ indices are 1-based.
    const a = indices[i] + 1;
    const b = indices[i + 1] + 1;
    const c = indices[i + 2] + 1;
    lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
  }
  return lines.join('\n');
}

const maybeIt = outputDir ? it : it.skip;

describe('procgen / preview export', () => {
  maybeIt('writes a spread of buildings as .obj', () => {
    const dir = outputDir!;
    mkdirSync(dir, { recursive: true });

    const cases: { name: string; spec: GeneratedModelSpec }[] = [
      { name: 'tower-seed0', spec: generateBuilding({ seed: 0, footprint: [24, 18] }) },
      { name: 'tower-seed1', spec: generateBuilding({ seed: 1, footprint: [24, 18] }) },
      { name: 'tower-seed2', spec: generateBuilding({ seed: 2, footprint: [24, 18] }) },
      { name: 'tower-seed3', spec: generateBuilding({ seed: 3, footprint: [24, 18] }) },
      {
        name: 'slab-wide',
        spec: generateBuilding({ seed: 4, footprint: [46, 20], params: { floors: 8 } })
      },
      {
        name: 'highrise',
        spec: generateBuilding({ seed: 5, footprint: [26, 26], params: { floors: 30 } })
      },
      {
        name: 'lowrise',
        spec: generateBuilding({ seed: 6, footprint: [18, 14], params: { floors: 4 } })
      }
    ];

    for (const { name, spec } of cases) {
      writeFileSync(join(dir, `${name}.obj`), toObj(spec, name), 'utf8');
    }

    // A row of buildings, to judge how they read together.
    const blockNodes = [];
    let x = 0;
    for (let i = 0; i < 6; i++) {
      const width = 14 + (i % 3) * 6;
      const spec = generateBuilding({
        seed: 100 + i,
        footprint: [width, 18],
        origin: [x, 0, 0],
        params: { floors: 6 + i * 4 }
      });
      blockNodes.push(...(spec.nodes ?? []));
      x += width + 6;
    }
    writeFileSync(
      join(dir, 'block.obj'),
      toObj({ version: 1, nodes: blockNodes, generation: { maxVertices: 400000 } }, 'block'),
      'utf8'
    );
  });
});
