import { Scene, SceneNode } from '@zephyr3d/scene';
import { UpdateQueue } from '../../../libs/scene/src/scene/update_queue';

jest.mock('@zephyr3d/scene/app/api', () => {
  const frameInfo = { frameCounter: 0, elapsedFrame: 16, elapsedOverall: 0 };
  return {
    tryGetApp: jest.fn(() => null),
    getDevice: jest.fn(() => ({
      frameInfo,
      getDeviceCaps: () => ({ textureCaps: { maxTextureSize: 4096 } }),
      createTexture2D: () => null
    })),
    __frameInfo: frameInfo
  };
});

const frameInfo = (require('@zephyr3d/scene/app/api') as { __frameInfo: { frameCounter: number } })
  .__frameInfo;

type Item = { stamp?: number };

function itemQueue() {
  return new UpdateQueue<Item>(
    (item) => item.stamp,
    (item, stamp) => (item.stamp = stamp)
  );
}

/** A node counting its updates, re-queuing itself from update() as animated nodes do */
class SelfQueuingNode extends SceneNode {
  updates = 0;
  update(frameId: number, elapsed: number, delta: number) {
    super.update(frameId, elapsed, delta);
    this.updates++;
    this.scene?.queueUpdateNode(this);
  }
}

/** A scene whose update touches nothing but its queues: no image based light to refresh */
function newScene() {
  const scene = new Scene();
  scene.env.light.type = 'constant';
  return scene;
}

function step(scene: Scene) {
  frameInfo.frameCounter++;
  scene.frameUpdate();
}

describe('UpdateQueue', () => {
  test('queues an item once until taken, in queuing order', () => {
    const queue = itemQueue();
    const a: Item = {};
    const b: Item = {};
    queue.add(a);
    queue.add(b);
    queue.add(a);
    expect(queue.size).toBe(2);
    expect(queue.take()).toEqual([a, b]);
    expect(queue.size).toBe(0);
  });

  test('takes an item queued again while the taken items are processed', () => {
    const queue = itemQueue();
    const a: Item = {};
    queue.add(a);
    for (const item of queue.take()) {
      queue.add(item);
      queue.add(item);
    }
    expect(queue.take()).toEqual([a]);
  });

  test('never mistakes an item queued in another queue for already queued', () => {
    const first = itemQueue();
    const second = itemQueue();
    const a: Item = {};
    first.add(a);
    second.add(a);
    expect(first.take()).toEqual([a]);
    expect(second.take()).toEqual([a]);
  });

  test('drops cleared items and queues them again afterwards', () => {
    const queue = itemQueue();
    const a: Item = {};
    queue.add(a);
    queue.clear();
    expect(queue.size).toBe(0);
    queue.add(a);
    expect(queue.take()).toEqual([a]);
  });
});

describe('Scene update queue', () => {
  test('updates a node re-queuing itself from update() once every frame', () => {
    const scene = newScene();
    const node = new SelfQueuingNode(scene);
    node.parent = scene.rootNode;
    node.updates = 0;
    scene.queueUpdateNode(node);
    scene.queueUpdateNode(node);
    for (let i = 0; i < 5; i++) {
      step(scene);
    }
    expect(node.updates).toBe(5);
    scene.dispose();
  });

  test('updates a node only in its own scene, once a frame', () => {
    // A node waits in one update queue of each kind at most, which its stamps rely on: queued in
    // the queues of two scenes, either would overwrite the other's stamp and queue it twice
    const a = newScene();
    const b = newScene();
    const node = new SelfQueuingNode(a);
    node.parent = a.rootNode;
    step(a);
    const updates = node.updates;
    b.queueUpdateNode(node);
    step(b);
    expect(node.updates).toBe(updates);
    step(a);
    step(a);
    expect(node.updates).toBe(updates + 2);
    a.dispose();
    b.dispose();
  });
});
