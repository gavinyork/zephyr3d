// list.test.ts
import { List } from '@zephyr3d/base';

describe('List', () => {
  describe('basic structure', () => {
    test('new list is empty', () => {
      const list = new List<number>();
      expect(list.length).toBe(0);
      expect(list.begin().valid()).toBe(false);
      expect(list.end().valid()).toBe(false);
      expect(list.rbegin().valid()).toBe(false);
      expect(list.rend().valid()).toBe(false);
    });

    test('front() and back() throw on empty list', () => {
      const list = new List<number>();
      expect(() => list.front()).toThrow('List.front(): list is empty');
      expect(() => list.back()).toThrow('List.back(): list is empty');
    });
  });

  describe('append / prepend', () => {
    test('append adds elements to the end', () => {
      const list = new List<number>();

      const it1 = list.append(1);
      expect(list.length).toBe(1);
      expect(it1.data).toBe(1);
      expect(list.front()).toBe(1);
      expect(list.back()).toBe(1);

      const it2 = list.append(2);
      const it3 = list.append(3);

      expect(list.length).toBe(3);
      expect(list.front()).toBe(1);
      expect(list.back()).toBe(3);

      // iterate forwards
      const values: number[] = [];
      for (let it = list.begin(); it.valid(); it.next()) {
        values.push(it.data);
      }
      expect(values).toEqual([1, 2, 3]);

      // returned iterators should still be valid and point to correct nodes
      expect(it2.data).toBe(2);
      expect(it3.data).toBe(3);
    });

    test('prepend adds elements to the front', () => {
      const list = new List<number>();

      list.prepend(3);
      list.prepend(2);
      list.prepend(1);

      expect(list.length).toBe(3);
      expect(list.front()).toBe(1);
      expect(list.back()).toBe(3);

      const values: number[] = [];
      for (let it = list.begin(); it.valid(); it.next()) {
        values.push(it.data);
      }
      expect(values).toEqual([1, 2, 3]);
    });

    test('mix of prepend and append keeps correct order', () => {
      const list = new List<number>();

      list.append(2); // [2]
      list.prepend(1); // [1, 2]
      list.append(3); // [1, 2, 3]
      list.prepend(0); // [0, 1, 2, 3]

      const values: number[] = [];
      for (let it = list.begin(); it.valid(); it.next()) {
        values.push(it.data);
      }
      expect(values).toEqual([0, 1, 2, 3]);
    });
  });

  describe('iteration (forward and reverse)', () => {
    test('begin/end forward iteration', () => {
      const list = new List<string>();
      list.append('a');
      list.append('b');
      list.append('c');

      const result: string[] = [];
      for (let it = list.begin(); it.valid(); it.next()) {
        result.push(it.data);
      }
      expect(result).toEqual(['a', 'b', 'c']);

      // end() should be invalid
      const endIt = list.end();
      expect(endIt.valid()).toBe(false);
    });

    test('rbegin/rend reverse iteration', () => {
      const list = new List<string>();
      list.append('a');
      list.append('b');
      list.append('c');

      const result: string[] = [];
      for (let it = list.rbegin(); it.valid(); it.next()) {
        result.push(it.data);
      }
      expect(result).toEqual(['c', 'b', 'a']);

      const rendIt = list.rend();
      expect(rendIt.valid()).toBe(false);
    });

    test('ListIterator valid(), next(), prev(), getNext(), getPrev()', () => {
      const list = new List<number>();
      list.append(1);
      list.append(2);
      list.append(3);

      // forward iterator
      const it = list.begin();
      expect(it.valid()).toBe(true);
      expect(it.data).toBe(1);

      const itNext = it.getNext();
      expect(itNext.valid()).toBe(true);
      expect(itNext.data).toBe(2);

      it.next(); // now it points to 2
      expect(it.data).toBe(2);

      const itPrev = it.getPrev();
      expect(itPrev.valid()).toBe(true);
      expect(itPrev.data).toBe(1);

      it.prev(); // back to 1
      expect(it.data).toBe(1);

      // reverse iterator
      const rit = list.rbegin();
      expect(rit.valid()).toBe(true);
      expect(rit.data).toBe(3);

      const ritNext = rit.getNext();
      expect(ritNext.valid()).toBe(true);
      expect(ritNext.data).toBe(2);

      rit.next(); // 2
      expect(rit.data).toBe(2);

      const ritPrev = rit.getPrev();
      expect(ritPrev.valid()).toBe(true);
      expect(ritPrev.data).toBe(3);

      rit.prev(); // back to 3
      expect(rit.data).toBe(3);
    });

    test('ListIterator methods throw when invalid', () => {
      const list = new List<number>();
      const it = list.begin(); // empty => invalid

      expect(it.valid()).toBe(false);
      expect(() => it.next()).toThrow('ListIterator.next(): iterator is invalid');
      expect(() => it.getNext()).toThrow('ListIterator.getNext(): iterator is invalid');
      expect(() => it.prev()).toThrow('ListIterator.prev(): iterator is invalid');
      expect(() => it.getPrev()).toThrow('ListIterator.getPrev(): iterator is invalid');
      expect(() => (it as any).data).toThrow('ListIterator.data: iterator is invalid');
    });
  });

  describe('insert', () => {
    test('insert before a valid forward iterator', () => {
      const list = new List<number>();
      list.append(1);
      const it3 = list.append(3);

      // insert before it3
      const it2 = list.insert(2, it3)!;
      expect(list.length).toBe(3);
      expect(it2.data).toBe(2);

      const values: number[] = [];
      for (let it = list.begin(); it.valid(); it.next()) {
        values.push(it.data);
      }
      expect(values).toEqual([1, 2, 3]);
    });

    test('insert with a valid reversed iterator inserts after the current node (in forward order)', () => {
      const list = new List<number>();
      list.append(1);
      list.append(3);

      const rit = list.rbegin(); // points to 3
      const it2 = list.insert(2, rit)!;

      expect(list.length).toBe(3);
      expect(it2.data).toBe(2);

      const values: number[] = [];
      for (let it = list.begin(); it.valid(); it.next()) {
        values.push(it.data);
      }
      expect(values).toEqual([1, 3, 2]); // 改成这个
    });

    test('insert with invalid iterator appends to the end', () => {
      const list = new List<number>();
      list.append(1);
      const endIt = list.end(); // invalid

      const inserted = list.insert(2, endIt);
      expect(inserted).not.toBeNull();
      expect(list.length).toBe(2);
      expect(list.back()).toBe(2);
    });

    test('insert returns null if iterator belongs to another list', () => {
      const list1 = new List<number>();
      const list2 = new List<number>();

      const it = list1.append(1);
      const result = list2.insert(2, it);
      expect(result).toBeNull();
      expect(list2.length).toBe(0);
    });
  });

  describe('remove', () => {
    test('remove deletes the node pointed to by the iterator', () => {
      const list = new List<number>();
      const it1 = list.append(1);
      const it2 = list.append(2);
      const it3 = list.append(3);

      expect(list.length).toBe(3);

      // remove middle element
      list.remove(it2);
      expect(list.length).toBe(2);

      const values: number[] = [];
      for (let it = list.begin(); it.valid(); it.next()) {
        values.push(it.data);
      }
      expect(values).toEqual([1, 3]);

      // iterator `it2` has been advanced by remove()
      expect(it2.valid()).toBe(true);
      expect(it2.data).toBe(3);

      // remove first element
      list.remove(it1);
      expect(list.length).toBe(1);
      expect(list.front()).toBe(3);

      // remove last element
      list.remove(it3);
      expect(list.length).toBe(0);
      expect(list.begin().valid()).toBe(false);
    });

    test('remove does nothing for invalid iterator', () => {
      const list = new List<number>();
      list.append(1);
      const itInvalid = list.end(); // invalid

      list.remove(itInvalid);
      expect(list.length).toBe(1);
    });

    test('remove does nothing if iterator belongs to another list', () => {
      const list1 = new List<number>();
      const list2 = new List<number>();

      const it1 = list1.append(1);
      list2.append(10);

      list2.remove(it1); // should be ignored
      expect(list1.length).toBe(1);
      expect(list2.length).toBe(1);
    });
  });

  describe('forEach / forEachReverse', () => {
    test('forEach visits all elements in order', () => {
      const list = new List<number>();
      list.append(1);
      list.append(2);
      list.append(3);

      const values: number[] = [];
      list.forEach((v) => values.push(v));
      expect(values).toEqual([1, 2, 3]);
    });

    test('forEachReverse visits all elements in reverse order', () => {
      const list = new List<number>();
      list.append(1);
      list.append(2);
      list.append(3);

      const values: number[] = [];
      list.forEachReverse((v) => values.push(v));
      expect(values).toEqual([3, 2, 1]);
    });

    test('forEach / forEachReverse do nothing when callback is falsy', () => {
      const list = new List<number>();
      list.append(1);
      list.append(2);

      // Typescript will complain, but at runtime this branch exists
      (list as any).forEach(null);
      (list as any).forEachReverse(null);

      const values: number[] = [];
      list.forEach((v) => values.push(v));
      expect(values).toEqual([1, 2]);
    });
  });

  describe('clear', () => {
    test('clear removes all elements', () => {
      const list = new List<number>();
      list.append(1);
      list.append(2);
      list.append(3);

      list.clear();
      expect(list.length).toBe(0);
      expect(list.begin().valid()).toBe(false);
      expect(() => list.front()).toThrow('List.front(): list is empty');
      expect(() => list.back()).toThrow('List.back(): list is empty');
    });

    test('clear on an empty list is safe', () => {
      const list = new List<number>();
      list.clear();
      expect(list.length).toBe(0);
    });
  });

  describe('ListIterator data getter/setter', () => {
    test('data getter reads node value', () => {
      const list = new List<string>();
      list.append('a');
      const it = list.begin();
      expect(it.data).toBe('a');
    });

    test('data setter updates node value when iterator is valid', () => {
      const list = new List<string>();
      list.append('a');
      const it = list.begin();

      it.data = 'b';
      expect(list.front()).toBe('b');

      const values: string[] = [];
      for (let i = list.begin(); i.valid(); i.next()) {
        values.push(i.data);
      }
      expect(values).toEqual(['b']);
    });

    test('data setter does nothing when iterator is invalid', () => {
      const list = new List<string>();
      const it = list.begin(); // invalid
      // should not throw, and should not write anything
      (it as any).data = 'x';

      expect(list.length).toBe(0);
    });
  });

  describe('ListIterator meta accessors', () => {
    test('reversed flag matches iterator direction', () => {
      const list = new List<number>();
      list.append(1);
      list.append(2);

      const it = list.begin();
      const rit = list.rbegin();

      expect(it.reversed).toBe(false);
      expect(rit.reversed).toBe(true);
    });

    test('list accessor returns owning list', () => {
      const list = new List<number>();
      list.append(1);

      const it = list.begin();
      expect(it.list).toBe(list);
    });
  });
});
