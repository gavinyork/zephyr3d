import { Application, AssetRegistry, ClipmapTerrain, DRef, Primitive } from '@zephyr3d/scene';
import type { EditTool } from './edittool';
import { Vector2, Vector4, type Vector3 } from '@zephyr3d/base';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import { ImGui } from '@zephyr3d/imgui';
import { ImageList } from '../../components/imagelist';
import { Editor } from '../../core/editor';
import { BindGroup, GPUProgram, RenderStateSet } from '@zephyr3d/device';

export class TerrainEditTool implements EditTool {
  private static _brushProgram: GPUProgram = null;
  private static _brushBindGroup: BindGroup = null;
  private static _brushPrimitive: Primitive = null;
  private static _brushRenderStates: RenderStateSet = null;
  private _terrain: DRef<ClipmapTerrain>;
  private _disposed: boolean;
  private _brushSize: number;
  private _brushAngle: number;
  private _brushStrength: number;
  private _brushImageList: ImageList;
  private _editList: string[];
  private _editSelected: number;
  private _brushing: boolean;
  private _hitPos: Vector2;
  constructor(terrain: ClipmapTerrain, assetRegistry: AssetRegistry) {
    this._terrain = new DRef(terrain);
    this._brushSize = 10;
    this._brushAngle = 0;
    this._brushStrength = 1;
    this._disposed = false;
    this._brushing = false;
    this._brushImageList = new ImageList(assetRegistry);
    this._editList = ['raise', 'smooth', 'level', 'copy', 'texture'];
    this._editSelected = -1;
    this._hitPos = null;
    for (const name in Editor.instance.getBrushes()) {
      this._brushImageList.addImage(Editor.instance.getBrushes()[name].get());
    }
    this._brushImageList.selected = 0;
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
    if (this._brushing && this._hitPos) {
      this.drawRegion(this._hitPos, this._brushSize, this._brushAngle);
      if (this._editList[this._editSelected] !== 'texture') {
        this._terrain.get().material.calculateNormalMap();
      }
    }
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
    }
    ImGui.End();
  }
  drawRegion(pos: Vector2, size: number, angle: number) {
    TerrainEditTool.prepareBrush();
    const terrain = this._terrain.get();
    const device = Application.instance.device;
    let clear = false;
    if (!terrain.heightMap) {
      terrain.heightMap = device.createTexture2D(
        'r16f',
        Math.max(1, terrain.sizeX),
        Math.max(1, terrain.sizeZ),
        {
          samplerOptions: { mipFilter: 'none' }
        }
      );
      clear = true;
    }
    const program = TerrainEditTool._brushProgram;
    const bindGroup = TerrainEditTool._brushBindGroup;
    const framebuffer = device.pool.fetchTemporalFramebuffer(false, 0, 0, terrain.heightMap, null, false);
    bindGroup.setValue('params', new Vector4(pos.x, pos.y, size, angle));
    bindGroup.setValue('region', terrain.worldRegion);
    device.pushDeviceStates();
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    device.setRenderStates(TerrainEditTool._brushRenderStates);
    device.setFramebuffer(framebuffer);
    if (clear) {
      device.clearFrameBuffer(Vector4.zero(), 1, 0);
    }
    TerrainEditTool._brushPrimitive.draw();
    device.popDeviceStates();
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
  static prepareBrush() {
    if (!this._brushProgram) {
      this._brushProgram = Application.instance.device.buildRenderProgram({
        vertex(pb) {
          this.params = pb.vec4().uniform(0);
          this.region = pb.vec4().uniform(0);
          this.$inputs.position = pb.float().attrib('position');
          this.axis = [pb.vec2(-1, -1), pb.vec2(1, -1), pb.vec2(-1, 1), pb.vec2(1, 1)];
          pb.main(function () {
            this.$l.worldPos = this.params.xy;
            this.$l.size = this.params.z;
            this.$l.angle = this.params.w;
            this.$l.s = pb.sin(this.angle);
            this.$l.c = pb.cos(this.angle);
            this.$l.rotMat = pb.mat2(this.c, this.s, pb.neg(this.s), this.c);
            this.$l.axis = pb.mul(this.rotMat, this.axis.at(this.$builtins.vertexIndex));
            this.$l.pos = pb.add(this.worldPos, pb.mul(pb.normalize(this.axis), this.size));
            this.$l.uv = pb.div(pb.sub(this.pos, this.region.xy), pb.sub(this.region.zw, this.region.xy));
            this.$l.cs = pb.sub(pb.mul(this.uv, 2), pb.vec2(1));
            this.$outputs.uv = this.uv;
            this.$builtins.position = pb.vec4(this.cs.x, pb.neg(this.cs.y), 0, 1);
          });
        },
        fragment(pb) {
          this.$outputs.color = pb.vec4();
          pb.main(function () {
            this.$l.height = pb.length(this.$inputs.uv);
            this.$outputs.color = pb.vec4(this.height, this.height, this.height, 1);
          });
        }
      });
      this._brushBindGroup = Application.instance.device.createBindGroup(
        this._brushProgram.bindGroupLayouts[0]
      );
      this._brushPrimitive = new Primitive();
      this._brushPrimitive.createAndSetVertexBuffer('position_f32', new Float32Array([0, 1, 2, 3]));
      this._brushPrimitive.indexCount = 4;
      this._brushPrimitive.indexStart = 0;
      this._brushPrimitive.primitiveType = 'triangle-strip';
      this._brushRenderStates = Application.instance.device.createRenderStateSet();
      this._brushRenderStates.useDepthState().enableTest(false).enableWrite(false);
      this._brushRenderStates.useRasterizerState().setCullMode('none');
      this._brushRenderStates
        .useBlendingState()
        .enable(true)
        .setBlendFuncRGB('one', 'one')
        .setBlendFuncAlpha('zero', 'one');
    }
  }
  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
      this._terrain.dispose();
    }
  }
}
