// OrderedStringSet.test.ts
import { OrderedStringSet } from '@zephyr3d/base';

describe('OrderedStringSet', () => {
  describe('construction and basic shape', () => {
    test('creates an empty set by default (no duplicates)', () => {
      const set = new OrderedStringSet();
      expect(set.items).toEqual([]);
      expect(set.has('a')).toBe(false);
    });

    test('creates an empty set that allows duplicates', () => {
      const set = new OrderedStringSet(true);
      expect(set.items).toEqual([]);
      expect(set.has('a')).toBe(false);
    });
  });

  describe('insertion and ordering (no duplicates)', () => {
    test('keeps items sorted', () => {
      const set = new OrderedStringSet();

      set.add('delta');
      set.add('alpha');
      set.add('charlie');
      set.add('bravo');

      expect(set.items).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    });

    test('ignores duplicates when allowDuplicates = false', () => {
      const set = new OrderedStringSet();

      set.add('b');
      set.add('a');
      set.add('b');
      set.add('c');
      set.add('a');

      expect(set.items).toEqual(['a', 'b', 'c']);
    });

    test('inserting already-present string does not change items', () => {
      const set = new OrderedStringSet();

      set.add('m');
      set.add('n');
      const before = set.items;

      set.add('m');
      const after = set.items;

      expect(after).toEqual(before);
    });
  });

  describe('insertion and ordering (with duplicates)', () => {
    test('keeps items sorted when duplicates are allowed', () => {
      const set = new OrderedStringSet(true);

      set.add('delta');
      set.add('alpha');
      set.add('charlie');
      set.add('bravo');

      expect(set.items).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    });

    test('inserts duplicates but keeps sorted order', () => {
      const set = new OrderedStringSet(true);

      set.add('b');
      set.add('a');
      set.add('b');
      set.add('c');
      set.add('b');

      const items = set.items;
      // All values sorted; duplicates of 'b' clustered
      expect(items).toEqual(['a', 'b', 'b', 'b', 'c']);
      // The set should still report existence correctly
      expect(set.has('b')).toBe(true);
      expect(set.has('d')).toBe(false);
    });

    test('inserting an existing value places it before or among existing duplicates', () => {
      const set = new OrderedStringSet(true);

      set.add('b');
      set.add('b');
      set.add('b');

      // Internal policy: new 'b' should be inserted into the existing cluster
      set.add('b');

      const items = set.items;
      expect(items).toEqual(['b', 'b', 'b', 'b']);
    });
  });

  describe('has()', () => {
    test('returns true only for values in the set (no duplicates)', () => {
      const set = new OrderedStringSet();

      set.add('x');
      set.add('y');

      expect(set.has('x')).toBe(true);
      expect(set.has('y')).toBe(true);
      expect(set.has('z')).toBe(false);
      expect(set.has('')).toBe(false);
    });

    test('works correctly with duplicates allowed', () => {
      const set = new OrderedStringSet(true);

      set.add('x');
      set.add('x');

      expect(set.has('x')).toBe(true);
      expect(set.items).toEqual(['x', 'x']);
    });
  });

  describe('remove()', () => {
    test('removes the first occurrence of the string (no duplicates)', () => {
      const set = new OrderedStringSet();

      set.add('a');
      set.add('b');
      set.add('c');

      set.remove('b');
      expect(set.items).toEqual(['a', 'c']);
      expect(set.has('b')).toBe(false);
    });

    test('removes only one occurrence when duplicates are allowed', () => {
      const set = new OrderedStringSet(true);

      set.add('a');
      set.add('b');
      set.add('b');
      set.add('b');
      set.add('c');

      set.remove('b');

      // Only one 'b' removed; two remain, still ordered
      expect(set.items).toEqual(['a', 'b', 'b', 'c']);
      expect(set.has('b')).toBe(true);
    });

    test('does nothing when removing a non-existing string', () => {
      const set = new OrderedStringSet(true);

      set.add('a');
      set.add('b');

      const before = set.items;
      set.remove('z');
      expect(set.items).toEqual(before);
    });

    test('can remove the only element', () => {
      const set = new OrderedStringSet();

      set.add('only');
      set.remove('only');

      expect(set.items).toEqual([]);
      expect(set.has('only')).toBe(false);
    });
  });

  describe('removeAll()', () => {
    test('removes all occurrences of a value when duplicates are allowed', () => {
      const set = new OrderedStringSet(true);

      set.add('a');
      set.add('b');
      set.add('b');
      set.add('c');
      set.add('b');
      set.add('d');

      set.removeAll('b');

      expect(set.items).toEqual(['a', 'c', 'd']);
      expect(set.has('b')).toBe(false);
    });

    test('removes the element when duplicates are not allowed (acts like remove)', () => {
      const set = new OrderedStringSet();

      set.add('a');
      set.add('b');
      set.add('c');

      set.removeAll('b');

      expect(set.items).toEqual(['a', 'c']);
      expect(set.has('b')).toBe(false);
    });

    test('does nothing if the value is not present', () => {
      const set = new OrderedStringSet(true);

      set.add('a');
      set.add('b');

      const before = set.items;
      set.removeAll('z');

      expect(set.items).toEqual(before);
    });

    test('can clear a set made of only duplicates of a single value', () => {
      const set = new OrderedStringSet(true);

      set.add('x');
      set.add('x');
      set.add('x');

      set.removeAll('x');

      expect(set.items).toEqual([]);
      expect(set.has('x')).toBe(false);
    });
  });

  describe('items getter', () => {
    test('returns a shallow copy, not the internal array', () => {
      const set = new OrderedStringSet();

      set.add('a');
      set.add('b');

      const items = set.items;
      expect(items).toEqual(['a', 'b']);

      // Mutate returned array and verify internal state is unchanged
      items.push('c');
      expect(items).toEqual(['a', 'b', 'c']);
      expect(set.items).toEqual(['a', 'b']);
    });
  });

  describe('edge cases and ordering details', () => {
    test('handles empty strings', () => {
      const set = new OrderedStringSet(true);

      set.add('');
      set.add('a');
      set.add('');
      set.add('b');

      expect(set.items).toEqual(['', '', 'a', 'b']);

      set.removeAll('');
      expect(set.items).toEqual(['a', 'b']);
    });

    test('handles values with different lexicographical order', () => {
      const set = new OrderedStringSet(true);

      set.add('apple');
      set.add('app');
      set.add('banana');
      set.add('ban');

      expect(set.items).toEqual(['app', 'apple', 'ban', 'banana']);
    });
  });
});
