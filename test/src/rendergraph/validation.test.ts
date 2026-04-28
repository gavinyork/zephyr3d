import type { RGHandle } from '../../../libs/scene/src/render/rendergraph';
import { RenderGraph } from '../../../libs/scene/src/render/rendergraph';

describe('RenderGraph validation improvements', () => {
  let graph: RenderGraph;

  beforeEach(() => {
    graph = new RenderGraph();
  });

  describe('transient resource validation', () => {
    test('reading transient resource without producer throws', () => {
      // Manually create a transient resource without a producer (simulating edge case)
      const backbuffer = graph.importTexture('backbuffer');
      let orphanHandle: RGHandle;

      graph.addPass('CreateOrphan', (builder) => {
        orphanHandle = builder.createTexture({ format: 'r32f', label: 'orphan' });
        builder.setExecute(() => {});
      });

      // Manually clear the producer to simulate the edge case
      const orphanRes = graph.getResource(orphanHandle!);
      if (orphanRes) {
        orphanRes.producer = null;
      }

      expect(() => {
        graph.addPass('ReadOrphan', (builder) => {
          builder.read(orphanHandle!);
          builder.write(backbuffer);
        });
      }).toThrow(/has no producer/);
    });
  });

  describe('circular dependency detection', () => {
    test('circular dependency reports involved passes', () => {
      const backbuffer = graph.importTexture('backbuffer');

      // Create a circular dependency by having passes depend on each other's outputs
      let texA: RGHandle;
      let texB: RGHandle;

      graph.addPass('PassA', (builder) => {
        texA = builder.createTexture({ format: 'r32f', label: 'texA' });
        builder.setExecute(() => {});
      });

      graph.addPass('PassB', (builder) => {
        builder.read(texA!);
        texB = builder.createTexture({ format: 'r32f', label: 'texB' });
        builder.setExecute(() => {});
      });

      graph.addPass('Final', (builder) => {
        builder.read(texB!);
        builder.write(backbuffer);
        builder.setExecute(() => {});
      });

      // Manually create a cycle by making PassA read texB (after all passes are added)
      const resB = graph.getResource(texB!);
      const passA = graph.passes[0];
      if (resB && passA) {
        passA.reads.push(resB);
        resB.consumers.push(passA);
      }

      expect(() => {
        graph.compile([backbuffer]);
      }).toThrow(/Passes in cycle/);
    });
  });
});
