import {
  rewriteJsonPathValues,
  rewritePathString,
  type PathRewriteRule
} from '../../../utility/editor/src/helpers/assetreference';

describe('asset reference path rewriting', () => {
  test('rewrites direct asset references', () => {
    const rules: PathRewriteRule[] = [
      {
        oldPath: '/assets/avatar/body.glb',
        newPath: '/assets/avatar/body-source.glb',
        isDirectory: false
      }
    ];
    const prefab = {
      Primitive: '/assets/avatar/body.zmsh',
      PrefabId: '/assets/avatar/body.glb'
    };

    expect(rewriteJsonPathValues(prefab, rules)).toBe(true);
    expect(prefab.PrefabId).toBe('/assets/avatar/body-source.glb');
    expect(prefab.Primitive).toBe('/assets/avatar/body.zmsh');
  });

  test('rewrites source references stored as nested JSON strings', () => {
    const rules: PathRewriteRule[] = [
      {
        oldPath: '/assets/avatar/body.glb',
        newPath: '/assets/avatar/body-source.glb',
        isDirectory: false
      }
    ];
    const prefab = {
      MorphSource: JSON.stringify({
        sourcePath: '/assets/avatar/body.glb',
        nodePath: 'Avatar/Body',
        subMeshName: 'BodyMesh'
      })
    };

    expect(rewriteJsonPathValues(prefab, rules)).toBe(true);
    expect(JSON.parse(prefab.MorphSource)).toEqual({
      sourcePath: '/assets/avatar/body-source.glb',
      nodePath: 'Avatar/Body',
      subMeshName: 'BodyMesh'
    });
  });

  test('rewrites nested source references when their directory moves', () => {
    const rules: PathRewriteRule[] = [
      {
        oldPath: '/assets/avatar',
        newPath: '/assets/characters/avatar',
        isDirectory: true
      }
    ];
    const prefab = {
      MorphSource: JSON.stringify({
        sourcePath: '/assets/avatar/body.glb',
        nodePath: 'Avatar/Body',
        subMeshName: 'BodyMesh'
      })
    };

    expect(rewriteJsonPathValues(prefab, rules)).toBe(true);
    expect(JSON.parse(prefab.MorphSource).sourcePath).toBe('/assets/characters/avatar/body.glb');
  });

  test('does not rewrite paths that only share a filename prefix', () => {
    const rules: PathRewriteRule[] = [
      {
        oldPath: '/assets/avatar/body.glb',
        newPath: '/assets/avatar/body-source.glb',
        isDirectory: false
      }
    ];

    expect(rewritePathString('/assets/avatar/body.glb.backup', rules)).toBe('/assets/avatar/body.glb.backup');
  });
});
