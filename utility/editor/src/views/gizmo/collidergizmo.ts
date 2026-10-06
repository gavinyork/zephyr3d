import type { Camera, Scene, SceneNode } from '@zephyr3d/scene';
import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import {
  CharacterController,
  Collider,
  Joint,
  RigidBody,
  getColliderOutline,
  getColliderOutlineKey,
  isPhysicsReady,
  type ColliderOutline
} from '@zephyr3d/physics';
import type { AALineBatch, LineGizmo, PostGizmoRenderer } from './postgizmo';
import { PostGizmoRenderer as Renderer } from './postgizmo';

const COLOR_STATIC = new Vector3(0.3, 0.9, 0.35);
const COLOR_DYNAMIC = new Vector3(1, 0.6, 0.15);
const COLOR_KINEMATIC = new Vector3(0.35, 0.6, 1);
const COLOR_TRIGGER = new Vector3(1, 0.9, 0.2);
const COLOR_CHARACTER = new Vector3(0.2, 0.95, 0.95);
const COLOR_JOINT = new Vector4(1, 0.35, 0.85, 1);
/** Alpha of colliders that do not belong to a selected node. */
const DIM_ALPHA = 0.45;
/** Size of a joint's pivot cross and axis, in world units. */
const JOINT_MARK_SIZE = 0.15;

type OutlineTarget = Collider | CharacterController;

interface OutlineEntry {
  key: string;
  outline: Nullable<ColliderOutline>;
  batch: Nullable<AALineBatch>;
  /** Key of the outline being built, so a stale result is dropped. */
  pendingKey: Nullable<string>;
  error: Nullable<string>;
}

/**
 * Draws physics colliders, character capsules and joints in the scene view:
 * those on the selected nodes and below them, or everything in the scene.
 * Outlines come from the physics package, so they are the shapes the simulation
 * builds; they are rebuilt only when a collider's shape changes.
 */
export class ColliderGizmo {
  private readonly _renderer: PostGizmoRenderer;
  private readonly _entries: Map<OutlineTarget, OutlineEntry>;
  private readonly _jointGizmo: LineGizmo;
  private _showAll: boolean;
  private readonly _onErrorChanged: Nullable<() => void>;
  /**
   * @param onErrorChanged - Called when a collider's outline fails to build, or
   *   builds again, so the inspector can show {@link ColliderGizmo.getError}.
   */
  constructor(renderer: PostGizmoRenderer, onErrorChanged?: () => void) {
    this._renderer = renderer;
    this._onErrorChanged = onErrorChanged ?? null;
    this._entries = new Map();
    this._jointGizmo = { lines: [], width: 1.5, color: COLOR_JOINT };
    this._showAll = false;
    renderer.addLineGizmo(this._jointGizmo);
  }
  /** Draw the colliders of the whole scene, not only of the selection. */
  get showAll() {
    return this._showAll;
  }
  set showAll(value: boolean) {
    this._showAll = !!value;
  }
  /** Whether anything is drawn, so the gizmo renderer has to run. */
  get active() {
    return this._renderer.hasAALineBatches || this._jointGizmo.lines.length > 0;
  }
  /** Why a collider has no outline, for the inspector; null if it has one or is not drawn. */
  getError(target: OutlineTarget) {
    return this._entries.get(target)?.error ?? null;
  }
  update(scene: Nullable<Scene>, selected: SceneNode[], camera: Nullable<Camera>) {
    const targets = new Map<OutlineTarget, boolean>();
    const joints: Joint[] = [];
    const visit = (node: SceneNode, highlighted: boolean) => {
      node.iterate((child) => {
        for (const component of child.components) {
          if (component instanceof Collider || component instanceof CharacterController) {
            targets.set(component, highlighted || targets.get(component) === true);
          } else if (component instanceof Joint) {
            joints.push(component);
          }
        }
        return false;
      });
    };
    if (scene && camera && isPhysicsReady()) {
      if (this._showAll) {
        visit(scene.rootNode, false);
      }
      for (const node of selected) {
        if (node.scene === scene) {
          visit(node, true);
        }
      }
    }
    for (const [target, entry] of this._entries) {
      if (!targets.has(target)) {
        this.release(entry);
        this._entries.delete(target);
      }
    }
    const vp = camera?.viewProjectionMatrix;
    for (const [target, highlighted] of targets) {
      const entry = this.ensureOutline(target);
      if (entry.batch && entry.outline && vp) {
        const host = target.host!;
        Matrix4x4.multiply(vp, host.worldMatrix, entry.batch.mvpMatrix).multiplyRight(
          entry.outline.transform
        );
        const rgb = this.colorOf(target);
        entry.batch.color!.setXYZW(rgb.x, rgb.y, rgb.z, highlighted ? 1 : DIM_ALPHA);
        entry.batch.width = highlighted ? 1.5 : 1;
        entry.batch.enabled = true;
      }
    }
    this.updateJoints(joints, camera);
  }
  dispose() {
    for (const entry of this._entries.values()) {
      this.release(entry);
    }
    this._entries.clear();
    this._renderer.removeLineGizmo(this._jointGizmo);
  }
  private ensureOutline(target: OutlineTarget) {
    let entry = this._entries.get(target);
    if (!entry) {
      entry = { key: '', outline: null, batch: null, pendingKey: null, error: null };
      this._entries.set(target, entry);
    }
    const key = getColliderOutlineKey(target);
    if (key !== entry.key && key !== entry.pendingKey) {
      entry.pendingKey = key;
      const current = entry;
      getColliderOutline(target).then(
        (outline) => {
          if (this._entries.get(target) !== current || current.pendingKey !== key) {
            return;
          }
          current.pendingKey = null;
          current.key = key;
          this.setError(current, null);
          this.setOutline(current, outline);
        },
        (err) => {
          if (this._entries.get(target) !== current || current.pendingKey !== key) {
            return;
          }
          current.pendingKey = null;
          current.key = key;
          this.setError(current, err instanceof Error ? err.message : String(err));
          this.setOutline(current, null);
        }
      );
    }
    return entry;
  }
  private setError(entry: OutlineEntry, error: Nullable<string>) {
    if (entry.error !== error) {
      entry.error = error;
      this._onErrorChanged?.();
    }
  }
  private setOutline(entry: OutlineEntry, outline: Nullable<ColliderOutline>) {
    this.release(entry);
    entry.outline = outline;
    if (outline && outline.segments.length > 0) {
      entry.batch = {
        primitive: Renderer.createAALineBatch(outline.segments),
        count: outline.segments.length / 6,
        mvpMatrix: new Matrix4x4(),
        color: new Vector4(1, 1, 1, 1),
        enabled: false
      };
      this._renderer.addAALineBatch(entry.batch);
    }
  }
  private release(entry: OutlineEntry) {
    if (entry.batch) {
      this._renderer.removeAALineBatch(entry.batch);
      entry.batch.primitive.dispose();
      entry.batch = null;
    }
  }
  private colorOf(target: OutlineTarget) {
    if (target instanceof CharacterController) {
      return COLOR_CHARACTER;
    }
    if (target.isTrigger) {
      return COLOR_TRIGGER;
    }
    // The rigid body the collider belongs to: on its node or the nearest above.
    for (let node: Nullable<SceneNode> = target.host; node; node = node.parent) {
      const body = node.getComponent(RigidBody);
      if (body) {
        return body.motionType === 'dynamic'
          ? COLOR_DYNAMIC
          : body.motionType === 'kinematic'
            ? COLOR_KINEMATIC
            : COLOR_STATIC;
      }
    }
    return COLOR_STATIC;
  }
  /** Pivot crosses, hinge and slider axes, and lines to the connected end. */
  private updateJoints(joints: Joint[], camera: Nullable<Camera>) {
    const lines: Vector4[][] = [];
    if (camera) {
      const vp = camera.viewProjectionMatrix;
      const clip = (p: Vector3) => vp.transformPoint(p, new Vector4());
      for (const joint of joints) {
        const host = joint.host!;
        const pivot = host.worldMatrix.transformPointAffine(joint.anchor, new Vector3());
        for (const axis of [Vector3.axisPX(), Vector3.axisPY(), Vector3.axisPZ()]) {
          const d = host.worldMatrix.transformVectorAffine(axis, new Vector3()).inplaceNormalize();
          d.scaleBy(JOINT_MARK_SIZE * 0.5);
          lines.push([clip(Vector3.sub(pivot, d)), clip(Vector3.add(pivot, d))]);
        }
        if (joint.type === 'hinge' || joint.type === 'slider') {
          const d = host.worldMatrix.transformVectorAffine(joint.axis, new Vector3()).inplaceNormalize();
          d.scaleBy(JOINT_MARK_SIZE * 3);
          lines.push([clip(Vector3.sub(pivot, d)), clip(Vector3.add(pivot, d))]);
        }
        const other = joint.connectedBody;
        let end: Nullable<Vector3> = null;
        if (joint.type === 'rope' || joint.type === 'spring') {
          end = other
            ? other.worldMatrix.transformPointAffine(joint.connectedAnchor, new Vector3())
            : new Vector3(joint.connectedAnchor);
        } else if (other) {
          end = other.getWorldPosition();
        }
        if (end) {
          lines.push([clip(pivot), clip(end)]);
        }
      }
    }
    this._jointGizmo.lines = lines;
  }
}
