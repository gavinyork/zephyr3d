import type { GeneratedModelSpec, ProceduralNode } from '@zephyr3d/modelgen';
import { Random } from './random';
import type { Scope } from './scope';

/**
 * What a rule is handed when it fires.
 *
 * A rule does two things: emit geometry for the scope it was given, and derive
 * child symbols over sub-scopes. It never returns anything — the engine collects
 * emitted nodes and walks the derivations.
 *
 * @public
 */
export interface GrammarContext<P extends object, D = unknown> {
  /** Seeded RNG. Rules must use this rather than `Math.random`. */
  readonly rng: Random;
  /** Resolved parameters: the ruleset defaults merged with caller overrides. */
  readonly params: Readonly<P>;
  /** Derivation depth of the current symbol; the axiom is depth 0. */
  readonly depth: number;
  /** The symbol currently being rewritten, useful for diagnostics. */
  readonly symbol: string;
  /**
   * Payload handed over by whoever derived this symbol, or `undefined` for the
   * axiom. This is how a decision made high up (which facade a building wears,
   * which tier of a pagoda roof this is) reaches the rule that needs it, without
   * encoding it into symbol names.
   */
  readonly data: D | undefined;
  /** Adds a geometry node to the output. Ignores `null` so emitters can be chained. */
  emit(node: ProceduralNode | null): void;
  /** Queues `symbol` to be rewritten over `scope`, optionally carrying a payload. */
  derive(symbol: string, scope: Scope, data?: D): void;
}

/**
 * A production rule: rewrites one symbol over one scope.
 * @public
 */
export type Rule<P extends object, D = unknown> = (scope: Scope, ctx: GrammarContext<P, D>) => void;

/**
 * Engine-agnostic material intent for one material group.
 *
 * Plain numbers, no engine types: a style ships the look it was designed for, and
 * every consumer — a runtime demo, the editor plugin — reads the same source of
 * truth instead of inventing its own palette.
 *
 * @public
 */
export interface MaterialHint {
  /** Base colour as linear RGB in `[0, 1]`. */
  albedo: [number, number, number];
  /** Metalness in `[0, 1]`. */
  metallic: number;
  /** Roughness in `[0, 1]`. */
  roughness: number;
  /**
   * How far the albedo may drift per building, as a fraction of the base value.
   * Consumers that want a varied block scale each instance's colour within this
   * band; a block where every wall is the exact same grey reads as copy-paste.
   */
  variation?: number;
}

/**
 * A named collection of rules describing one architectural style.
 *
 * Adding a style means writing one of these and registering it — no changes to the
 * engine. Rules are free to emit any procedural node type, so a style whose forms
 * are not box-shaped (a curved Chinese roof, say) can emit `revolve` or `surface`
 * nodes instead of boxes.
 *
 * @public
 */
export interface Ruleset<P extends object = Record<string, never>, D = unknown> {
  /** Stable identifier, e.g. `'modern-office'`. */
  id: string;
  /** Human-readable name for UI. */
  displayName?: string;
  /** Symbol the derivation starts from. */
  axiom: string;
  /** Parameter defaults; callers may override any subset. */
  defaultParams: P;
  /** Rule table keyed by symbol name. */
  rules: Record<string, Rule<P, D>>;
  /**
   * Suggested materials, keyed by the node `id` the rules tag geometry with.
   * Optional: a style that leaves shading entirely to the caller simply omits it.
   */
  palette?: Readonly<Record<string, MaterialHint>>;
  /**
   * Derives the total envelope height from the parameters, so callers can size the
   * axiom scope without knowing anything about the style. A style whose height is
   * not a simple floor count (a pagoda, say) computes it however it likes.
   */
  envelopeHeight?: (params: P) => number;
}

/**
 * A ruleset with its type parameters erased, for storage in heterogeneous collections.
 * @public
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type AnyRuleset = Ruleset<any, any>;

/**
 * Options for {@link runGrammar}.
 * @public
 */
export interface RunGrammarOptions<P extends object> {
  /** Scope the axiom is applied to. */
  scope: Scope;
  /** Random seed; the same seed reproduces the same model exactly. */
  seed?: number;
  /** Overrides merged over the ruleset's {@link Ruleset.defaultParams}. */
  params?: Partial<P>;
  /** Derivation depth limit. Exceeding it throws. Default 64. */
  maxDepth?: number;
  /** Emitted node limit. Exceeding it throws. Default 50000. */
  maxNodes?: number;
};

/**
 * Runs a ruleset and collects the geometry it emits.
 *
 * The derivation is breadth-first over a work queue rather than recursive, so a
 * deep ruleset cannot blow the JS stack; runaway rulesets are caught by the depth
 * and node limits instead.
 *
 * @returns The emitted procedural nodes, ready to drop into a {@link GeneratedModelSpec}.
 * @public
 */
export function runGrammar<P extends object, D = unknown>(
  ruleset: Ruleset<P, D>,
  options: RunGrammarOptions<P>
): ProceduralNode[] {
  const maxDepth = options.maxDepth ?? 64;
  const maxNodes = options.maxNodes ?? 50000;
  const params = { ...ruleset.defaultParams, ...(options.params ?? {}) } as P;
  const rng = new Random(options.seed ?? 0);
  const nodes: ProceduralNode[] = [];
  const queue: { symbol: string; scope: Scope; depth: number; data: D | undefined }[] = [
    { symbol: ruleset.axiom, scope: options.scope, depth: 0, data: undefined }
  ];

  while (queue.length > 0) {
    const task = queue.shift()!;
    if (task.depth > maxDepth) {
      throw new Error(
        `Ruleset "${ruleset.id}" exceeded max derivation depth ${maxDepth} at symbol "${task.symbol}"`
      );
    }
    const rule = ruleset.rules[task.symbol];
    if (!rule) {
      throw new Error(`Ruleset "${ruleset.id}" has no rule for symbol "${task.symbol}"`);
    }
    const ctx: GrammarContext<P, D> = {
      rng,
      params,
      depth: task.depth,
      symbol: task.symbol,
      data: task.data,
      emit(node) {
        if (!node) {
          return;
        }
        if (nodes.length >= maxNodes) {
          throw new Error(`Ruleset "${ruleset.id}" exceeded max node count ${maxNodes}`);
        }
        nodes.push(node);
      },
      derive(symbol, scope, data) {
        queue.push({ symbol, scope, depth: task.depth + 1, data });
      }
    };
    rule(task.scope, ctx);
  }
  return nodes;
}

const registry = new Map<string, AnyRuleset>();

/**
 * Registers a style so it can be looked up by id.
 *
 * @throws If a different ruleset is already registered under the same id.
 * @public
 */
export function registerStyle(ruleset: AnyRuleset): void {
  const existing = registry.get(ruleset.id);
  if (existing && existing !== ruleset) {
    throw new Error(`A different ruleset is already registered as "${ruleset.id}"`);
  }
  registry.set(ruleset.id, ruleset);
}

/**
 * Looks up a registered style.
 * @throws If no style with that id is registered.
 * @public
 */
export function getStyle(id: string): AnyRuleset {
  const ruleset = registry.get(id);
  if (!ruleset) {
    const known = [...registry.keys()].sort().join(', ') || '<none>';
    throw new Error(`Unknown style "${id}". Registered styles: ${known}`);
  }
  return ruleset;
}

/**
 * Ids of all registered styles, sorted.
 * @public
 */
export function listStyles(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Wraps emitted nodes in a spec ready for `generatePrimitive`.
 * @public
 */
export function toSpec(
  nodes: ProceduralNode[],
  generation?: GeneratedModelSpec['generation']
): GeneratedModelSpec {
  return generation ? { version: 1, nodes, generation } : { version: 1, nodes };
}
