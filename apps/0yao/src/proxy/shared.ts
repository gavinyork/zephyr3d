import { DRef, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import type { EditorMenuContext, EditorPluginContext } from '@zephyr3d/editor/editor-plugin';
import { PlaneShape, SphereShape, UnlitMaterial } from '@zephyr3d/scene';
import { BoundingBox, Mesh, Primitive, SceneNode } from '@zephyr3d/scene';

const PLANE_NORMAL_PROXY_NAME = '$__PLANE_NORMAL_PROXY__$';

const _colliderProxyMaterial: DRef<UnlitMaterial> = new DRef();
const _colliderPlanePrimitive: DRef<Primitive> = new DRef();
const _colliderSpherePrimitive: DRef<Primitive> = new DRef();

export function handleAddCollider(
  menuCtx: EditorMenuContext,
  node: SceneNode,
  type: 'sphere' | 'capsule' | 'plane'
) {
  const defaultMeta =
    type === 'sphere'
      ? {
          sceneCollider: {
            type: 'sphere',
            enabled: true,
            visible: true,
            radius: 0.15
          }
        }
      : type === 'capsule'
        ? {
            sceneCollider: {
              type: 'capsule',
              enabled: true,
              visible: true,
              offset: 0.1,
              endOffset: 0.1,
              radius: 0.1
            }
          }
        : {
            sceneCollider: {
              type: 'plane',
              enabled: true,
              visible: true,
              normal: 1,
              planeSize: 0.5
            }
          };
  const typeName = type === 'sphere' ? 'Sphere' : type === 'capsule' ? 'Capsule' : 'Plane';
  menuCtx.scene.commands.addChildNode(node, SceneNode).then((colliderNode) => {
    if (!colliderNode) {
      return;
    }
    let index = 1;
    while (node.children.find((c) => c.name === `${typeName}Collider_${index}`)) {
      index++;
    }
    colliderNode.name = `${typeName}Collider_${index}`;
    colliderNode.metaData = defaultMeta as any;
    colliderNode.gpuPickable = true;
    menuCtx.scene.proxy.createProxy(colliderNode);
    menuCtx.scene.proxy.updateProxy(colliderNode);
    menuCtx.scene.commands.selectNode(colliderNode);
    menuCtx.scene.refreshProperties();
    menuCtx.scene.notifySceneChanged();
  });
}

function fromToRotation(from: Vector3, to: Vector3): Quaternion {
  const f = from.clone().inplaceNormalize();
  const t = to.clone().inplaceNormalize();
  return Quaternion.unitVectorToUnitVector(f, t);
  /*
    const dot = Math.max(-1, Math.min(1, Vector3.dot(f, t)));
    if (dot > 0.999999) {
      return Quaternion.identity();
    }
    if (dot < -0.999999) {
      const ortho = Math.abs(f.x) < 0.9 ? Vector3.axisPX() : Vector3.axisPY();
      const axis = Vector3.cross(f, ortho, new Vector3()).inplaceNormalize();
      return Quaternion.fromAxisAngle(axis, Math.PI);
    }
    const axis = Vector3.cross(f, t, new Vector3()).inplaceNormalize();
    const angle = Math.acos(dot);
    return Quaternion.fromAxisAngle(axis, angle);
    */
}

function getColliderProxyMaterial(): UnlitMaterial {
  if (!_colliderProxyMaterial.get()) {
    const m = new UnlitMaterial();
    m.blendMode = 'blend';
    m.cullMode = 'none';
    m.opacity = 0.3;
    m.albedoColor = new Vector4(0, 0, 1, 1);
    _colliderProxyMaterial.set(m);
  }
  return _colliderProxyMaterial.get();
}

function normalizeCapsuleAxisDistance(value: unknown, fallback: number): number {
  const minValue = 0.0001;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(minValue, Math.abs(value));
  }
  if (Array.isArray(value) && value.length >= 3) {
    const x = Number(value[0]) || 0;
    const y = Number(value[1]) || 0;
    const z = Number(value[2]) || 0;
    const axisDistance = Math.abs(x) > 1e-6 ? Math.abs(x) : Math.hypot(x, y, z);
    return Math.max(minValue, axisDistance || fallback);
  }
  return Math.max(minValue, Math.abs(fallback));
}
function normalizePlaneNormalY(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 0 ? -1 : 1;
  }
  if (Array.isArray(value) && value.length >= 3) {
    const y = Number(value[1]) || 0;
    return y < 0 ? -1 : 1;
  }
  return fallback < 0 ? -1 : 1;
}

export function getSpringColliderMeta(src: SceneNode): any | null {
  const meta = src.metaData as any;
  const collider = meta?.sceneCollider ?? meta?.springCollider;
  if (!collider || typeof collider !== 'object') {
    return null;
  }
  if (collider.type !== 'sphere' && collider.type !== 'capsule' && collider.type !== 'plane') {
    return null;
  }
  // Migrate legacy fields so the inspector only exposes the new visibility toggle.
  if (collider.visible === undefined) {
    collider.visible = true;
  }
  if ('opacity' in collider) {
    delete collider.opacity;
  }
  if ('alpha' in collider) {
    delete collider.alpha;
  }
  if (collider.type === 'sphere' && 'offset' in collider) {
    delete collider.offset;
  }
  if (collider.type === 'capsule') {
    collider.offset = normalizeCapsuleAxisDistance(collider.offset, 0.1);
    collider.endOffset = normalizeCapsuleAxisDistance(collider.endOffset, 0.1);
  }
  if (collider.type === 'plane') {
    if ('offset' in collider) {
      delete collider.offset;
    }
    collider.normal = normalizePlaneNormalY(collider.normal, 1);
  }
  return {
    ...collider,
    __unitScale: meta?.sceneCollider ? 1 : 0.1
  };
}

function createCapsuleSolidPrimitive(radius: number, axisLength: number) {
  const r = Math.max(0.001, radius);
  const halfAxis = Math.max(0, axisLength) * 0.5;
  const radialSegments = 24;
  const hemiStacks = 8;
  const vertices: number[] = [];
  const indices: number[] = [];
  const rings: Array<{ y: number; radius: number }> = [];
  for (let i = 1; i < hemiStacks; i++) {
    const angle = -Math.PI * 0.5 + (i / hemiStacks) * (Math.PI * 0.5);
    rings.push({
      y: -halfAxis + Math.sin(angle) * r,
      radius: Math.cos(angle) * r
    });
  }
  rings.push({ y: -halfAxis, radius: r });
  if (halfAxis > 1e-6) {
    rings.push({ y: halfAxis, radius: r });
  }
  for (let i = 1; i < hemiStacks; i++) {
    const angle = (i / hemiStacks) * (Math.PI * 0.5);
    rings.push({
      y: halfAxis + Math.sin(angle) * r,
      radius: Math.cos(angle) * r
    });
  }
  const bottomPole = 0;
  vertices.push(0, -halfAxis - r, 0);
  for (const ring of rings) {
    for (let i = 0; i < radialSegments; i++) {
      const angle = (i / radialSegments) * Math.PI * 2;
      vertices.push(Math.cos(angle) * ring.radius, ring.y, Math.sin(angle) * ring.radius);
    }
  }
  const topPole = vertices.length / 3;
  vertices.push(0, halfAxis + r, 0);
  const ringVertex = (ringIndex: number, segment: number) => 1 + ringIndex * radialSegments + segment;
  if (rings.length > 0) {
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      indices.push(bottomPole, ringVertex(0, next), ringVertex(0, i));
    }
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let i = 0; i < radialSegments; i++) {
        const next = (i + 1) % radialSegments;
        const a = ringVertex(ring, i);
        const b = ringVertex(ring, next);
        const c = ringVertex(ring + 1, i);
        const d = ringVertex(ring + 1, next);
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }
    const lastRing = rings.length - 1;
    for (let i = 0; i < radialSegments; i++) {
      const next = (i + 1) % radialSegments;
      indices.push(ringVertex(lastRing, i), ringVertex(lastRing, next), topPole);
    }
  }
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
  primitive.createAndSetIndexBuffer(new Uint16Array(indices));
  primitive.primitiveType = 'triangle-list';
  primitive.indexStart = 0;
  primitive.indexCount = indices.length;
  primitive.setBoundingVolume(
    new BoundingBox(new Vector3(-r, -halfAxis - r, -r), new Vector3(r, halfAxis + r, r))
  );
  return primitive;
}

function createPlaneNormalPrimitive(ctx: EditorPluginContext) {
  return ctx
    .getSceneContext()
    .proxy.createLinePrimitive(
      [0, 0, 0, 0, 0.6, 0, 0.08, 0.48, 0, -0.08, 0.48, 0, 0, 0.48, 0.08, 0, 0.48, -0.08],
      [0, 1, 1, 2, 1, 3, 1, 4, 1, 5],
      new BoundingBox(new Vector3(-0.08, 0, -0.08), new Vector3(0.08, 0.6, 0.08))
    );
}
function ensurePlaneNormalProxy(ctx: EditorPluginContext, proxy: Mesh): Mesh {
  let direction = proxy.children.find((child) => child.name === PLANE_NORMAL_PROXY_NAME) as Mesh;
  if (!direction) {
    direction = new Mesh(
      proxy.scene,
      createPlaneNormalPrimitive(ctx),
      getColliderProxyMaterial().createInstance()
    );
    direction.sealed = true;
    direction.parent = proxy;
    direction.showState = 'inherit';
    direction.castShadow = false;
    direction.name = PLANE_NORMAL_PROXY_NAME;
    const directionMat = direction.material as UnlitMaterial;
    directionMat.opacity = 1;
    directionMat.albedoColor = new Vector4(0, 0, 1, 1);
  }
  return direction;
}

export function getSpringColliderProxyMesh(ctx: EditorPluginContext, src: SceneNode) {
  const meta = getSpringColliderMeta(src);
  const type = meta?.type ?? 'sphere';
  if (type === 'capsule') {
    return new Mesh(
      src.scene,
      createCapsuleSolidPrimitive(0.1, 0.2),
      getColliderProxyMaterial().createInstance()
    );
  }
  if (type === 'plane') {
    if (!_colliderPlanePrimitive.get()) {
      _colliderPlanePrimitive.set(new PlaneShape({ size: 1 }));
    }
    const proxy = new Mesh(
      src.scene,
      _colliderPlanePrimitive.get(),
      getColliderProxyMaterial().createInstance()
    );
    ensurePlaneNormalProxy(ctx, proxy);
    return proxy;
  }
  if (!_colliderSpherePrimitive.get()) {
    _colliderSpherePrimitive.set(new SphereShape({ radius: 0.5 }));
  }
  return new Mesh(src.scene, _colliderSpherePrimitive.get(), getColliderProxyMaterial().createInstance());
}
export function updateSpringColliderProxy(ctx: EditorPluginContext, proxy: Mesh, meta: any) {
  const unitScale = Number(meta?.__unitScale) || 1;
  const mat = proxy.material as UnlitMaterial;
  const visible = meta?.visible !== false;
  proxy.showState = visible ? 'visible' : 'hidden';
  mat.opacity = 0.3;
  mat.albedoColor = new Vector4(0, 0, 1, 1);
  if (!visible) {
    return;
  }
  if (meta.type === 'sphere') {
    const radius = Math.max(0.001, (Number(meta.radius) || 0.15) * unitScale);
    proxy.position.setXYZ(0, 0, 0);
    proxy.rotation.identity();
    proxy.scale.setXYZ(radius * 2, radius * 2, radius * 2);
    return;
  }
  if (meta.type === 'capsule') {
    const radius = Math.max(0.001, (Number(meta.radius) || 0.1) * unitScale);
    const startDistance = normalizeCapsuleAxisDistance(meta.offset, 0.1) * unitScale;
    const endDistance = normalizeCapsuleAxisDistance(meta.endOffset, 0.1) * unitScale;
    const startOffset = new Vector3(startDistance, 0, 0);
    const endOffset = new Vector3(-endDistance, 0, 0);
    const center = Vector3.scale(Vector3.add(startOffset, endOffset, new Vector3()), 0.5, new Vector3());
    const axis = Vector3.sub(endOffset, startOffset, new Vector3());
    const length = Math.max(0.001, axis.magnitude);
    const dir = Vector3.scale(axis, 1 / length, new Vector3());
    const rot = fromToRotation(Vector3.axisPY(), dir);
    const capsuleKey = `${radius.toFixed(6)}|${length.toFixed(6)}`;
    if ((proxy as any).__capsuleKey !== capsuleKey) {
      const oldPrimitive = proxy.primitive;
      proxy.primitive = createCapsuleSolidPrimitive(radius, length);
      (proxy as any).__capsuleKey = capsuleKey;
      oldPrimitive?.dispose();
    }
    proxy.position.set(center);
    proxy.rotation.set(rot);
    proxy.scale.setXYZ(1, 1, 1);
    return;
  }
  const normalY = normalizePlaneNormalY(meta.normal, 1);
  const normal = new Vector3(0, normalY, 0);
  const planeSize = Math.max(0.001, (Number(meta.planeSize) || 0.5) * unitScale);
  const n = normal.magnitudeSq > 1e-6 ? normal.inplaceNormalize() : Vector3.axisPY();
  const rot = fromToRotation(Vector3.axisPY(), n);
  proxy.position.setXYZ(0, 0, 0);
  proxy.rotation.set(rot);
  proxy.scale.setXYZ(planeSize * 2, planeSize * 2, 1);
  const direction = ensurePlaneNormalProxy(ctx, proxy);
  if (direction) {
    direction.position.setXYZ(0, 0, 0);
    direction.rotation.identity();
    direction.scale.setXYZ(1, 1, 1);
    direction.showState = visible ? 'visible' : 'hidden';
  }
}
