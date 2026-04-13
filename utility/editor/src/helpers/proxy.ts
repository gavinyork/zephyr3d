import { Matrix4x4, Quaternion, Vector3, Vector4, DRef, DWeakRef, Disposable } from '@zephyr3d/base';
import type { Scene, SceneNode } from '@zephyr3d/scene';
import { TetrahedronFrameShape } from '@zephyr3d/scene';
import {
  BoundingBox,
  Mesh,
  PlaneShape,
  SphereShape,
  Primitive,
  UnlitMaterial,
  PerspectiveCamera
} from '@zephyr3d/scene';

const PROXY_NAME = '$__PROXY__$';
const PLANE_NORMAL_PROXY_NAME = '$__PLANE_NORMAL_PROXY__$';

export class NodeProxy extends Disposable {
  private readonly _diamondPrimitive: DRef<Primitive>;
  private readonly _spotLightPrimitive: DRef<Primitive>;
  private readonly _directionalLightPrimitive: DRef<Primitive>;
  private readonly _rectLightPrimitive: DRef<Primitive>;
  private readonly _perspectiveCameraPrimitive: DRef<TetrahedronFrameShape>;
  private readonly _colliderSpherePrimitive: DRef<SphereShape>;
  private readonly _colliderPlanePrimitive: DRef<PlaneShape>;
  private readonly _lightProxyMaterial: DRef<UnlitMaterial>;
  private readonly _colliderProxyMaterial: DRef<UnlitMaterial>;
  private _scene: Scene;
  private _proxyList: DWeakRef<Mesh>[];
  constructor(scene: Scene) {
    super();
    this._scene = scene;
    this._diamondPrimitive = new DRef();
    this._spotLightPrimitive = new DRef();
    this._directionalLightPrimitive = new DRef();
    this._rectLightPrimitive = new DRef();
    this._perspectiveCameraPrimitive = new DRef();
    this._colliderSpherePrimitive = new DRef();
    this._colliderPlanePrimitive = new DRef();
    this._lightProxyMaterial = new DRef(new UnlitMaterial());
    this._colliderProxyMaterial = new DRef(new UnlitMaterial());
    this._colliderProxyMaterial.get().blendMode = 'blend';
    this._colliderProxyMaterial.get().cullMode = 'none';
    this._colliderProxyMaterial.get().opacity = 0.3;
    this._colliderProxyMaterial.get().albedoColor = new Vector4(0, 0, 1, 1);
    this._proxyList = [];
  }
  getProto(proxy: SceneNode) {
    return this.isProxy(proxy) ? proxy.parent : proxy;
  }
  isProxy(node: SceneNode) {
    return node && node.name === PROXY_NAME && node.sealed;
  }
  createProxy(src: SceneNode) {
    if (this.isProxy(src)) {
      return;
    }
    const index = src.children.findIndex((val) => this.isProxy(val.get()));
    if (index >= 0) {
      return;
    }
    let proxy: Mesh;
    if (this.getSpringColliderMeta(src)) {
      proxy = this.getSpringColliderProxyMesh(src);
    } else if (src.isPunctualLight() && src.isDirectionLight()) {
      proxy = this.getDirectionalLightProxyMesh();
    } else if (src.isPunctualLight() && src.isSpotLight()) {
      proxy = this.getSpotLightProxyMesh();
    } else if (src.isPunctualLight() && src.isPointLight()) {
      proxy = this.getPointLightProxyMesh();
    } else if (src.isPunctualLight() && src.isRectLight()) {
      proxy = this.getRectLightProxyMesh();
    } else if (src instanceof PerspectiveCamera) {
      proxy = this.getPerspectiveCameraProxyMesh();
    }
    if (proxy) {
      proxy.sealed = true;
      proxy.parent = src;
      proxy.showState = 'inherit';
      proxy.castShadow = false;
      proxy.name = PROXY_NAME;
      this.updateProxy(src);
      this._proxyList.push(new DWeakRef(proxy));
    }
    return proxy;
  }
  updateProxy(src: SceneNode) {
    if (src) {
      const index = src.children.findIndex((val) => this.isProxy(val.get()));
      if (index >= 0) {
        const proxy = src.children[index].get() as Mesh;
        const material = proxy.material;
        const primitive = proxy.primitive;
        const springMeta = this.getSpringColliderMeta(src);
        if (springMeta) {
          const type = springMeta.type;
          const mismatch =
            (type === 'sphere' && !(primitive instanceof SphereShape)) ||
            (type === 'capsule' && (primitive instanceof SphereShape || primitive instanceof PlaneShape)) ||
            (type === 'plane' && !(primitive instanceof PlaneShape));
          if (mismatch) {
            proxy.remove();
            this.createProxy(src);
            return;
          }
          this.updateSpringColliderProxy(proxy, springMeta);
        } else if (src.isPunctualLight()) {
          (material as UnlitMaterial).albedoColor = new Vector4(src.color.x, src.color.y, src.color.z, 1);
          if (src.isPointLight()) {
            const range = src.range;
            primitive.setBoundingVolume(
              new BoundingBox(new Vector3(-range, -range, -range), new Vector3(range, range, range))
            );
          } else if (src.isSpotLight()) {
            const s = Math.tan(Math.acos(src.cutoff)) / 0.2;
            proxy.scale.setXYZ(s, s, 1);
          } else if (src.isRectLight()) {
            proxy.scale.setXYZ(src.width, src.height, 1);
          }
        } else if (src instanceof PerspectiveCamera) {
          proxy.scale.z = src.getFarPlane();
          proxy.scale.y = src.getTanHalfFovy() * src.getFarPlane();
          proxy.scale.x = proxy.scale.y * src.getAspect();
        }
      }
    }
  }
  hideProxy(src: SceneNode) {
    if (src) {
      const index = src.children.findIndex((val) => this.isProxy(val.get()));
      if (index >= 0) {
        const proxy = src.children[index].get() as Mesh;
        proxy.showState = 'hidden';
      }
    }
  }
  showProxy(src: SceneNode) {
    if (src) {
      const index = src.children.findIndex((val) => this.isProxy(val.get()));
      if (index >= 0) {
        const proxy = src.children[index].get() as Mesh;
        proxy.showState = 'visible';
      }
    }
  }
  protected onDispose() {
    super.onDispose();
    this._scene = null;
    this._diamondPrimitive.dispose();
    this._spotLightPrimitive.dispose();
    this._directionalLightPrimitive.dispose();
    this._rectLightPrimitive.dispose();
    this._perspectiveCameraPrimitive.dispose();
    this._colliderSpherePrimitive.dispose();
    this._colliderPlanePrimitive.dispose();
    this._lightProxyMaterial.dispose();
    this._colliderProxyMaterial.dispose();
    for (const ref of this._proxyList) {
      ref.dispose();
    }
    this._proxyList = [];
  }
  private getSpringColliderMeta(src: SceneNode): any | null {
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
      collider.offset = this.normalizeCapsuleAxisDistance(collider.offset, 0.1);
      collider.endOffset = this.normalizeCapsuleAxisDistance(collider.endOffset, 0.1);
    }
    if (collider.type === 'plane') {
      if ('offset' in collider) {
        delete collider.offset;
      }
      collider.normal = this.normalizePlaneNormalY(collider.normal, 1);
    }
    return {
      ...collider,
      __unitScale: meta?.sceneCollider ? 1 : 0.1
    };
  }
  private normalizeCapsuleAxisDistance(value: unknown, fallback: number): number {
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
  private normalizePlaneNormalY(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 0 ? -1 : 1;
    }
    if (Array.isArray(value) && value.length >= 3) {
      const y = Number(value[1]) || 0;
      return y < 0 ? -1 : 1;
    }
    return fallback < 0 ? -1 : 1;
  }
  private fromToRotation(from: Vector3, to: Vector3): Quaternion {
    const f = from.clone().inplaceNormalize();
    const t = to.clone().inplaceNormalize();
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
  }
  private getSpringColliderProxyMesh(src: SceneNode) {
    const meta = this.getSpringColliderMeta(src);
    const type = meta?.type ?? 'sphere';
    if (type === 'capsule') {
      return new Mesh(
        this._scene,
        NodeProxy.createCapsuleSolidPrimitive(0.1, 0.2),
        this._colliderProxyMaterial.get().createInstance()
      );
    }
    if (type === 'plane') {
      if (!this._colliderPlanePrimitive.get()) {
        this._colliderPlanePrimitive.set(new PlaneShape({ size: 1 }));
      }
      const proxy = new Mesh(this._scene, this._colliderPlanePrimitive.get(), this._colliderProxyMaterial.get().createInstance());
      this.ensurePlaneNormalProxy(proxy);
      return proxy;
    }
    if (!this._colliderSpherePrimitive.get()) {
      this._colliderSpherePrimitive.set(new SphereShape({ radius: 0.5 }));
    }
    return new Mesh(this._scene, this._colliderSpherePrimitive.get(), this._colliderProxyMaterial.get().createInstance());
  }
  private updateSpringColliderProxy(proxy: Mesh, meta: any) {
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
      const startDistance = this.normalizeCapsuleAxisDistance(meta.offset, 0.1) * unitScale;
      const endDistance = this.normalizeCapsuleAxisDistance(meta.endOffset, 0.1) * unitScale;
      const startOffset = new Vector3(startDistance, 0, 0);
      const endOffset = new Vector3(-endDistance, 0, 0);
      const center = Vector3.scale(Vector3.add(startOffset, endOffset, new Vector3()), 0.5, new Vector3());
      const axis = Vector3.sub(endOffset, startOffset, new Vector3());
      const length = Math.max(0.001, axis.magnitude);
      const dir = Vector3.scale(axis, 1 / length, new Vector3());
      const rot = this.fromToRotation(Vector3.axisPY(), dir);
      const capsuleKey = `${radius.toFixed(6)}|${length.toFixed(6)}`;
      if ((proxy as any).__capsuleKey !== capsuleKey) {
        const oldPrimitive = proxy.primitive;
        proxy.primitive = NodeProxy.createCapsuleSolidPrimitive(radius, length);
        (proxy as any).__capsuleKey = capsuleKey;
        oldPrimitive?.dispose();
      }
      proxy.position.set(center);
      proxy.rotation.set(rot);
      proxy.scale.setXYZ(1, 1, 1);
      return;
    }
    const normalY = this.normalizePlaneNormalY(meta.normal, 1);
    const normal = new Vector3(0, normalY, 0);
    const planeSize = Math.max(0.001, (Number(meta.planeSize) || 0.5) * unitScale);
    const n = normal.magnitudeSq > 1e-6 ? normal.inplaceNormalize() : Vector3.axisPY();
    const rot = this.fromToRotation(Vector3.axisPY(), n);
    proxy.position.setXYZ(0, 0, 0);
    proxy.rotation.set(rot);
    proxy.scale.setXYZ(planeSize * 2, planeSize * 2, 1);
    const direction = this.ensurePlaneNormalProxy(proxy);
    if (direction) {
      direction.position.setXYZ(0, 0, 0);
      direction.rotation.identity();
      direction.scale.setXYZ(1, 1, 1);
      direction.showState = visible ? 'visible' : 'hidden';
    }
  }
  private ensurePlaneNormalProxy(proxy: Mesh): Mesh {
    let direction = proxy.children.find((child) => child.get()?.name === PLANE_NORMAL_PROXY_NAME)?.get() as Mesh;
    if (!direction) {
      direction = new Mesh(
        this._scene,
        NodeProxy.createPlaneNormalPrimitive(),
        this._colliderProxyMaterial.get().createInstance()
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
  private static createLinePrimitive(vertices: number[], indices: number[], bbox: BoundingBox) {
    const primitive = new Primitive();
    primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    primitive.createAndSetIndexBuffer(new Uint16Array(indices));
    primitive.primitiveType = 'line-list';
    primitive.indexStart = 0;
    primitive.indexCount = indices.length;
    primitive.setBoundingVolume(bbox);
    return primitive;
  }
  private static createCapsuleSolidPrimitive(radius: number, axisLength: number) {
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
  private static createPlaneNormalPrimitive() {
    return NodeProxy.createLinePrimitive(
      [
        0,
        0,
        0,
        0,
        0.6,
        0,
        0.08,
        0.48,
        0,
        -0.08,
        0.48,
        0,
        0,
        0.48,
        0.08,
        0,
        0.48,
        -0.08
      ],
      [0, 1, 1, 2, 1, 3, 1, 4, 1, 5],
      new BoundingBox(new Vector3(-0.08, 0, -0.08), new Vector3(0.08, 0.6, 0.08))
    );
  }
  private getDirectionalLightProxyMesh() {
    if (!this._directionalLightPrimitive.get()) {
      const vertices = [
        -0.095,
        -0.095,
        0,
        -0.095,
        -0.095,
        0.5,
        0.095,
        -0.095,
        0.5,
        0.095,
        -0.095,
        0,
        -0.095,
        0.095,
        0,
        -0.095,
        0.095,
        0.5,
        0.095,
        0.095,
        0.5,
        0.095,
        0.095,
        0,
        -0.18,
        -0.18,
        0,
        -0.18,
        0.18,
        0,
        0.18,
        0.18,
        0,
        0.18,
        -0.18,
        0,
        0,
        0,
        -0.34,
        0,
        0,
        0.5
      ];
      const indices = [
        0,
        1,
        1,
        2,
        2,
        3,
        3,
        0,
        4,
        5,
        5,
        6,
        6,
        7,
        7,
        4,
        0,
        4,
        1,
        5,
        2,
        6,
        3,
        7,
        8,
        9,
        9,
        10,
        10,
        11,
        11,
        8,
        8,
        12,
        9,
        12,
        10,
        12,
        11,
        12,
        13
      ];
      const primitive = NodeProxy.createLinePrimitive(
        vertices,
        indices,
        new BoundingBox(new Vector3(-0.18, -0.18, -0.34), new Vector3(0.18, 0.18, 0.5))
      );
      this._directionalLightPrimitive.set(primitive);
    }
    return new Mesh(
      this._scene,
      this._directionalLightPrimitive.get(),
      this._lightProxyMaterial.get().createInstance()
    );
  }
  private getSpotLightProxyMesh() {
    if (!this._spotLightPrimitive.get()) {
      const vertices: number[] = [0, 0, 0];
      const indices: number[] = [];
      const segmentCount = 8;
      for (let i = 0; i < segmentCount; i++) {
        const angle = (i / segmentCount) * Math.PI * 2;
        vertices.push(Math.cos(angle) * 0.2, Math.sin(angle) * 0.2, -1);
      }
      for (let i = 0; i < segmentCount; i++) {
        const thisIndex = i + 1;
        const nextIndex = ((i + 1) % segmentCount) + 1;
        indices.push(0, thisIndex);
        indices.push(thisIndex, nextIndex);
      }
      this._spotLightPrimitive.set(
        NodeProxy.createLinePrimitive(
          vertices,
          indices,
          new BoundingBox(new Vector3(-0.2, -0.2, -1), new Vector3(0.2, 0.2, 0))
        )
      );
    }
    return new Mesh(
      this._scene,
      this._spotLightPrimitive.get(),
      this._lightProxyMaterial.get().createInstance()
    );
  }
  private getPointLightProxyMesh() {
    if (!this._diamondPrimitive.get()) {
      const primitive = new Primitive();
      primitive.createAndSetVertexBuffer(
        'position_f32x3',
        new Float32Array([0, 0.2, 0, -0.1, 0, 0.1, 0.1, 0, 0.1, 0.1, 0, -0.1, -0.1, 0, -0.1, 0, -0.2, 0])
      );
      primitive.createAndSetIndexBuffer(
        new Uint16Array([0, 1, 0, 2, 0, 3, 0, 4, 5, 1, 5, 2, 5, 3, 5, 4, 1, 2, 2, 3, 3, 4, 4, 1])
      );
      primitive.primitiveType = 'line-list';
      primitive.indexStart = 0;
      primitive.indexCount = primitive.getIndexBuffer().length;
      primitive.setBoundingVolume(new BoundingBox(new Vector3(-0.1, -0.2, -0.1), new Vector3(0.1, 0.2, 0.1)));
      this._diamondPrimitive.set(primitive);
    }
    return new Mesh(
      this._scene,
      this._diamondPrimitive.get(),
      this._lightProxyMaterial.get().createInstance()
    );
  }
  private getRectLightProxyMesh() {
    if (!this._rectLightPrimitive.get()) {
      const primitive = NodeProxy.createLinePrimitive(
        [
          -0.5,
          -0.5,
          0,
          -0.5,
          0.5,
          0,
          0.5,
          0.5,
          0,
          0.5,
          -0.5,
          0,
          0,
          0,
          0,
          0,
          0,
          -0.25
        ],
        [0, 1, 1, 2, 2, 3, 3, 0, 4, 5],
        new BoundingBox(new Vector3(-0.5, -0.5, -0.25), new Vector3(0.5, 0.5, 0))
      );
      this._rectLightPrimitive.set(primitive);
    }
    return new Mesh(this._scene, this._rectLightPrimitive.get(), this._lightProxyMaterial.get().createInstance());
  }
  private getPerspectiveCameraProxyMesh() {
    if (!this._perspectiveCameraPrimitive.get()) {
      const primitive = new TetrahedronFrameShape({
        height: 1,
        sizeX: 1,
        sizeZ: 1,
        transform: Matrix4x4.translation(new Vector3(0, 0, -1)).rotateRight(
          Quaternion.fromAxisAngle(Vector3.axisPX(), Math.PI * 0.5)
        )
      });
      this._perspectiveCameraPrimitive.set(primitive);
    }
    return new Mesh(
      this._scene,
      this._perspectiveCameraPrimitive.get(),
      this._lightProxyMaterial.get().createInstance()
    );
  }
}
