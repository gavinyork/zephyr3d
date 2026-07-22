import {
  RenderPipeline,
  resolveModuleOrder
} from '../../../libs/scene/src/render/rendergraph/render_pipeline';
import type { RenderModule } from '../../../libs/scene/src/render/rendergraph/render_module';

function mod(type: string): RenderModule {
  return { type, enabled: () => true, setup: () => {} };
}

function dep(type: string, reads?: string[], writes?: string[]): RenderModule {
  return { type, reads, writes, enabled: () => true, setup: () => {} };
}

function order(modules: RenderModule[]): string[] {
  return resolveModuleOrder(modules).map((m) => m.type);
}

function types(p: RenderPipeline): string[] {
  return p.modules.map((m) => m.type);
}

describe('RenderPipeline', () => {
  test('constructs from an ordered module list', () => {
    const p = new RenderPipeline([mod('A'), mod('B'), mod('C')]);
    expect(types(p)).toEqual(['A', 'B', 'C']);
  });

  test('rejects duplicate types on construction and insertion', () => {
    expect(() => new RenderPipeline([mod('A'), mod('A')])).toThrow(/already exists/);
    const p = new RenderPipeline([mod('A')]);
    expect(() => p.append(mod('A'))).toThrow(/already exists/);
    expect(() => p.insertAfter('A', mod('A'))).toThrow(/already exists/);
  });

  test('append / prepend', () => {
    const p = new RenderPipeline([mod('B')]);
    p.append(mod('C')).prepend(mod('A'));
    expect(types(p)).toEqual(['A', 'B', 'C']);
  });

  test('insertBefore / insertAfter anchor by type', () => {
    const p = new RenderPipeline([mod('A'), mod('C')]);
    p.insertAfter('A', mod('B'));
    expect(types(p)).toEqual(['A', 'B', 'C']);
    p.insertBefore('C', mod('B2'));
    expect(types(p)).toEqual(['A', 'B', 'B2', 'C']);
  });

  test('insert throws when the anchor is missing', () => {
    const p = new RenderPipeline([mod('A')]);
    expect(() => p.insertAfter('X', mod('Y'))).toThrow(/no module with type "X"/);
    expect(() => p.insertBefore('X', mod('Y'))).toThrow(/no module with type "X"/);
  });

  test('replace keeps position; allows same type; rejects colliding new type', () => {
    const p = new RenderPipeline([mod('A'), mod('B'), mod('C')]);
    const b2 = mod('B');
    p.replace('B', b2);
    expect(types(p)).toEqual(['A', 'B', 'C']);
    expect(p.get('B')).toBe(b2);
    // Replacing B with a module typed 'C' collides with the existing C.
    expect(() => p.replace('B', mod('C'))).toThrow(/already exists/);
    // Renaming via replace to a fresh type is allowed.
    p.replace('B', mod('B3'));
    expect(types(p)).toEqual(['A', 'B3', 'C']);
  });

  test('replace / remove throw when the type is missing', () => {
    const p = new RenderPipeline([mod('A')]);
    expect(() => p.replace('X', mod('Y'))).toThrow(/no module with type "X"/);
    expect(() => p.remove('X')).toThrow(/no module with type "X"/);
  });

  test('remove', () => {
    const p = new RenderPipeline([mod('A'), mod('B'), mod('C')]);
    p.remove('B');
    expect(types(p)).toEqual(['A', 'C']);
  });

  test('has / get', () => {
    const a = mod('A');
    const p = new RenderPipeline([a]);
    expect(p.has('A')).toBe(true);
    expect(p.has('Z')).toBe(false);
    expect(p.get('A')).toBe(a);
    expect(p.get('Z')).toBeUndefined();
  });

  test('clone is independent of the source', () => {
    const p = new RenderPipeline([mod('A'), mod('B')]);
    const c = p.clone();
    c.append(mod('C'));
    expect(types(p)).toEqual(['A', 'B']);
    expect(types(c)).toEqual(['A', 'B', 'C']);
    // Module instances are shared.
    expect(c.get('A')).toBe(p.get('A'));
  });

  test('build runs enabled modules in order and skips disabled ones', () => {
    const calls: string[] = [];
    const track = (type: string, enabled: boolean): RenderModule => ({
      type,
      enabled: () => enabled,
      setup: () => calls.push(type)
    });
    const p = new RenderPipeline([track('A', true), track('B', false), track('C', true)]);
    p.build({} as never);
    expect(calls).toEqual(['A', 'C']);
  });

  test('disabled writer authored last does not reorder enabled modules', () => {
    const calls: string[] = [];
    const consumer = dep('M1', ['R']);
    consumer.setup = () => calls.push('M1');
    const independent = dep('M2');
    independent.setup = () => calls.push('M2');
    const disabledWriter = dep('Wd', undefined, ['R']);
    disabledWriter.enabled = () => false;
    disabledWriter.setup = () => calls.push('Wd');

    new RenderPipeline([consumer, independent, disabledWriter]).build({} as never);
    expect(calls).toEqual(['M1', 'M2']);
  });
});

describe('resolveModuleOrder', () => {
  test('preserves authored order when no dependencies are declared', () => {
    expect(order([mod('A'), mod('B'), mod('C')])).toEqual(['A', 'B', 'C']);
  });

  test('places a consumer after its producer', () => {
    expect(order([dep('Consumer', ['X']), dep('Producer', undefined, ['X'])])).toEqual([
      'Producer',
      'Consumer'
    ]);
  });

  test('places a consumer after the last writer when a resource is written multiple times', () => {
    const modules = [dep('C', ['X']), dep('W1', undefined, ['X']), dep('W2', undefined, ['X'])];
    expect(order(modules)).toEqual(['W1', 'W2', 'C']);
  });

  test('handles multiple reads on one consumer', () => {
    const modules = [dep('C', ['A', 'B']), dep('PA', undefined, ['A']), dep('PB', undefined, ['B'])];
    // C must be after both PA and PB.
    const result = order(modules);
    expect(result.indexOf('C')).toBeGreaterThan(result.indexOf('PA'));
    expect(result.indexOf('C')).toBeGreaterThan(result.indexOf('PB'));
  });

  test('skips a read whose producer is absent (lenient)', () => {
    expect(order([dep('A'), dep('B', ['Missing']), dep('C')])).toEqual(['A', 'B', 'C']);
  });

  test('throws on cyclic dependencies', () => {
    const modules = [dep('A', ['B'], ['A']), dep('B', ['A'], ['B'])];
    expect(() => resolveModuleOrder(modules)).toThrow(/cyclic module dependency/i);
  });

  test('preserves authored order when reads are already satisfied', () => {
    const modules = [dep('PA', undefined, ['A']), dep('PB', undefined, ['B']), dep('C', ['A', 'B'])];
    expect(order(modules)).toEqual(['PA', 'PB', 'C']);
  });

  test('stable sort uses authored index as tiebreak', () => {
    // Two consumers of the same resource — authored order wins.
    const modules = [dep('P', undefined, ['X']), dep('C1', ['X']), dep('C2', ['X'])];
    expect(order(modules)).toEqual(['P', 'C1', 'C2']);
  });
});
