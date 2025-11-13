import type { ClipmapTerrain, GrassInstanceInfo } from '@zephyr3d/scene';
import UPNG from 'upng-js';
import { ClipmapTerrainMaterial, CopyBlitter, fetchSampler, getDevice, getEngine } from '@zephyr3d/scene';
import type { EditTool } from './edittool';
import { degree2radian, Disposable, DRef, HttpRequest, Vector2, Vector4, type Vector3 } from '@zephyr3d/base';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import { ImGui } from '@zephyr3d/imgui';
import { ImageList } from '../../components/imagelist';
import type { Editor } from '../../core/editor';
import { type Texture2D, type Texture2DArray } from '@zephyr3d/device';
import { TerrainTextureBrush } from './brushes/splat';
import { TerrainRaiseBrush } from './brushes/raise';
import type { TerrainHeightBrush } from './brushes/height';
import { TerrainLowerBrush } from './brushes/lower';
import { TerrainSmoothBrush } from './brushes/smooth';
import { TerrainFlattenBrush } from './brushes/flatten';
import { FilePicker } from '../../components/filepicker';
import { Dialog } from '../dlg/dlg';
import { eventBus } from '../../core/eventbus';
import type { BaseTerrainBrush } from './brushes/base';
import { EraseGrassBrush, GrassBrush } from './brushes/grass';
import { ThermalErosionBrush } from './brushes/thermalerosion';
import { HydraulicErosionBrush } from './brushes/hydraulicerosion';

const blitter = new CopyBlitter();
export class TerrainEditTool extends Disposable implements EditTool {
  private static readonly defaultBrush: DRef<Texture2D> = new DRef();
  private readonly _editor: Editor;
  private _terrain: DRef<ClipmapTerrain>;
  private _brushSize: number;
  private _brushAngle: number;
  private _brushStrength: number;
  private _brushImageList: ImageList;
  private _detailAlbedo: ImageList;
  private readonly _grassAlbedo: ImageList;
  private _detailNormal: ImageList;
  private readonly _brushList: BaseTerrainBrush[];
  private readonly _editList: string[];
  private _editSelected: number;
  private _brushing: boolean;
  private _hitPos: Vector2;
  private readonly _splatMapCopy: DRef<Texture2DArray | Texture2D>;
  private readonly _heightMapCopy: DRef<Texture2D>;
  private _heightDirty: boolean;
  constructor(editor: Editor, terrain: ClipmapTerrain) {
    super();
    this._terrain = new DRef(terrain);
    this._editor = editor;
    this._brushSize = 10;
    this._brushAngle = 0;
    this._brushStrength = 1;
    this._brushing = false;
    if (!TerrainEditTool.defaultBrush.get()) {
      TerrainEditTool.defaultBrush.set(TerrainEditTool.createDefaultBrushFallof());
    }
    this._brushImageList = new ImageList();
    this._brushImageList.linearColorSpace = true;

    this._grassAlbedo = new ImageList();
    this._grassAlbedo.linearColorSpace = false;
    this._grassAlbedo.selectable = true;

    this._detailAlbedo = new ImageList();
    this._detailAlbedo.linearColorSpace = false;
    this._detailAlbedo.selectable = true;
    this._detailAlbedo.maxImageCount = ClipmapTerrainMaterial.MAX_DETAIL_MAP_COUNT;
    this._detailAlbedo.defaultImage = ClipmapTerrainMaterial.getDefaultDetailMap();

    this._detailNormal = new ImageList();
    this._detailNormal.linearColorSpace = true;
    this._detailNormal.selectable = false;
    this._detailNormal.maxImageCount = ClipmapTerrainMaterial.MAX_DETAIL_MAP_COUNT;
    this._detailNormal.defaultImage = ClipmapTerrainMaterial.getDefaultNormalMap();

    this.refreshGrassTextures();
    this._grassAlbedo.on('update_image', (asset: string, index: number) => {
      this._terrain.get().grassRenderer.setGrassTexture(index, this._grassAlbedo.getImage(index));
      this.refreshGrassTextures();
      eventBus.dispatchEvent('scene_changed');
    });
    this._grassAlbedo.on('add_image', (asset: string, index: number) => {
      const grassRenderer = this._terrain.get().grassRenderer;
      grassRenderer.addLayer(1, 1, this._grassAlbedo.getImage(index));
      this.refreshGrassTextures();
      eventBus.dispatchEvent('scene_changed');
    });

    this.refreshDetailMaps();
    this._detailAlbedo.on('update_image', (asset: string, index: number) => {
      this._terrain.get().material.setDetailMap(index, this._detailAlbedo.getImage(index));
      this.refreshDetailMaps();
      eventBus.dispatchEvent('scene_changed');
    });
    this._detailAlbedo.on('add_image', (asset: string, index: number) => {
      const material = this._terrain.get().material;
      material.numDetailMaps++;
      for (let i = material.numDetailMaps - 1; i > index; i--) {
        material.setDetailMap(i, material.getDetailMap(i - 1));
      }
      material.setDetailMap(index, this._detailAlbedo.getImage(index));
      this.refreshDetailMaps();
      eventBus.dispatchEvent('scene_changed');
    });
    this._detailNormal.on('update_image', (asset: string, index: number) => {
      this._terrain.get().material.setDetailNormalMap(index, this._detailNormal.getImage(index));
      this.refreshDetailMaps();
      eventBus.dispatchEvent('scene_changed');
    });
    this._detailNormal.on('add_image', (asset: string, index: number) => {
      const material = this._terrain.get().material;
      material.numDetailMaps++;
      for (let i = material.numDetailMaps - 1; i > index; i--) {
        material.setDetailNormalMap(i, material.getDetailNormalMap(i - 1));
      }
      material.setDetailNormalMap(index, this._detailNormal.getImage(index));
      this.refreshDetailMaps();
      eventBus.dispatchEvent('scene_changed');
    });
    this._brushList = [
      new TerrainRaiseBrush(),
      new TerrainLowerBrush(),
      new TerrainSmoothBrush(),
      new TerrainFlattenBrush(),
      new ThermalErosionBrush(),
      new HydraulicErosionBrush(),
      new TerrainTextureBrush(),
      new GrassBrush(),
      new EraseGrassBrush()
    ];
    this._editList = this._brushList.map((brush) => brush.getName());
    this._editSelected = 0;
    this._hitPos = null;
    this._brushImageList.addImage(TerrainEditTool.defaultBrush.get());
    for (const name in this._editor.getBrushes()) {
      this._brushImageList.addImage(this._editor.getBrushes()[name].get());
    }
    this._brushImageList.selected = 0;
    this._heightDirty = false;
    const splatMap = this._terrain.get().material.getSplatMap();
    const splatMapCopy =
      getDevice().type === 'webgl'
        ? getDevice().createTexture2D(splatMap.format, splatMap.width, splatMap.height)
        : getDevice().createTexture2DArray(splatMap.format, splatMap.width, splatMap.height, splatMap.depth);
    splatMapCopy.name = 'SplatMapCopy';
    blitter.blit(splatMap, splatMapCopy, fetchSampler('clamp_nearest_nomip'));
    this._splatMapCopy = new DRef(splatMapCopy);

    this.ensureTerrainHeightMap();
    const heightMap = this._terrain.get().heightMap;
    const heightMapCopy = getDevice().createTexture2D(heightMap.format, heightMap.width, heightMap.height, {
      mipmapping: false
    });
    heightMapCopy.name = 'heightMapCopy';
    blitter.blit(heightMap, heightMapCopy, fetchSampler('clamp_nearest_nomip'));
    this._heightMapCopy = new DRef(heightMapCopy);
  }
  get terrain() {
    return this._terrain.get();
  }
  get detailAlbedo() {
    return this._detailAlbedo;
  }
  get detailNormal() {
    return this._detailNormal;
  }
  get grassAlbedo() {
    return this._grassAlbedo;
  }
  handlePointerEvent(evt: PointerEvent, hitObject: any, hitPos: Vector3): boolean {
    if (hitPos && hitObject === this._terrain.get()) {
      this._hitPos = this._hitPos ?? new Vector2();
      this._hitPos.setXY(hitPos.x, hitPos.z);
      if (evt.type === 'pointerdown' && evt.button === 0 && this._editSelected >= 0) {
        this._brushing = true;
      }
      if ((evt.buttons & 1) === 0) {
        this._brushing = false;
      }
    } else {
      this._hitPos = null;
    }
    return false;
  }
  update() {
    if (!this._brushing && this._heightDirty) {
      this._heightDirty = false;
      this._terrain.get().updateBoundingBox();
      this._terrain.get().updateRegion();
    }
    if (
      !this._heightMapCopy.get() ||
      this._heightMapCopy.get().width !== this._terrain.get().heightMap.width ||
      this._heightMapCopy.get().height !== this._terrain.get().heightMap.height
    ) {
      this._heightMapCopy.dispose();
      this._heightMapCopy.set(
        getDevice().createTexture2D(
          this._terrain.get().heightMap.format,
          this._terrain.get().heightMap.width,
          this._terrain.get().heightMap.height,
          {
            mipmapping: false
          }
        )
      );
    }
    if (this._brushing && this._hitPos && this._brushImageList.selected >= 0) {
      const texture = this._brushImageList.getImage(this._brushImageList.selected);
      const angle = degree2radian(this._brushAngle);
      switch (this._editList[this._editSelected]) {
        case 'raise':
          this.applyHeightBrush(
            this._brushList[this._editSelected] as TerrainRaiseBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength / Math.max(Math.abs(this._terrain.get().scale.y), 0.001)
          );
          break;
        case 'lower':
          this.applyHeightBrush(
            this._brushList[this._editSelected] as TerrainLowerBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength / Math.max(Math.abs(this._terrain.get().scale.y), 0.001)
          );
          break;
        case 'smooth':
          this.applyHeightBrush(
            this._brushList[this._editSelected] as TerrainSmoothBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength
          );
          break;
        case 'flatten':
          this.applyHeightBrush(
            this._brushList[this._editSelected] as TerrainFlattenBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength
          );
          break;
        case 'thermal erosion':
          this.applyHeightBrush(
            this._brushList[this._editSelected] as ThermalErosionBrush,
            texture,
            this._hitPos,
            this._brushSize,
            angle,
            this._brushStrength
          );
          break;
        case 'hydraulic erosion':
          this.applyHeightBrush(
            this._brushList[this._editSelected] as HydraulicErosionBrush,
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
              this._brushList[this._editSelected] as TerrainTextureBrush,
              texture,
              this._hitPos,
              this._brushSize,
              angle,
              this._brushStrength,
              this._detailAlbedo.selected
            );
          }
          break;
        case 'grass':
          if (this._grassAlbedo.selected >= 0) {
            this.applyGrassBrush(
              this._hitPos,
              this._brushSize,
              this._brushStrength,
              this._grassAlbedo.selected
            );
          }
          break;
        case 'erase grass':
          if (this._grassAlbedo.selected >= 0) {
            this.applyGrassEraseBrush(
              this._hitPos,
              this._brushSize,
              this._brushStrength,
              this._grassAlbedo.selected
            );
          }
          break;
        default:
          break;
      }
    }
  }
  applyGrassEraseBrush(hitPos: Vector2, brushSize: number, brushStrength: number, grassIndex: number) {
    const region = this._terrain.get().worldRegion;
    const posMinX = Math.max(hitPos.x - brushSize, region.x);
    const posMaxX = Math.min(hitPos.x + brushSize, region.z);
    const posMinZ = Math.max(hitPos.y - brushSize, region.y);
    const posMaxZ = Math.min(hitPos.y + brushSize, region.w);
    const area = (posMaxZ - posMinZ) * (posMaxX - posMinX);
    const regionWidthInv = 1 / (region.z - region.x);
    const regionHeightInv = 1 / (region.w - region.y);
    const numInstances = Math.ceil(area * brushStrength * 0.1);
    this._terrain
      .get()
      .grassRenderer.removeInstances(
        grassIndex,
        (posMinX - region.x) * regionWidthInv,
        (posMinZ - region.y) * regionHeightInv,
        (posMaxX - region.x) * regionWidthInv,
        (posMaxZ - region.y) * regionHeightInv,
        numInstances
      );
    eventBus.dispatchEvent('scene_changed');
  }
  applyGrassBrush(hitPos: Vector2, brushSize: number, brushStrength: number, grassIndex: number) {
    const region = this._terrain.get().worldRegion;
    const posMinX = hitPos.x - brushSize;
    const posMaxX = hitPos.x + brushSize;
    const posMinZ = hitPos.y - brushSize;
    const posMaxZ = hitPos.y + brushSize;
    const area = (posMaxZ - posMinZ) * (posMaxX - posMinX);
    const regionWidthInv = 1 / (region.z - region.x);
    const regionHeightInv = 1 / (region.w - region.y);
    const numInstances = Math.ceil(area * brushStrength * 0.02);
    /*
    const instances: GrassInstanceInfo[] = Array.from({ length: numInstances }).map(() => ({
      x: (posMinX + Math.random() * (posMaxX - posMinX) - region.x) * regionWidthInv,
      y: (posMinZ + Math.random() * (posMaxZ - posMinZ) - region.y) * regionHeightInv,
      angle: Math.random() * Math.PI * 2
    }));
    */
    const centerX = (posMinX + posMaxX) * 0.5;
    const centerZ = (posMinZ + posMaxZ) * 0.5;
    const radius = Math.min(posMaxX - centerX, posMaxZ - centerZ);
    const instances: GrassInstanceInfo[] = Array.from({ length: numInstances })
      .map(() => {
        let r: number;
        const sigma = 0.4;
        do {
          let u = 0;
          let v = 0;
          while (u === 0) {
            u = Math.random();
          }
          while (v === 0) {
            v = Math.random();
          }
          const z0 = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
          r = Math.abs(z0 * sigma);
        } while (r > 1);
        const theta = Math.random() * 2 * Math.PI;
        const x = r * Math.cos(theta) * radius + centerX;
        const y = r * Math.sin(theta) * radius + centerZ;
        return {
          x: (x - region.x) * regionWidthInv,
          y: (y - region.y) * regionHeightInv,
          angle: Math.random() * Math.PI * 2
        };
      })
      .filter((v) => {
        return v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1;
      });
    this._terrain.get().grassRenderer.addInstances(grassIndex, instances);
    eventBus.dispatchEvent('scene_changed');
  }
  applyTextureBrush(
    brush: TerrainTextureBrush,
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

    const device = getDevice();
    const fb = device.pool.fetchTemporalFramebuffer<Texture2DArray | Texture2D>(
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

    brush.detailIndex = detailIndex;
    brush.sourceSplatMap = this._splatMapCopy.get();
    brush.brush(
      brushTexture,
      this._terrain.get().worldRegion,
      this._terrain.get().scale,
      hitPos,
      brushSize,
      angle,
      Math.max(strength * 0.1, 0.01)
    );
    brush.sourceSplatMap = null;

    device.popDeviceStates();
    device.pool.releaseFrameBuffer(fb);
    eventBus.dispatchEvent('scene_changed');
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
    const device = getDevice();
    const fb = device.pool.fetchTemporalFramebuffer<Texture2D>(false, 0, 0, heightMap, null, false);
    device.pushDeviceStates();
    device.setFramebuffer(fb);
    brush.sourceHeightMap = this._heightMapCopy.get();
    brush.brush(
      brushTexture,
      this._terrain.get().worldRegion,
      this._terrain.get().scale,
      hitPos,
      brushSize,
      angle,
      strength
    );
    brush.sourceHeightMap = null;

    device.popDeviceStates();
    device.pool.releaseFrameBuffer(fb);

    this._heightDirty = true;
    eventBus.dispatchEvent('scene_changed');
  }
  handleKeyboardEvent(_evt: KeyboardEvent): boolean {
    return false;
  }
  renderEditSection() {
    ImGui.BeginChild(
      'EditChild',
      new ImGui.ImVec2(
        0,
        2 * ImGui.GetStyle().WindowPadding.y + ImGui.GetStyle().ItemSpacing.y * 3 + 3 * ImGui.GetFrameHeight()
      ),
      true
    );
    ImGui.Text('Edit');
    if (ImGui.Button('Import Height Map...')) {
      this.importHeightMap();
    }
    const sel = [this._editSelected] as [number];
    if (ImGui.Combo('Edit', sel, this._editList)) {
      this._editSelected = sel[0];
    }
    ImGui.EndChild();
  }
  renderGrassTextureSection() {
    ImGui.BeginChild(
      'GrassTexture',
      new ImGui.ImVec2(
        0,
        60 +
          2 * ImGui.GetFrameHeight() +
          2 * ImGui.GetStyle().WindowPadding.y +
          2 * ImGui.GetStyle().ItemSpacing.y
      ),
      true
    );
    ImGui.Text('Grass Textures');
    ImGui.BeginChild('GrassTextureList', new ImGui.ImVec2(0, 60));
    this._grassAlbedo.render(ImGui.GetContentRegionAvail());
    ImGui.EndChild();
    const layer = this._grassAlbedo.selected;
    if (layer >= 0) {
      const grassRenderer = this._terrain.get().grassRenderer;
      const bladeSize = [grassRenderer.getBladeWidth(layer), grassRenderer.getBladeHeight(layer)] as [
        number,
        number
      ];
      if (ImGui.SliderFloat2('BladeSize', bladeSize, 0, 10)) {
        grassRenderer.setBladeSize(layer, bladeSize[0], bladeSize[1]);
      }
    }
    ImGui.EndChild();
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
    if (ImGui.SliderFloat('Strength', brushStrength, 0, 1, '%.1f', ImGui.SliderFlags.None)) {
      this._brushStrength = brushStrength[0];
    }
    ImGui.EndChild();
  }
  async createHeightMapFromPNG(httpRequest: HttpRequest, url: string, heightMap: Texture2D) {
    const buffer = await httpRequest.requestArrayBuffer(url);
    const png = UPNG.decode(buffer);
    const { width, height, depth } = png;
    const data = new Uint8Array(png.data);
    const dataLen = data.length;
    const pixelDataLen = dataLen - height;
    if (depth !== 8 && depth !== 16) {
      return null;
    }
    const stride = pixelDataLen / ((width * height * depth) / 8);
    if (stride !== 1 && stride !== 2 && stride !== 3 && stride !== 4) {
      return null;
    }
    const tmpTexture = getDevice().createTexture2D('r32f', width, height, {
      mipmapping: false
    });
    const texels = new Float32Array(width * height);
    let dstOffset = 0;
    if (depth === 16) {
      let i = 0;
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const hi = data[i];
          const lo = data[i + 1];
          texels[dstOffset++] = ((hi << 8) | lo) / 65535;
          i += stride * 2;
        }
      }
    } else {
      let i = 0;
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const value = data[i];
          texels[dstOffset++] = value / 255;
          i += stride;
        }
      }
    }
    tmpTexture.update(texels, 0, 0, width, height);
    tmpTexture.name = 'TmpHeight';
    new CopyBlitter().blit(
      tmpTexture,
      heightMap,
      fetchSampler(
        heightMap.width === tmpTexture.width && heightMap.height === tmpTexture.height
          ? 'clamp_nearest_nomip'
          : 'clamp_linear_nomip'
      )
    );
    //tmpTexture.dispose();
  }
  importHeightMap() {
    FilePicker.chooseFiles(false, '.jpg,.tga,.png,.dds').then((files) => {
      if (files.length > 0) {
        const url = URL.createObjectURL(files[0]);
        const httpRequest = new HttpRequest(() => url);
        if (files[0].name.toLowerCase().endsWith('.png')) {
          this.createHeightMapFromPNG(httpRequest, url, this._terrain.get().heightMap)
            .then(() => {
              URL.revokeObjectURL(url);
              this._terrain.get().updateBoundingBox();
            })
            .catch((err) => {
              Dialog.messageBox('Error', String(err));
              URL.revokeObjectURL(url);
            });
          eventBus.dispatchEvent('scene_changed');
        } else {
          files[0].arrayBuffer().then((buffer) => {
            getEngine()
              .resourceManager.loadTextureFromBuffer(buffer, files[0].type, false, { mipFilter: 'none' })
              .then((tex) => {
                if (!tex || !tex.isTexture2D()) {
                  Dialog.messageBox('Error', 'Invalid texture');
                }
                const heightMap = this._terrain.get().heightMap;
                new CopyBlitter().blit(
                  tex,
                  heightMap,
                  fetchSampler(
                    heightMap.width === tex.width && heightMap.height === tex.height
                      ? 'clamp_nearest_nomip'
                      : 'clamp_linear_nomip'
                  )
                );
                this._terrain.get().updateBoundingBox();
                eventBus.dispatchEvent('scene_changed');
                URL.revokeObjectURL(url);
              })
              .catch((err) => {
                Dialog.messageBox('Error', String(err));
                URL.revokeObjectURL(url);
              });
          });
        }
      }
    });
  }
  render(): void {
    if (ImGui.Begin('Terrain Tools', null, ImGui.WindowFlags.AlwaysAutoResize | ImGui.WindowFlags.NoResize)) {
      ImGui.Dummy(new ImGui.ImVec2(300, 0));
      this.renderBrushSection();
      this.renderEditSection();
      if (this._editSelected >= 0) {
        this._brushList[this._editSelected].renderSettings(this);
      }
    }
    ImGui.End();
  }
  ensureTerrainHeightMap(): void {
    if (!this._terrain.get().heightMap) {
      const device = getDevice();
      const heightMap = device.createTexture2D(
        'r32f',
        Math.max(1, this._terrain.get().sizeX),
        Math.max(1, this._terrain.get().sizeZ)
      );
      heightMap.name = 'TerrainHeightMap';
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
  refreshGrassTextures() {
    const grassRenderer = this._terrain.get().grassRenderer;
    this._grassAlbedo.clear();
    for (let i = 0; i < grassRenderer.numLayers; i++) {
      this._grassAlbedo.addImage(grassRenderer.getGrassTexture(i));
    }
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
        const d = Math.hypot(u, v) * 0.9;
        const val = ((1 - smoothStep(0, 1, d)) * 255) >> 0;
        data[k++] = val;
        data[k++] = val;
        data[k++] = val;
        data[k++] = 255;
      }
    }
    const texture = getDevice().createTexture2D('rgba8unorm', size, size, {
      mipmapping: false
    });
    texture.name = 'DefaultBrush';
    texture.update(data, 0, 0, size, size);
    return texture;
  }
  protected onDispose(): void {
    super.onDispose();
    if (this._heightDirty && this._terrain?.get()) {
      this._heightDirty = false;
      this._terrain.get().updateBoundingBox();
    }
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
