import { MemoryFS } from '@zephyr3d/base';
import {
  GPUClothComponent,
  GPUClothSystem,
  ResourceManager,
  Scene,
  SceneNode,
  type GPUClothComponentConfig
} from '@zephyr3d/scene';

const CONFIG: GPUClothComponentConfig = {
  version: 1,
  sourceId: 'cloth:test',
  enabled: true,
  simulationMeshId: 'simulation-mesh',
  gravity: [1, -4.5, 2],
  damping: 0.12,
  dynamicFriction: 0.21,
  staticFriction: 0.43,
  stiffness: 0.67,
  poseFollow: 0.18,
  substeps: 3,
  solverIterations: 7,
  maxNeighbors: 12,
  maxTrianglesPerVertex: 24,
  workgroupSize: 128,
  rebuildNormals: false,
  pinnedVertexWeights: '0:0, 3:0.5',
  wrapTargets: [
    {
      meshId: 'render-mesh',
      targetWrapWeights: '0:0, 1:0.5',
      bindingData: {
        version: 4,
        vertexCount: 2,
        sourceVertexCount: 4,
        influenceCount: 3,
        maxOffsetDistance: 0.25,
        sourceTriangleIndices: 'AAAA',
        sourceBarycentrics: 'BBBB',
        targetLocalOffsets: 'CCCC'
      }
    }
  ],
  colliders: [
    {
      type: 'capsule',
      enabled: false,
      nodeId: 'collider-node',
      offset: [0.1, 0.2, 0.3],
      endOffset: [0.4, 0.5, 0.6],
      radius: 0.15,
      normal: [0, 1, 0],
      size: [0.5, 0.6, 0.7]
    }
  ]
};

describe('GPUClothComponent serialization', () => {
  it('round-trips persistent configuration through SceneNode serialization', async () => {
    const scene = new Scene();
    const host = new SceneNode(scene);
    host.name = 'cloth-host';
    host.addGPUClothComponent(new GPUClothComponent(CONFIG));

    const manager = new ResourceManager(new MemoryFS());
    const serialized = await manager.serializeObject(host);
    const container = new SceneNode(scene);
    container.remove();
    const restored = (await manager.deserializeObject<SceneNode>(container, serialized))!;

    expect(restored.gpuClothComponents).toHaveLength(1);
    const component = restored.gpuClothComponents[0];
    expect(component).toBeInstanceOf(GPUClothComponent);
    expect(component.host).toBe(restored);
    expect(component.config).toEqual(CONFIG);

    scene.dispose();
  });

  it('owns and disposes components removed from the host', () => {
    const scene = new Scene();
    const host = new SceneNode(scene);
    const component = host.addGPUClothComponent(new GPUClothComponent());

    expect(component.host).toBe(host);
    expect(host.removeGPUClothComponent(component)).toBe(true);
    expect(component.disposed).toBe(true);
    expect(component.host).toBeNull();
    expect(host.gpuClothComponents).toHaveLength(0);

    scene.dispose();
  });

  it('rejects components owned by another host without changing either host', () => {
    const scene = new Scene();
    const firstHost = new SceneNode(scene);
    const secondHost = new SceneNode(scene);
    const component = firstHost.addGPUClothComponent(new GPUClothComponent());

    expect(() => secondHost.addGPUClothComponent(component)).toThrow(
      'GPU cloth component belongs to another scene node.'
    );
    expect(firstHost.gpuClothComponents).toEqual([component]);
    expect(secondHost.gpuClothComponents).toHaveLength(0);
    expect(component.host).toBe(firstHost);

    scene.dispose();
  });

  it('disposes a system whose asynchronous creation finishes after removal', async () => {
    const scene = new Scene();
    const host = new SceneNode(scene);
    const simulationMesh = new SceneNode(scene) as any;
    simulationMesh.parent = host;
    simulationMesh.isMesh = () => true;
    simulationMesh.primitive = { getNumVertices: () => 3 };

    let finishCreate!: (system: GPUClothSystem) => void;
    const createResult = new Promise<GPUClothSystem>((resolve) => {
      finishCreate = resolve;
    });
    const system = {
      disabledReason: null,
      dispose: jest.fn(),
      setWrapTargetsFromBindingData: jest.fn()
    } as unknown as GPUClothSystem;
    const createSpy = jest.spyOn(GPUClothSystem, 'createFromMesh').mockReturnValue(createResult);
    const component = host.addGPUClothComponent(
      new GPUClothComponent({
        ...CONFIG,
        simulationMeshId: simulationMesh.persistentId,
        wrapTargets: [],
        colliders: []
      })
    );
    const pendingRebuild = component.rebuild();

    expect(host.removeGPUClothComponent(component)).toBe(true);
    finishCreate(system);
    await pendingRebuild;

    expect(system.dispose).toHaveBeenCalledTimes(1);
    expect(component.system).toBeNull();
    createSpy.mockRestore();
    scene.dispose();
  });

  it('expands sparse target wrap weights with wrapped vertices as the default', async () => {
    const scene = new Scene();
    const host = new SceneNode(scene);
    const simulationMesh = new SceneNode(scene) as any;
    simulationMesh.parent = host;
    simulationMesh.isMesh = () => true;
    simulationMesh.primitive = { getNumVertices: () => 4 };
    const targetMesh = new SceneNode(scene) as any;
    targetMesh.parent = host;
    targetMesh.isMesh = () => true;
    targetMesh.primitive = { getNumVertices: () => 3 };

    const system = {
      disabledReason: null,
      dispose: jest.fn(),
      setWrapTargetsFromBindingData: jest.fn().mockResolvedValue(undefined)
    } as unknown as GPUClothSystem;
    const createSpy = jest.spyOn(GPUClothSystem, 'createFromMesh').mockResolvedValue(system);
    const component = host.addGPUClothComponent(
      new GPUClothComponent({
        ...CONFIG,
        simulationMeshId: simulationMesh.persistentId,
        wrapTargets: [
          {
            ...CONFIG.wrapTargets[0],
            meshId: targetMesh.persistentId,
            targetWrapWeights: '0:0, 1:0.5'
          }
        ],
        colliders: []
      })
    );

    await component.rebuild();

    const targets = (system.setWrapTargetsFromBindingData as jest.Mock).mock.calls[0][0];
    expect(targets[0].target).toBe(targetMesh);
    expect([...targets[0].targetWrapWeights]).toEqual([0, 0.5, 1]);

    host.removeGPUClothComponent(component);
    createSpy.mockRestore();
    scene.dispose();
  });
});
