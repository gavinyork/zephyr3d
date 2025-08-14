import { Matrix4x4, Quaternion, Vector3, Vector4, DRef, DWeakRef } from '@zephyr3d/base';
import type { Scene, SceneNode } from '@zephyr3d/scene';
import { TetrahedronFrameShape } from '@zephyr3d/scene';
import {
  BoundingBox,
  CylinderShape,
  Mesh,
  Primitive,
  UnlitMaterial,
  PerspectiveCamera
} from '@zephyr3d/scene';

const PROXY_NAME = '$__PROXY__$';

export class NodeProxy {
  private readonly _diamondPrimitive: DRef<Primitive>;
  private readonly _spotLightPrimitive: DRef<Primitive>;
  private readonly _directionalLightPrimitive: DRef<Primitive>;
  private readonly _perspectiveCameraPrimitive: DRef<TetrahedronFrameShape>;
  private readonly _lightProxyMaterial: DRef<UnlitMaterial>;
  private _scene: Scene;
  private _proxyList: DWeakRef<Mesh>[];
  constructor(scene: Scene) {
    this._scene = scene;
    this._diamondPrimitive = new DRef();
    this._spotLightPrimitive = new DRef();
    this._directionalLightPrimitive = new DRef();
    this._perspectiveCameraPrimitive = new DRef();
    this._lightProxyMaterial = new DRef(new UnlitMaterial());
    this._proxyList = [];
  }
  dispose() {
    this._scene = null;
    this._diamondPrimitive.dispose();
    this._spotLightPrimitive.dispose();
    this._directionalLightPrimitive.dispose();
    this._lightProxyMaterial.dispose();
    for (const ref of this._proxyList) {
      ref.dispose();
    }
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
    if (src.isPunctualLight() && src.isDirectionLight()) {
      proxy = this.getDirectionalLightProxyMesh();
    } else if (src.isPunctualLight() && src.isSpotLight()) {
      proxy = this.getSpotLightProxyMesh();
    } else if (src.isPunctualLight() && src.isPointLight()) {
      proxy = this.getPointLightProxyMesh();
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
  private getDirectionalLightProxyMesh() {
    if (!this._directionalLightPrimitive.get()) {
      const bbox = new BoundingBox();
      bbox.beginExtend();
      const vertices: number[] = [];
      const indices: number[] = [];
      CylinderShape.generateData(
        {
          topRadius: 0.1,
          bottomRadius: 0.1,
          height: 0.8,
          anchor: 0,
          transform: Matrix4x4.rotation(new Vector3(1, 0, 0), -Math.PI * 0.5)
        },
        vertices,
        null,
        null,
        indices,
        bbox,
        vertices.length / 3
      );
      CylinderShape.generateData(
        {
          topRadius: 0,
          bottomRadius: 0.2,
          height: 0.5,
          anchor: 0,
          transform: Matrix4x4.translation(new Vector3(0, 0.8, 0)).rotateLeft(
            Quaternion.fromAxisAngle(new Vector3(1, 0, 0), -Math.PI * 0.5)
          )
        },
        vertices,
        null,
        null,
        indices,
        bbox,
        vertices.length / 3
      );
      const primitive = new Primitive();
      primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
      primitive.createAndSetIndexBuffer(new Uint16Array(indices));
      primitive.primitiveType = 'triangle-list';
      primitive.indexCount = indices.length;
      primitive.setBoundingVolume(bbox);
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
      this._spotLightPrimitive.set(
        new CylinderShape({
          topRadius: 0.2,
          bottomRadius: 0,
          topCap: true,
          height: 1,
          transform: Quaternion.fromAxisAngle(new Vector3(1, 0, 0), -Math.PI * 0.5).toMatrix4x4()
        })
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
        new Uint16Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4])
      );
      primitive.primitiveType = 'triangle-list';
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
