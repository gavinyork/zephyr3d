import { diff, applyPatch } from '@zephyr3d/base';

type JSONValue = null | boolean | number | string | JSONObject | JSONArray;
type JSONObject = { [k: string]: JSONValue };
type JSONArray = JSONValue[];

interface CanonOptions {
  floatEpsilon?: number;
  floatDigits?: number;
  normalizeNewline?: boolean;
}

function canonicalize(v: JSONValue, opt: CanonOptions = {}): JSONValue {
  const eps = opt.floatEpsilon ?? 0;
  const digits = opt.floatDigits;
  const normNL = opt.normalizeNewline ?? false;

  function normNumber(x: number): number {
    if (Object.is(x, -0)) {
      x = 0;
    }
    if (eps > 0 && Math.abs(x) < eps) {
      x = 0;
    }
    if (typeof digits === 'number') {
      const f = Number(x.toFixed(digits));
      if (eps > 0 && Math.abs(f) < eps) {
        return 0;
      }
      return f;
    }
    return x;
  }

  function normString(s: string): string {
    if (!normNL) {
      return s;
    }
    return s.replace(/\r\n?/g, '\n');
  }

  function canon(x: JSONValue): JSONValue {
    if (x === null) {
      return null;
    }
    if (typeof x === 'boolean') {
      return x;
    }
    if (typeof x === 'number') {
      return normNumber(x);
    }
    if (typeof x === 'string') {
      return normString(x);
    }

    if (Array.isArray(x)) {
      return x.map((el) => canon(el));
    }

    const keys = Object.keys(x)
      .filter((k) => (x as any)[k] !== undefined)
      .sort();
    const out: any = {};
    for (const k of keys) {
      out[k] = canon((x as any)[k]);
    }
    return out;
  }

  return canon(v);
}

function stringifyCanonical(v: JSONValue, opt?: CanonOptions): string {
  const c = canonicalize(v, opt);
  return JSON.stringify(c, null, 2);
}

function assertEqualJSON(a: any, b: any, msg?: string) {
  const sa = stringifyCanonical(a, { floatEpsilon: 1e-9, floatDigits: 6, normalizeNewline: true });
  const sb = stringifyCanonical(b, { floatEpsilon: 1e-9, floatDigits: 6, normalizeNewline: true });
  if (sa !== sb) {
    throw new Error((msg ?? 'JSON not equal') + `\nA=${sa}\nB=${sb}`);
  }
}

function roundTrip(base: any, target: any) {
  const p = diff(base, target);
  const applied = applyPatch(base, p);
  assertEqualJSON(applied, target, 'roundTrip failed');
  return p;
}

function runTests() {
  roundTrip(42, 42);
  roundTrip('abc', 'abc');
  roundTrip(true, true);
  roundTrip(null, null);
  roundTrip(1, 2);
  roundTrip('a', 'b');
  roundTrip(false, true);
  roundTrip(null, 0);
  roundTrip(1, { a: 1 });
  roundTrip('x', [1, 2, 3]);
  roundTrip(null, 'now string');
  roundTrip({}, { a: 1 });
  roundTrip({ x: 1 }, { x: 1, y: 2 });
  roundTrip({ a: 1 }, {});
  roundTrip({ x: 1, y: 2 }, { x: 1 });
  roundTrip({ a: 1 }, { a: 2 });
  roundTrip({ s: 'a', n: 1, b: false }, { s: 'b', n: 2, b: true });
  roundTrip({ a: { b: { c: 1 } } }, { a: { b: { c: 2, d: 'new' } } });
  roundTrip(
    { user: { name: 'Tom', age: 20 }, cfg: { theme: 'light' } },
    { user: { name: 'Tom', age: 21 }, cfg: {} }
  );
  roundTrip([], []);
  roundTrip([], [1, 2, 3]);
  roundTrip([1, 2], []);
  roundTrip([1, 2], [1, 2, 3, 4]);
  roundTrip([1, 2, 3, 4], [1, 2]);
  roundTrip([1, 2, 3], [1, 9, 3]); // index 1 替换
  roundTrip(['a', 'b', 'c'], ['a', 'B', 'c']);
  roundTrip(
    [
      { id: 1, v: 10 },
      { id: 2, v: 20 }
    ],
    [
      { id: 1, v: 10 },
      { id: 2, v: 21 }
    ]
  );
  roundTrip([{ o: { x: 1 } }, { o: { x: 2 } }], [{ o: { x: 1 } }, { o: { x: 3, y: 1 } }]);
  roundTrip(
    [
      [1, 2],
      [3, 4]
    ],
    [
      [1, 2],
      [3, 5]
    ]
  );
  roundTrip([[{ a: 1 }]], [[{ a: 2, b: 1 }]]);
  roundTrip({ name: 'car', wheels: [1, 2, 3, 4] }, { name: 'car', wheels: [1, 9, 3] });
  roundTrip({ items: [{ a: 1 }, { b: 2 }] }, { items: [{ a: 1 }, { b: 3 }, { c: 9 }] });
  roundTrip({ a: { b: [1, { c: 2 }] } }, { a: { b: { notArray: true } } });
  roundTrip({ cfg: { x: 1, y: 2 }, data: [1, 2, 3] }, { cfg: 'RESET', data: [1, 2, 3] });
  roundTrip(
    { cfg: { theme: 'light', layout: { col: 2, gap: 8 } } },
    { cfg: { theme: 'dark', layout: { col: 3, gap: 8, pad: 4 } } }
  );
  roundTrip({ a: null }, { a: undefined as any });
  roundTrip({ a: 1 }, {});
  roundTrip({}, { a: null });
  roundTrip({ a: {} }, { a: { b: [] } });
  roundTrip({ a: { b: [] } }, { a: {} });
  {
    const base = { a: [1, 2, 3], b: { x: 1 } };
    const target = { a: [1, 9], b: { x: 2, y: 1 } };
    const p = diff(base, target);
    const once = applyPatch(base, p);
    const twice = applyPatch(once, p);
    assertEqualJSON(once, twice, 'apply twice should be idempotent');
    const o = { a: 1, b: [1, 2], c: { d: 'x' } };
    const p0 = diff(o, o);
    if (p0.length !== 0) {
      throw new Error('diff with same object must be empty');
    }
    const applied = applyPatch(o, p0);
    assertEqualJSON(applied, o, 'empty patch should keep object unchanged');
  }
  roundTrip(
    [1, 2, 3, 4],
    [1, 99, 3] // index 1 set，尾部 del
  );

  roundTrip(
    [{ v: 1 }, { v: 2 }, { v: 3 }],
    [{ v: 1 }, { v: 2, extra: true }, { v: 3 }, { v: 4 }] // 第二项递归变更 + 尾部 ins
  );
  {
    const base = { a: {} };
    const patch = [
      {
        kind: 'arr',
        path: ['a', 'list'],
        ops: [
          { op: 'ins', index: 0, value: 1 },
          { op: 'ins', index: 1, value: 2 }
        ]
      }
    ] as const;
    const applied = applyPatch(base, patch as any);
    assertEqualJSON(applied, { a: { list: [1, 2] } });
  }
  {
    const base = { a: 1, b: 2 };
    const target = { b: 2, a: 1 };
    const p = diff(base, target);
    const applied = applyPatch(base, p);
    assertEqualJSON(applied, target);
  }
  {
    function randPrim(): any {
      const t = Math.floor(Math.random() * 4);
      if (t === 0) {
        return null;
      }
      if (t === 1) {
        return Math.floor(Math.random() * 10);
      }
      if (t === 2) {
        return Math.random() < 0.5;
      }
      return Math.random().toString(36).slice(2, 7);
    }
    function randJSON(depth = 0): any {
      if (depth > 3) {
        return randPrim();
      }
      const choice = Math.random();
      if (choice < 0.33) {
        // object
        const o: any = {};
        const n = Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          o['k' + i] = randJSON(depth + 1);
        }
        return o;
      } else if (choice < 0.66) {
        // array
        const a: any[] = [];
        const n = Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          a.push(randJSON(depth + 1));
        }
        return a;
      } else {
        return randPrim();
      }
    }

    for (let i = 0; i < 200; i++) {
      const base = randJSON();
      const target = randJSON();
      roundTrip(base, target);
    }
  }
  {
    const base = {
      name: 'Car',
      transform: { pos: [0, 0, 0], rot: [0, 0, 0, 1], scl: [1, 1, 1] },
      renderers: [
        { mesh: 'body.mesh', material: 'mat/default' },
        { mesh: 'wheel.mesh', material: 'mat/wheel' },
        { mesh: 'wheel.mesh', material: 'mat/wheel' },
        { mesh: 'wheel.mesh', material: 'mat/wheel' },
        { mesh: 'wheel.mesh', material: 'mat/wheel' }
      ],
      extras: {}
    };

    const target = {
      name: 'Car',
      transform: { pos: [0, 0, 0], rot: [0, 0, 0, 1], scl: [1, 1, 1] },
      renderers: [
        { mesh: 'body.mesh', material: 'mat/sport' },
        { mesh: 'wheel.mesh', material: 'mat/wheel' },
        { mesh: 'wheel.mesh', material: 'mat/wheel' }
      ],
      extras: { lightbar: { type: 'spot', intensity: 1200 } }
    };

    roundTrip(base, target);
  }

  console.log('done');
}

const btn = document.querySelector('#start');
btn.addEventListener('click', function () {
  runTests();
});
