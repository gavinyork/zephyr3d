/**
 * Water tools of the editor MCP bridge: the interaction field of a Water node.
 */
import type { SceneNode, Water } from '@zephyr3d/scene';
import { WaterInteraction } from '@zephyr3d/scene';
import type { SceneController } from '../controllers/scenecontroller';

/** Fields of a WaterInteraction the tool may set, by name. */
const SETTABLE = [
  'resolution',
  'windowSize',
  'waveSpeed',
  'damping',
  'maxAmplitude',
  'foamAmount',
  'foamDecay',
  'foamMinSpeed',
  'foamMaxSpeed',
  'breakingAcceleration',
  'foamDiffusion',
  'spongeWidth',
  'shallowDepth',
  'shoreAbsorbDepth'
] as const;

function describe(interaction: WaterInteraction | null) {
  if (!interaction) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const key of SETTABLE) {
    out[key] = interaction[key];
  }
  out.followMode = interaction.followMode;
  out.origin = [interaction.originX, interaction.originZ];
  return out;
}

/**
 * Attaches, configures or detaches the interaction field of a Water node, and
 * fires impulses into it: `enabled` true creates one when missing, false
 * removes it; `properties` sets fields by name; `impulses` are [x, z, radius,
 * strength] in world units, strength a height in metres.
 */
export async function editWaterInteraction(controller: SceneController | null, params: any) {
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { interaction: null, err: 'No scene is currently opened' };
  }
  const node = scene.findNodeById<SceneNode>(String(params.node_id ?? ''));
  if (!node || !node.isWater()) {
    return { interaction: null, err: `Not a Water node: ${params.node_id}` };
  }
  const water = node as Water;
  if (params.enabled === false) {
    water.interaction = null;
    return { interaction: null, err: null };
  }
  let interaction = water.interaction;
  if (!interaction && params.enabled === true) {
    interaction = new WaterInteraction();
    water.interaction = interaction;
  }
  if (!interaction) {
    return { interaction: null, err: 'The water has no interaction field; pass enabled: true to add one' };
  }
  const props = params.properties && typeof params.properties === 'object' ? params.properties : {};
  for (const [key, value] of Object.entries(props)) {
    if (!(SETTABLE as readonly string[]).includes(key)) {
      return { interaction: describe(interaction), err: `Unknown or read-only field: ${key}` };
    }
    (interaction as any)[key] = Number(value);
  }
  const impulses: unknown[] = Array.isArray(params.impulses) ? params.impulses : [];
  for (const imp of impulses) {
    const [x, z, radius, strength] = (imp as number[]).map(Number);
    interaction.addImpulse(x, z, radius, strength);
  }
  // A row of the field along x at a world z, decimated to `count` samples
  let row = null;
  if (params.read_row && typeof params.read_row === 'object') {
    const r = await interaction.readRow(Number(params.read_row.z ?? 0));
    if (r) {
      const count = Math.max(2, Math.min(r.heights.length, Math.floor(Number(params.read_row.count ?? 64))));
      const stride = r.heights.length / count;
      const xs: number[] = [];
      const hs: number[] = [];
      for (let i = 0; i < count; i++) {
        // Peak magnitude within each stride, so a thin crest is not skipped
        let best = 0;
        let bi = Math.floor(i * stride);
        for (let j = Math.floor(i * stride); j < Math.floor((i + 1) * stride); j++) {
          if (Math.abs(r.heights[j]) > Math.abs(best)) {
            best = r.heights[j];
            bi = j;
          }
        }
        xs.push(Math.round((r.x0 + bi * r.texel) * 100) / 100);
        hs.push(Math.round(best * 10000) / 10000);
      }
      row = { z: r.z, x: xs, h: hs };
    }
  }
  return { interaction: describe(interaction), row, err: null };
}
