import { Disposable, type Nullable } from '@zephyr3d/base';
import type { SceneNode, SceneNodeComponent } from '@zephyr3d/scene';
import { PhysicsWorld } from './world';

/**
 * Common lifecycle of the physics components: joins the scene's
 * {@link PhysicsWorld} while the host node is in a scene, leaves it otherwise.
 *
 * @public
 */
export abstract class PhysicsComponent extends Disposable implements SceneNodeComponent {
  private _host: Nullable<SceneNode>;
  private _world: Nullable<PhysicsWorld>;
  constructor() {
    super();
    this._host = null;
    this._world = null;
  }
  /** The node this component is attached to. */
  get host() {
    return this._host;
  }
  /** The world this component is part of, while its node is in a scene. */
  get world() {
    return this._world;
  }
  /** See {@link SceneNodeComponent}. */
  attach(host: SceneNode) {
    if (this._host === host) {
      return;
    }
    if (this._host) {
      throw new Error('Physics component is already attached to another scene node.');
    }
    this._host = host;
    if (host.attached) {
      this.hostAttached();
    }
  }
  /** See {@link SceneNodeComponent}. */
  detach(host?: SceneNode) {
    if (!this._host || (host && this._host !== host)) {
      return;
    }
    this.hostDetached();
    this._host = null;
  }
  /** See {@link SceneNodeComponent}. */
  hostAttached() {
    const scene = this._host?.scene;
    if (scene && !this._world) {
      this._world = PhysicsWorld.get(scene);
      this._join(this._world);
    }
  }
  /** See {@link SceneNodeComponent}. */
  hostDetached() {
    if (this._world) {
      if (!this._world.disposed) {
        this._leave(this._world);
      }
      this._world = null;
    }
  }
  /** @internal */
  protected abstract _join(world: PhysicsWorld): void;
  /** @internal */
  protected abstract _leave(world: PhysicsWorld): void;
  protected onDispose() {
    super.onDispose();
    this.detach();
  }
}
