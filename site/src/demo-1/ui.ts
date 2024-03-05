import { ImGui, imGuiEndFrame, imGuiNewFrame } from "@zephyr3d/imgui";
import { Application, BoundingBox, GraphNode, Material, OrbitCameraController, PerspectiveCamera, SceneNode } from "@zephyr3d/scene";
import { FurMaterial } from "./materials/fur";
import { ParallaxMapMaterial, ParallaxMappingMode } from "./materials/parallax";
import { WoodMaterial } from "./materials/wood";
import { AABB, Vector3 } from "@zephyr3d/base";
import { ToonMaterial } from "./materials/toon";

export class UI {
  private _camera: PerspectiveCamera;
  private _meshes: { node: SceneNode, material: Material, bbox?: AABB }[];
  private _materialNames: string[];
  private _index: number;
  private _parallaxModes: ParallaxMappingMode[];
  constructor(camera: PerspectiveCamera, meshes: { node: SceneNode, material: Material }[]){
    this._camera = camera;
    this._meshes = meshes;
    this._materialNames = this._meshes.map(val => val.material.constructor.name);
    this._index = 0;
    this._parallaxModes = [
      'basic',
      'steep',
      'occlusion',
      'relief'
    ];
    this.updateMeshShowState();
    this.updateBoundingBoxes();
    this.lookAt();
  }
  render(){
    imGuiNewFrame();
    this.renderMaterialUI();
    imGuiEndFrame();
  }
  updateBoundingBoxes(){
    for (let i = 0; i < this._meshes.length; i++) {
      const node = this._meshes[i].node;
      const bbox = new BoundingBox();
      bbox.beginExtend();
      node.iterate(node => {
        if (node.isGraphNode()){
          const aabb = node.getWorldBoundingVolume()?.toAABB();
          if (aabb && aabb.isValid()) {
            bbox.extend(aabb.minPoint);
            bbox.extend(aabb.maxPoint);
          }
        }
      });
      this._meshes[i].bbox = new AABB(bbox.minPoint.scaleBy(node.scale.x), bbox.maxPoint.scaleBy(node.scale.x));
    }
  }
  lookAt(){
    const bbox = this._meshes[this._index].bbox;
    const center = bbox.center;
    const extents = bbox.extents;
    let size = Math.max(extents.x, extents.y);
    const dist = size / Math.tan(this._camera.fovY * 0.5) + extents.z + this._camera.near;

    this._camera.lookAt(
      Vector3.add(center, Vector3.scale(Vector3.axisPZ(), dist)),
      center,
      Vector3.axisPY()
    );
    this._camera.near = Math.min(1, this._camera.near);
    this._camera.far = Math.max(10, dist + extents.z + 100);
    (this._camera.controller as OrbitCameraController).setOptions({ center });
  }
  updateMeshShowState() {
    for (let i = 0; i < this._meshes.length; i++) {
      this._meshes[i].node.showState = i === this._index ? GraphNode.SHOW_DEFAULT : GraphNode.SHOW_HIDE;
    }
  }
  renderWoodMaterialSettings(material: WoodMaterial){
    const distored = [...material.distored] as [number,number,number];
    if (ImGui.SliderFloat3('Distored', distored, 0, 100)){
      material.distord = new Vector3(...distored);
    }
    const darkColor = {
      r: material.darkColor.x,
      g: material.darkColor.y,
      b: material.darkColor.z
    };
    if (ImGui.ColorEdit3('Dark color', darkColor)){
      material.darkColor = new Vector3(darkColor.r, darkColor.g, darkColor.b);
    }
    const lightColor = {
      r: material.lightColor.x,
      g: material.lightColor.y,
      b: material.lightColor.z
    };
    if (ImGui.ColorEdit3('Light color', lightColor)){
      material.lightColor = new Vector3(lightColor.r, lightColor.g, lightColor.b);
    }
    const density = [material.density] as [number];
    if (ImGui.SliderFloat('Density', density, 0, 100)){
      material.density = density[0];
    }
  }
  renderParallaxMaterialSettings(material: ParallaxMapMaterial){
    const index = [this._parallaxModes.indexOf(material.mode)] as [number];
    if (ImGui.Combo('Mode', index, this._parallaxModes)){
      material.mode = this._parallaxModes[index[0]];
    }
    const parallaxScale = [material.parallaxScale] as [number];
    if(ImGui.SliderFloat('Parallax scale', parallaxScale, 0, 1)){
      material.parallaxScale = parallaxScale[0];
    }
    const minLayers = [material.minParallaxLayers] as [number];
    if(ImGui.SliderInt('Parallax min layers', minLayers, 1, 100)){
      material.minParallaxLayers = minLayers[0];
    }
    const maxLayers = [material.maxParallaxLayers] as [number];
    if(ImGui.SliderInt('Parallax max layers', maxLayers, 1, 100)){
      material.maxParallaxLayers = maxLayers[0];
    }
  }
  renderToonMaterialSettings(material: ToonMaterial){
    const bands = [material.bands] as [number];
    if (ImGui.SliderInt('Bands', bands, 1, 8)) {
      material.bands = bands[0];
    }
    const edgeThickness = [material.edgeThickness] as [number];
    if (ImGui.SliderFloat('Edge thickness', edgeThickness, 0, 2)) {
      material.edgeThickness = edgeThickness[0];
    }
  }
  renderFurMaterialSettings(material: FurMaterial){
    const numLayers = [material.numLayers] as [number];
    if (ImGui.SliderInt('Layer count', numLayers, 1, 100)) {
      material.numLayers = numLayers[0];
    }
    const layerThickness = [material.thickness] as [number];
    if (ImGui.SliderFloat('Layer thickness', layerThickness, 0, 0.5)) {
      material.thickness = layerThickness[0];
    }
    const noiseRepeat = [material.noiseRepeat] as [number];
    if (ImGui.SliderFloat('Noise repeat', noiseRepeat, 1, 100)) {
      material.noiseRepeat = noiseRepeat[0];
    }
  }
  renderMaterialUI(){
    ImGui.SetNextWindowPos(new ImGui.ImVec2(0, 0), ImGui.Cond.Always);
    ImGui.SetNextWindowSize(new ImGui.ImVec2(350, Application.instance.device.getViewport().height), ImGui.Cond.Always);
    if (ImGui.Begin('User defined material example')){
      const t = [this._index] as [number];
      if (ImGui.Combo('Select material', t, this._materialNames)){
        this._index = t[0];
        this.updateMeshShowState();
        this.lookAt();
      }
      const material = this._meshes[this._index].material;
      if (material instanceof FurMaterial){
        this.renderFurMaterialSettings(material);
      } else if (material instanceof ParallaxMapMaterial){
        this.renderParallaxMaterialSettings(material);
      } else if (material instanceof WoodMaterial){
        this.renderWoodMaterialSettings(material);
      } else if (material instanceof ToonMaterial){
        this.renderToonMaterialSettings(material);
      }
    }
    ImGui.End();
  }
}

