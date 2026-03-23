import type { Scene, SceneNode } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';
import { RuntimeScript, createSphereCollider, createCapsuleCollider, SpringModifier, SpringSystem, SpringChain } from '@zephyr3d/scene';

// Change HostType to your attachment type
type HostType = Scene;

export default class extends RuntimeScript<HostType> {
  private scene: Scene;
  private root: SceneNode;
  private bone1: SceneNode;
  private springSys: SpringSystem;
  /**
   * Called exactly once right after the constructor.
   * Use this for initialization that may be asynchronous (e.g., loading assets).
   * You can return a Promise to delay subsequent lifecycle steps until initialization completes.
   */
  onCreated(): void | Promise<void> {
  }

  /**
   * Called after onCreated() when this script is attached to a host object.
   * You should store the attached host in your own member(s) for later use.
   *
   * If this script is implemented as a singleton, it may be attached to multiple hosts.
   * In that case, onAttached() can be called multiple times; consider using an array
   * (or a Set) to keep track of all attached hosts.
   */
  onAttached(_host: HostType): void | Promise<void> {
    this.scene = _host;
    const chains = [
      ['hair_backjoint1', 'hair_backjoint9'],
      ['hair_bangLjoint1', 'hair_bangLjoint8'],
      ['hair_bangFjoint17', 'hair_bangFjoint21'],
      ['hair_bangRjoint9', 'hair_bangRjoint16']
    ];
    this.root = this.scene.findNodeByName('girlQ01');
    for (const t of chains) {
      const chain = SpringChain.fromBoneChain(_host.findNodeByName(t[0]), _host.findNodeByName(t[1]), { damping: 0.9, stiffness: 0.75 });
      const springSystem = new SpringSystem(chain, {
        gravity: new Vector3(0, -50, 0),
        iterations: 5,
        enableInertialForces: true,
        centrifugalScale: 2,
        coriolisScale: 1,
        //solver: 'xpbd',
      });
      springSystem.addCollider(createSphereCollider(new Vector3(0, 1.5, 0), 0.15, this.root));
      const springModifier = new SpringModifier(springSystem, 1);
      this.root.animationSet.skeletons[0].get().modifiers.push(springModifier);

      this.bone1 = _host.findNodeByName('bone1');
      this.springSys = new SpringSystem(SpringChain.fromBoneChain(this.bone1, _host.findNodeByName('bone5')));
      this.springSys.gravity.setXYZ(0, -80, 0);
      const colliderstart1 = _host.findNodeByName('capsulestart1');
      const colliderend1 = _host.findNodeByName('capsuleend1');
      this.springSys.addCollider(createCapsuleCollider(colliderstart1.getWorldPosition(), colliderend1.getWorldPosition(), 1 + 1));
      const colliderstart2 = _host.findNodeByName('capsulestart2');
      const colliderend2 = _host.findNodeByName('capsuleend2');
      this.springSys.addCollider(createCapsuleCollider(colliderstart2.getWorldPosition(), colliderend2.getWorldPosition(), 1 + 1));
    }
  }

  /**
   * Called once per frame.
   * Use this for per-frame updates such as animations, state changes, or logic.
   *
   * @param _deltaTime  Time elapsed since the previous frame (in seconds).
   * @param _elapsedTime Total time since this script started running (in seconds).
   */
  onUpdate(_deltaTime: number, _elapsedTime: number) {
    const d = 5;
    this.root.position.setXYZ(Math.sin(_elapsedTime * 1) * d, 0, 0);
    this.root.rotation.fromAxisAngle(Vector3.axisPY(), _elapsedTime * 8);

    this.bone1.position.z = Math.sin(_elapsedTime * 2) * 10;
    this.springSys.update(_deltaTime);
    this.springSys.applyToNodes();
  }
  /**
   * Called when this script is detached from a specific host via Engine.detachScript(),
   * or when that host is destroyed.
   * Update your stored list of attached hosts here (e.g., remove the host).
   */
  onDetached(_host: Scene) {
  }

  /**
   * Called after all hosts have been detached from this script.
   * The script instance will be discarded afterwards.
   * Use this to clean up resources and free memory (dispose handles, cancel timers, remove listeners, etc.).
   */
  onDestroy() {
  }
}
