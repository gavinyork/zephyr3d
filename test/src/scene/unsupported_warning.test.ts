import { warnUnsupported } from '../../../libs/scene/src/utility/unsupported';

describe('warnUnsupported', () => {
  test('warns once per feature with requirement and consequence', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      warnUnsupported('Feature A', 'WebGPU', 'it is disabled');
      warnUnsupported('Feature A', 'WebGPU', 'it is disabled');
      warnUnsupported('Feature B', 'WebGPU', 'falling back');
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenNthCalledWith(1, '[zephyr3d] Feature A requires WebGPU; it is disabled.');
      expect(warn).toHaveBeenNthCalledWith(2, '[zephyr3d] Feature B requires WebGPU; falling back.');
    } finally {
      warn.mockRestore();
    }
  });
});
