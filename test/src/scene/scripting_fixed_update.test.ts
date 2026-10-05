import { MemoryFS } from '@zephyr3d/base';
import { RuntimeScript, Scene, SceneNode, ScriptingSystem } from '@zephyr3d/scene';

class FixedScript extends RuntimeScript<SceneNode> {
  steps: number[] = [];
  onFixedUpdate(fixedDeltaTime: number) {
    this.steps.push(fixedDeltaTime);
  }
}
/** Predates onFixedUpdate and does not define it. */
class PlainScript extends RuntimeScript<SceneNode> {}

async function attach<T extends RuntimeScript<SceneNode>>(
  system: ScriptingSystem,
  host: SceneNode,
  cls: new () => T
) {
  return (await system.attachScriptIndirect(host, { url: cls.name, id: cls.name, cls }))! as T;
}

describe('ScriptingSystem.fixedUpdate', () => {
  it('calls onFixedUpdate on the hosts the filter accepts', async () => {
    const system = new ScriptingSystem({ VFS: new MemoryFS() });
    const sceneA = new Scene();
    const sceneB = new Scene();
    const a = await attach(system, new SceneNode(sceneA), FixedScript);
    const b = await attach(system, new SceneNode(sceneB), FixedScript);
    await attach(system, new SceneNode(sceneA), PlainScript);
    system.fixedUpdate(0.5, (host) => host instanceof SceneNode && host.scene === sceneA);
    system.fixedUpdate(0.25);
    expect(a.steps).toEqual([0.5, 0.25]);
    expect(b.steps).toEqual([0.25]);
  });

  it('is never called by the per-frame update', async () => {
    const system = new ScriptingSystem({ VFS: new MemoryFS() });
    const script = await attach(system, new SceneNode(new Scene()), FixedScript);
    system.update(0.016, 1);
    expect(script.steps).toEqual([]);
  });
});
