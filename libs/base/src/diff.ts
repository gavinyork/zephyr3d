/**
 * A JSON-like value that can be diffed/patched.
 *
 * Includes primitives (`null`, `boolean`, `number`, `string`), objects, and arrays.
 *
 * @public
 */
export type DiffValue = null | boolean | number | string | DiffObject | DiffArray;

/**
 * A JSON-like object with string keys and {@link DiffValue} values.
 *
 * @public
 */
export type DiffObject = { [k: string]: DiffValue };

/**
 * A JSON-like array with {@link DiffValue} elements.
 *
 * @public
 */
export type DiffArray = DiffValue[];

/**
 * A path describing a location within a JSON-like structure.
 *
 * Each segment is either a string (object key) or a number (array index).
 *
 * Example: `["users", 0, "name"]`
 *
 * @public
 */
export type DiffPath = (string | number)[];

/**
 * A patch operation that sets the value at `path` to `value`.
 *
 * - Represents add/replace semantics.
 *
 * @public
 */
export type DiffOpSet = { kind: 'set'; path: DiffPath; value: DiffValue };

/**
 * A patch operation that deletes the value at `path`.
 *
 * @public
 */
export type DiffOpDel = { kind: 'del'; path: DiffPath };

/**
 * An array patch operation that inserts `value` at `index`.
 *
 * @public
 */
export type DiffArrIns = { op: 'ins'; index: number; value: DiffValue };

/**
 * An array patch operation that deletes the element at `index`.
 *
 * @public
 */
export type DiffArrDel = { op: 'del'; index: number };

/**
 * An array patch operation that sets the element at `index` to `value`.
 *
 * @public
 */
export type DiffArrSet = { op: 'set'; index: number; value: DiffValue };

/**
 * A patch operation that applies a list of array mutations (`ops`) at `path`.
 *
 * - The `ops` list can include insert (`ins`), delete (`del`), and set (`set`) operations.
 *
 * @public
 */
export type DiffOpArr = { kind: 'arr'; path: DiffPath; ops: (DiffArrIns | DiffArrDel | DiffArrSet)[] };

/**
 * A patch is a list of operations that can transform one {@link DiffValue} into another.
 *
 * @public
 */
export type DiffPatch = (DiffOpSet | DiffOpDel | DiffOpArr)[];

// ---------- Utils ----------

function isObject(x: any): x is DiffObject {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}
function isArray(x: any): x is DiffArray {
  return Array.isArray(x);
}
function isPrimitive(x: any): x is null | boolean | number | string {
  return x === null || typeof x === 'boolean' || typeof x === 'number' || typeof x === 'string';
}
function shallowEqual(a: any, b: any) {
  return a === b;
}
function cloneDeep<T extends DiffValue>(v: T): T {
  if (isArray(v)) {
    return v.map(cloneDeep) as T;
  }
  if (isObject(v)) {
    const out: any = {};
    for (const k of Object.keys(v)) {
      out[k] = cloneDeep((v as any)[k]);
    }
    return out;
  }
  return v;
}

// ---------- Diff ----------

/**
 * Compute a patch that transforms `base` into `target`.
 *
 * This function emits a sequence of operations needed to convert the input value
 * `base` into `target`. The resulting {@link DiffPatch} can be applied with
 * {@link applyPatch}.
 *
 * Semantics:
 * - Primitives: emits a single `set` if values differ.
 * - Objects: recurses into keys; emits `set` for additions/updates and `del` for removals.
 * - Arrays: emits an `arr` operation containing element-wise `set`, `ins`, and `del`.
 *
 * Notes:
 * - Comparison for primitives uses strict equality (`===`) via `shallowEqual`.
 * - Complex nested changes within arrays are represented either as:
 *   - element-wise `set` when types differ or primitives differ, or
 *   - nested operations pushed to the top-level with extended paths when elements are arrays/objects.
 * - This is not a minimum-edit-distance diff; it's a straightforward positional diff.
 *
 * @param base - The source value.
 * @param target - The desired target value.
 * @returns A {@link DiffPatch} that converts `base` into `target`.
 *
 * @public
 */
export function diff(base: DiffValue, target: DiffValue) {
  const patch: DiffPatch = [];
  diffInto(base, target, [], patch);
  return patch;
}

function diffInto(base: DiffValue, target: DiffValue, path: DiffPath, out: DiffPatch) {
  if (isPrimitive(base) && isPrimitive(target)) {
    if (!shallowEqual(base, target)) {
      out.push({ kind: 'set', path, value: cloneDeep(target) });
    }
    return;
  }

  if (isArray(base) && isArray(target)) {
    diffArray(base, target, path, out);
    return;
  }

  if (isObject(base) && isObject(target)) {
    diffObject(base, target, path, out);
    return;
  }

  out.push({ kind: 'set', path, value: cloneDeep(target) });
}

function diffObject(baseObj: DiffObject, targetObj: DiffObject, path: DiffPath, out: DiffPatch) {
  const keys = new Set([...Object.keys(baseObj), ...Object.keys(targetObj)]);
  for (const k of keys) {
    const p = [...path, k];
    const hasB = Object.prototype.hasOwnProperty.call(baseObj, k);
    const hasT = Object.prototype.hasOwnProperty.call(targetObj, k);

    if (!hasB && hasT) {
      out.push({ kind: 'set', path: p, value: cloneDeep(targetObj[k]) });
    } else if (hasB && !hasT) {
      out.push({ kind: 'del', path: p });
    } else {
      diffInto(baseObj[k], targetObj[k], p, out);
    }
  }
}

function diffArray(baseArr: DiffArray, targetArr: DiffArray, path: DiffPath, out: DiffPatch) {
  const ops: (DiffArrIns | DiffArrDel | DiffArrSet)[] = [];
  const minLen = Math.min(baseArr.length, targetArr.length);

  // sort prefix
  for (let i = 0; i < minLen; i++) {
    const b = baseArr[i];
    const t = targetArr[i];

    if (isPrimitive(b) && isPrimitive(t)) {
      if (!shallowEqual(b, t)) {
        ops.push({ op: 'set', index: i, value: cloneDeep(t) });
      }
      continue;
    }

    if ((isArray(b) && isArray(t)) || (isObject(b) && isObject(t))) {
      const sub: DiffPatch = [];
      diffInto(b, t, [], sub);
      if (sub.length > 0) {
        for (const sop of sub) {
          if (sop.kind === 'arr' || sop.kind === 'set' || sop.kind === 'del') {
            const newPath = [...path, i, ...sop.path];
            if (sop.kind === 'arr') {
              out.push({ kind: 'arr', path: newPath, ops: sop.ops });
            } else if (sop.kind === 'set') {
              out.push({ kind: 'set', path: newPath, value: sop.value });
            } else if (sop.kind === 'del') {
              out.push({ kind: 'del', path: newPath });
            }
          }
        }
      }
      continue;
    }

    ops.push({ op: 'set', index: i, value: cloneDeep(t) });
  }

  for (let i = minLen; i < targetArr.length; i++) {
    ops.push({ op: 'ins', index: i, value: cloneDeep(targetArr[i]) });
  }

  for (let i = baseArr.length - 1; i >= targetArr.length; i--) {
    ops.push({ op: 'del', index: i });
  }

  if (ops.length > 0) {
    out.push({ kind: 'arr', path, ops });
  }
}

// ---------- Apply ----------

function getAt(root: any, path: DiffPath) {
  let cur = root;
  for (const k of path) {
    cur = cur?.[k as any];
  }
  return cur;
}

function ensurePath(root: any, path: DiffPath) {
  let cur = root;
  for (let i = 0; i < path.length; i++) {
    const k = path[i];
    const next = path[i + 1];
    if (!(k in cur) || cur[k as any] === undefined || cur[k as any] === null) {
      cur[k as any] = typeof next === 'number' ? [] : {};
    }
    cur = cur[k as any];
  }
  return cur;
}

function setAt(root: any, path: DiffPath, value: any) {
  if (path.length === 0) {
    return cloneDeep(value);
  }
  const parent = ensurePath(root, path.slice(0, -1));
  const key = path[path.length - 1];
  parent[key as any] = cloneDeep(value);
  return root;
}

function delAt(root: any, path: DiffPath) {
  if (path.length === 0) {
    return undefined;
  }
  const parent = getAt(root, path.slice(0, -1));
  if (parent == null) {
    return root;
  }
  const key = path[path.length - 1];
  if (isArray(parent) && typeof key === 'number') {
    if (key >= 0 && key < parent.length) {
      parent.splice(key, 1);
    }
  } else if (isObject(parent)) {
    delete parent[key as any];
  }
  return root;
}

function applyArrayOps(arr: any[], ops: (DiffArrIns | DiffArrDel | DiffArrSet)[]) {
  for (const op of ops) {
    if (op.op === 'set') {
      arr[op.index] = cloneDeep(op.value);
    }
  }
  for (const op of ops) {
    if (op.op === 'ins') {
      arr.splice(op.index, 0, cloneDeep(op.value));
    }
  }
  const dels = ops
    .filter((o) => o.op === 'del')
    .sort((a, b) => (b as DiffArrDel).index - (a as DiffArrDel).index) as DiffArrDel[];
  for (const op of dels) {
    if (op.index >= 0 && op.index < arr.length) {
      arr.splice(op.index, 1);
    }
  }
}

/**
 * Apply a {@link DiffPatch} to a given `base` value to produce a new value.
 *
 * Behavior:
 * - `set`: sets/replaces the value at path (deep-cloned).
 * - `del`: deletes the value at path; deleting the root yields `undefined`.
 * - `arr`: applies array element `set`s first, then `ins`, then `del` (descending indices),
 *   minimizing index-shift side-effects during mutation.
 *
 * Structural handling:
 * - Intermediate containers are created as needed: arrays for numeric next keys,
 *   objects otherwise.
 * - If an `arr` operation targets a non-array location, the array result is
 *   reconstructed by replaying the sub-ops against an empty array and then
 *   placed at the path.
 *
 * Immutability:
 * - The function starts by deep-cloning `base` to avoid mutating the input.
 *
 * @param base - The source value onto which the patch is applied.
 * @param patch - The patch to apply (produced by {@link diff}).
 * @returns The result of applying `patch` to `base`.
 *
 * @public
 */
export function applyPatch(base: DiffValue, patch: DiffPatch) {
  let root: any = cloneDeep(base);

  for (const op of patch) {
    if (op.kind === 'set') {
      root = setAt(root, op.path, op.value);
    } else if (op.kind === 'del') {
      root = delAt(root, op.path);
    } else if (op.kind === 'arr') {
      const arr = getAt(root, op.path);
      if (!isArray(arr)) {
        const replaced = replayArrayOps([], op.ops);
        root = setAt(root, op.path, replaced);
      } else {
        applyArrayOps(arr, op.ops);
      }
    }
  }

  return root as DiffValue;
}

function replayArrayOps(start: any[], ops: (DiffArrIns | DiffArrDel | DiffArrSet)[]) {
  const arr = start.slice();
  applyArrayOps(arr, ops);
  return arr;
}
