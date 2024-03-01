import { makeEventTarget } from "@zephyr3d/base";
import { ImGui, imGuiEndFrame, imGuiNewFrame } from "@zephyr3d/imgui";
import { Application, Material } from "@zephyr3d/scene";
import { FurMaterial } from "./materials/fur";
import { ParallaxMapMaterial, ParallaxMappingMode } from "./materials/parallax";

export class UI extends makeEventTarget(Object)<{ change: Material }>() {
  private _materials: Material[];
  private _materialNames: string[];
  private _index: number;
  private _parallaxModes: ParallaxMappingMode[];
  constructor(materials: Material[]){
    super();
    this._materials = materials;
    this._materialNames = this._materials.map(val => val.constructor.name);
    this._index = 0;
    this._parallaxModes = [
      'basic',
      'steep',
      'occlusion',
      'relief'
    ];
  }
  render(){
    imGuiNewFrame();
    this.renderMaterialUI();
    imGuiEndFrame();
  }
  get currentMaterial() {
    return this._materials[this._index];
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
  renderFurMaterialSettings(material: FurMaterial){
    const numLayers = [material.numLayers] as [number];
    if (ImGui.SliderInt('Layer count', numLayers, 1, 100)) {
      material.numLayers = numLayers[0];
    }
    const layerThickness = [material.thickness] as [number];
    if (ImGui.SliderFloat('Layer thickness', layerThickness, 0, 0.1)) {
      material.thickness = layerThickness[0];
    }
  }
  renderMaterialUI(){
    ImGui.SetNextWindowPos(new ImGui.ImVec2(0, 0), ImGui.Cond.Always);
    ImGui.SetNextWindowSize(new ImGui.ImVec2(300, Application.instance.device.getViewport().height), ImGui.Cond.Always);
    if (ImGui.Begin('Custom material example')){
      const t = [this._index] as [number];
      if (ImGui.Combo('Select material', t, this._materialNames)){
        this._index = t[0];
        this.dispatchEvent(this._materials[this._index], 'change');
      }
      const material = this._materials[this._index];
      if (material instanceof FurMaterial){
        this.renderFurMaterialSettings(material);
      } else if (material instanceof ParallaxMapMaterial){
        this.renderParallaxMaterialSettings(material);
      }
    }
    ImGui.End();
  }
}

