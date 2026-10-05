import { Disposable, Quaternion, Vector3, type Nullable } from '@zephyr3d/base';
import { MemoryFS } from '@zephyr3d/base';
import {
  GPUClothComponent,
  getSceneNodeComponentTypes,
  registerSceneNodeComponentType,
  ResourceManager,
  Scene,
  SceneNode,
  type SceneNodeComponent
} from '@zephyr3d/scene';
import * as api from '../../../libs/scene/src/app/api';

/** A minimal component that records its lifecycle. */
class TestComponent extends Disposable implements SceneNodeComponent {
  value: number;
  log: string[] = [];
  private _host: Nullable<SceneNode> = null;
  constructor(value = 0) {
    super();
    this.value = value;
  }
  get host() {
    return this._host;
  }
  attach(host: SceneNode) {
    this._host = host;
    this.log.push('attach');
  }
  detach() {
    this._host = null;
    this.log.push('detach');
  }
  hostAttached() {
    this.log.push('hostAttached');
  }
  hostDetached() {
    this.log.push('hostDetached');
  }
}
class OtherComponent extends TestComponent {}

function registerTestComponent(manager: ResourceManager) {
  registerSceneNodeComponentType(TestComponent);
  manager.registerClass({
    ctor: TestComponent,
    name: 'TestComponent',
    createFunc(_ctx, init) {
      return { obj: new TestComponent(init as number), loadProps: false };
    },
    getInitParams(component: TestComponent) {
      return component.value;
    },
    getProps() {
      return [];
    }
  });
}

describe('SceneNode components', () => {
  it('adds, finds and removes components, disposing what it removes', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    const a = node.addComponent(new TestComponent());
    const b = node.addComponent(new OtherComponent());
    expect(node.components).toEqual([a, b]);
    expect(a.host).toBe(node);
    // instanceof semantics: OtherComponent is also a TestComponent
    expect(node.getComponent(OtherComponent)).toBe(b);
    expect(node.getComponents(TestComponent)).toEqual([a, b]);
    // adding twice does nothing
    node.addComponent(a);
    expect(node.components).toEqual([a, b]);

    expect(node.removeComponent(a)).toBe(true);
    expect(a.disposed).toBe(true);
    expect(a.host).toBeNull();
    expect(node.removeComponent(a)).toBe(false);
    expect(node.components).toEqual([b]);

    node.dispose();
    expect(b.disposed).toBe(true);
    scene.dispose();
  });

  it('rejects a component owned by another node', () => {
    const scene = new Scene();
    const first = new SceneNode(scene);
    const second = new SceneNode(scene);
    const c = first.addComponent(new TestComponent());
    expect(() => second.addComponent(c)).toThrow('Component belongs to another scene node.');
    expect(first.components).toEqual([c]);
    expect(second.components).toHaveLength(0);
    scene.dispose();
  });

  it('tells components when the host enters and leaves a scene', () => {
    const scene = new Scene();
    const parent = new SceneNode(scene);
    const child = new SceneNode(scene);
    child.parent = parent;
    const c = child.addComponent(new TestComponent());
    parent.remove();
    parent.parent = scene.rootNode;
    expect(c.log).toEqual(['attach', 'hostDetached', 'hostAttached']);
    scene.dispose();
  });

  it('keeps GPU cloth components as their own subset', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    const generic = node.addComponent(new TestComponent());
    const cloth = node.addGPUClothComponent(new GPUClothComponent());
    expect(node.components).toEqual([generic, cloth]);
    expect(node.gpuClothComponents).toEqual([cloth]);
    expect(node.getComponent(GPUClothComponent)).toBe(cloth);

    // replacing the cloth list leaves other components alone
    node.gpuClothComponents = [];
    expect(cloth.disposed).toBe(true);
    expect(node.components).toEqual([generic]);
    expect(generic.disposed).toBe(false);
    scene.dispose();
  });

  it('round-trips generic and cloth components through serialization', async () => {
    const scene = new Scene();
    const manager = new ResourceManager(new MemoryFS());
    registerTestComponent(manager);
    const host = new SceneNode(scene);
    host.addComponent(new TestComponent(42));
    host.addGPUClothComponent(new GPUClothComponent());

    const serialized = await manager.serializeObject(host);
    const container = new SceneNode(scene);
    container.remove();
    const restored = (await manager.deserializeObject<SceneNode>(container, serialized))!;

    const generic = restored.getComponents(TestComponent);
    expect(generic).toHaveLength(1);
    expect(generic[0].value).toBe(42);
    expect(generic[0].host).toBe(restored);
    expect(restored.gpuClothComponents).toHaveLength(1);
    expect(restored.components).toHaveLength(2);
    scene.dispose();
  });

  it('registers component types once, in a live list', () => {
    const types = getSceneNodeComponentTypes();
    const before = types.length;
    class LateComponent extends TestComponent {}
    registerSceneNodeComponentType(LateComponent);
    registerSceneNodeComponentType(LateComponent);
    expect(types.length).toBe(before + 1);
    expect(types).toContain(LateComponent);
  });
});

describe('SceneNode.setWorldPose', () => {
  it('lands the node on the requested world pose under a transformed parent', () => {
    const scene = new Scene();
    const parent = new SceneNode(scene);
    parent.position.setXYZ(3, -2, 5);
    Quaternion.fromAxisAngle(new Vector3(0, 1, 0), 0.7, parent.rotation);
    parent.scale.setXYZ(2, 2, 2);
    const node = new SceneNode(scene);
    node.parent = parent;
    node.scale.setXYZ(0.5, 1, 3);

    const position = new Vector3(1, 2, 3);
    const rotation = Quaternion.fromAxisAngle(new Vector3(1, 0, 0), 0.4);
    let changes = 0;
    node.on('transformchanged', () => {
      changes++;
    });
    node.setWorldPose(position, rotation);

    const worldPos = new Vector3();
    const worldRot = new Quaternion();
    node.worldMatrix.decompose(null, worldRot, worldPos);
    expect(worldPos.x).toBeNear(1, 1e-4);
    expect(worldPos.y).toBeNear(2, 1e-4);
    expect(worldPos.z).toBeNear(3, 1e-4);
    // q and -q are the same rotation
    const dot = Math.abs(
      worldRot.x * rotation.x + worldRot.y * rotation.y + worldRot.z * rotation.z + worldRot.w * rotation.w
    );
    expect(dot).toBeNear(1, 1e-4);
    // local scale is kept, and the change is reported once
    expect([node.scale.x, node.scale.y, node.scale.z]).toEqual([0.5, 1, 3]);
    expect(changes).toBe(1);
    scene.dispose();
  });

  it('keeps the part that is omitted', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    node.position.setXYZ(4, 5, 6);
    node.setWorldPose(null, Quaternion.fromAxisAngle(new Vector3(0, 0, 1), 1));
    expect([node.position.x, node.position.y, node.position.z]).toEqual([4, 5, 6]);
    scene.dispose();
  });
});

describe("Scene 'afterupdate' event", () => {
  it('fires after queued nodes update and before the next frame', () => {
    let frame = 1;
    const device = {
      frameInfo: {
        get frameCounter() {
          return frame;
        },
        elapsedFrame: 16,
        elapsedOverall: 16
      }
    };
    const spy = jest.spyOn(api, 'getDevice').mockReturnValue(device as any);
    try {
      const scene = new Scene();
      // Environment lighting needs real device caps and is not what this test is about
      (scene as any).updateEnvLight = () => {};
      const order: string[] = [];
      const node = new SceneNode(scene);
      node.update = () => {
        order.push('node');
      };
      scene.on('update', () => void order.push('update'));
      scene.on('afterupdate', () => void order.push('afterupdate'));
      scene.queueUpdateNode(node);
      scene.frameUpdate();
      // once per device frame
      scene.frameUpdate();
      expect(order).toEqual(['update', 'node', 'afterupdate']);
      frame = 2;
      scene.frameUpdate();
      expect(order).toEqual(['update', 'node', 'afterupdate', 'update', 'afterupdate']);
      scene.dispose();
    } finally {
      spy.mockRestore();
    }
  });
});
