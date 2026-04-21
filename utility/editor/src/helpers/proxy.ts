import { Matrix4x4, Quaternion, Vector3, Vector4, DRef, DWeakRef, Disposable } from '@zephyr3d/base';
import type { Scene, SceneNode } from '@zephyr3d/scene';
import { TetrahedronFrameShape } from '@zephyr3d/scene';
import { BoundingBox, Mesh, Primitive, UnlitMaterial, PerspectiveCamera } from '@zephyr3d/scene';

const PROXY_NAME = '$__PROXY__$';

export class NodeProxy extends Disposable {
  private readonly _diamondPrimitive: DRef<Primitive>;
  private readonly _spotLightPrimitive: DRef<Primitive>;
  private readonly _directionalLightPrimitive: DRef<Primitive>;
  private readonly _rectLightPrimitive: DRef<Primitive>;
  private readonly _perspectiveCameraPrimitive: DRef<TetrahedronFrameShape>;
  private readonly _lightProxyMaterial: DRef<UnlitMaterial>;
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
    this._lightProxyMaterial = new DRef(new UnlitMaterial());
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
    const index = src.children.findIndex((val) => this.isProxy(val));
    if (index >= 0) {
      return;
    }
    let proxy: Mesh;
    if (src.isPunctualLight() && src.isDirectionLight()) {
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
      const children = src.children;
      const index = children.findIndex((val) => this.isProxy(val));
      if (index >= 0) {
        const proxy = children[index] as Mesh;
        const material = proxy.material;
        const primitive = proxy.primitive;
        if (src.isPunctualLight()) {
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
      const children = src.children;
      const index = children.findIndex((val) => this.isProxy(val));
      if (index >= 0) {
        const proxy = children[index] as Mesh;
        proxy.showState = 'hidden';
      }
    }
  }
  showProxy(src: SceneNode) {
    if (src) {
      const children = src.children;
      const index = children.findIndex((val) => this.isProxy(val));
      if (index >= 0) {
        const proxy = children[index] as Mesh;
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
    this._lightProxyMaterial.dispose();
    for (const ref of this._proxyList) {
      ref.dispose();
    }
    this._proxyList = [];
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
  private getDirectionalLightProxyMesh() {
    if (!this._directionalLightPrimitive.get()) {
      const vertices = [
        -0.095, -0.095, 0, -0.095, -0.095, 0.5, 0.095, -0.095, 0.5, 0.095, -0.095, 0, -0.095, 0.095, 0,
        -0.095, 0.095, 0.5, 0.095, 0.095, 0.5, 0.095, 0.095, 0, -0.18, -0.18, 0, -0.18, 0.18, 0, 0.18, 0.18,
        0, 0.18, -0.18, 0, 0, 0, -0.34, 0, 0, 0.5
      ];
      const indices = [
        0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7, 8, 9, 9, 10, 10, 11, 11, 8, 8,
        12, 9, 12, 10, 12, 11, 12, 13
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
        [-0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, 0, 0, 0, 0, 0, -0.25],
        [0, 1, 1, 2, 2, 3, 3, 0, 4, 5],
        new BoundingBox(new Vector3(-0.5, -0.5, -0.25), new Vector3(0.5, 0.5, 0))
      );
      this._rectLightPrimitive.set(primitive);
    }
    return new Mesh(
      this._scene,
      this._rectLightPrimitive.get(),
      this._lightProxyMaterial.get().createInstance()
    );
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
