import { DRef } from '@zephyr3d/base';
import { MemoryFS } from '@zephyr3d/base';
import {
  ConstantScalarNode,
  PBRBluePrintMaterial,
  PBRBluePrintMaterialInstance,
  ResourceManager,
  SubsurfaceProfile
} from '@zephyr3d/scene';

describe('Blueprint scalar parameter range', () => {
  test('ConstantScalarNode should clamp default value when range is enabled', () => {
    const node = new ConstantScalarNode();
    node.useRange = true;
    node.minValue = 1;
    node.maxValue = 3;
    node.x = 5;

    expect(node.x).toBe(3);

    node.x = -10;
    expect(node.x).toBe(1);
  });

  test('Blueprint material instance should preserve an explicit RectSpecularScale override', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const parent = new PBRBluePrintMaterial();
    parent.rectSpecularScale = 0;
    const instance = new PBRBluePrintMaterialInstance(parent, '/materials/parent.zmtl');

    expect(instance.rectSpecularScale).toBe(0);

    instance.rectSpecularScale = 0.35;
    instance.markMaterialPropertyOverridden('RectSpecularScale');
    const props = await manager.serializeObjectProps(instance);
    expect(props.RectSpecularScale).toBeCloseTo(0.35);

    const restored = new PBRBluePrintMaterialInstance(parent, '/materials/parent.zmtl');
    await manager.deserializeObjectProps(restored, props);
    restored.setMaterialPropertyOverrides(Object.keys(props));
    restored.syncInheritedUniforms();

    expect(restored.rectSpecularScale).toBeCloseTo(0.35);
  });

  test('Blueprint material instance should inherit latest scalar range from parent while keeping override value', () => {
    const parent = new PBRBluePrintMaterial();
    parent.uniformValues = [
      {
        name: 'u_scalar',
        type: 'float',
        value: [0.5],
        minValue: 0,
        maxValue: 1,
        inVertexShader: false,
        inFragmentShader: true,
        finalValue: 0.5
      }
    ];

    const instance = new PBRBluePrintMaterialInstance(parent, '/materials/parent.zmat');
    instance.setOverrides(
      [
        {
          name: 'u_scalar',
          type: 'float',
          value: [0.75],
          inVertexShader: false,
          inFragmentShader: true
        }
      ],
      []
    );

    expect(instance.uniformValues[0].value).toEqual([0.75]);
    expect(instance.uniformValues[0].minValue).toBe(0);
    expect(instance.uniformValues[0].maxValue).toBe(1);

    parent.uniformValues = [
      {
        name: 'u_scalar',
        type: 'float',
        value: [0.25],
        minValue: -2,
        maxValue: 2,
        inVertexShader: false,
        inFragmentShader: true,
        finalValue: 0.25
      }
    ];
    instance.syncInheritedUniforms(parent);

    expect(instance.uniformValues[0].value).toEqual([0.75]);
    expect(instance.uniformValues[0].minValue).toBe(-2);
    expect(instance.uniformValues[0].maxValue).toBe(2);
  });

  test('Blueprint material instance should migrate only compatible overrides when changing parent', () => {
    const texture = (
      name: string,
      type: string,
      path: string,
      exposed: boolean,
      inVertexShader: boolean,
      inFragmentShader: boolean,
      finalTexture: unknown = null
    ) =>
      ({
        name,
        type,
        texture: path,
        exposed,
        sRGB: true,
        wrapS: 'clamp',
        wrapT: 'clamp',
        minFilter: 'linear',
        magFilter: 'linear',
        mipFilter: 'nearest',
        inVertexShader,
        inFragmentShader,
        finalTexture: new DRef(finalTexture as any),
        finalSampler: {} as any,
        params: { clone: () => ({}) } as any
      }) as any;
    const parentA = new PBRBluePrintMaterial();
    parentA.uniformValues = [
      {
        name: 'u_shared',
        type: 'float',
        value: [0.2],
        minValue: 0,
        maxValue: 1,
        inVertexShader: false,
        inFragmentShader: true,
        finalValue: 0.2
      },
      {
        name: 'u_type_changed',
        type: 'vec3',
        value: [0, 0, 0],
        inVertexShader: false,
        inFragmentShader: true,
        finalValue: new Float32Array([0, 0, 0])
      },
      {
        name: 'u_removed',
        type: 'float',
        value: [0],
        inVertexShader: false,
        inFragmentShader: true,
        finalValue: 0
      }
    ];
    parentA.uniformTextures = [
      texture('t_shared', 'tex2D', '/old/shared.png', true, false, true),
      texture('t_type_changed', 'texCube', '/old/cube.dds', true, false, true),
      texture('t_hidden', 'tex2D', '/old/hidden.png', true, false, true)
    ];

    const sharedTexture = { id: 'shared-override' };
    const discardedTexture = { id: 'discarded-override' };
    const instance = new PBRBluePrintMaterialInstance(parentA, '/materials/parent-a.zmtl');
    const reparentable = instance as PBRBluePrintMaterialInstance & {
      getDiscardedOverridesForParent: (parent: PBRBluePrintMaterial) => {
        uniformValues: string[];
        uniformTextures: string[];
      };
      changeParentMaterial: (
        parent: PBRBluePrintMaterial,
        parentId: string
      ) => { uniformValues: string[]; uniformTextures: string[] };
    };
    instance.setOverrides(
      [
        { ...parentA.uniformValues[0], value: [0.75], finalValue: 0.75 },
        { ...parentA.uniformValues[1], value: [1, 2, 3], finalValue: new Float32Array([1, 2, 3]) },
        { ...parentA.uniformValues[2], value: [0.5], finalValue: 0.5 }
      ],
      [
        texture('t_shared', 'tex2D', '/override/shared.png', true, false, true, sharedTexture),
        texture('t_type_changed', 'texCube', '/override/cube.dds', true, false, true),
        texture('t_hidden', 'tex2D', '/override/hidden.png', true, false, true, discardedTexture)
      ]
    );

    const parentB = new PBRBluePrintMaterial();
    parentB.uniformValues = [
      {
        name: 'u_shared',
        type: 'float',
        value: [0.4],
        minValue: -2,
        maxValue: 2,
        inVertexShader: true,
        inFragmentShader: false,
        finalValue: 0.4
      },
      {
        name: 'u_type_changed',
        type: 'float',
        value: [1],
        inVertexShader: false,
        inFragmentShader: true,
        finalValue: 1
      }
    ];
    parentB.uniformTextures = [
      texture('t_shared', 'tex2D', '/new/shared.png', true, true, false),
      texture('t_type_changed', 'tex2D', '/new/texture.png', true, false, true),
      texture('t_hidden', 'tex2D', '/new/hidden.png', false, true, false)
    ];

    expect(reparentable.getDiscardedOverridesForParent(parentB)).toEqual({
      uniformValues: ['u_type_changed', 'u_removed'],
      uniformTextures: ['t_type_changed', 't_hidden']
    });
    const discarded = reparentable.changeParentMaterial(parentB, '/materials/parent-b.zmtl');

    expect(discarded).toEqual({
      uniformValues: ['u_type_changed', 'u_removed'],
      uniformTextures: ['t_type_changed', 't_hidden']
    });
    expect(instance.parentMaterial).toBe(parentB);
    expect(instance.parentMaterialId).toBe('/materials/parent-b.zmtl');
    expect(instance.uniformValues.map((v) => v.name)).toEqual(['u_shared', 'u_type_changed']);
    expect(instance.uniformValues[0].value).toEqual([0.75]);
    expect(instance.uniformValues[0].minValue).toBe(-2);
    expect(instance.uniformValues[0].maxValue).toBe(2);
    expect(instance.uniformValues[0].inVertexShader).toBe(true);
    expect(instance.getOverrideUniformValues().map((v) => v.name)).toEqual(['u_shared']);

    const migratedTexture = instance.uniformTextures.find((v) => v.name === 't_shared')!;
    expect(migratedTexture.texture).toBe('/override/shared.png');
    expect(migratedTexture.inVertexShader).toBe(true);
    expect(migratedTexture.inFragmentShader).toBe(false);
    expect(migratedTexture.finalTexture?.get()).toBe(sharedTexture);
    expect(instance.uniformTextures.find((v) => v.name === 't_hidden')!.texture).toBe('/new/hidden.png');
    expect(instance.uniformTextures.find((v) => v.name === 't_hidden')!.finalTexture?.get()).toBeNull();
    expect(instance.getOverrideUniformTextures().map((v) => v.name)).toEqual(['t_shared']);
  });

  test('Blueprint material instance should keep hydrated texture overrides after rebuilding override maps', () => {
    const parent = new PBRBluePrintMaterial();
    parent.uniformTextures = [
      {
        name: 'u_BaseColor',
        type: 'tex2D',
        texture: '/materials/base.png',
        sRGB: true,
        wrapS: 'clamp',
        wrapT: 'clamp',
        minFilter: 'linear',
        magFilter: 'linear',
        mipFilter: 'nearest',
        inVertexShader: false,
        inFragmentShader: true,
        finalTexture: new DRef(null),
        finalSampler: {} as any,
        params: { clone: () => ({}) } as any
      } as any
    ];

    const hydratedTextureRef = { id: 'hydrated-texture' } as any;
    const instance = new PBRBluePrintMaterialInstance(parent, '/materials/parent.zmat');
    instance.setOverrides([], [
      {
        name: 'u_BaseColor',
        type: 'tex2D',
        texture: '/materials/override.png',
        sRGB: true,
        wrapS: 'clamp',
        wrapT: 'clamp',
        minFilter: 'linear',
        magFilter: 'linear',
        mipFilter: 'nearest',
        inVertexShader: false,
        inFragmentShader: true,
        finalTexture: new DRef(hydratedTextureRef),
        finalSampler: { id: 'sampler' } as any,
        params: { clone: () => ({}) } as any
      } as any
    ]);

    expect(instance.uniformTextures[0].finalTexture?.get()).toBe(hydratedTextureRef);

    instance.setParentMaterial(parent, instance.parentMaterialId);
    instance.setOverrides(instance.uniformValues, instance.uniformTextures);

    expect(instance.uniformTextures[0].texture).toBe('/materials/override.png');
    expect(instance.uniformTextures[0].finalTexture?.get()).toBe(hydratedTextureRef);
    expect(instance.getOverrideUniformTextures()[0].texture).toBe('/materials/override.png');
  });

  test('Blueprint material instance should preserve hydrated inherited textures after parent sync', () => {
    const hiddenParentTexture = { id: 'hidden-parent-texture' } as any;
    const visibleParentTexture = { id: 'visible-parent-texture' } as any;
    const thicknessTexture = {
      id: 'thickness-texture',
      getDefaultSampler: () => ({ id: 'default-thickness-sampler' })
    } as any;
    const parent = new PBRBluePrintMaterial();
    parent.uniformTextures = [
      {
        name: 'u_makeup02',
        type: 'tex2D',
        texture: '/materials/makeup02.png',
        exposed: false,
        sRGB: false,
        wrapS: 'clamp',
        wrapT: 'clamp',
        minFilter: 'linear',
        magFilter: 'linear',
        mipFilter: 'nearest',
        inVertexShader: false,
        inFragmentShader: true,
        finalTexture: new DRef(hiddenParentTexture),
        finalSampler: { id: 'hidden-sampler' } as any,
        params: { clone: () => ({}) } as any
      } as any,
      {
        name: 'u_EmissiveTex',
        type: 'tex2D',
        texture: '/materials/emissive.png',
        exposed: true,
        sRGB: true,
        wrapS: 'clamp',
        wrapT: 'clamp',
        minFilter: 'linear',
        magFilter: 'linear',
        mipFilter: 'nearest',
        inVertexShader: false,
        inFragmentShader: true,
        finalTexture: new DRef(visibleParentTexture),
        finalSampler: { id: 'visible-sampler' } as any,
        params: { clone: () => ({}) } as any
      } as any
    ];

    const instance = new PBRBluePrintMaterialInstance(parent, '/materials/parent.zmat');

    expect(instance.uniformTextures[0].finalTexture?.get()).toBe(hiddenParentTexture);
    expect(instance.uniformTextures[1].finalTexture?.get()).toBe(visibleParentTexture);

    instance.thicknessTexture = thicknessTexture;
    instance.syncInheritedUniforms(parent);

    expect(instance.uniformTextures[0].finalTexture?.get()).toBe(hiddenParentTexture);
    expect(instance.uniformTextures[1].finalTexture?.get()).toBe(visibleParentTexture);
  });

  test('reloadBluePrintMaterials should refresh parent props before syncing blueprint instances', async () => {
    const vfs = new MemoryFS();
    const manager = new ResourceManager(vfs);
    const parentPath = '/materials/parent.zmtl';
    const bpPath = '/materials/parent.zbpt';
    const instancePath = '/materials/instance.zmtl';

    const parentBlueprint = {
      type: 'PBRMaterial',
      state: {
        fragment: {
          nodes: [{ id: 1, title: '', locked: true, node: { ClassName: 'PBRBlockNode', Object: {} } }],
          links: [],
          canvasOffset: [0, 0],
          canvasScale: 1
        },
        vertex: {
          nodes: [{ id: 1, title: '', locked: true, node: { ClassName: 'VertexBlockNode', Object: {} } }],
          links: [],
          canvasOffset: [0, 0],
          canvasScale: 1
        }
      }
    };
    await vfs.writeFile(bpPath, JSON.stringify(parentBlueprint, null, 2), { encoding: 'utf8', create: true });

    const parentMaterialFile: any = {
      type: 'PBRBluePrintMaterial',
      props: {
        ClearCoat: false,
        RectSpecularScale: 0,
        AttenuationColor: [1, 0.5, 0.4]
      },
      data: {
        IR: bpPath,
        uniformValues: [],
        uniformTextures: []
      }
    };
    await vfs.writeFile(parentPath, JSON.stringify(parentMaterialFile, null, 2), {
      encoding: 'utf8',
      create: true
    });

    const instanceMaterialFile: any = {
      type: 'PBRBluePrintMaterialInstance',
      props: {},
      data: {
        parent: parentPath,
        uniformValues: [],
        uniformTextures: []
      }
    };
    await vfs.writeFile(instancePath, JSON.stringify(instanceMaterialFile, null, 2), {
      encoding: 'utf8',
      create: true
    });

    const parent = await manager.fetchMaterial<PBRBluePrintMaterial>(parentPath, { overrideVFS: vfs });
    const instance = await manager.fetchMaterial<PBRBluePrintMaterialInstance>(instancePath, { overrideVFS: vfs });

    expect(parent).toBeInstanceOf(PBRBluePrintMaterial);
    expect(instance).toBeInstanceOf(PBRBluePrintMaterialInstance);
    expect(parent!.clearcoat).toBe(false);
    expect(instance!.clearcoat).toBe(false);
    expect(parent!.rectSpecularScale).toBe(0);
    expect(instance!.rectSpecularScale).toBe(0);

    parentMaterialFile.props = {
      ClearCoat: true,
      RectSpecularScale: 0.25,
      SubsurfaceProfile: {
        ClassName: 'SubsurfaceProfile',
        Object: {
          ScatterColor: [0.8, 0.6, 0.4]
        }
      }
    };
    await vfs.writeFile(parentPath, JSON.stringify(parentMaterialFile, null, 2), {
      encoding: 'utf8',
      create: true
    });

    await manager.reloadBluePrintMaterials();

    expect(parent!.clearcoat).toBe(true);
    expect(parent!.subsurfaceProfile).toBeInstanceOf(SubsurfaceProfile);
    expect(instance!.clearcoat).toBe(true);
    expect(instance!.subsurfaceProfile).toBeInstanceOf(SubsurfaceProfile);
    expect(parent!.rectSpecularScale).toBe(0.25);
    expect(instance!.rectSpecularScale).toBe(0.25);
  });
});
