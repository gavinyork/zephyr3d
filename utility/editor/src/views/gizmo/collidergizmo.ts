import type {
  Camera,
  Collider,
  ColliderOutline,
  Joint,
  PhysicsWorld,
  Scene,
  SceneNode,
  Wheel
} from '@zephyr3d/scene';
import { CharacterController } from '@zephyr3d/scene';
import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import type { AALineBatch, LineGizmo, PostGizmoRenderer } from './postgizmo';
import { PostGizmoRenderer as Renderer } from './postgizmo';

const COLOR_STATIC = new Vector3(0.3, 0.9, 0.35);
const COLOR_DYNAMIC = new Vector3(1, 0.6, 0.15);
const COLOR_KINEMATIC = new Vector3(0.35, 0.6, 1);
const COLOR_TRIGGER = new Vector3(1, 0.9, 0.2);
const COLOR_CHARACTER = new Vector3(0.2, 0.95, 0.95);
const COLOR_JOINT = new Vector4(1, 0.35, 0.85, 1);
const COLOR_WHEEL = new Vector4(0.95, 0.95, 0.95, 1);
function forwardVector(forward: string) {
  switch (forward) {
    case '-z':
      return Vector3.axisNZ();
    case '+x':
      return Vector3.axisPX();
    case '-x':
      return Vector3.axisNX();
    default:
      return Vector3.axisPZ();
  }
}
/** Segments per wheel circle. */
const WHEEL_SEGMENTS = 32;
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
 * Outlines come from the scene's physics world, so they are the shapes the
 * simulation builds; they are rebuilt only when a collider's shape changes.
 */
export class ColliderGizmo {
  private readonly _renderer: PostGizmoRenderer;
  private readonly _entries: Map<OutlineTarget, OutlineEntry>;
  private readonly _jointGizmo: LineGizmo;
  private readonly _wheelGizmo: LineGizmo;
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
    this._wheelGizmo = { lines: [], width: 1.5, color: COLOR_WHEEL };
    this._showAll = false;
    renderer.addLineGizmo(this._jointGizmo);
    renderer.addLineGizmo(this._wheelGizmo);
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
    return (
      this._renderer.hasAALineBatches ||
      this._jointGizmo.lines.length > 0 ||
      this._wheelGizmo.lines.length > 0
    );
  }
  /** Why a collider has no outline, for the inspector; null if it has one or is not drawn. */
  getError(target: OutlineTarget) {
    return this._entries.get(target)?.error ?? null;
  }
  update(scene: Nullable<Scene>, selected: SceneNode[], camera: Nullable<Camera>) {
    const targets = new Map<OutlineTarget, boolean>();
    const joints: Joint[] = [];
    const wheels: Wheel[] = [];
    const visit = (node: SceneNode, highlighted: boolean) => {
      node.iterate((child) => {
        const physics = child.physics;
        if (!physics) {
          return false;
        }
        const outlined: OutlineTarget[] = [...physics.colliders];
        if (physics.character) {
          outlined.push(physics.character);
        }
        for (const target of outlined) {
          targets.set(target, highlighted || targets.get(target) === true);
        }
        if (physics.joint && !joints.includes(physics.joint)) {
          joints.push(physics.joint);
        }
        if (physics.wheel && !wheels.includes(physics.wheel)) {
          wheels.push(physics.wheel);
        }
        return false;
      });
    };
    if (scene && camera) {
      if (this._showAll) {
        visit(scene.rootNode, false);
      }
      for (const node of selected) {
        if (node.scene === scene) {
          visit(node, true);
        }
      }
    }
    // Outlines are built by the scene's physics world, asked for only when there
    // is something to draw; without a physics engine there is none.
    const world = targets.size > 0 || joints.length > 0 || wheels.length > 0 ? scene!.physicsWorld : null;
    if (!world) {
      targets.clear();
      joints.length = 0;
      wheels.length = 0;
    }
    for (const [target, entry] of this._entries) {
      if (!targets.has(target)) {
        this.release(entry);
        this._entries.delete(target);
      }
    }
    const vp = camera?.viewProjectionMatrix;
    for (const [target, highlighted] of targets) {
      const entry = this.ensureOutline(world!, target);
      if (entry.batch && entry.outline && vp) {
        const host = target.node!;
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
    this.updateWheels(wheels, camera);
  }
  dispose() {
    for (const entry of this._entries.values()) {
      this.release(entry);
    }
    this._entries.clear();
    this._renderer.removeLineGizmo(this._jointGizmo);
    this._renderer.removeLineGizmo(this._wheelGizmo);
  }
  private ensureOutline(world: PhysicsWorld, target: OutlineTarget) {
    let entry = this._entries.get(target);
    if (!entry) {
      entry = { key: '', outline: null, batch: null, pendingKey: null, error: null };
      this._entries.set(target, entry);
    }
    const key = world.getColliderOutlineKey(target);
    if (key !== entry.key && key !== entry.pendingKey) {
      entry.pendingKey = key;
      const current = entry;
      world.getColliderOutline(target).then(
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
    for (let node: Nullable<SceneNode> = target.node; node; node = node.parent) {
      const body = node.physics?.body;
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
  /**
   * Each wheel as its vehicle sees it at rest: a circle of its radius about the
   * axle, through the wheel node's position, and its suspension from where it is
   * attached down to the centre, with its travel marked.
   */
  private updateWheels(wheels: Wheel[], camera: Nullable<Camera>) {
    const lines: Vector4[][] = [];
    if (camera) {
      const vp = camera.viewProjectionMatrix;
      const clip = (p: Vector3) => vp.transformPoint(p, new Vector4());
      for (const wheel of wheels) {
        const node = wheel.node!;
        // The vehicle's axes: its node's up and front, without scale.
        let vehicleNode: Nullable<SceneNode> = node.parent;
        while (vehicleNode && !vehicleNode.physics?.vehicle) {
          vehicleNode = vehicleNode.parent;
        }
        const vehicle = vehicleNode?.physics?.vehicle ?? null;
        const frame = (vehicleNode ?? node).worldMatrix;
        const up = frame.transformVectorAffine(Vector3.axisPY(), new Vector3()).inplaceNormalize();
        const front = frame
          .transformVectorAffine(forwardVector(vehicle?.forward ?? '+z'), new Vector3())
          .inplaceNormalize();
        const center = node.getWorldPosition();
        const top = Vector3.add(center, Vector3.scale(up, wheel.suspensionRestLength));
        lines.push([clip(top), clip(center)]);
        // Travel either side of rest.
        const t = wheel.maxSuspensionTravel;
        const tick = Vector3.scale(front, 0.05);
        for (const d of [t, -t]) {
          const p = Vector3.add(center, Vector3.scale(up, d));
          lines.push([clip(Vector3.sub(p, tick)), clip(Vector3.add(p, tick))]);
        }
        const circle: Vector4[] = [];
        for (let i = 0; i <= WHEEL_SEGMENTS; i++) {
          const a = (i / WHEEL_SEGMENTS) * Math.PI * 2;
          const p = Vector3.add(
            center,
            Vector3.add(
              Vector3.scale(up, Math.cos(a) * wheel.radius),
              Vector3.scale(front, Math.sin(a) * wheel.radius)
            )
          );
          circle.push(clip(p));
        }
        lines.push(circle);
      }
    }
    this._wheelGizmo.lines = lines;
  }
  /** Pivot crosses, hinge and slider axes, and lines to the connected end. */
  private updateJoints(joints: Joint[], camera: Nullable<Camera>) {
    const lines: Vector4[][] = [];
    if (camera) {
      const vp = camera.viewProjectionMatrix;
      const clip = (p: Vector3) => vp.transformPoint(p, new Vector4());
      for (const joint of joints) {
        const host = joint.node!;
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
