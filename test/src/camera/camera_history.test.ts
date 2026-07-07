import { Camera } from '../../../libs/scene/src/camera/camera';
import type { HistoryResourceManager } from '../../../libs/scene/src/render/rendergraph';

function createHistoryManager(onDispose: () => void): HistoryResourceManager {
  return {
    dispose: onDispose
  } as unknown as HistoryResourceManager;
}

describe('Camera history cleanup', () => {
  test('clearHistoryData disposes graph history resources', () => {
    const camera = new Camera(null);
    let disposeCount = 0;
    const manager = createHistoryManager(() => {
      disposeCount++;
    });

    camera.setHistoryResourceManager(manager);
    expect(camera.getHistoryResourceManager()).toBe(manager);

    camera.clearHistoryData();

    expect(disposeCount).toBe(1);
    expect(camera.getHistoryResourceManager()).toBeNull();
  });

  test('setHistoryResourceManager disposes replaced graph history resources', () => {
    const camera = new Camera(null);
    let firstDisposeCount = 0;
    let secondDisposeCount = 0;
    const first = createHistoryManager(() => {
      firstDisposeCount++;
    });
    const second = createHistoryManager(() => {
      secondDisposeCount++;
    });

    camera.setHistoryResourceManager(first);
    camera.setHistoryResourceManager(second);

    expect(firstDisposeCount).toBe(1);
    expect(secondDisposeCount).toBe(0);
    expect(camera.getHistoryResourceManager()).toBe(second);
  });
});
