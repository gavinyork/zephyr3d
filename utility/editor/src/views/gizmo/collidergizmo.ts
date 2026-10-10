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
/**
 * Colliders farther than this from the camera are not drawn: each outline is a
 * draw call, and a scattered forest has hundreds of them.
 */
const MAX_OUTLINE_DISTANCE = 250;

const tmpMatrix = new Matrix4x4();
const tmpCenter = new Vector3();

/** Shapes whose outline depends only on the numbers in {@link OutlineEntry.params}. */
const SIMPLE_SHAPES = ['box', 'sphere', 'capsule', 'cylinder'];
const NUM_PARAMS = 13;
const tmpParams = new Float32Array(NUM_PARAMS);

/**
 * What the outline of a box, sphere, capsule or cylinder collider is built
 * from: shape, node scale, offset, size, radius and height. Cheap to read every
 * frame, unlike the outline key; false for shapes that also depend on geometry.
 */
function readParams(target: OutlineTarget, out: Float32Array) {
  const collider = target instanceof CharacterController ? target._ownedCollider : target;
  const shape = SIMPLE_SHAPES.indexOf(collider.shape);
  const host = collider.node;
  if (shape < 0 || !host) {
    return false;
  }
  const m = host.worldMatrix;
  out[0] = shape;
  out[1] = Math.hypot(m[0], m[1], m[2]);
  out[2] = Math.hypot(m[4], m[5], m[6]);
  out[3] = Math.hypot(m[8], m[9], m[10]);
  out[4] = collider.offset.x;
  out[5] = collider.offset.y;
  out[6] = collider.offset.z;
  out[7] = collider.size.x;
  out[8] = collider.size.y;
  out[9] = collider.size.z;
  out[10] = collider.radius;
  out[11] = collider.height;
  out[12] = 1;
  return true;
}

type OutlineTarget = Collider | CharacterController;

interface OutlineEntry {
  key: string;
  outline: Nullable<ColliderOutline>;
  batch: Nullable<AALineBatch>;
  /** Key of the outline being built, so a stale result is dropped. */
  pendingKey: Nullable<string>;
  error: Nullable<string>;
  /** Bounding sphere of the outline's segments, in the outline's space. */
  center: Vector3;
  radius: number;
  /** See {@link readParams}, when the key was last computed; all 0 when it is to be computed each frame. */
  params: Float32Array;
}

/**
 * Whether an outline with the bounding sphere (`center`, `radius`) in the space
 * of `model` is in front of the camera and near enough to draw.
 */
function isVisible(
  model: Matrix4x4,
  center: Vector3,
  radius: number,
  eye: Vector3,
  planes: readonly { distanceToPoint(p: Vector3): number; a: number; b: number; c: number }[]
) {
  const c = model.transformPointAffine(center, tmpCenter);
  const scale = Math.max(
    Math.hypot(model[0], model[1], model[2]),
    Math.hypot(model[4], model[5], model[6]),
    Math.hypot(model[8], model[9], model[10])
  );
  const r = radius * scale;
  if (Vector3.distance(c, eye) - r > MAX_OUTLINE_DISTANCE) {
    return false;
  }
  for (const plane of planes) {
    if (plane.distanceToPoint(c) < -r * Math.hypot(plane.a, plane.b, plane.c)) {
      return false;
    }
  }
  return true;
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
        // Colliders the engine makes for itself, such as those of scattered
        // foliage, are drawn only with a selected node above them
        if (!physics || (child.sealed && !highlighted)) {
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
    const eye = camera?.getWorldPosition();
    const planes = camera?.frustum.planes;
    for (const [target, highlighted] of targets) {
      // Out of view: not drawn, and whether its shape changed can wait until it is back
      const existing = this._entries.get(target);
      if (existing?.batch && existing.outline && vp) {
        const model = Matrix4x4.multiply(target.node!.worldMatrix, existing.outline.transform, tmpMatrix);
        if (!isVisible(model, existing.center, existing.radius, eye!, planes!)) {
          existing.batch.enabled = false;
          continue;
        }
      }
      const entry = this.ensureOutline(world!, target);
      if (entry.batch && entry.outline && vp) {
        const host = target.node!;
        const model = Matrix4x4.multiply(host.worldMatrix, entry.outline.transform, tmpMatrix);
        entry.batch.enabled = isVisible(model, entry.center, entry.radius, eye!, planes!);
        if (!entry.batch.enabled) {
          continue;
        }
        entry.batch.worldMatrix.set(model);
        const rgb = this.colorOf(target);
        entry.batch.color!.setXYZW(rgb.x, rgb.y, rgb.z, highlighted ? 1 : DIM_ALPHA);
        entry.batch.width = highlighted ? 1.5 : 1;
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
      entry = {
        key: '',
        outline: null,
        batch: null,
        pendingKey: null,
        error: null,
        center: new Vector3(),
        radius: 0,
        params: new Float32Array(NUM_PARAMS)
      };
      this._entries.set(target, entry);
    }
    if (readParams(target, tmpParams)) {
      let same = true;
      for (let i = 0; i < NUM_PARAMS; i++) {
        if (tmpParams[i] !== entry.params[i]) {
          same = false;
          break;
        }
      }
      if (same) {
        return entry;
      }
      entry.params.set(tmpParams);
    } else {
      entry.params.fill(0);
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
      const seg = outline.segments;
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      for (let i = 0; i < seg.length; i += 3) {
        min.setXYZ(Math.min(min.x, seg[i]), Math.min(min.y, seg[i + 1]), Math.min(min.z, seg[i + 2]));
        max.setXYZ(Math.max(max.x, seg[i]), Math.max(max.y, seg[i + 1]), Math.max(max.z, seg[i + 2]));
      }
      Vector3.scale(Vector3.add(min, max, entry.center), 0.5, entry.center);
      entry.radius = Vector3.distance(min, max) * 0.5;
      entry.batch = {
        primitive: Renderer.createAALineBatch(outline.segments),
        count: outline.segments.length / 6,
        worldMatrix: new Matrix4x4(),
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
