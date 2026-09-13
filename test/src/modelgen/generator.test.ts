import {
  generatePrimitive,
  normalizeGeneratedModelSpec,
  type GeneratedModelSpec,
  type WorkerSuccess
} from '@zephyr3d/modelgen';

const NO_DEADLINE = Infinity;

function generate(spec: GeneratedModelSpec): WorkerSuccess {
  return generatePrimitive(spec, NO_DEADLINE);
}

function positionsOf(result: WorkerSuccess): Float32Array {
  return result.primitive.vertices.position.data;
}

function normalsOf(result: WorkerSuccess): Float32Array {
  return result.primitive.vertices.normal.data;
}

/** Every index must address an existing vertex. */
function expectIndicesInRange(result: WorkerSuccess): void {
  const indices = result.primitive.indices;
  let max = -1;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] > max) {
      max = indices[i];
    }
  }
  expect(max).toBeLessThan(result.vertexCount);
}

/** Normals must be unit length, otherwise lighting is silently wrong. */
function expectUnitNormals(result: WorkerSuccess): void {
  const normals = normalsOf(result);
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    expect(len).toBeNear(1, 1e-3);
  }
}

/** Shared sanity checks that must hold for any generated mesh. */
function expectWellFormed(result: WorkerSuccess): void {
  expect(result.type).toBe('success');
  expect(result.vertexCount).toBeGreaterThan(0);
  expect(result.indexCount).toBeGreaterThan(0);
  expect(result.indexCount % 3).toBe(0);
  expect(positionsOf(result).length).toBe(result.vertexCount * 3);
  expect(normalsOf(result).length).toBe(result.vertexCount * 3);
  expect(result.primitive.vertices.texCoord0.data.length).toBe(result.vertexCount * 2);
  expect(result.primitive.type).toBe('triangle-list');
  expectIndicesInRange(result);
  expectUnitNormals(result);
}

describe('modelgen / primitives', () => {
  it('generates a box with the requested extents', () => {
    const result = generate({ nodes: [{ type: 'box', size: [2, 4, 6] }] });
    expectWellFormed(result);
    expect(result.boxMin).toEqual([-1, -2, -3]);
    expect(result.boxMax).toEqual([1, 2, 3]);
  });

  it('applies node translation and scale to the bounds', () => {
    const result = generate({
      nodes: [{ type: 'box', size: [1, 1, 1], scale: [2, 2, 2], position: [10, 0, 0] }]
    });
    expect(result.boxMin[0]).toBeNear(9, 1e-4);
    expect(result.boxMax[0]).toBeNear(11, 1e-4);
    expect(result.boxMin[1]).toBeNear(-1, 1e-4);
  });

  it('generates a sphere whose vertices all lie on the radius', () => {
    const radius = 1.5;
    const result = generate({
      nodes: [{ type: 'sphere', radius, widthSegments: 24, heightSegments: 12 }]
    });
    expectWellFormed(result);
    const positions = positionsOf(result);
    for (let i = 0; i < positions.length; i += 3) {
      expect(Math.hypot(positions[i], positions[i + 1], positions[i + 2])).toBeNear(radius, 1e-3);
    }
  });

  it('generates a cylinder with the requested height and radius', () => {
    const result = generate({
      nodes: [{ type: 'cylinder', radius: 0.5, height: 3, segments: 32 }]
    });
    expectWellFormed(result);
    expect(result.boxMax[1] - result.boxMin[1]).toBeNear(3, 1e-3);
    expect(result.boxMax[0]).toBeNear(0.5, 1e-2);
  });

  it('honours segment counts by producing more geometry', () => {
    const coarse = generate({ nodes: [{ type: 'sphere', widthSegments: 8, heightSegments: 4 }] });
    const fine = generate({ nodes: [{ type: 'sphere', widthSegments: 64, heightSegments: 32 }] });
    expect(fine.vertexCount).toBeGreaterThan(coarse.vertexCount * 4);
  });

  it('merges multiple top-level nodes into one mesh', () => {
    const single = generate({ nodes: [{ type: 'box', size: [1, 1, 1] }] });
    const pair = generate({
      nodes: [
        { type: 'box', size: [1, 1, 1], position: [-4, 0, 0] },
        { type: 'box', size: [1, 1, 1], position: [4, 0, 0] }
      ]
    });
    expect(pair.vertexCount).toBe(single.vertexCount * 2);
    expect(pair.boxMin[0]).toBeNear(-4.5, 1e-4);
    expect(pair.boxMax[0]).toBeNear(4.5, 1e-4);
  });
});

describe('modelgen / surfaces and curves', () => {
  it('revolves a profile into a solid of revolution', () => {
    const result = generate({
      nodes: [
        {
          type: 'revolve',
          profile: [
            [0, 0],
            [0.4, 0],
            [0.3, 1],
            [0, 1]
          ],
          segments: 48,
          capBottom: true
        }
      ]
    });
    expectWellFormed(result);
    // Profile max radius is 0.4 and it spans y in [0, 1].
    expect(result.boxMax[0]).toBeNear(0.4, 1e-2);
    expect(result.boxMin[1]).toBeNear(0, 1e-3);
    expect(result.boxMax[1]).toBeNear(1, 1e-3);
  });

  it('tessellates a flat Bezier patch', () => {
    const points: [number, number, number][] = [];
    for (let v = 0; v < 4; v++) {
      for (let u = 0; u < 4; u++) {
        points.push([u / 3, 0, v / 3]);
      }
    }
    const result = generate({
      nodes: [{ type: 'surface', surfaceType: 'bezierPatch', patches: [points], segmentsU: 8, segmentsV: 8 }]
    });
    expectWellFormed(result);
    expect(result.boxMax[1] - result.boxMin[1]).toBeNear(0, 1e-4);
    expect((8 + 1) * (8 + 1)).toBe(result.vertexCount);
  });

  it('sweeps a tube along a catmull-rom curve', () => {
    const result = generate({
      nodes: [
        {
          type: 'curve',
          curveType: 'catmullRom',
          points: [
            [-1, 0, 0],
            [0, 1, 0],
            [1, 0, 0]
          ],
          shape: 'tube',
          radius: 0.1,
          radialSegments: 12,
          tubularSegments: 24
        }
      ]
    });
    expectWellFormed(result);
    expect(result.boxMin[0]).toBeLessThan(-0.9);
    expect(result.boxMax[0]).toBeGreaterThan(0.9);
  });
});

describe('modelgen / csg', () => {
  it('subtracts a cylinder from a box and stays inside the base bounds', () => {
    const result = generate({
      generation: { maxVertices: 60000 },
      nodes: [
        {
          type: 'csg',
          op: 'difference',
          base: { type: 'box', size: [2, 2, 2] },
          subtract: [{ type: 'cylinder', radius: 0.5, height: 4, segments: 24 }]
        }
      ]
    });
    expectWellFormed(result);
    // A difference can never grow past the base volume.
    expect(result.boxMin[0]).toBeGreaterThanOrEqual(-1.001);
    expect(result.boxMax[0]).toBeLessThanOrEqual(1.001);
  });

  it('unions two disjoint boxes into a mesh spanning both', () => {
    const result = generate({
      nodes: [
        {
          type: 'csg',
          op: 'union',
          children: [
            { type: 'box', size: [1, 1, 1], position: [-2, 0, 0] },
            { type: 'box', size: [1, 1, 1], position: [2, 0, 0] }
          ]
        }
      ]
    });
    expectWellFormed(result);
    expect(result.boxMin[0]).toBeNear(-2.5, 1e-3);
    expect(result.boxMax[0]).toBeNear(2.5, 1e-3);
  });
});

describe('modelgen / script nodes', () => {
  const quadScript = `
    function generate(api, input) {
      const mesh = api.mesh();
      const size = input?.size ?? 1;
      mesh.addVertex([-size, 0, -size], [0, 1, 0], [0, 0]);
      mesh.addVertex([size, 0, -size], [0, 1, 0], [1, 0]);
      mesh.addVertex([size, 0, size], [0, 1, 0], [1, 1]);
      mesh.addVertex([-size, 0, size], [0, 1, 0], [0, 1]);
      mesh.addTriangle(0, 1, 2);
      mesh.addTriangle(0, 2, 3);
      return mesh.build();
    }
  `;

  it('runs a script node and honours its input', () => {
    const result = generate({
      nodes: [{ type: 'script', script: { source: quadScript }, input: { size: 3 } }]
    });
    expectWellFormed(result);
    expect(result.vertexCount).toBe(4);
    expect(result.boxMax[0]).toBeNear(3, 1e-4);
  });

  it('is deterministic: the same seeded spec regenerates identical geometry', () => {
    const spec: GeneratedModelSpec = {
      nodes: [
        {
          type: 'script',
          script: {
            source: `
              function generate(api, input) {
                const mesh = api.mesh();
                const rng = api.rng(input.seed);
                for (let i = 0; i < 32; i++) {
                  const x = rng.range(-1, 1);
                  const z = rng.range(-1, 1);
                  const n = api.noise.fbm2(x * 4, z * 4, 3);
                  mesh.addVertex([x, n, z], [0, 1, 0], [0, 0]);
                  mesh.addVertex([x + 0.1, n, z], [0, 1, 0], [1, 0]);
                  mesh.addVertex([x, n, z + 0.1], [0, 1, 0], [0, 1]);
                  mesh.addTriangle(i * 3, i * 3 + 1, i * 3 + 2);
                }
                return mesh.build();
              }
            `
          },
          input: { seed: 12345 }
        }
      ]
    };
    const first = positionsOf(generate(spec));
    const second = positionsOf(generate(spec));
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('denies the script sandbox access to host globals', () => {
    const result = generate({
      nodes: [
        {
          type: 'script',
          script: {
            source: `
              function generate(api) {
                const mesh = api.mesh();
                const blocked = typeof fetch === 'undefined' && typeof require === 'undefined';
                const h = blocked ? 1 : 2;
                mesh.addVertex([0, 0, 0], [0, 1, 0], [0, 0]);
                mesh.addVertex([1, 0, 0], [0, 1, 0], [1, 0]);
                mesh.addVertex([0, h, 0], [0, 1, 0], [0, 1]);
                mesh.addTriangle(0, 1, 2);
                return mesh.build();
              }
            `
          }
        }
      ]
    });
    // Height 1 means both globals were shadowed inside the sandbox.
    expect(result.boxMax[1]).toBeNear(1, 1e-4);
  });
});

describe('modelgen / options and failure modes', () => {
  it('emits tangents only when asked', () => {
    const without = generate({ nodes: [{ type: 'box' }] });
    expect(without.hasTangents).toBe(false);
    expect(without.primitive.vertices.tangent).toBeUndefined();

    const withTangents = generate({
      generation: { generateTangents: true },
      nodes: [{ type: 'box' }]
    });
    expect(withTangents.hasTangents).toBe(true);
    expect(withTangents.primitive.vertices.tangent.data.length).toBe(withTangents.vertexCount * 4);
  });

  it('promotes indices to u32 past the u16 vertex limit', () => {
    const small = generate({ nodes: [{ type: 'sphere', widthSegments: 8, heightSegments: 4 }] });
    expect(small.primitive.indexType).toBe('u16');

    const large = generate({
      generation: { maxVertices: 200000 },
      nodes: [{ type: 'sphere', widthSegments: 512, heightSegments: 256 }]
    });
    expect(large.vertexCount).toBeGreaterThan(65535);
    expect(large.primitive.indexType).toBe('u32');
  });

  it('reports progress monotonically and finishes at 1', () => {
    const values: number[] = [];
    generatePrimitive(
      {
        nodes: [{ type: 'box' }, { type: 'sphere' }, { type: 'cylinder' }]
      },
      NO_DEADLINE,
      (progress) => values.push(progress)
    );
    expect(values.length).toBeGreaterThan(0);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
    expect(values[values.length - 1]).toBeNear(1, 1e-6);
  });

  it('rejects an empty or malformed spec', () => {
    expect(() => generate({ nodes: [] })).toThrow(/at least one node/);
    expect(() => generate(null as unknown as GeneratedModelSpec)).toThrow(/must be an object/);
  });

  it('enforces the vertex budget', () => {
    expect(() =>
      generate({
        generation: { maxVertices: 10 },
        nodes: [{ type: 'sphere', widthSegments: 64, heightSegments: 32 }]
      })
    ).toThrow(/exceeding maxVertices/);
  });

  it('aborts once the deadline has passed', () => {
    expect(() => generatePrimitive({ nodes: [{ type: 'sphere' }] }, Date.now() - 1000)).toThrow(/timed out/);
  });
});

describe('modelgen / spec normalization', () => {
  it('camel-cases keys and maps enum values', () => {
    const normalized = normalizeGeneratedModelSpec({
      nodes: [
        {
          type: 'surface',
          surface_type: 'bezier_patch',
          segments_u: 4,
          segments_v: 6,
          coordinate_system: 'z_up',
          coordinate_remap: 'z_up_to_y_up'
        }
      ]
    }) as Record<string, unknown>;
    const node = (normalized.nodes as Record<string, unknown>[])[0];
    expect(node.surfaceType).toBe('bezierPatch');
    expect(node.segmentsU).toBe(4);
    expect(node.segmentsV).toBe(6);
    expect(node.coordinateSystem).toBe('zUp');
    expect(node.coordinateRemap).toBe('zUpToYUp');
    expect(node.segments_u).toBeUndefined();
  });

  it('leaves an already-camelCase spec untouched', () => {
    const spec = {
      nodes: [{ type: 'curve', curveType: 'catmullRom', points: [[0, 0, 0]], radialSegments: 8 }]
    };
    expect(normalizeGeneratedModelSpec(spec)).toEqual(spec);
  });

  it('produces a spec the generator accepts', () => {
    const normalized = normalizeGeneratedModelSpec({
      nodes: [
        {
          type: 'revolve',
          profile: [
            [0, 0],
            [0.5, 0],
            [0, 1]
          ],
          segments: 16,
          cap_bottom: true
        }
      ]
    });
    expectWellFormed(generate(normalized));
  });
});
