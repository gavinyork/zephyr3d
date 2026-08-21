/**
 * Assembles tessellated strand ribbons into a {@link SharedModel}.
 *
 * @remarks
 * Every curve importer ends the same way: tessellate each strand set, hang the
 * resulting primitives off one root node, and register a scene. Only the parsing
 * in front of it differs, so this step lives once rather than once per container.
 */
import { AssetHierarchyNode, AssetScene, type SharedModel, type AssetSubMeshData } from '@zephyr3d/scene';
import type { ResolvedStrandRibbonOptions } from './strandribbon';
import { tessellateStrandRibbons } from './strandribbon';
import type { StrandCurveSet } from './types';

/**
 * Tessellates strand sets and fills a model with the result.
 *
 * @remarks
 * Strand sets that lose every strand to filtering are skipped rather than
 * emitted as empty nodes, so an aggressive `strandStride` thins the model out
 * instead of leaving degenerate primitives behind.
 *
 * @param curves - Decoded strand sets, one node each.
 * @param model - Model to fill; its active scene is set on return.
 * @param opt - Resolved tessellation options.
 * @public
 */
export function buildStrandModel(
  curves: StrandCurveSet[],
  model: SharedModel,
  opt: ResolvedStrandRibbonOptions
) {
  const root = new AssetHierarchyNode(opt.nodeName, model);
  for (const [index, curve] of curves.entries()) {
    const primitive = tessellateStrandRibbons(curve, opt);
    if (!primitive) {
      continue;
    }
    const name = curve.name || `Curves${index}`;
    const node = new AssetHierarchyNode(name, model, root);
    const subMesh: AssetSubMeshData = {
      primitive,
      material: null,
      rawPositions: null,
      rawBlendIndices: null,
      rawJointWeights: null,
      name,
      numTargets: 0
    };
    node.mesh = { subMeshes: [subMesh] };
    model.addPrimitive(primitive);
  }
  const scene = new AssetScene(opt.nodeName);
  scene.rootNodes.push(root);
  model.scenes.push(scene);
  model.activeScene = 0;
}
