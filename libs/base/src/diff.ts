export type DiffValue = null | boolean | number | string | DiffObject | DiffArray;
export type DiffObject = { [k: string]: DiffValue };
export type DiffArray = DiffValue[];

export type DiffPath = (string | number)[];

export type DiffOpSet = { kind: 'set'; path: DiffPath; value: DiffValue };
export type DiffOpDel = { kind: 'del'; path: DiffPath };
export type DiffArrIns = { op: 'ins'; index: number; value: DiffValue };
export type DiffArrDel = { op: 'del'; index: number };
export type DiffArrSet = { op: 'set'; index: number; value: DiffValue };
export type DiffOpArr = { kind: 'arr'; path: DiffPath; ops: (DiffArrIns | DiffArrDel | DiffArrSet)[] };

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
function shallowEqual(a: any, b: any): boolean {
  return a === b; // 基本类型直接 ===；对象/数组时我们在递归中处理
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

export function diff(base: DiffValue, target: DiffValue): DiffPatch {
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

  // 类型不一致，整段替换
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

// 保守数组 diff：
// - 对齐前缀：对每个 i 在 [0, minLen) 上递归：
//   - 若元素类型相同且为对象/数组：递归 diff
//   - 否则若不同或基本类型不同：arr.set(i, value)
// - 对于 target 比 base 长的部分：顺序 arr.ins(i, v)
// - 对于 base 比 target 长的尾部：从尾到头 arr.del(i)
function diffArray(baseArr: DiffArray, targetArr: DiffArray, path: DiffPath, out: DiffPatch) {
  const ops: (DiffArrIns | DiffArrDel | DiffArrSet)[] = [];
  const minLen = Math.min(baseArr.length, targetArr.length);

  // 前缀对齐
  for (let i = 0; i < minLen; i++) {
    const b = baseArr[i];
    const t = targetArr[i];

    if (isPrimitive(b) && isPrimitive(t)) {
      if (!shallowEqual(b, t)) {
        ops.push({ op: 'set', index: i, value: cloneDeep(t) });
      }
      continue;
    }

    // 如果二者都是数组或对象，尽量递归细化（避免整段替换）
    if ((isArray(b) && isArray(t)) || (isObject(b) && isObject(t))) {
      // 递归差异将以独立的 patch 表达，但对于数组内的对象，我们更希望生成针对该索引下的 set/del 等。
      // 这里的策略：对 b 与 t 调用子 diff，收集到一个临时 patch；
      // 如果临时 patch 为空，跳过；否则将这些 patch 的 path 前缀替换为 [...path, i]
      const sub: DiffPatch = [];
      diffInto(b, t, [], sub);
      if (sub.length > 0) {
        // 将相对路径补上数组索引
        for (const sop of sub) {
          if (sop.kind === 'arr' || sop.kind === 'set' || sop.kind === 'del') {
            // 子 patch 的 path 是相对的（起点是该元素本身）
            // 对于 set/del：直接合并为顶层 out 的 set/del（路径 = [...path, i, ...sop.path]）
            // 对于 arr：将其 path 前缀为 [...path, i, ...]
            // 注意：为了保持“数组操作与对象操作分离”的简洁，我们将子数组 op（kind: "arr"）推到 out，
            // 而不是嵌入父级的 ops。
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

    // 类型不同或一个是对象一个是基本类型 → 直接 set
    ops.push({ op: 'set', index: i, value: cloneDeep(t) });
  }

  // 末尾新增
  for (let i = minLen; i < targetArr.length; i++) {
    ops.push({ op: 'ins', index: i, value: cloneDeep(targetArr[i]) });
  }

  // 末尾删除（从后往前）
  for (let i = baseArr.length - 1; i >= targetArr.length; i--) {
    ops.push({ op: 'del', index: i });
  }

  if (ops.length > 0) {
    out.push({ kind: 'arr', path, ops });
  }
}

// ---------- Apply ----------

function getAt(root: any, path: DiffPath): any {
  let cur = root;
  for (const k of path) {
    cur = cur?.[k as any];
  }
  return cur;
}

function ensurePath(root: any, path: DiffPath): any {
  let cur = root;
  for (let i = 0; i < path.length; i++) {
    const k = path[i];
    const next = path[i + 1];
    if (!(k in cur) || cur[k as any] === undefined || cur[k as any] === null) {
      // 下一个是数字 → 需要数组；否则对象
      cur[k as any] = typeof next === 'number' ? [] : {};
    }
    cur = cur[k as any];
  }
  return cur;
}

function setAt(root: any, path: DiffPath, value: any): any {
  // 返回可能更新后的 root（包括根替换）
  if (path.length === 0) {
    // 直接替换根
    return cloneDeep(value);
  }
  // 常规：修改子路径
  const parent = ensurePath(root, path.slice(0, -1));
  const key = path[path.length - 1];
  parent[key as any] = cloneDeep(value);
  return root;
}

function delAt(root: any, path: DiffPath): any {
  // 返回可能更新后的 root（包括根删除的约定行为）
  if (path.length === 0) {
    // 删除根：语义不明确，这里返回 undefined
    // 如果你希望“清空为 {} 或 []”，可在此自定义策略
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
  // 与原实现一致
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

export function applyPatch(base: DiffValue, patch: DiffPatch): DiffValue {
  // 根值可能在过程中被替换，因此必须把 root 作为变量引用持有
  let root: any = cloneDeep(base);

  for (const op of patch) {
    if (op.kind === 'set') {
      root = setAt(root, op.path, op.value);
    } else if (op.kind === 'del') {
      root = delAt(root, op.path);
    } else if (op.kind === 'arr') {
      const arr = getAt(root, op.path);
      if (!isArray(arr)) {
        // 路径不是数组：退化为 set 整段替换（先在空数组上回放，再整体 set）
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
