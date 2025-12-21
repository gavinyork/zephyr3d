import { formatString } from '@zephyr3d/base';

describe('formatString', () => {
  describe('literals and %%', () => {
    test('returns format string as-is when no specifiers', () => {
      expect(formatString('Hello World')).toBe('Hello World');
    });

    test('handles literal % with %%', () => {
      expect(formatString('100%% sure')).toBe('100% sure');
      expect(formatString('%%')).toBe('%');
      expect(formatString('a%%b%%c')).toBe('a%b%c');
    });
  });

  describe('%s (string)', () => {
    test('replaces %s with string argument', () => {
      expect(formatString('Hello %s', 'World')).toBe('Hello World');
    });

    test('string with precision cuts length', () => {
      expect(formatString('%.3s', 'abcdef')).toBe('abc');
      expect(formatString('%.10s', 'abc')).toBe('abc');
    });

    test('string with width pads by default on left', () => {
      expect(formatString('%5s', 'ab')).toBe('   ab');
    });

    test('string with left align flag pads on right', () => {
      expect(formatString('%-5s', 'ab')).toBe('ab   ');
    });

    test('%s with null/undefined formats as empty string', () => {
      expect(formatString('%s', null as any)).toBe('');
      expect(formatString('%s', undefined as any)).toBe('');
    });
  });

  describe('%c (character)', () => {
    test('number argument -> charCode', () => {
      expect(formatString('%c', 65)).toBe('A');
    });

    test('string argument -> first character', () => {
      expect(formatString('%c', 'Hello')).toBe('H');
    });

    test('empty string/null/undefined -> NUL', () => {
      expect(formatString('%c', '')).toBe('\u0000');
      expect(formatString('%c', null as any)).toBe('\u0000');
      expect(formatString('%c', undefined as any)).toBe('\u0000');
    });
  });

  describe('%d / %i / %u (integers)', () => {
    test('%d formats signed decimal', () => {
      expect(formatString('%d', 42)).toBe('42');
      expect(formatString('%d', -42)).toBe('-42');
    });

    test('%i is an alias of %d', () => {
      expect(formatString('%i', 42)).toBe('42');
      expect(formatString('%i', -42)).toBe('-42');
    });

    test('%u formats as unsigned 32-bit', () => {
      // -1 -> 4294967295
      expect(formatString('%u', -1)).toBe('4294967295');
      expect(formatString('%u', 42)).toBe('42');
    });

    test('sign flag + adds plus for positive', () => {
      expect(formatString('%+d', 42)).toBe('+42');
      expect(formatString('%+d', -42)).toBe('-42');
    });

    test('space flag adds space for positive, minus for negative', () => {
      expect(formatString('% d', 42)).toBe(' 42');
      expect(formatString('% d', -42)).toBe('-42');
    });

    test('precision pads with leading zeros', () => {
      expect(formatString('%.5d', 42)).toBe('00042');
      expect(formatString('%.3d', -5)).toBe('-005');
    });

    test('width pads with spaces by default', () => {
      expect(formatString('%5d', 42)).toBe('   42');
    });

    test('left align with - flag', () => {
      expect(formatString('%-5d', 42)).toBe('42   ');
    });

    test('zero pad with 0 flag and no precision', () => {
      expect(formatString('%05d', 42)).toBe('00042');
      expect(formatString('%05d', -42)).toBe('-0042'); // sign kept, zeros after
    });

    test('zero pad ignored when precision is specified', () => {
      expect(formatString('%05.3d', 42)).toBe('  042'); // width=5, prec=3, pad spaces outside
    });

    test('boolean and empty string handling in integer conversion', () => {
      expect(formatString('%d', true)).toBe('1');
      expect(formatString('%d', false)).toBe('0');
      expect(formatString('%d', '')).toBe('0');
    });
  });

  describe('%f (floating point)', () => {
    test('default precision is 6', () => {
      expect(formatString('%f', 3.1)).toBe('3.100000');
    });

    test('precision controls digits after decimal', () => {
      expect(formatString('%.2f', Math.PI)).toBe('3.14');
      expect(formatString('%.0f', 3.5)).toBe('4'); // toFixed 的行为
    });

    test('sign and space flags work for positive numbers', () => {
      expect(formatString('%+f', 1.5)).toBe('+1.500000');
      expect(formatString('% f', 1.5)).toBe(' 1.500000');
      expect(formatString('%+f', -1.5)).toBe('-1.500000');
    });

    test('handles Infinity and NaN as strings', () => {
      expect(formatString('%f', Infinity)).toBe('Infinity');
      expect(formatString('%f', -Infinity)).toBe('-Infinity');
      expect(formatString('%f', NaN)).toBe('NaN');
    });
  });

  describe('%x / %X / %o (hex/oct)', () => {
    test('%x formats lowercase hex', () => {
      expect(formatString('%x', 255)).toBe('ff');
      expect(formatString('%x', 16)).toBe('10');
    });

    test('%X formats uppercase hex', () => {
      expect(formatString('%X', 255)).toBe('FF');
    });

    test('%o formats octal', () => {
      expect(formatString('%o', 8)).toBe('10');
      expect(formatString('%o', 9)).toBe('11');
    });

    test('alternate form (#) adds prefix for non-zero', () => {
      expect(formatString('%#x', 255)).toBe('0xff');
      expect(formatString('%#X', 255)).toBe('0XFF');
      expect(formatString('%#o', 8)).toBe('0o10');
    });

    test('alternate form does not add prefix for zero', () => {
      expect(formatString('%#x', 0)).toBe('0');
      expect(formatString('%#o', 0)).toBe('0');
    });

    test('precision pads digits with zeros (before alt prefix)', () => {
      expect(formatString('%.4x', 0x1a)).toBe('001a');
      expect(formatString('%#.4x', 0x1a)).toBe('0x001a');
    });

    test('zero pad with width and alt keeps prefix before zeros', () => {
      expect(formatString('%#08x', 0x1a)).toBe('0x00001a');
      expect(formatString('%08x', 0x1a)).toBe('0000001a');
    });
  });

  describe('width & precision from arguments (*)', () => {
    test('width from argument (*)', () => {
      expect(formatString('>%*d<', 5, 42)).toBe('>   42<');
      expect(formatString('>%*s<', 3, 'a')).toBe('>  a<');
    });

    test('precision from argument (*) for integer', () => {
      expect(formatString('>%.*d<', 4, 42)).toBe('>0042<');
    });

    test('precision from argument (*) for float', () => {
      expect(formatString('>%.*f<', 2, 3.14159)).toBe('>3.14<');
    });

    test('negative precision from arg behaves as "no precision" (per implementation)', () => {
      expect(formatString('%.*f', -1, 3.1)).toBe('3.100000'); // 回到默认 6
    });
  });

  describe('argument indexes n$', () => {
    test('basic reordering with explicit indexes', () => {
      expect(formatString('%2$s %1$s', 'first', 'second')).toBe('second first');
    });

    test('explicit index used for width/precision and value', () => {
      expect(formatString('%2$*1$d', 5, 42)).toBe('   42'); // width=arg1=5, value=arg2=42
    });

    test('throws when explicit index is out of range', () => {
      expect(() => formatString('%3$s', 'a', 'b')).toThrow(/Argument index 3\$ out of range/);
    });

    test('throws when too few arguments for implicit index', () => {
      expect(() => formatString('%s %s', 'only1')).toThrow(/Too few arguments/);
    });
  });

  describe('zero pad interaction and prefixes', () => {
    test('zero pad respects sign prefix for integers', () => {
      expect(formatString('%+05d', 42)).toBe('+0042');
      expect(formatString('%+05d', -42)).toBe('-0042');
    });

    test('zero pad with alt hex keeps 0x / 0X prefix', () => {
      expect(formatString('%#08x', 0x1a)).toBe('0x00001a');
      expect(formatString('%#08X', 0x1a)).toBe('0X00001A');
    });
  });

  describe('combined realistic examples', () => {
    test('example from JSDoc: simple string and hex', () => {
      expect(formatString('Hello %s', 'World')).toBe('Hello World');
      expect(formatString('Hex: %#x', 255)).toBe('Hex: 0xff');
    });

    test('example from JSDoc: width from arg', () => {
      expect(formatString('Width: %*d', 5, 42)).toBe('Width:    42');
    });

    test('example from JSDoc: float precision', () => {
      const out = formatString('Pi: %.2f', Math.PI);
      expect(out).toBe('Pi: 3.14');
    });

    test('example from JSDoc: indexed args', () => {
      expect(formatString('Index: %2$s %1$s', 'first', 'second')).toBe('Index: second first');
    });
  });
});
