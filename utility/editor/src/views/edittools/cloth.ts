import { Disposable, DRef, Vector3, type Nullable } from '@zephyr3d/base';
import { PBPrimitiveType } from '@zephyr3d/device';
import { ImGui } from '@zephyr3d/imgui';
import { Camera, Mesh, SceneNode } from '@zephyr3d/scene';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import { ClothWeightPaintCommand, type ClothWeightState } from '../../commands/scenecommands';
import type { Editor } from '../../core/editor';
import type { EditTool, EditToolContext } from './edittool';

type ClothPaintMode = 'pin' | 'unpin' | 'smooth';
type ClothMeshData = {
  vertexCount: number;
  positions: Nullable<Float32Array>;
  loading: boolean;
  error: string;
  primitiveSignature: string;
};

const MAX_WEIGHT_OVERLAY_POINTS = 6000;

function isGPUClothScript(script: string) {
  const normalized = (script ?? '').trim().toLowerCase().replace(/\\/g, '/');
  return /(^|\/)gpucloth(\.ts|\.js)?$/.test(normalized);
}

export function collectClothTargetMeshes(host: SceneNode): Mesh[] {
  if (!host) {
    return [];
  }
  if (host.isMesh() && host.primitive) {
    return [host];
  }
  const targets: Mesh[] = [];
  host.iterate((node) => {
    if (node.isMesh() && node.primitive) {
      targets.push(node);
    }
    return false;
  });
  return targets;
}

export function findClothPaintHost(startNode: Nullable<SceneNode>): Nullable<SceneNode> {
  let current = startNode;
  while (current) {
    if (isGPUClothScript((current as any).script ?? '') && collectClothTargetMeshes(current).length > 0) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function parsePinnedVertexMap(source: string): Record<string, string> {
  const text = String(source ?? '').trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string') {
        result[key] = typeof value === 'string' ? value : String(value ?? '');
      }
    }
    return result;
  } catch {
    return {};
  }
}

function serializePinnedVertexMap(value: Record<string, string>) {
  const entries = Object.entries(value)
    .filter(([, encoded]) => String(encoded ?? '').trim().length > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : '';
}

function clampWeight(value: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);
}

function parseLegacyPinnedVertexIndices(source: string) {
  const result = new Map<number, number>();
  if (!String(source ?? '').trim()) {
    return result;
  }
  for (const value of String(source ?? '')
    .split(/[^0-9]+/g)
    .filter((item) => item.length > 0)) {
    const index = Number(value);
    if (Number.isFinite(index) && index >= 0) {
      result.set(index | 0, 0);
    }
  }
  return result;
}

function parseVertexWeights(source: string) {
  const result = new Map<number, number>();
  const text = String(source ?? '').trim();
  if (!text) {
    return result;
  }
  for (const token of text.split(',')) {
    const entry = token.trim();
    if (!entry) {
      continue;
    }
    const separator = entry.indexOf(':');
    if (separator < 0) {
      continue;
    }
    const index = Number(entry.slice(0, separator).trim());
    const weight = clampWeight(Number(entry.slice(separator + 1).trim()));
    if (Number.isFinite(index) && index >= 0) {
      result.set(index | 0, weight);
    }
  }
  return result;
}

function serializeVertexWeights(weights: Map<number, number>) {
  return [...weights.entries()]
    .filter(([index, weight]) => Number.isFinite(index) && index >= 0 && clampWeight(weight) < 1 - 1e-4)
    .sort((a, b) => a[0] - b[0])
    .map(([index, weight]) => `${index}:${clampWeight(weight).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`)
    .join(', ');
}

function sameClothWeightState(a: ClothWeightState, b: ClothWeightState) {
  return (
    a.vertexPinWeightsByTarget === b.vertexPinWeightsByTarget &&
    a.pinnedVertexIndicesByTarget === b.pinnedVertexIndicesByTarget
  );
}

async function readMeshPositionData(mesh: Mesh): Promise<Float32Array> {
  const primitive = mesh.primitive;
  if (!primitive) {
    throw new Error('Mesh has no primitive.');
  }
  const info = primitive.getVertexBufferInfo('position');
  if (!info) {
    throw new Error('Mesh has no position buffer.');
  }
  if (!info.type.isPrimitiveType() || info.type.scalarType !== PBPrimitiveType.F32 || info.type.cols < 3) {
    throw new Error('Only float3/float4 position buffers are supported.');
  }
  const bytes = await info.buffer.getBufferSubData();
  const raw = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
  const stride = info.stride >> 2;
  const drawOffset = info.drawOffset >> 2;
  const vertexCount = primitive.getNumVertices();
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const src = drawOffset + i * stride;
    const dst = i * 3;
    positions[dst] = raw[src];
    positions[dst + 1] = raw[src + 1];
    positions[dst + 2] = raw[src + 2];
  }
  return positions;
}

export class ClothPaintTool extends Disposable implements EditTool {
  private readonly _host: DRef<SceneNode>;
  private readonly _ctx: EditToolContext;
  private readonly _targets: Mesh[];
  private readonly _meshData: Map<Mesh, ClothMeshData>;
  private _activeTargetIndex: number;
  private _paintMode: ClothPaintMode;
  private _brushRadius: number;
  private _brushFalloff: number;
  private _brushStrength: number;
  private _strokeActive: boolean;
  private _strokeStartState: Nullable<ClothWeightState>;
  private _lastStrokePos: Nullable<Vector3>;
  private _hoverHitPos: Nullable<Vector3>;
  private _vertexWeights: Map<number, number>;
  private readonly _tmpLocalPos: Vector3;
  private readonly _tmpWorldPos: Vector3;
  private readonly _tmpCameraAxisX: Vector3;
  private readonly _tmpCameraAxisY: Vector3;
  private readonly _tmpNdcPos: Vector3;
  private readonly _tmpScreenPos: Vector3;
  constructor(_editor: Editor, host: SceneNode, ctx: EditToolContext, preferredTarget?: Nullable<Mesh>) {
    super();
    void _editor;
    this._host = new DRef(host);
    this._ctx = ctx;
    this._targets = collectClothTargetMeshes(host);
    this._meshData = new Map();
    this._activeTargetIndex = Math.max(
      0,
      preferredTarget ? this._targets.findIndex((mesh) => mesh === preferredTarget) : 0
    );
    if (this._activeTargetIndex < 0) {
      this._activeTargetIndex = 0;
    }
    this._paintMode = 'pin';
    this._brushRadius = 0.1;
    this._brushFalloff = 0.35;
    this._brushStrength = 0.1;
    this._strokeActive = false;
    this._strokeStartState = null;
    this._lastStrokePos = null;
    this._hoverHitPos = null;
    this._vertexWeights = new Map();
    this._tmpLocalPos = new Vector3();
    this._tmpWorldPos = new Vector3();
    this._tmpCameraAxisX = new Vector3();
    this._tmpCameraAxisY = new Vector3();
    this._tmpNdcPos = new Vector3();
    this._tmpScreenPos = new Vector3();
    this.syncVertexWeightsFromConfig();
    this.ensureActiveMeshData();
  }
  handlePointerEvent(evt: PointerEvent, hitObject: any, hitPos: Vector3): boolean {
    if (!this._host.get() || this._targets.length === 0) {
      return false;
    }
    const hitMesh = this.resolveHitMesh(hitObject);
    if (hitMesh) {
      this.setActiveTarget(hitMesh);
    }
    this.updateHoverHit(hitMesh, hitPos);
    if (evt.type === 'pointerup' && evt.button === 0) {
      const handled = this._strokeActive;
      this.finishStroke();
      return handled;
    }
    if (evt.type === 'pointermove' && (evt.buttons & 1) === 0) {
      const handled = this._strokeActive;
      this.finishStroke();
      return handled;
    }
    if (ImGui.GetIO().WantCaptureMouse) {
      return false;
    }
    if (evt.type === 'pointerdown' && evt.button === 0) {
      if (!hitPos || !this.getActiveTarget() || hitMesh !== this.getActiveTarget()) {
        return false;
      }
      this.beginStroke();
      this.applyBrushDab(hitPos);
      return true;
    }
    if (evt.type === 'pointermove' && this._strokeActive) {
      if (hitPos && hitMesh === this.getActiveTarget()) {
        this.applyBrushDab(hitPos);
      }
      return true;
    }
    return false;
  }
  handleKeyboardEvent(_evt: KeyboardEvent): boolean {
    return false;
  }
  render(): void {
    const activeMesh = this.getActiveTarget();
    const meshInfo = activeMesh ? this._meshData.get(activeMesh) ?? null : null;
    if (ImGui.Begin('Cloth Paint', null, ImGui.WindowFlags.AlwaysAutoResize | ImGui.WindowFlags.NoResize)) {
      ImGui.Dummy(new ImGui.ImVec2(320, 0));
      ImGui.Text('Brush weight painting for GPU cloth.');
      if (this._targets.length > 1) {
        const current = [this._activeTargetIndex] as [number];
        if (
          ImGui.Combo(
            'Target Mesh',
            current,
            this._targets.map((mesh, index) => this.getMeshLabel(mesh, index))
          )
        ) {
          this._activeTargetIndex = current[0];
          this.syncVertexWeightsFromConfig();
          this.ensureActiveMeshData();
        }
      } else if (activeMesh) {
        ImGui.Text(`Target: ${this.getMeshLabel(activeMesh, this._activeTargetIndex)}`);
      }
      const modeIndex = [this._paintMode === 'pin' ? 0 : this._paintMode === 'unpin' ? 1 : 2] as [number];
      if (ImGui.Combo('Mode', modeIndex, ['Pin', 'Unpin', 'Smooth'])) {
        this._paintMode = modeIndex[0] === 0 ? 'pin' : modeIndex[0] === 1 ? 'unpin' : 'smooth';
      }
      const radius = [this._brushRadius] as [number];
      if (ImGui.SliderFloat('Radius', radius, 0.01, 2, '%.2f')) {
        this._brushRadius = Math.max(0.01, radius[0]);
      }
      const strength = [this._brushStrength] as [number];
      if (ImGui.SliderFloat('Strength', strength, 0, 1, '%.2f')) {
        this._brushStrength = clampWeight(strength[0]);
      }
      const falloff = [this._brushFalloff] as [number];
      if (ImGui.SliderFloat('Falloff', falloff, 0, 1, '%.2f')) {
        this._brushFalloff = clampWeight(falloff[0]);
      }
      ImGui.TextColored(new ImGui.ImVec4(0.95, 0.35, 0.35, 1), 'Fixed = Red');
      ImGui.SameLine();
      ImGui.TextColored(new ImGui.ImVec4(0.35, 0.95, 0.4, 1), 'Active = Green');
      ImGui.Text('Brush Preview: strength * falloff per dab');
      ImGui.Text(`Edited Count: ${this._vertexWeights.size}`);
      if (meshInfo) {
        if (meshInfo.loading) {
          ImGui.Text('Reading mesh vertices...');
        } else if (meshInfo.error) {
          ImGui.TextWrapped(`Vertex cache failed: ${meshInfo.error}`);
        } else {
          ImGui.Text(`Vertex Count: ${meshInfo.vertexCount}`);
        }
      }
      if (ImGui.Button('All Active')) {
        this.applyImmediateChange(
          new Map<number, number>(),
          'Set all cloth weights to active'
        );
      }
      ImGui.SameLine();
      if (ImGui.Button('All Fixed') && meshInfo?.positions) {
        this.applyImmediateChange(
          new Map(Array.from({ length: meshInfo.vertexCount }, (_, index) => [index, 0] as const)),
          'Set all cloth weights to fixed'
        );
      }
      if (this._targets.length > 1) {
        ImGui.TextWrapped('This tool stores painted weights per mesh target to avoid index collisions between submeshes.');
      }
    }
    ImGui.End();
    this.renderViewportOverlay(activeMesh, meshInfo);
  }
  update(): void {
    this.ensureActiveMeshData();
    if (!this._strokeActive) {
      this.syncVertexWeightsFromConfig();
    }
  }
  getSubMenuItems(): MenuItemOptions[] {
    return [];
  }
  getToolBarItems(): ToolBarItem[] {
    return [];
  }
  getTarget(): any {
    return this._host.get();
  }
  protected onDispose(): void {
    super.onDispose();
    this.finishStroke();
    this._hoverHitPos = null;
    this._host.dispose();
    this._meshData.clear();
  }
  private getActiveTarget() {
    return this._targets[this._activeTargetIndex] ?? null;
  }
  private getMeshLabel(mesh: Mesh, index: number) {
    return mesh.name?.trim() ? mesh.name : `Mesh ${index + 1}`;
  }
  private resolveHitMesh(hitObject: any): Nullable<Mesh> {
    let current = hitObject instanceof SceneNode ? hitObject : null;
    while (current) {
      if (current.isMesh()) {
        return this._targets.find((mesh) => mesh === current) ?? null;
      }
      if (current === this._host.get()) {
        break;
      }
      current = current.parent;
    }
    return null;
  }
  private setActiveTarget(mesh: Mesh) {
    const nextIndex = this._targets.findIndex((target) => target === mesh);
    if (nextIndex >= 0 && nextIndex !== this._activeTargetIndex) {
      this._activeTargetIndex = nextIndex;
      this.syncVertexWeightsFromConfig();
      this.ensureActiveMeshData();
    }
  }
  private beginStroke() {
    if (this._strokeActive) {
      return;
    }
    this.syncVertexWeightsFromConfig();
    this._strokeActive = true;
    this._strokeStartState = this.captureState();
    this._lastStrokePos = null;
  }
  private finishStroke() {
    if (!this._strokeActive) {
      return;
    }
    const oldState = this._strokeStartState;
    const newState = this.captureState();
    this._strokeActive = false;
    this._strokeStartState = null;
    this._lastStrokePos = null;
    if (oldState && !sameClothWeightState(oldState, newState)) {
      void this._ctx.executeCommand(new ClothWeightPaintCommand(this._host.get()!, oldState, newState));
      this._ctx.refreshProperties();
      this._ctx.notifySceneChanged();
    }
  }
  private updateHoverHit(hitMesh: Nullable<Mesh>, hitPos: Nullable<Vector3>) {
    if (hitMesh && hitMesh === this.getActiveTarget() && hitPos) {
      this._hoverHitPos = this._hoverHitPos ?? new Vector3();
      this._hoverHitPos.set(hitPos);
    } else if (!this._strokeActive) {
      this._hoverHitPos = null;
    }
  }
  private renderViewportOverlay(activeMesh: Nullable<Mesh>, meshInfo: Nullable<ClothMeshData>) {
    const camera = this._ctx.getCamera();
    const viewportRect = this._ctx.getViewportRect();
    if (!camera || !viewportRect || !activeMesh || !meshInfo?.positions || meshInfo.loading) {
      return;
    }
    const drawList = ImGui.GetForegroundDrawList();
    const clipMin = new ImGui.ImVec2(viewportRect[0], viewportRect[1]);
    const clipMax = new ImGui.ImVec2(viewportRect[0] + viewportRect[2], viewportRect[1] + viewportRect[3]);
    drawList.PushClipRect(clipMin, clipMax, true);
    this.drawWeightOverlay(drawList, camera, viewportRect, activeMesh, meshInfo);
    this.drawBrushOverlay(drawList, camera, viewportRect);
    drawList.PopClipRect();
  }
  private drawWeightOverlay(
    drawList: ReturnType<typeof ImGui.GetForegroundDrawList>,
    camera: Camera,
    viewportRect: readonly [number, number, number, number],
    mesh: Mesh,
    meshInfo: ClothMeshData
  ) {
    const pointRadius = meshInfo.vertexCount > 4000 ? 2 : meshInfo.vertexCount > 1500 ? 2.5 : 3;
    const sampleStep = Math.max(1, Math.ceil(meshInfo.vertexCount / MAX_WEIGHT_OVERLAY_POINTS));
    const worldMatrix = mesh.worldMatrix;
    for (let i = 0; i < meshInfo.vertexCount; i += sampleStep) {
      const offset = i * 3;
      this._tmpLocalPos.setXYZ(meshInfo.positions[offset], meshInfo.positions[offset + 1], meshInfo.positions[offset + 2]);
      worldMatrix.transformPointAffine(this._tmpLocalPos, this._tmpWorldPos);
      if (!this.projectWorldToScreen(camera, viewportRect, this._tmpWorldPos, this._tmpScreenPos)) {
        continue;
      }
      const weight = this.getStoredWeight(i);
      const influence = this.getBrushInfluenceAt(this._tmpWorldPos);
      const halfSize = pointRadius + influence * 1.5;
      const color = this.getVertexOverlayColor(weight, influence);
      drawList.AddRectFilled(
        new ImGui.ImVec2(this._tmpScreenPos.x - halfSize, this._tmpScreenPos.y - halfSize),
        new ImGui.ImVec2(this._tmpScreenPos.x + halfSize, this._tmpScreenPos.y + halfSize),
        color,
        0,
        0
      );
    }
  }
  private drawBrushOverlay(
    drawList: ReturnType<typeof ImGui.GetForegroundDrawList>,
    camera: Camera,
    viewportRect: readonly [number, number, number, number]
  ) {
    if (!this._hoverHitPos || !this.projectWorldToScreen(camera, viewportRect, this._hoverHitPos, this._tmpScreenPos)) {
      return;
    }
    const brushRadiusPx = this.getBrushRadiusInScreenSpace(camera, viewportRect, this._hoverHitPos);
    if (!(brushRadiusPx > 1)) {
      return;
    }
    const innerRadiusPx = brushRadiusPx * this.getBrushInnerRatio();
    const brushColor =
      this._paintMode === 'pin'
        ? new ImGui.ImVec4(0.35, 1, 0.45, 1)
        : this._paintMode === 'unpin'
          ? new ImGui.ImVec4(1, 0.28, 0.28, 1)
          : new ImGui.ImVec4(1, 0.85, 0.25, 1);
    const fillOuterColor = ImGui.ColorConvertFloat4ToU32(
      new ImGui.ImVec4(brushColor.x, brushColor.y, brushColor.z, 0.05)
    );
    const fillInnerColor = ImGui.ColorConvertFloat4ToU32(
      new ImGui.ImVec4(brushColor.x, brushColor.y, brushColor.z, 0.12)
    );
    const borderColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1, 1, 1, 0.95));
    const falloffColor = ImGui.ColorConvertFloat4ToU32(
      new ImGui.ImVec4(brushColor.x, brushColor.y, brushColor.z, 0.65)
    );
    const textColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1, 1, 1, 0.95));
    const center = new ImGui.ImVec2(this._tmpScreenPos.x, this._tmpScreenPos.y);
    drawList.AddCircleFilled(center, brushRadiusPx, fillOuterColor, 48);
    drawList.AddCircleFilled(center, innerRadiusPx, fillInnerColor, 40);
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      const radius = innerRadiusPx + (brushRadiusPx - innerRadiusPx) * t;
      const alpha = 0.45 * (1 - t) + 0.08;
      drawList.AddCircle(
        center,
        radius,
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(brushColor.x, brushColor.y, brushColor.z, alpha)),
        48,
        1
      );
    }
    drawList.AddCircle(center, innerRadiusPx, falloffColor, 40, 1);
    drawList.AddCircle(center, brushRadiusPx, borderColor, 48, 1.5);
    drawList.AddText(
      new ImGui.ImVec2(this._tmpScreenPos.x + brushRadiusPx + 8, this._tmpScreenPos.y - 8),
      textColor,
      `${this._paintMode.toUpperCase()} ${this._brushRadius.toFixed(2)} / ${this._brushStrength.toFixed(2)}`
    );
  }
  private getBrushRadiusInScreenSpace(
    camera: Camera,
    viewportRect: readonly [number, number, number, number],
    centerWorldPos: Vector3
  ) {
    const cameraWorldMatrix = camera.worldMatrix;
    this._tmpCameraAxisX.setXYZ(cameraWorldMatrix[0], cameraWorldMatrix[1], cameraWorldMatrix[2]).inplaceNormalize();
    this._tmpCameraAxisY.setXYZ(cameraWorldMatrix[4], cameraWorldMatrix[5], cameraWorldMatrix[6]).inplaceNormalize();
    const centerScreenX = this._tmpScreenPos.x;
    const centerScreenY = this._tmpScreenPos.y;
    let radiusPx = 0;
    this._tmpWorldPos.set(centerWorldPos);
    this._tmpWorldPos.addBy(Vector3.scale(this._tmpCameraAxisX, this._brushRadius, this._tmpLocalPos));
    if (this.projectWorldToScreen(camera, viewportRect, this._tmpWorldPos, this._tmpNdcPos)) {
      radiusPx = Math.max(
        radiusPx,
        Math.hypot(this._tmpNdcPos.x - centerScreenX, this._tmpNdcPos.y - centerScreenY)
      );
    }
    this._tmpWorldPos.set(centerWorldPos);
    this._tmpWorldPos.addBy(Vector3.scale(this._tmpCameraAxisY, this._brushRadius, this._tmpLocalPos));
    if (this.projectWorldToScreen(camera, viewportRect, this._tmpWorldPos, this._tmpNdcPos)) {
      radiusPx = Math.max(
        radiusPx,
        Math.hypot(this._tmpNdcPos.x - centerScreenX, this._tmpNdcPos.y - centerScreenY)
      );
    }
    return radiusPx;
  }
  private projectWorldToScreen(
    camera: Camera,
    viewportRect: readonly [number, number, number, number],
    worldPos: Vector3,
    out: Vector3
  ) {
    camera.viewProjectionMatrix.transformPointP(worldPos, this._tmpNdcPos);
    if (
      !Number.isFinite(this._tmpNdcPos.x) ||
      !Number.isFinite(this._tmpNdcPos.y) ||
      !Number.isFinite(this._tmpNdcPos.z) ||
      this._tmpNdcPos.x < -1 ||
      this._tmpNdcPos.x > 1 ||
      this._tmpNdcPos.y < -1 ||
      this._tmpNdcPos.y > 1 ||
      this._tmpNdcPos.z < -1 ||
      this._tmpNdcPos.z > 1
    ) {
      return false;
    }
    out.setXYZ(
      viewportRect[0] + (this._tmpNdcPos.x * 0.5 + 0.5) * viewportRect[2],
      viewportRect[1] + (1 - (this._tmpNdcPos.y * 0.5 + 0.5)) * viewportRect[3],
      this._tmpNdcPos.z
    );
    return true;
  }
  private getBrushInfluenceAt(worldPos: Vector3) {
    if (!this._hoverHitPos || this._brushRadius <= 0) {
      return 0;
    }
    const distanceSq = Vector3.distanceSq(worldPos, this._hoverHitPos);
    const radiusSq = this._brushRadius * this._brushRadius;
    if (distanceSq >= radiusSq) {
      return 0;
    }
    const innerRadius = this._brushRadius * this.getBrushInnerRatio();
    const innerRadiusSq = innerRadius * innerRadius;
    if (distanceSq <= innerRadiusSq) {
      return 1;
    }
    const distance = Math.sqrt(distanceSq);
    const t = (distance - innerRadius) / Math.max(this._brushRadius - innerRadius, 1e-5);
    const smoothT = t * t * (3 - 2 * t);
    return 1 - smoothT;
  }
  private getVertexOverlayColor(weight: number, influence: number) {
    const clampedWeight = clampWeight(weight);
    const base = [
      0.96 + (0.2 - 0.96) * clampedWeight,
      0.22 + (0.9 - 0.22) * clampedWeight,
      0.22 + (0.28 - 0.22) * clampedWeight,
      0.82
    ];
    const previewWeight =
      this._paintMode === 'pin'
        ? clampWeight(clampedWeight + this._brushStrength * influence)
        : this._paintMode === 'unpin'
          ? clampWeight(clampedWeight - this._brushStrength * influence)
          : clampedWeight;
    const preview =
      this._paintMode === 'smooth'
        ? [1, 0.9, 0.3, 0.95]
        : [
            0.96 + (0.2 - 0.96) * previewWeight,
            0.22 + (0.96 - 0.22) * previewWeight,
            0.22 + (0.3 - 0.22) * previewWeight,
            0.98
          ];
    const blend = this._paintMode === 'smooth' ? influence * 0.55 : influence * 0.9;
    return ImGui.ColorConvertFloat4ToU32(
      new ImGui.ImVec4(
        base[0] + (preview[0] - base[0]) * blend,
        base[1] + (preview[1] - base[1]) * blend,
        base[2] + (preview[2] - base[2]) * blend,
        base[3] + (preview[3] - base[3]) * blend
      )
    );
  }
  private getBrushInnerRatio() {
    return clampWeight(1 - this._brushFalloff);
  }
  private getStoredWeight(index: number) {
    return this._vertexWeights.get(index) ?? 1;
  }
  private setStoredWeight(index: number, weight: number) {
    const clamped = clampWeight(weight);
    if (clamped >= 1 - 1e-4) {
      this._vertexWeights.delete(index);
    } else {
      this._vertexWeights.set(index, clamped);
    }
  }
  private applyImmediateChange(weights: Map<number, number>, desc: string) {
    if (!this._host.get()) {
      return;
    }
    this.syncVertexWeightsFromConfig();
    const oldState = this.captureState();
    this._vertexWeights = new Map(weights);
    const newState = this.buildStateForActiveTarget();
    if (sameClothWeightState(oldState, newState)) {
      return;
    }
    this.applyState(newState);
    this._ctx.refreshProperties();
    this._ctx.notifySceneChanged();
    void this._ctx.executeCommand(new ClothWeightPaintCommand(this._host.get()!, oldState, newState, desc));
  }
  private syncVertexWeightsFromConfig() {
    const host = this._host.get();
    const activeMesh = this.getActiveTarget();
    if (!host || !activeMesh) {
      this._vertexWeights = new Map();
      return;
    }
    const config = ((host as any).scriptConfig ?? {}) as {
      vertexPinWeightsByTarget?: string;
      pinnedVertexIndicesByTarget?: string;
    };
    const map = parsePinnedVertexMap(config.vertexPinWeightsByTarget ?? '');
    const legacyMap = parsePinnedVertexMap(config.pinnedVertexIndicesByTarget ?? '');
    const targetId = String(activeMesh.persistentId ?? '');
    const source = targetId && Object.prototype.hasOwnProperty.call(map, targetId) ? map[targetId] ?? '' : '';
    const legacySource =
      targetId && Object.prototype.hasOwnProperty.call(legacyMap, targetId) ? legacyMap[targetId] ?? '' : '';
    this._vertexWeights =
      source.trim().length > 0
        ? parseVertexWeights(source)
        : parseLegacyPinnedVertexIndices(legacySource);
  }
  private captureState(): ClothWeightState {
    const host = this._host.get();
    const config = ((host as any)?.scriptConfig ?? {}) as {
      vertexPinWeightsByTarget?: string;
      pinnedVertexIndicesByTarget?: string;
    };
    return {
      vertexPinWeightsByTarget: String(config.vertexPinWeightsByTarget ?? ''),
      pinnedVertexIndicesByTarget: String(config.pinnedVertexIndicesByTarget ?? '')
    };
  }
  private buildStateForActiveTarget(): ClothWeightState {
    const current = this.captureState();
    const mesh = this.getActiveTarget();
    if (!mesh) {
      return current;
    }
    const targetId = String(mesh.persistentId ?? '');
    const nextByTarget = parsePinnedVertexMap(current.vertexPinWeightsByTarget);
    const serializedWeights = serializeVertexWeights(this._vertexWeights);
    if (targetId) {
      if (serializedWeights) {
        nextByTarget[targetId] = serializedWeights;
      } else {
        delete nextByTarget[targetId];
      }
    }
    return {
      vertexPinWeightsByTarget: serializePinnedVertexMap(nextByTarget),
      pinnedVertexIndicesByTarget: ''
    };
  }
  private applyState(state: ClothWeightState) {
    const host = this._host.get();
    if (!host) {
      return;
    }
    const config = (((host as any).scriptConfig ??= {}) as {
      vertexPinWeightsByTarget?: string;
      pinnedVertexIndicesByTarget?: string;
    });
    config.vertexPinWeightsByTarget = state.vertexPinWeightsByTarget;
    config.pinnedVertexIndicesByTarget = state.pinnedVertexIndicesByTarget;
  }
  private ensureActiveMeshData() {
    const mesh = this.getActiveTarget();
    if (!mesh?.primitive) {
      return;
    }
    const primitive = mesh.primitive;
    const primitiveSignature = `${primitive.id}:${primitive.changeTag}`;
    let data = this._meshData.get(mesh);
    if (data?.loading || data?.primitiveSignature === primitiveSignature) {
      return;
    }
    data = {
      vertexCount: primitive.getNumVertices(),
      positions: data?.positions ?? null,
      loading: true,
      error: '',
      primitiveSignature
    };
    this._meshData.set(mesh, data);
    void readMeshPositionData(mesh)
      .then((positions) => {
        const next = this._meshData.get(mesh);
        if (!next || next.primitiveSignature !== primitiveSignature) {
          return;
        }
        next.positions = positions;
        next.vertexCount = positions.length / 3;
        next.loading = false;
        next.error = '';
      })
      .catch((err) => {
        const next = this._meshData.get(mesh);
        if (!next || next.primitiveSignature !== primitiveSignature) {
          return;
        }
        next.positions = null;
        next.loading = false;
        next.error = err instanceof Error ? err.message : String(err);
      });
  }
  private applyBrushDab(hitPos: Vector3) {
    const mesh = this.getActiveTarget();
    const data = mesh ? this._meshData.get(mesh) : null;
    if (!mesh || !data?.positions || data.loading) {
      return;
    }
    const spacing = Math.max(this._brushRadius * 0.15, 0.005);
    if (this._lastStrokePos) {
      const dx = hitPos.x - this._lastStrokePos.x;
      const dy = hitPos.y - this._lastStrokePos.y;
      const dz = hitPos.z - this._lastStrokePos.z;
      if (dx * dx + dy * dy + dz * dz < spacing * spacing) {
        return;
      }
    }
    const radiusSq = this._brushRadius * this._brushRadius;
    const worldMatrix = mesh.worldMatrix;
    const affectedIndices: number[] = [];
    const affectedInfluences: number[] = [];
    const affectedPositions: number[] = [];
    let changed = false;
    for (let i = 0; i < data.vertexCount; i++) {
      const offset = i * 3;
      this._tmpLocalPos.setXYZ(data.positions[offset], data.positions[offset + 1], data.positions[offset + 2]);
      worldMatrix.transformPointAffine(this._tmpLocalPos, this._tmpWorldPos);
      const dx = this._tmpWorldPos.x - hitPos.x;
      const dy = this._tmpWorldPos.y - hitPos.y;
      const dz = this._tmpWorldPos.z - hitPos.z;
      if (dx * dx + dy * dy + dz * dz > radiusSq) {
        continue;
      }
      const influence = this.getBrushInfluenceAt(this._tmpWorldPos);
      if (influence <= 0) {
        continue;
      }
      affectedIndices.push(i);
      affectedInfluences.push(influence);
      affectedPositions.push(this._tmpWorldPos.x, this._tmpWorldPos.y, this._tmpWorldPos.z);
    }
    if (affectedIndices.length === 0) {
      return;
    }
    if (this._paintMode === 'smooth') {
      const nextWeights: number[] = new Array(affectedIndices.length);
      for (let i = 0; i < affectedIndices.length; i++) {
        const currentWeight = this.getStoredWeight(affectedIndices[i]);
        let sum = 0;
        let total = 0;
        const ax = affectedPositions[i * 3];
        const ay = affectedPositions[i * 3 + 1];
        const az = affectedPositions[i * 3 + 2];
        for (let j = 0; j < affectedIndices.length; j++) {
          const dx = affectedPositions[j * 3] - ax;
          const dy = affectedPositions[j * 3 + 1] - ay;
          const dz = affectedPositions[j * 3 + 2] - az;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const neighborInfluence = Math.max(0, 1 - dist / Math.max(this._brushRadius, 1e-5));
          if (neighborInfluence <= 0) {
            continue;
          }
          total += neighborInfluence;
          sum += this.getStoredWeight(affectedIndices[j]) * neighborInfluence;
        }
        const averageWeight = total > 1e-5 ? sum / total : currentWeight;
        nextWeights[i] = clampWeight(
          currentWeight + (averageWeight - currentWeight) * this._brushStrength * affectedInfluences[i]
        );
      }
      for (let i = 0; i < affectedIndices.length; i++) {
        const index = affectedIndices[i];
        const currentWeight = this.getStoredWeight(index);
        const nextWeight = nextWeights[i];
        if (Math.abs(nextWeight - currentWeight) <= 1e-4) {
          continue;
        }
        this.setStoredWeight(index, nextWeight);
        changed = true;
      }
    } else {
      const direction = this._paintMode === 'pin' ? 1 : -1;
      for (let i = 0; i < affectedIndices.length; i++) {
        const index = affectedIndices[i];
        const currentWeight = this.getStoredWeight(index);
        const nextWeight = clampWeight(currentWeight + direction * this._brushStrength * affectedInfluences[i]);
        if (Math.abs(nextWeight - currentWeight) <= 1e-4) {
          continue;
        }
        this.setStoredWeight(index, nextWeight);
        changed = true;
      }
    }
    this._lastStrokePos = this._lastStrokePos ?? new Vector3();
    this._lastStrokePos.set(hitPos);
    if (changed) {
      const state = this.buildStateForActiveTarget();
      this.applyState(state);
      this._ctx.refreshProperties();
      this._ctx.notifySceneChanged();
    }
  }
}
