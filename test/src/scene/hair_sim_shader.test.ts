import { ProgramBuilder } from '../../../libs/device/src';
import { createHairSimulationProgram } from '../../../libs/scene/src/animation/hair/gpu_hair_simulation';

/**
 * Generates the WGSL of the hair solver and pins the shape of what it emits.
 *
 * The solver runs TressFX's five stages back to back in a single kernel with a
 * thread per strand, rather than as five dispatches with a thread per vertex.
 * That rearrangement is only sound if the stages keep their order and their
 * contents, so this checks both - and checks the handful of details whose
 * absence produces a plausible-looking groom that is wrong in a specific way.
 */
function generateSolverSource(): string {
  let source = '';
  const device: any = {
    type: 'webgpu',
    getDeviceCaps() {
      return { shaderCaps: { supportShaderF16: false } };
    },
    buildComputeProgram(options: any) {
      const builder = new ProgramBuilder(device);
      const result = builder.buildCompute(options);
      if (!result) {
        throw new Error(builder.lastError ?? 'hair solver shader generation failed');
      }
      source = result[0];
      return { bindGroupLayouts: result[1], name: '' };
    }
  };
  createHairSimulationProgram(device, 64);
  return source;
}

/**
 * WGSL reserved words, from the specification's `reserved_word` rule.
 *
 * @remarks
 * The shader builder emits local names verbatim, so one of these used as a
 * variable produces WGSL that generates and reads perfectly well and is then
 * rejected by the driver at pipeline creation. The compute pass silently never
 * runs, which on a hair solver looks exactly like a groom that is simply not
 * simulated - strands sitting at their rest pose, no error anywhere near the
 * code that caused it. Cheap to check here, expensive to find otherwise.
 */
const WGSL_RESERVED = new Set([
  'NULL',
  'Self',
  'abstract',
  'active',
  'alignas',
  'alignof',
  'as',
  'asm',
  'asm_fragment',
  'async',
  'attribute',
  'auto',
  'await',
  'become',
  'binding_array',
  'cast',
  'catch',
  'class',
  'co_await',
  'co_return',
  'co_yield',
  'coherent',
  'column_major',
  'common',
  'compile',
  'compile_fragment',
  'concept',
  'const_cast',
  'consteval',
  'constexpr',
  'constinit',
  'crate',
  'debugger',
  'decltype',
  'delete',
  'demote',
  'demote_to_helper',
  'do',
  'dynamic_cast',
  'enum',
  'explicit',
  'export',
  'extends',
  'extern',
  'external',
  'fallthrough',
  'filter',
  'final',
  'finally',
  'friend',
  'from',
  'fxgroup',
  'get',
  'goto',
  'groupshared',
  'highp',
  'impl',
  'implements',
  'import',
  'inline',
  'instanceof',
  'interface',
  'layout',
  'lowp',
  'macro',
  'macro_rules',
  'match',
  'mediump',
  'meta',
  'mod',
  'module',
  'move',
  'mut',
  'mutable',
  'namespace',
  'new',
  'nil',
  'noexcept',
  'noinline',
  'nointerpolation',
  'noperspective',
  'null',
  'nullptr',
  'of',
  'operator',
  'package',
  'packoffset',
  'partition',
  'pass',
  'patch',
  'pixelfragment',
  'precise',
  'precision',
  'premerge',
  'priv',
  'protected',
  'pub',
  'public',
  'readonly',
  'ref',
  'regardless',
  'register',
  'reinterpret_cast',
  'require',
  'resource',
  'restrict',
  'self',
  'set',
  'shared',
  'sizeof',
  'smooth',
  'snorm',
  'static',
  'static_assert',
  'static_cast',
  'std',
  'subroutine',
  'super',
  'target',
  'template',
  'this',
  'thread',
  'thread_local',
  'throw',
  'trait',
  'try',
  'type',
  'typedef',
  'typeid',
  'typename',
  'typeof',
  'union',
  'unless',
  'unorm',
  'unsafe',
  'unsized',
  'use',
  'using',
  'varying',
  'virtual',
  'volatile',
  'wgsl',
  'where',
  'with',
  'writeonly',
  'yield'
]);

describe('GPU hair solver shader', () => {
  const source = generateSolverSource();

  test('declares no reserved WGSL identifiers', () => {
    // Covers every `let`, `var` and function parameter the solver declares.
    const declared = new Set<string>();
    for (const m of source.matchAll(/\b(?:let|var)\s+(\w+)\s*:/g)) {
      declared.add(m[1]);
    }
    for (const fn of source.matchAll(/\bfn\s+\w+\(([^)]*)\)/g)) {
      for (const param of fn[1].split(',')) {
        const name = param.trim().split(':')[0].trim();
        if (name) {
          declared.add(name);
        }
      }
    }
    expect(declared.size).toBeGreaterThan(20);
    expect([...declared].filter((name) => WGSL_RESERVED.has(name))).toEqual([]);
  });

  test('transforms both stored positions by the node motion', () => {
    // The solver works in local space and brings the node's frame-to-frame
    // motion in through `relativeTransform`. Both the current and the previous
    // stored position must go through that matrix: the translation then cancels
    // in the velocity term and the strand keeps its world position, to be
    // dragged along by the pinned roots. Transforming only one of the two turns
    // the node's own motion into strand velocity, which integrates frame over
    // frame - a small drag winds the velocity up until the strands stream out
    // to full extension.
    expect(source).toMatch(
      /lagged: vec3<f32> = \(\w+\.relativeTransform \* vec4<f32>\(current,1\.0\)\)\.xyz;/
    );
    expect(source).toMatch(
      /laggedPrev: vec3<f32> = \(\w+\.relativeTransform \* vec4<f32>\(previous,1\.0\)\)\.xyz;/
    );
  });

  test('shock propagation blends between lagging and following', () => {
    // In local space the two ends of TressFX's blend are already to hand:
    // carrying a point through the relative transform leaves it where it was in
    // the world, and leaving it alone carries it rigidly with the node. Both
    // stored positions take the same blend, for the same reason both take the
    // transform.
    expect(source).toMatch(/current = mix\(lagged,current,\w+\.vspCoeff\);/);
    expect(source).toMatch(/previous = mix\(laggedPrev,previous,\w+\.vspCoeff\);/);
    const velocity = source.indexOf('(current - previous)');
    expect(velocity).toBeGreaterThan(source.indexOf('current = mix(lagged'));
  });

  test('pins the first two points', () => {
    // Two, not one: a single pinned point fixes where a strand hangs from but
    // leaves the direction it leaves the scalp in free, so the root end flops
    // and can invert. The second point is what gives each strand the root frame
    // the local shape constraint is defined against.
    expect(source).toMatch(/Z_hairSetPoint\(firstPoint,rootRest/);
    expect(source).toMatch(/Z_hairSetHistory\(firstPoint,rootRest/);
    expect(source).toMatch(/nextIdx: u32 = firstPoint \+ 1u;[\s\S]{0,200}Z_hairSetPoint\(nextIdx,nextRest/);
    // And the stages that move points all start past them.
    expect(source.match(/for \(var i: u32 = 2u; i < pointCount/g)?.length).toBe(2);
  });

  test('the local shape constraint is measured against the current frame', () => {
    // What separates holding a shape from holding a pose. The rotation is taken
    // from the bind direction of the previous segment to whatever direction that
    // segment points in now, and the bind offset is carried through it - so a
    // strand keeps its curl while remaining free to hang and swing anywhere.
    // Rotating a fixed pose instead would anchor the strand in space.
    expect(source).toMatch(
      /rotation: vec4<f32> = Z_hairQuatFromUnitVectors\(normalize\(lastBindVec\),normalize\(lastVec\)/
    );
    expect(source).toMatch(/bendTarget: vec3<f32> = Z_hairQuatRotate\(rotation,bindVec\S*\) \+ pos;/);
    expect(source).toMatch(/lastVec: vec3<f32> = pos - posMinus;/);
  });

  test('the length pass runs root to tip and pays the parent back', () => {
    // Placing each point at exactly its authored distance from a parent that is
    // already final leaves the strand inextensible in one pass, but satisfies
    // the segment by moving the child alone - so the momentum that correction
    // represents has to be handed back to the parent, or every root movement
    // pumps the chain and the gain collects at the free end as a whip.
    expect(source).toMatch(/for \(var j: u32 = 1u; j < pointCount - 1u/);
    expect(source).toMatch(/projected = parent \+ \(\(offset \/ dist\) \* restLength\);/);
    expect(source).toMatch(
      /correction: vec3<f32> = projected - predicted;[\s\S]{0,200}Z_hairSetHistory\(parentIdx,Z_hairGetHistory\(parentIdx\S*\) \+ \(correction \* \w+\.ftlDamping\)/
    );
    // The pinned roots have no momentum to be paid.
    expect(source).toMatch(/if \(j > 1u\) \{/);
  });

  test('a contact push does not read as velocity', () => {
    // Being pushed out of a collider is a position fix, not a shove: the history
    // follows the push so the point leaves the surface with the velocity it
    // arrived with, and friction then takes its share of the tangential part.
    expect(source).toMatch(/push: vec3<f32> = resolved - position;[\s\S]{0,120}history = history \+ push;/);
    expect(source).toMatch(/history = history \+ \(tangential \* \w+\.friction\);/);
  });

  test('runs the stages in order', () => {
    // Integrate, then hold the shape, then hold the lengths, then resolve
    // contacts. Shape before length matters: the bending correction moves points
    // off their segment lengths, and the length pass is what cleans that up.
    //
    // Measured inside the entry point, since the helpers these stages call are
    // defined ahead of it in whatever order they were declared.
    const main = source.slice(source.indexOf('@compute'));
    const integrate = main.indexOf('current = mix(lagged');
    const localShape = main.indexOf('Z_hairQuatFromUnitVectors');
    const length = main.indexOf('projected = parent +');
    const contacts = main.indexOf('Z_hairResolveContacts(position');
    expect(integrate).toBeGreaterThan(-1);
    expect(localShape).toBeGreaterThan(integrate);
    expect(length).toBeGreaterThan(localShape);
    expect(contacts).toBeGreaterThan(length);
  });
});
