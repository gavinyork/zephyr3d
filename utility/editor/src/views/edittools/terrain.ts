import { Application, AssetRegistry, ClipmapTerrain, ClipmapTerrainMaterial, DRef } from '@zephyr3d/scene';
import type { EditTool } from './edittool';
import { degree2radian, Vector2, Vector4, type Vector3 } from '@zephyr3d/base';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import { ImGui } from '@zephyr3d/imgui';
import { ImageList } from '../../components/imagelist';
import { Editor } from '../../core/editor';
import { BaseTerrainBrush } from './brushes/base';
import { Texture2D } from '@zephyr3d/device';

export class TerrainEditTool implements EditTool {
  private _terrain: DRef<ClipmapTerrain>;
  private _disposed: boolean;
  private _brushSize: number;
  private _brushAngle: number;
  private _brushStrength: number;
  private _brushImageList: ImageList;
  private _detailAlbedo: ImageList;
  private _detailNormal: ImageList;
  private _editList: string[];
  private _editSelected: number;
  private _brushing: boolean;
  private _hitPos: Vector2;
  private _raiseBrush: BaseTerrainBrush;
  private _smoothBrush: BaseTerrainBrush;
  private _levelBrush: BaseTerrainBrush;
  private _copyBrush: BaseTerrainBrush;
  private _textureBrush: BaseTerrainBrush;
  private _assetRegistry: AssetRegistry;
  constructor(terrain: ClipmapTerrain, assetRegistry: AssetRegistry) {
    this._terrain = new DRef(terrain);
    this._assetRegistry = assetRegistry;
    this._brushSize = 10;
    this._brushAngle = 0;
    this._brushStrength = 1;
    this._disposed = false;
    this._brushing = false;
    this._brushImageList = new ImageList(this._assetRegistry);
    this._detailAlbedo = new ImageList(this._assetRegistry);
    this._detailAlbedo.selectable = true;
    this._detailAlbedo.defaultImage = ClipmapTerrainMaterial.getDefaultDetailMap();
    this._detailNormal = new ImageList(this._assetRegistry);
    this._detailNormal.selectable = false;
    this._detailNormal.defaultImage = ClipmapTerrainMaterial.getDefaultNormalMap();
    this.refreshDetailMaps();
    this._detailAlbedo.on('update_image', (asset: string, index: number) => {
      this._terrain.get().material.setDetailMap(index, this._detailAlbedo.getImage(index));
      this.refreshDetailMaps();
    });
    this._detailAlbedo.on('add_image', (asset: string, index: number) => {
      const material = this._terrain.get().material;
      material.numDetailMaps++;
      for (let i = material.numDetailMaps - 1; i > index; i--) {
        material.setDetailMap(i, material.getDetailMap(i - 1));
      }
      material.setDetailMap(index, this._detailAlbedo.getImage(index));
      this.refreshDetailMaps();
    });
    this._detailNormal.on('update_image', (asset: string, index: number) => {
      this._terrain.get().material.setDetailNormalMap(index, this._detailNormal.getImage(index));
      this.refreshDetailMaps();
    });
    this._detailNormal.on('add_image', (asset: string, index: number) => {
      const material = this._terrain.get().material;
      material.numDetailMaps++;
      for (let i = material.numDetailMaps - 1; i > index; i--) {
        material.setDetailNormalMap(i, material.getDetailNormalMap(i - 1));
      }
      material.setDetailNormalMap(index, this._detailNormal.getImage(index));
      this.refreshDetailMaps();
    });
    this._editList = ['raise', 'smooth', 'level', 'copy', 'texture'];
    this._editSelected = -1;
    this._hitPos = null;
    for (const name in Editor.instance.getBrushes()) {
      this._brushImageList.addImage(Editor.instance.getBrushes()[name].get());
    }
    this._brushImageList.selected = 0;
    this._raiseBrush = new BaseTerrainBrush();
    this._smoothBrush = new BaseTerrainBrush();
    this._levelBrush = new BaseTerrainBrush();
    this._copyBrush = new BaseTerrainBrush();
    this._textureBrush = new BaseTerrainBrush();
  }
  handlePointerEvent(evt: PointerEvent, hitObject: any, hitPos: Vector3): boolean {
    if (hitPos) {
      this._hitPos = this._hitPos ?? new Vector2();
      this._hitPos.setXY(hitPos.x, hitPos.z);
      if (evt.type === 'pointerdown' && evt.button === 0 && this._editSelected >= 0) {
        this._brushing = true;
      }
      if (evt.type === 'pointerup' && evt.button === 0) {
        this._brushing = false;
      }
    } else {
      this._hitPos = null;
    }
    return false;
  }
  update() {
    if (this._brushing && this._hitPos && this._brushImageList.selected >= 0) {
      const texture = this._brushImageList.getImage(this._brushImageList.selected);
      const angle = degree2radian(this._brushAngle);
      switch (this._editList[this._editSelected]) {
        case 'raise':
          this.applyHeightBrush(
            this._raiseBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength
          );
          break;
        case 'smooth':
          this.applyHeightBrush(
            this._smoothBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength
          );
          break;
        case 'level':
          this.applyHeightBrush(
            this._levelBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength
          );
          break;
        case 'copy':
          this.applyHeightBrush(
            this._copyBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength
          );
          break;
        case 'texture':
          this.applyTextureBrush(texture, this._hitPos, this._brushSize, angle, this._brushStrength);
          break;
        default:
          break;
      }
      if (this._editList[this._editSelected] !== 'texture') {
        this._terrain.get().material.calculateNormalMap();
      }
    }
  }
  applyTextureBrush(
    brushTexture: Texture2D,
    hitPos: Vector2,
    brushSize: number,
    angle: number,
    strength: number
  ) {
    this._textureBrush.brush(
      this._terrain.get().heightMap,
      brushTexture,
      this._terrain.get().worldRegion,
      hitPos,
      brushSize,
      angle,
      strength,
      null
    );
  }
  applyHeightBrush(
    brush: BaseTerrainBrush,
    brushTexture: Texture2D,
    hitPos: Vector2,
    brushSize: number,
    angle: number,
    strength: number
  ) {
    const clear = this.ensureTerrainHeightMap();
    brush.brush(
      this._terrain.get().heightMap,
      brushTexture,
      this._terrain.get().worldRegion,
      hitPos,
      brushSize,
      angle,
      strength,
      clear ? Vector4.zero() : null
    );
  }
  handleKeyboardEvent(evt: KeyboardEvent): boolean {
    return false;
  }
  renderEditSection() {
    ImGui.BeginChild(
      'EditChild',
      new ImGui.ImVec2(
        0,
        2 * ImGui.GetStyle().WindowPadding.y + ImGui.GetStyle().ItemSpacing.y + 2 * ImGui.GetFrameHeight()
      ),
      true
    );
    ImGui.Text('Edit');
    const sel = [this._editSelected] as [number];
    if (ImGui.Combo('Edit', sel, this._editList)) {
      this._editSelected = sel[0];
    }
    ImGui.EndChild();
    if (this._editList[this._editSelected] === 'texture') {
    }
  }
  renderDetailMapSection() {
    ImGui.BeginChild(
      'Detail',
      new ImGui.ImVec2(
        0,
        60 * 2 +
          3 * ImGui.GetFrameHeight() +
          2 * ImGui.GetStyle().WindowPadding.y +
          3 * ImGui.GetStyle().ItemSpacing.y
      ),
      true
    );
    ImGui.Text('Detail Albedo');
    ImGui.BeginChild('AlbedoList', new ImGui.ImVec2(0, 60));
    this._detailAlbedo.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    ImGui.Text('Detail Normal');
    ImGui.BeginChild('NormalList', new ImGui.ImVec2(0, 60));
    this._detailNormal.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    const disabled = this._detailAlbedo.selected < 0;
    if (disabled) {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, ImGui.GetStyle().Alpha * 0.5);
      ImGui.InputFloat('UVScale', [0] as [number], 1, 10, undefined, ImGui.InputTextFlags.ReadOnly);
      ImGui.PopStyleVar();
    } else {
      const uvScale = [this._terrain.get().material.getDetailMapUVScale(this._detailAlbedo.selected)] as [
        number
      ];
      if (ImGui.DragFloat('UVScale', uvScale, 1, 0, 1000, undefined)) {
        this._terrain.get().material.setDetailMapUVScale(this._detailAlbedo.selected, uvScale[0]);
      }
    }
    ImGui.EndChild();
  }
  renderBrushSection() {
    ImGui.BeginChild(
      'Brush',
      new ImGui.ImVec2(
        0,
        60 +
          4 * ImGui.GetStyle().ItemSpacing.y +
          2 * ImGui.GetStyle().WindowPadding.y +
          4 * ImGui.GetFrameHeight()
      ),
      true
    );
    ImGui.Text('Brush settings');
    ImGui.BeginChild('BrushList', new ImGui.ImVec2(0, 60));
    this._brushImageList.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    const brushSize = [this._brushSize] as [number];
    if (ImGui.SliderFloat('Size', brushSize, 0, 100, '%.1f', ImGui.SliderFlags.None)) {
      this._brushSize = brushSize[0];
    }
    const brushAngle = [this._brushAngle] as [number];
    if (ImGui.SliderFloat('Rotation', brushAngle, 0, 360, '%.1f', ImGui.SliderFlags.None)) {
      this._brushAngle = brushAngle[0];
    }
    const brushStrength = [this._brushStrength] as [number];
    if (ImGui.SliderFloat('Strength', brushStrength, 0, 16, '%.1f', ImGui.SliderFlags.None)) {
      this._brushStrength = brushStrength[0];
    }
    ImGui.EndChild();
  }
  render(): void {
    if (ImGui.Begin('Terrain Tools', null, ImGui.WindowFlags.AlwaysAutoResize | ImGui.WindowFlags.NoResize)) {
      ImGui.Dummy(new ImGui.ImVec2(300, 0));
      this.renderBrushSection();
      this.renderEditSection();
      if (this._editList[this._editSelected] === 'texture') {
        this.renderDetailMapSection();
      }
    }
    ImGui.End();
  }
  ensureTerrainHeightMap(): boolean {
    let clear = false;
    if (!this._terrain.get().heightMap) {
      this._terrain.get().heightMap = Application.instance.device.createTexture2D(
        'r16f',
        Math.max(1, this._terrain.get().sizeX),
        Math.max(1, this._terrain.get().sizeZ),
        {
          samplerOptions: { mipFilter: 'none' }
        }
      );
      clear = true;
    }
    return clear;
  }
  getSubMenuItems(): MenuItemOptions[] {
    return [];
  }
  getToolBarItems(): ToolBarItem[] {
    return [];
  }
  getTarget(): any {
    return this._terrain.get();
  }
  get disposed(): boolean {
    return this._disposed;
  }
  refreshDetailMaps() {
    const terrain = this._terrain.get();
    this._detailAlbedo.clear();
    this._detailNormal.clear();
    for (let i = 0; i < terrain.material.numDetailMaps; i++) {
      this._detailAlbedo.addImage(terrain.material.getDetailMap(i));
      this._detailNormal.addImage(terrain.material.getDetailNormalMap(i));
    }
  }
  dispose(): void {
    this._disposed = true;
    this._terrain?.dispose();
    this._terrain = null;
    this._brushImageList?.dispose();
    this._brushImageList = null;
    this._detailAlbedo?.dispose();
    this._detailAlbedo = null;
    this._detailNormal?.dispose();
    this._detailNormal = null;
  }
}
