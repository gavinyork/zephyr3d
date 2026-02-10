// base64-utils.test.ts
import { uint8ArrayToBase64, textToBase64, base64ToText, base64ToUint8Array } from '@zephyr3d/base';

describe('Base64 helpers', () => {
  describe('uint8ArrayToBase64()', () => {
    test('converts simple ASCII bytes to base64', () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const result = uint8ArrayToBase64(bytes);
      expect(result).toBe('SGVsbG8=');
    });

    test('converts arbitrary binary data to base64', () => {
      const bytes = new Uint8Array([0, 255, 16, 32, 128]);
      const result = uint8ArrayToBase64(bytes);
      // Expected computed via any standard base64 encoder
      expect(result).toBe('AP8QIIA=');
    });
  });

  describe('textToBase64()', () => {
    test('encodes plain ASCII text correctly', () => {
      const result = textToBase64('Hello, World!');
      expect(result).toBe('SGVsbG8sIFdvcmxkIQ==');
    });

    test('encodes unicode text (including emoji) correctly', () => {
      const text = 'Hello, 世界 🌍';
      const result = textToBase64(text);

      // Expected value computed via Buffer.from(text, 'utf8').toString('base64')
      expect(result).toBe('SGVsbG8sIOS4lueVjCDwn4yN');
    });
  });

  describe('base64ToUint8Array()', () => {
    test('decodes base64 back to original bytes', () => {
      const base64 = 'AP8QIIA=';
      const bytes = base64ToUint8Array(base64);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(bytes)).toEqual([0, 255, 16, 32, 128]);
    });

    test('decoding then re-encoding keeps the same base64 string', () => {
      const originalBase64 = 'SGVsbG8='; // "Hello"
      const bytes = base64ToUint8Array(originalBase64);
      const encodedAgain = uint8ArrayToBase64(bytes);

      expect(encodedAgain).toBe(originalBase64);
    });
  });

  describe('base64ToText()', () => {
    test('decodes ASCII text correctly', () => {
      const base64 = 'SGVsbG8sIFdvcmxkIQ==';
      const text = base64ToText(base64);
      expect(text).toBe('Hello, World!');
    });

    test('decodes unicode text (including emoji) correctly', () => {
      const originalText = 'Hello, 世界 🌍';
      const base64 = textToBase64(originalText);
      const decoded = base64ToText(base64);

      expect(decoded).toBe(originalText);
    });
  });

  describe('round-trip consistency', () => {
    test('text -> base64 -> text round trip is lossless for various inputs', () => {
      const cases = [
        '',
        'a',
        'foo',
        'Hello, World!',
        '中文测试',
        'emoji 😀😃😄😁',
        'mixed 文本 + emoji 🚀🔥'
      ];

      for (const text of cases) {
        const b64 = textToBase64(text);
        const decoded = base64ToText(b64);
        expect(decoded).toBe(text);
      }
    });

    test('uint8array -> base64 -> uint8array round trip is lossless', () => {
      const cases: Uint8Array[] = [
        new Uint8Array([]),
        new Uint8Array([0]),
        new Uint8Array([0, 1, 2, 3, 4, 5, 255]),
        new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
      ];

      for (const bytes of cases) {
        const b64 = uint8ArrayToBase64(bytes);
        const decoded = base64ToUint8Array(b64);
        expect(Array.from(decoded)).toEqual(Array.from(bytes));
      }
    });
  });
});
