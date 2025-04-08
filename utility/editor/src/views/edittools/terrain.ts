import {
  Application,
  AssetRegistry,
  ClipmapTerrain,
  ClipmapTerrainMaterial,
  CopyBlitter,
  DRef,
  fetchSampler
} from '@zephyr3d/scene';
import type { EditTool } from './edittool';
import { degree2radian, Vector2, Vector4, type Vector3 } from '@zephyr3d/base';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import { ImGui } from '@zephyr3d/imgui';
import { ImageList } from '../../components/imagelist';
import { Editor } from '../../core/editor';
import { Texture2D, Texture2DArray } from '@zephyr3d/device';
import { TerrainTextureBrush } from './brushes/splat';
import { TerrainRaiseBrush } from './brushes/raise';
import { TerrainHeightBrush } from './brushes/height';
import { TerrainLowerBrush } from './brushes/lower';
import { TerrainSmoothBrush } from './brushes/smooth';
import { TerrainFlattenBrush } from './brushes/flatten';
import { TerrainErosoinBrush } from './brushes/erosion';

const blitter = new CopyBlitter();
export class TerrainEditTool implements EditTool {
  private static defaultBrush: DRef<Texture2D> = new DRef();
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
  private _raiseBrush: TerrainRaiseBrush;
  private _lowerBrush: TerrainLowerBrush;
  private _smoothBrush: TerrainSmoothBrush;
  private _flattenBrush: TerrainFlattenBrush;
  private _erosionBrush: TerrainErosoinBrush;
  private _textureBrush: TerrainTextureBrush;
  private _assetRegistry: AssetRegistry;
  private _splatMapCopy: DRef<Texture2DArray>;
  private _heightMapCopy: DRef<Texture2D>;
  constructor(terrain: ClipmapTerrain, assetRegistry: AssetRegistry) {
    this._terrain = new DRef(terrain);
    this._assetRegistry = assetRegistry;
    this._brushSize = 10;
    this._brushAngle = 0;
    this._brushStrength = 1;
    this._disposed = false;
    this._brushing = false;
    if (!TerrainEditTool.defaultBrush.get()) {
      TerrainEditTool.defaultBrush.set(TerrainEditTool.createDefaultBrushFallof());
    }
    this._brushImageList = new ImageList(this._assetRegistry);
    this._detailAlbedo = new ImageList(this._assetRegistry);
    this._detailAlbedo.selectable = true;
    this._detailAlbedo.maxImageCount = ClipmapTerrainMaterial.MAX_DETAIL_MAP_COUNT;
    this._detailAlbedo.defaultImage = ClipmapTerrainMaterial.getDefaultDetailMap();
    this._detailNormal = new ImageList(this._assetRegistry);
    this._detailNormal.selectable = false;
    this._detailNormal.maxImageCount = ClipmapTerrainMaterial.MAX_DETAIL_MAP_COUNT;
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
    this._editList = ['raise', 'lower', 'smooth', 'flatten', 'erosion', 'texture'];
    this._editSelected = -1;
    this._hitPos = null;
    this._brushImageList.addImage(TerrainEditTool.defaultBrush.get());
    for (const name in Editor.instance.getBrushes()) {
      this._brushImageList.addImage(Editor.instance.getBrushes()[name].get());
    }
    this._brushImageList.selected = 0;
    this._raiseBrush = new TerrainRaiseBrush();
    this._lowerBrush = new TerrainLowerBrush();
    this._smoothBrush = new TerrainSmoothBrush();
    this._flattenBrush = new TerrainFlattenBrush();
    this._erosionBrush = new TerrainErosoinBrush();
    this._textureBrush = new TerrainTextureBrush();
    const splatMap = this._terrain.get().material.getSplatMap();
    const splatMapCopy = Application.instance.device.createTexture2DArray(
      splatMap.format,
      splatMap.width,
      splatMap.height,
      splatMap.depth
    );
    splatMapCopy.name = 'SplatMapCopy';
    blitter.blit(splatMap, splatMapCopy, fetchSampler('clamp_nearest_nomip'));
    this._splatMapCopy = new DRef(splatMapCopy);

    this.ensureTerrainHeightMap();
    const heightMap = this._terrain.get().heightMap;
    const heightMapCopy = Application.instance.device.createTexture2D(
      heightMap.format,
      heightMap.width,
      heightMap.height,
      { samplerOptions: { mipFilter: 'none' } }
    );
    heightMapCopy.name = 'heightMapCopy';
    blitter.blit(heightMap, heightMapCopy, fetchSampler('clamp_linear_nomip'));
    this._heightMapCopy = new DRef(heightMapCopy);
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
        case 'lower':
          this.applyHeightBrush(
            this._lowerBrush,
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
        case 'flatten':
          this.applyHeightBrush(
            this._flattenBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength
          );
          break;
        case 'erosion':
          this.applyHeightBrush(
            this._erosionBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength
          );
          break;
        case 'texture':
          if (this._detailAlbedo.selected >= 0) {
            this.applyTextureBrush(
              texture,
              this._hitPos,
              this._brushSize,
              angle,
              this._brushStrength,
              this._detailAlbedo.selected
            );
          }
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
    strength: number,
    detailIndex: number
  ) {
    const terrain = this._terrain.get();
    const splatMap = terrain.material.getSplatMap();
    blitter.blit(splatMap, this._splatMapCopy.get(), fetchSampler('clamp_nearest_nomip'));

    const device = Application.instance.device;
    const fb = device.pool.fetchTemporalFramebuffer<Texture2DArray>(
      false,
      0,
      0,
      splatMap,
      null,
      false,
      1,
      false,
      0,
      0,
      detailIndex >> 2
    );
    device.pushDeviceStates();
    device.setFramebuffer(fb);

    this._textureBrush.detailIndex = detailIndex;
    this._textureBrush.sourceSplatMap = this._splatMapCopy.get();
    this._textureBrush.brush(
      brushTexture,
      this._terrain.get().worldRegion,
      hitPos,
      brushSize,
      angle,
      Math.max(strength * 0.1, 0.01)
    );
    this._textureBrush.sourceSplatMap = null;

    device.popDeviceStates();
    device.pool.releaseFrameBuffer(fb);
  }
  applyHeightBrush(
    brush: TerrainHeightBrush,
    brushTexture: Texture2D,
    hitPos: Vector2,
    brushSize: number,
    angle: number,
    strength: number
  ) {
    const terrain = this._terrain.get();
    const heightMap = terrain.heightMap;
    blitter.blit(heightMap, this._heightMapCopy.get(), fetchSampler('clamp_nearest_nomip'));
    const device = Application.instance.device;
    const fb = device.pool.fetchTemporalFramebuffer<Texture2D>(false, 0, 0, heightMap, null, false);
    device.pushDeviceStates();
    device.setFramebuffer(fb);

    brush.sourceHeightMap = this._heightMapCopy.get();
    brush.brush(brushTexture, this._terrain.get().worldRegion, hitPos, brushSize, angle, strength);
    brush.sourceHeightMap = null;

    device.popDeviceStates();
    device.pool.releaseFrameBuffer(fb);
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
  ensureTerrainHeightMap(): void {
    if (!this._terrain.get().heightMap) {
      const device = Application.instance.device;
      const heightMap = device.createTexture2D(
        'r16f',
        Math.max(1, this._terrain.get().sizeX),
        Math.max(1, this._terrain.get().sizeZ),
        {
          samplerOptions: { mipFilter: 'none' }
        }
      );
      this._terrain.get().heightMap = heightMap;
      const fb = device.pool.fetchTemporalFramebuffer(false, 0, 0, heightMap, null, false);
      device.pushDeviceStates();
      device.setFramebuffer(fb);
      device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
      device.popDeviceStates();
      device.pool.releaseFrameBuffer(fb);
    }
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
  static createDefaultBrushFallof(): Texture2D {
    function smoothStep(a: number, b: number, t: number) {
      if (t <= a) {
        return 0;
      } else if (t >= b) {
        return 1;
      } else {
        const f = (t - a) / (b - a);
        return 3 * f * f - 2 * f * f * f;
      }
    }
    const size = 64;
    const data = new Uint8Array(4 * size * size);
    let k = 0;
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const u = (2 * j) / size - 1;
        const v = (2 * i) / size - 1;
        const d = Math.sqrt(u * u + v * v) * 0.9;
        const val = ((1 - smoothStep(0, 1, d)) * 255) >> 0;
        data[k++] = val;
        data[k++] = val;
        data[k++] = val;
        data[k++] = 255;
      }
    }
    const texture = Application.instance.device.createTexture2D('rgba8unorm', size, size, {
      samplerOptions: { mipFilter: 'none' }
    });
    texture.name = 'DefaultBrush';
    texture.update(data, 0, 0, size, size);
    return texture;
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
    this._splatMapCopy.dispose();
    this._heightMapCopy.dispose();
  }
}
