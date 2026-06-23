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
});
