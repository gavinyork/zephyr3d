import { DRef } from '@zephyr3d/base';
import { ConstantScalarNode, PBRBluePrintMaterial, PBRBluePrintMaterialInstance } from '@zephyr3d/scene';

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
});
