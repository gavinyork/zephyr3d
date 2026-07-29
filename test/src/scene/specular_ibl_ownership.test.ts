import * as fs from 'fs';
import * as path from 'path';
import { MaterialVaryingFlags } from '../../../libs/scene/src/values';

/**
 * Indirect specular must have exactly one owner per frame.
 *
 * Materials write `specularFactor` and roughness into an MRT so SSR can resolve
 * the reflection itself, and in that case the material must not also add the
 * specular IBL or it would be counted twice. The subtlety is that the MRT out
 * parameter is declared when *either* the roughness or the scene normal flag is
 * set (see mixinPBRMetallicRoughness), while SSGI asks only for the scene
 * normal. Gating the skip on that out parameter therefore dropped specular
 * highlights in every SSGI-without-SSR frame. The gate has to test the roughness
 * flag, which SSR alone requests.
 *
 * Driving these shaders through ProgramBuilder needs the full material uniform
 * scaffolding, so this pins the decision in source instead - enough to catch a
 * revert to the `else if (outRoughness)` form that caused the defect.
 */
describe('Indirect specular ownership between SSR and SSGI', () => {
  const sources = [
    'material/mixins/pbr/common.ts',
    'material/mixins/lightmodel/pbrblueprintmixin.ts'
  ].map((rel) => ({
    rel,
    text: fs.readFileSync(path.join(__dirname, '../../../libs/scene/src', rel), 'utf8')
  }));

  test.each(sources.map((s) => [s.rel, s.text] as const))(
    '%s gates the specular IBL on the roughness flag, not on the MRT parameter',
    (_rel, text) => {
      // The specular IBL contribution is recognizable by the guard that precedes
      // its radiance lookup.
      const specularBlock = text.indexOf('&& ctx.env!.light.envLight.hasRadiance()');
      expect(specularBlock).toBeGreaterThan(0);
      const guard = text.slice(Math.max(0, specularBlock - 400), specularBlock);

      expect(guard).toContain('MaterialVaryingFlags.SCENE_STORE_ROUGHNESS');
      // `else if` here would make an SSGI-only frame skip specular entirely.
      expect(guard).not.toMatch(/\}\s*else if\s*\(\s*ctx\.env/);
    }
  );

  test('the roughness and normal flags are distinct bits', () => {
    // Treating them as interchangeable is what let SSGI suppress specular.
    expect(MaterialVaryingFlags.SCENE_STORE_ROUGHNESS & MaterialVaryingFlags.SCENE_STORE_NORMAL).toBe(0);
  });
});
