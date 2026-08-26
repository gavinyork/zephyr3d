import { MemoryFS } from '@zephyr3d/base';
import { HairNode, ResourceManager, Scene } from '@zephyr3d/scene';
import { encodeZHair } from '../../../libs/scene/src/asset/loaders/zhair/zhair_format';

/**
 * A hair node holds all of its own state and serialises like any other node, so
 * what these pin is that the state really is on the node: the asset path, the
 * decimation applied to it, and the shading controls the node surfaces on the
 * material's behalf. None of it is recoverable from anywhere else - the `.zhair`
 * file holds strands and nothing but strands - so a property that fails to
 * round-trip leaves a groom that reloads wrong with no error to say why.
 */

/** Paths the node asked the asset manager for. */
let fetchedPaths: string[] = [];
/** The bytes every fetch resolves to. */
let assetBytes: ArrayBuffer = new ArrayBuffer(0);

jest.mock('@zephyr3d/scene/app/api', () => ({
  getDevice: jest.fn(() => ({
    // Enough of a device for a strand upload and a placeholder vertex buffer.
    createBuffer: (byteLength: number) => ({
      byteLength,
      bufferSubData: () => undefined,
      dispose: () => undefined
    }),
    createVertexBuffer: (_format: string, data: Float32Array) => ({
      byteLength: data.byteLength,
      dispose: () => undefined
    }),
    frameInfo: { frameCounter: 0, elapsedFrame: 16 }
  })),
  // The node reaches for its asset through the engine, which is the only thing
  // it needs the engine for.
  getEngine: jest.fn(() => ({
    resourceManager: {
      getAssetId: () => null,
      assetManager: {
        fetchBinaryData: async (path: string) => {
          fetchedPaths.push(path);
          return assetBytes;
        }
      }
    }
  }))
}));

/** A groom whose values encode their own index, so a misread is visible. */
function buildHairAsset(strandCount: number, pointsPerStrand: number) {
  const pointCount = strandCount * pointsPerStrand;
  const positions = new Float32Array(pointCount * 3);
  const pointCounts = new Uint32Array(strandCount);
  const widths = new Float32Array(pointCount);
  for (let s = 0; s < strandCount; s++) {
    pointCounts[s] = pointsPerStrand;
    for (let i = 0; i < pointsPerStrand; i++) {
      const p = s * pointsPerStrand + i;
      positions[p * 3] = s;
      positions[p * 3 + 1] = i;
      positions[p * 3 + 2] = 0;
      widths[p] = 0.002;
    }
  }
  return encodeZHair([{ name: 'Groom', positions, pointCounts, widths }], { unitScale: 0.01 });
}

function createNode(scene: Scene) {
  const node = new HairNode(scene);
  node.parent = scene.rootNode;
  return node;
}

describe('HairNode', () => {
  beforeEach(() => {
    fetchedPaths = [];
    assetBytes = buildHairAsset(20, 4);
  });

  it('loads strands from a .zhair asset', async () => {
    const node = createNode(new Scene());
    await node.setHairAsset('/assets/groom.zhair');

    expect(fetchedPaths).toEqual(['/assets/groom.zhair']);
    expect(node.hairAsset).toBe('/assets/groom.zhair');
    expect(node.strandCount).toBe(20);
  });

  it('re-decimates without re-reading the file', async () => {
    const node = createNode(new Scene());
    await node.setHairAsset('/assets/groom.zhair');
    expect(fetchedPaths).toHaveLength(1);

    // The opened file is kept, so a stride change is synchronous and the source
    // archive is never consulted again.
    node.strandStride = 4;
    expect(node.strandCount).toBe(5);
    node.maxStrands = 3;
    expect(node.strandCount).toBeLessThanOrEqual(3);
    node.strandStride = 1;
    node.maxStrands = 0;
    expect(node.strandCount).toBe(20);
    expect(fetchedPaths).toHaveLength(1);
  });

  it('keeps its persistent id when its asset is set', async () => {
    // Regression: routing this through deserializeObjectProps defaulted every
    // property the patch omitted, wiping the id the constructor had assigned.
    // The editor resolves nodes by an id path, and an empty path resolves to the
    // scene root - so a later gizmo drag transformed the whole scene.
    const node = createNode(new Scene());
    const id = node.persistentId;
    expect(id).toBeTruthy();

    await node.setHairAsset('/assets/groom.zhair');
    expect(node.persistentId).toBe(id);
  });

  it('clears its strands when the asset is cleared', async () => {
    const node = createNode(new Scene());
    await node.setHairAsset('/assets/groom.zhair');
    expect(node.strandCount).toBe(20);

    await node.setHairAsset('');
    expect(node.strandCount).toBe(0);
    expect(node.hairAsset).toBe('');
    expect(node.computeBoundingVolume()).toBeNull();
  });

  it('survives an asset that cannot be read', async () => {
    const node = createNode(new Scene());
    assetBytes = new ArrayBuffer(8);

    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await node.setHairAsset('/assets/broken.zhair');
    errors.mockRestore();

    // A scene holding a corrupt groom still has to load; the node just draws
    // nothing.
    expect(node.strandCount).toBe(0);
    expect(node.computeBoundingVolume()).toBeNull();
  });

  it('sizes the draw range from strands and segment count', async () => {
    const node = createNode(new Scene());
    node.segmentsPerStrand = 8;
    await node.setHairAsset('/assets/groom.zhair');
    node.strandStride = 4;

    // Six vertices per ribbon segment, non-indexed.
    expect(node.getPrimitive()!.indexCount).toBe(5 * 8 * 6);
    // Changing the dial has to move the draw range with it, or the tail of the
    // groom silently stops being drawn.
    node.segmentsPerStrand = 3;
    expect(node.getPrimitive()!.indexCount).toBe(5 * 3 * 6);
  });

  it('computes a local-space bounding box padded by strand width', async () => {
    const node = createNode(new Scene());
    await node.setHairAsset('/assets/groom.zhair');

    const box = node.computeBoundingVolume()!;
    // Positions run x in [0,19] and y in [0,3], scaled by the file's 0.01 and
    // padded by the widest strand. The box is local space; the world matrix is
    // the base class's job.
    const pad = 0.002 * 0.01;
    expect(box.minPoint.x).toBeCloseTo(-pad, 6);
    expect(box.maxPoint.x).toBeCloseTo(0.19 + pad, 6);
    expect(box.maxPoint.y).toBeCloseTo(0.03 + pad, 6);
  });
});

describe('HairNode serialization', () => {
  beforeEach(() => {
    fetchedPaths = [];
    assetBytes = buildHairAsset(20, 4);
  });

  it('round-trips asset, decimation and shading through a plain node save', async () => {
    const scene = new Scene();
    const node = createNode(scene);
    node.name = 'Hair';
    await node.setHairAsset('/assets/groom.zhair');
    node.strandStride = 4;
    node.segmentsPerStrand = 12;
    node.strandRoundness = 0.4;
    node.minPixelWidth = 2.5;
    node.shadingModel = 'marschner';
    node.marschnerAbsorption = 2.5;
    node.blendMode = 'blend';
    node.castShadow = false;

    const manager = new ResourceManager(new MemoryFS());
    const serialized = (await manager.serializeObject(node)) as any;
    const props = serialized.Object ?? serialized;

    // Shading lives on the node, not on a serialized material object: the
    // material is an implementation detail and must not appear.
    expect(props.Material).toBeUndefined();
    expect(props.HairAsset).toBe('/assets/groom.zhair');
    expect(props.StrandStride).toBe(4);
    expect(props.SegmentsPerStrand).toBe(12);
    expect(props.ShadingModel).toBe('marschner');
    expect(props.BlendMode).toBe('blend');

    const restored = createNode(scene);
    await manager.deserializeObjectProps(restored, props);

    expect(restored.hairAsset).toBe('/assets/groom.zhair');
    expect(restored.strandCount).toBe(5);
    expect(restored.strandStride).toBe(4);
    expect(restored.segmentsPerStrand).toBe(12);
    expect(restored.strandRoundness).toBeCloseTo(0.4);
    expect(restored.minPixelWidth).toBeCloseTo(2.5);
    expect(restored.shadingModel).toBe('marschner');
    expect(restored.marschnerAbsorption).toBeCloseTo(2.5);
    expect(restored.blendMode).toBe('blend');
    expect(restored.castShadow).toBe(false);
  });

  it('round-trips the simulation dials', async () => {
    const scene = new Scene();
    const node = createNode(scene);
    node.localStiffness = 0.8;
    node.localIterations = 3;
    node.globalStiffness = 0.4;
    node.globalRange = 0.25;
    node.ftlDamping = 0.55;
    node.vspCoeff = 0.65;
    node.vspAccelThreshold = 120;
    node.damping = 0.3;
    node.friction = 0.6;
    node.substeps = 5;
    node.maxSpeedFactor = 6;

    const manager = new ResourceManager(new MemoryFS());
    const serialized = (await manager.serializeObject(node)) as any;
    const restored = createNode(scene);
    await manager.deserializeObjectProps(restored, serialized.Object ?? serialized);

    expect(restored.localStiffness).toBeCloseTo(0.8);
    expect(restored.localIterations).toBe(3);
    expect(restored.globalStiffness).toBeCloseTo(0.4);
    expect(restored.globalRange).toBeCloseTo(0.25);
    expect(restored.ftlDamping).toBeCloseTo(0.55);
    expect(restored.vspCoeff).toBeCloseTo(0.65);
    expect(restored.vspAccelThreshold).toBeCloseTo(120);
    expect(restored.damping).toBeCloseTo(0.3);
    expect(restored.friction).toBeCloseTo(0.6);
    expect(restored.substeps).toBe(5);
    expect(restored.maxSpeedFactor).toBeCloseTo(6);
  });
});
