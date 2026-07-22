import { RenderGraph } from '../../../libs/scene/src/render/rendergraph';
import { RGBlackboard, FrameResources } from '../../../libs/scene/src/render/rendergraph';

// ─────────────────────────────────────────────────────────────────────────
// Validates plan A: the graph sink is the LAST version registered under
// FrameResources.PresentedColor, so a user-side module appended after the
// built-in tail can take over the final output purely from public API —
// no engine edit, no reach into internal fg.state.
//
// This models what buildForwardPlusGraphInternal now does:
//   1. built-in tail writes the backbuffer and set(PresentedColor, v1)
//   2. an optional downstream module writes a NEW backbuffer version and
//      re-registers set(PresentedColor, v2)
//   3. the graph is compiled against blackboard.get(PresentedColor)
// The core RenderGraph rejects a sink that is not the latest version of its
// physical resource (see rendergraph.ts compile()), so this test would throw
// at compile() if the sink still pointed at the tail's stale version.
// ─────────────────────────────────────────────────────────────────────────

/** Reproduces the tail: import backbuffer, a Present-like pass writes it, register PresentedColor. */
function buildTail(graph: RenderGraph, blackboard: RGBlackboard) {
  const backbuffer = graph.importTexture('backbuffer');
  const sceneColor = graph.addPass('LightPass', (builder) => {
    const c = builder.createTexture({ format: 'rgba16f' });
    builder.setExecute(() => {});
    return c;
  });
  blackboard.set(FrameResources.SceneColor, sceneColor);
  const presented = graph.addPass('Present', (builder) => {
    builder.read(sceneColor);
    const out = builder.write(backbuffer);
    builder.setExecute(() => {});
    return out;
  });
  blackboard.set(FrameResources.PresentedColor, presented);
  return { backbuffer, sceneColor };
}

/** Resolve the sink exactly as buildForwardPlusGraphInternal does. */
function sinkOf(blackboard: RGBlackboard) {
  return blackboard.expect(FrameResources.PresentedColor);
}

describe('presented-color sink takeover (plan A)', () => {
  test('without a takeover module, the sink is the tail Present version', () => {
    const graph = new RenderGraph();
    const blackboard = new RGBlackboard();
    buildTail(graph, blackboard);

    const sink = sinkOf(blackboard);
    expect(sink.name).toContain('backbuffer');
    // Compiles cleanly: the tail version is the latest backbuffer version.
    expect(() => graph.compile([sink])).not.toThrow();
  });

  test('a user module appended after the tail takes over the final output', () => {
    const graph = new RenderGraph();
    const blackboard = new RGBlackboard();
    buildTail(graph, blackboard);

    // ── user-side, public API only ──
    // A depth-visualization-style module: read a frame resource, write a new
    // backbuffer version, re-register it as the presented color.
    const depthVizWrote = graph.addPass('DepthViz', (builder) => {
      // consume the previous presented version (what was on screen)
      builder.read(blackboard.expect(FrameResources.PresentedColor));
      const out = builder.write(blackboard.expect(FrameResources.PresentedColor));
      builder.setExecute(() => {});
      return out;
    });
    blackboard.set(FrameResources.PresentedColor, depthVizWrote);

    // The sink now follows the user's registration…
    const sink = sinkOf(blackboard);
    expect(sink).toBe(depthVizWrote);

    // …and compiles: DepthViz's version is the latest, so it is NOT culled and
    // the tail Present is correctly ordered before it (read→write chain).
    const compiled = graph.compile([sink]);
    const passNames = compiled.orderedPasses.map((p) => p.name);
    expect(passNames).toContain('DepthViz');
    expect(passNames.indexOf('Present')).toBeLessThan(passNames.indexOf('DepthViz'));
  });

  test('compiling against the stale tail version after a takeover is rejected', () => {
    // Guards the failure mode plan A fixes: if the sink were still the tail's
    // version (as it was when the sink came from internal state), compile()
    // rejects it because it is no longer the latest backbuffer version.
    const graph = new RenderGraph();
    const blackboard = new RGBlackboard();
    buildTail(graph, blackboard);
    const stale = blackboard.expect(FrameResources.PresentedColor);

    const taken = graph.addPass('DepthViz', (builder) => {
      builder.read(stale);
      const out = builder.write(stale);
      builder.setExecute(() => {});
      return out;
    });
    blackboard.set(FrameResources.PresentedColor, taken);

    expect(() => graph.compile([stale])).toThrow(/latest version/i);
    expect(() => graph.compile([sinkOf(blackboard)])).not.toThrow();
  });
});
