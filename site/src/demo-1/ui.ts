import { GUI } from 'lil-gui';
import type { Material, OrbitCameraController, PerspectiveCamera, SceneNode } from '@zephyr3d/scene';
import { Application, BoundingBox } from '@zephyr3d/scene';
import { FurMaterial } from './materials/fur';
import type { ParallaxMappingMode } from './materials/parallax';
import { ParallaxMapMaterial } from './materials/parallax';
import { WoodMaterial } from './materials/wood';
import { AABB, Vector3 } from '@zephyr3d/base';
import { ToonMaterial } from './materials/toon';

interface GUIParams {
  deviceType: string;
  material: string;
}

interface FurParams {
  layerCount: number;
  layerThickness: number;
  noiseRepeat: number;
}

interface ParallaxMapParams {
  mode: string;
  parallaxScale: number;
  minLayers: number;
  maxLayers: number;
}

interface WoodParams {
  distoredX: number;
  distoredY: number;
  distoredZ: number;
  density: number;
  lightColor: string;
  darkColor: string;
}

interface ToonParams {
  bands: number;
  edgeThickness: number;
}

export class Panel {
  private _camera: PerspectiveCamera;
  private _meshes: { node: SceneNode; material: Material; name: string; bbox?: AABB }[];
  private _materialNames: string[];
  private _index: number;
  private _parallaxModes: ParallaxMappingMode[];
  private _deviceList: string[];
  private _furParams: FurParams;
  private _parallaxMapParams: ParallaxMapParams;
  private _woodParams: WoodParams;
  private _toonParams: ToonParams;
  private _materialGroup: GUI;
  private _params: GUIParams;
  private _gui: GUI;
  constructor(camera: PerspectiveCamera, meshes: { node: SceneNode; material: Material; name: string }[]) {
    this._camera = camera;
    this._deviceList = ['WebGL', 'WebGL2', 'WebGPU'];
    this._meshes = meshes;
    this._materialNames = this._meshes.map((val) => val.name);
    this._index = 0;
    this._params = {
      deviceType:
        this._deviceList[
          this._deviceList.findIndex((val) => val.toLowerCase() === Application.instance.device.type)
        ],
      material: this._materialNames[this._index]
    };
    this._parallaxModes = ['basic', 'steep', 'occlusion', 'relief'];
    this._gui = new GUI({ container: document.body });
    this._furParams = null;
    this._parallaxMapParams = null;
    this._woodParams = null;
    this._toonParams = null;
    this._materialGroup = null;
    this.updateMeshShowState();
    this.updateBoundingBoxes();
    this.lookAt();
    this.create();
  }
  updateBoundingBoxes() {
    for (let i = 0; i < this._meshes.length; i++) {
      const node = this._meshes[i].node;
      const bbox = new BoundingBox();
      bbox.beginExtend();
      node.iterate((node) => {
        if (node.isGraphNode()) {
          const aabb = node.getWorldBoundingVolume()?.toAABB();
          if (aabb && aabb.isValid()) {
            bbox.extend(aabb.minPoint);
            bbox.extend(aabb.maxPoint);
          }
        }
      });
      this._meshes[i].bbox = new AABB(
        bbox.minPoint.scaleBy(node.scale.x),
        bbox.maxPoint.scaleBy(node.scale.x)
      );
    }
  }
  lookAt() {
    const bbox = this._meshes[this._index].bbox;
    const center = bbox.center;
    const extents = bbox.extents;
    const size = Math.max(extents.x, extents.y);
    const dist = size / Math.tan(this._camera.fovY * 0.5) + extents.z + this._camera.near;

    this._camera.lookAt(Vector3.add(center, Vector3.scale(Vector3.axisPZ(), dist)), center, Vector3.axisPY());
    this._camera.near = Math.min(1, this._camera.near);
    this._camera.far = Math.max(10, dist + extents.z + Math.max(extents.x, extents.y, extents.z) * 8);
    (this._camera.controller as OrbitCameraController).setOptions({ center });
  }
  updateMeshShowState() {
    for (let i = 0; i < this._meshes.length; i++) {
      this._meshes[i].node.showState = i === this._index ? 'visible' : 'hidden';
    }
  }
  css2rgb(css: string): Vector3 {
    if (css[0] === '#') {
      const hex = css.slice(1);
      let r, g, b;
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
      }
      return new Vector3(r / 255, g / 255, b / 255);
    } else {
      const rgb = css.match(/\d+/g);
      return new Vector3(parseInt(rgb[0]) / 255, parseInt(rgb[1]) / 255, parseInt(rgb[2]) / 255);
    }
  }
  editWoodMaterial(material: WoodMaterial) {
    this._woodParams = {
      distoredX: material.distored.x,
      distoredY: material.distored.y,
      distoredZ: material.distored.z,
      darkColor: `rgb(${Math.floor(material.darkColor.x * 255)}, ${Math.floor(
        material.darkColor.y * 255
      )}, ${Math.floor(material.darkColor.z * 255)})`,
      lightColor: `rgb(${Math.floor(material.lightColor.x * 255)}, ${Math.floor(
        material.lightColor.y * 255
      )}, ${Math.floor(material.lightColor.z * 255)})`,
      density: material.density
    };
    this._materialGroup
      .add(this._woodParams, 'distoredX', 0, 100, 0.1)
      .name('Distored X')
      .onChange((value) => {
        material.distored.x = value;
        material.uniformChanged();
      });
    this._materialGroup
      .add(this._woodParams, 'distoredY', 0, 100, 0.1)
      .name('Distored Y')
      .onChange((value) => {
        material.distored.y = value;
        material.uniformChanged();
      });
    this._materialGroup
      .add(this._woodParams, 'distoredZ', 0, 100, 0.1)
      .name('Distored Z')
      .onChange((value) => {
        material.distored.z = value;
        material.uniformChanged();
      });
    this._materialGroup
      .add(this._woodParams, 'density', 0, 100, 0.1)
      .name('Density')
      .onChange((value) => {
        material.density = value;
      });
    this._materialGroup
      .addColor(this._woodParams, 'darkColor')
      .name('Dark color')
      .onChange((value) => {
        material.darkColor = this.css2rgb(value);
      });
    this._materialGroup
      .addColor(this._woodParams, 'lightColor')
      .name('Light color')
      .onChange((value) => {
        material.lightColor = this.css2rgb(value);
      });
  }
  editParallaxMaterial(material: ParallaxMapMaterial) {
    this._parallaxMapParams = {
      minLayers: material.minParallaxLayers,
      maxLayers: material.maxParallaxLayers,
      parallaxScale: material.parallaxScale,
      mode: material.mode
    };
    this._materialGroup
      .add(this._parallaxMapParams, 'mode', this._parallaxModes)
      .name('Mode')
      .onChange((value) => {
        material.mode = value;
      });
    this._materialGroup
      .add(this._parallaxMapParams, 'parallaxScale', 0, 1, 0.01)
      .name('Parallax scale')
      .onChange((value) => {
        material.parallaxScale = value;
      });
    this._materialGroup
      .add(this._parallaxMapParams, 'minLayers', 1, 100, 1)
      .name('Min layers')
      .onChange((value) => {
        material.minParallaxLayers = value;
      });
    this._materialGroup
      .add(this._parallaxMapParams, 'maxLayers', 1, 100, 1)
      .name('Max layers')
      .onChange((value) => {
        material.maxParallaxLayers = value;
      });
  }
  editToonMaterial(material: ToonMaterial) {
    this._toonParams = {
      bands: material.bands,
      edgeThickness: material.edgeThickness
    };
    this._materialGroup
      .add(this._toonParams, 'bands', 1, 8, 1)
      .name('Bands')
      .onChange((value) => {
        material.bands = value;
      });
    this._materialGroup
      .add(this._toonParams, 'edgeThickness', 0, 2, 0.005)
      .name('Edge thickness')
      .onChange((value) => {
        material.edgeThickness = value;
      });
  }
  editFurMaterial(material: FurMaterial) {
    this._furParams = {
      layerCount: material.numLayers,
      layerThickness: material.thickness,
      noiseRepeat: material.noiseRepeat
    };
    this._materialGroup
      .add(this._furParams, 'layerCount', 1, 100, 1)
      .name('Layer count')
      .onChange((value) => {
        material.numLayers = value;
      });
    this._materialGroup
      .add(this._furParams, 'layerThickness', 0, 0.5, 0.01)
      .name('Layer thickness')
      .onChange((value) => {
        material.thickness = value;
      });
    this._materialGroup
      .add(this._furParams, 'noiseRepeat', 1, 32, 1)
      .name('Noise repeat')
      .onChange((value) => {
        material.noiseRepeat = value;
      });
    /*
    const colorStart = {
      r: material.colorStart.x,
      g: material.colorStart.y,
      b: material.colorStart.z,
      a: material.colorStart.w
    };
    if (ImGui.ColorEdit4('AO start', colorStart)){
      material.colorStart = new Vector4(colorStart.r, colorStart.g, colorStart.b, colorStart.a);
    }
    const colorEnd = {
      r: material.colorEnd.x,
      g: material.colorEnd.y,
      b: material.colorEnd.z,
      a: material.colorEnd.w
    };
    if (ImGui.ColorEdit4('AO end', colorEnd)){
      material.colorEnd = new Vector4(colorEnd.r, colorEnd.g, colorEnd.b, colorEnd.a);
    }
    */
  }
  create() {
    const systemSettings = this._gui.addFolder('System');
    systemSettings
      .add(this._params, 'deviceType', this._deviceList)
      .name('Select device')
      .onChange((value) => {
        const url = new URL(window.location.href);
        url.searchParams.set('dev', value.toLowerCase());
        window.location.href = url.href;
      });
    this.updateMaterialGroup();
  }
  updateMaterialGroup() {
    if (this._materialGroup) {
      this._materialGroup.destroy();
    }
    this._materialGroup = this._gui.addFolder('Material');
    this._materialGroup
      .add(this._params, 'material', this._materialNames)
      .name('Select material')
      .onChange((value) => {
        this._params.material = value;
        this._index = this._materialNames.indexOf(value);
        this.updateMaterialGroup();
      });
    this.updateMeshShowState();
    this.lookAt();
    const material = this._meshes[this._index].material;
    if (material instanceof FurMaterial) {
      this.editFurMaterial(material);
    } else if (material instanceof ParallaxMapMaterial) {
      this.editParallaxMaterial(material);
    } else if (material instanceof WoodMaterial) {
      this.editWoodMaterial(material);
    } else if (material instanceof ToonMaterial) {
      this.editToonMaterial(material);
    }
  }
}
