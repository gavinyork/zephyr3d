import { MemoryFS } from '@zephyr3d/base';
import { OBJImporter, parseMtl, parseObj } from '../../../libs/loaders/src/obj';
import { SharedModel } from '@zephyr3d/scene';

describe('OBJ parser', () => {
  test('resolves negative indices and triangulates polygons', () => {
    const document = parseObj(`
      mtllib "materials/main.mtl"
      o Quad
      g Front
      usemtl Red
      v -1 0 0
      v 1 0 0
      v 1 1 0
      v -1 1 0
      vt 0 0
      vt 1 0
      vt 1 1
      vt 0 1
      f -4/-4 -3/-3 -2/-2 -1/-1
    `);

    expect(document.mtllibs).toEqual(['materials/main.mtl']);
    expect(document.groups).toHaveLength(1);
    expect(document.groups[0].name).toBe('Quad/Front');
    expect(document.groups[0].triangles).toHaveLength(2);
    expect(document.groups[0].triangles[0].vertices[0]).toEqual({
      position: 0,
      texCoord: 0,
      normal: -1
    });
    expect(document.groups[0].triangles[1].vertices[2]).toEqual({
      position: 3,
      texCoord: 3,
      normal: -1
    });
  });

  test('reads common MTL values and texture options', () => {
    const materials = parseMtl(`
      newmtl Painted
      Kd 0.1 0.2 0.3
      Ks 0.4 0.5 0.6
      Ns 500
      Tr 0.25
      map_Kd -s 2 3 texture.png
      bump -bm 0.35 -clamp on normal.png
    `);
    const material = materials.get('Painted')!;

    expect(material.diffuse).toEqual([0.1, 0.2, 0.3]);
    expect(material.specular).toEqual([0.4, 0.5, 0.6]);
    expect(material.shininess).toBe(500);
    expect(material.opacity).toBeCloseTo(0.75);
    expect(material.diffuseMap).toMatchObject({
      path: 'texture.png',
      scale: [2, 3, 1]
    });
    expect(material.normalMap).toMatchObject({
      path: 'normal.png',
      bumpScale: 0.35,
      clamp: true
    });
  });
});

describe('OBJImporter', () => {
  test('builds grouped primitives, generated normals and MTL materials', async () => {
    const vfs = new MemoryFS();
    await vfs.writeFile(
      '/models/materials.mtl',
      `
        newmtl Red
        Kd 1 0 0
        Ns 250
        map_Kd textures/albedo.png
        map_Ks textures/specular.png
        map_Ke textures/emissive.png
        bump textures/normal.png
        map_d textures/alpha.png
      `,
      { create: true }
    );
    const obj = `
      mtllib materials.mtl
      o Triangle
      usemtl Red
      v 0 0 0
      v 1 0 0
      v 0 1 0
      vt 0 0
      vt 1 0
      vt 0 1
      f 1/1 2/2 3/3
    `;
    const model = new SharedModel();
    await new OBJImporter().import(new Blob([obj]), model, '/models', vfs);

    expect(model.scenes).toHaveLength(1);
    expect(model.activeScene).toBe(0);
    expect(model.primitives).toHaveLength(1);
    expect(model.primitives[0].indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(model.primitives[0].vertices.position.data).toEqual(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, -1])
    );
    expect(model.primitives[0].vertices.normal.data).toEqual(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]));
    expect(model.primitives[0].vertices.texCoord0.data).toEqual(new Float32Array([0, 0, 1, 0, 0, 1]));

    const material = model.getMaterial('obj_Red_N') as any;
    expect(material.diffuse.x).toBe(1);
    expect(material.diffuse.y).toBe(0);
    expect(material.diffuse.z).toBe(0);
    expect(material.diffuseMap.image.uri).toBe('/models/textures/albedo.png');
    expect(material.diffuseMap.sRGB).toBe(true);
    expect(material.specularColorMap.image.uri).toBe('/models/textures/specular.png');
    expect(material.specularColorMap.sRGB).toBe(true);
    expect(material.common.normalMap.image.uri).toBe('/models/textures/normal.png');
    expect(material.common.normalMap.sRGB).toBe(false);
    expect(material.common.emissiveMap.image.uri).toBe('/models/textures/emissive.png');
    expect(material.common.emissiveMap.sRGB).toBe(true);
    expect(model.getImage(0)?.uri).toBe('/models/textures/albedo.png');
  });

  test('keeps Y-up coordinates when requested', async () => {
    const model = new SharedModel();
    await new OBJImporter({ upAxis: 'y' }).import(
      new Blob([
        `
          v 0 0 0
          v 1 0 0
          v 0 1 0
          f 1 2 3
        `
      ]),
      model,
      ''
    );

    expect(model.primitives[0].vertices.position.data).toEqual(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    );
    expect(model.primitives[0].vertices.normal.data).toEqual(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  });

  test('supports OBJ files without an external VFS', async () => {
    const model = new SharedModel();
    await new OBJImporter().import(
      new Blob([
        `
          v 0 0 0
          v 1 0 0
          v 0 1 0
          f 1 2 3
        `
      ]),
      model,
      ''
    );

    expect(model.primitives).toHaveLength(1);
    expect(model.primitives[0].vertices).not.toHaveProperty('texCoord0');
  });
});
