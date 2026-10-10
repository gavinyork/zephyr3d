/**
 * Edit tool of a FoliageSystem: a brush painting the density mask of a layer, whose painted
 * instances are regenerated under the brush as it moves, and erasing them and the placed ones.
 *
 * Painting follows the PCG paint tool of Unreal Engine 5 (PCGPaintTool.cpp): the brush writes
 * where things grow and how densely, not instances; the layer's generation rule turns that into
 * instances. Shift erases, as there and in the classic foliage mode; [ and ] resize the brush,
 * as in the Unreal editor.
 */
import { Disposable, DRef, Vector3 } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type { FoliageLayer, FoliageSystem } from '@zephyr3d/scene';
import { ImGui } from '@zephyr3d/imgui';
import type { EditTool, EditToolContext } from './edittool';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import { CustomCommand } from '../../commands/scenecommands';
import { eventBus } from '../../core/eventbus';
import {
  applyFoliageBrushStamp,
  countFoliageCandidates,
  foliageLayerIsAsync,
  regenerateFoliageLayer,
  regenerateFoliageRegion,
  regenerateFoliageRegionSync
} from '../../helpers/foliagepaint';
import type { FoliageGenRegion } from '../../helpers/foliagegen';

/** Density change per second at full strength while the brush is held down */
const PAINT_RATE = 2;
/** Most candidates regenerated synchronously in one frame; larger strokes are deferred */
const SYNC_CANDIDATE_BUDGET = 20000;
/** Segments of the brush circle */
const CIRCLE_SEGMENTS = 48;

/** What one stroke changed, to undo it: mask tiles and instance groups of the layers touched */
type StrokeSnapshot = {
  /** Per layer: the mask tiles before the stroke, by tile key */
  masks: Map<FoliageLayer, Map<string, { tx: number; tz: number; cells: Uint8Array | null }>>;
  /** Per layer: the instances of both groups before the stroke */
  instances: Map<FoliageLayer, { generated: Float32Array; manual: Float32Array }>;
};

function unionRegion(a: Nullable<FoliageGenRegion>, b: Readonly<FoliageGenRegion>): FoliageGenRegion {
  return a
    ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
    : [b[0], b[1], b[2], b[3]];
}

export class FoliageEditTool extends Disposable implements EditTool {
  private readonly _foliage: DRef<FoliageSystem>;
  private readonly _ctx: EditToolContext;
  private _layerIndex: number;
  private _radius: number;
  private _strength: number;
  private _falloff: number;
  private _eraseMode: boolean;
  private _erasePlaced: boolean;
  private _allLayers: boolean;
  /** World position under the cursor, when it is over something */
  private _hitPos: Nullable<Vector3>;
  private _brushing: boolean;
  private _shift: boolean;
  private _stroke: Nullable<StrokeSnapshot>;
  /** Regions painted in this stroke not regenerated yet, per layer */
  private readonly _pending: Map<FoliageLayer, FoliageGenRegion>;
  /** Regions of layers with a place script, regenerated in the worker once the stroke ends */
  private readonly _deferred: Map<FoliageLayer, FoliageGenRegion>;
  private _regenerating: boolean;
  private readonly _onKeyDown: (evt: KeyboardEvent) => void;
  constructor(foliage: FoliageSystem, ctx: EditToolContext) {
    super();
    this._foliage = new DRef(foliage);
    this._ctx = ctx;
    this._layerIndex = 0;
    this._radius = 10;
    this._strength = 0.5;
    this._falloff = 0.5;
    this._eraseMode = false;
    this._erasePlaced = true;
    this._allLayers = false;
    this._hitPos = null;
    this._brushing = false;
    this._shift = false;
    this._stroke = null;
    this._pending = new Map();
    this._deferred = new Map();
    this._regenerating = false;
    // Edit tools are not sent keyboard events, and the camera takes the wheel
    this._onKeyDown = (evt: KeyboardEvent) => {
      this._shift = evt.shiftKey;
      const target = evt.target as Nullable<HTMLElement>;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (typing || ImGui.GetIO().WantTextInput || !this._hitPos) {
        return;
      }
      if (evt.key === '[' || evt.key === ']') {
        const factor = evt.key === ']' ? 1.15 : 1 / 1.15;
        this._radius = Math.min(500, Math.max(0.5, this._radius * factor));
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyDown);
  }
  private get foliage() {
    return this._foliage.get();
  }
  /** Whether the brush erases right now: the erase mode, or shift held */
  private get erasing() {
    return this._eraseMode !== this._shift;
  }
  getTarget() {
    return this.foliage;
  }
  getSubMenuItems(): MenuItemOptions[] {
    return [];
  }
  getToolBarItems(): ToolBarItem[] {
    return [];
  }
  handlePointerEvent(evt: PointerEvent, _hitObject: any, hitPos: Vector3): boolean {
    this._shift = evt.shiftKey;
    // Anything under the cursor can be painted on: the layer decides what instances stand on
    this._hitPos = hitPos ? new Vector3(hitPos) : null;
    if (
      evt.type === 'pointerdown' &&
      evt.button === 0 &&
      this._hitPos &&
      this.foliage?.getLayer(this._layerIndex)
    ) {
      this.beginStroke();
      return true;
    }
    if (this._brushing && (evt.buttons & 1) === 0) {
      void this.endStroke();
    }
    // Swallow clicks while painting, so they do not change the selection
    return this._brushing;
  }
  handleKeyboardEvent(evt: KeyboardEvent): boolean {
    this._shift = evt.shiftKey;
    return false;
  }
  update(dt: number) {
    const foliage = this.foliage;
    if (!foliage) {
      return;
    }
    if (this._brushing && this._hitPos) {
      this.stamp(Math.min(dt > 0 ? dt : 1 / 60, 0.1));
    }
    this.flushPending();
  }
  /** Layers the brush acts on: the current one, or every one when erasing all layers */
  private targetLayers() {
    const foliage = this.foliage!;
    if (this.erasing && this._allLayers) {
      return Array.from({ length: foliage.numLayers }, (_, i) => i);
    }
    return foliage.getLayer(this._layerIndex) ? [this._layerIndex] : [];
  }
  private beginStroke() {
    this._brushing = true;
    this._stroke = { masks: new Map(), instances: new Map() };
  }
  /** Records what a layer was before the stroke touches an area of it, the first time only */
  private snapshot(layer: FoliageLayer, region: Readonly<FoliageGenRegion>) {
    const stroke = this._stroke;
    if (!stroke) {
      return;
    }
    let tiles = stroke.masks.get(layer);
    if (!tiles) {
      tiles = new Map();
      stroke.masks.set(layer, tiles);
    }
    for (const [tx, tz] of layer.mask.tilesInRegion(region)) {
      const key = `${tx},${tz}`;
      if (!tiles.has(key)) {
        const [copy] = layer.mask.copyTiles(this.tileRegion(layer, tx, tz));
        tiles.set(key, { tx, tz, cells: copy?.cells ?? null });
      }
    }
    if (!stroke.instances.has(layer)) {
      stroke.instances.set(layer, {
        generated: layer.getInstances('generated'),
        manual: layer.getInstances('manual')
      });
    }
  }
  /** Region covered by one mask tile, slightly shrunk so it touches only that tile */
  private tileRegion(layer: FoliageLayer, tx: number, tz: number): FoliageGenRegion {
    const span = layer.mask.cellSize * 64;
    const e = span * 1e-6;
    return [tx * span + e, tz * span + e, (tx + 1) * span - e, (tz + 1) * span - e];
  }
  private stamp(dt: number) {
    const foliage = this.foliage!;
    const m = foliage.worldMatrix;
    const x = this._hitPos!.x - m.m03;
    const z = this._hitPos!.z - m.m23;
    const erase = this.erasing;
    for (const index of this.targetLayers()) {
      const layer = foliage.getLayer(index)!;
      const reach: FoliageGenRegion = [
        x - this._radius,
        z - this._radius,
        x + this._radius,
        z + this._radius
      ];
      this.snapshot(layer, reach);
      const changed = applyFoliageBrushStamp(foliage, index, {
        x,
        z,
        radius: this._radius,
        strength: Math.min(1, this._strength * PAINT_RATE * dt),
        falloff: this._falloff,
        erase,
        erasePlaced: this._erasePlaced
      });
      if (changed) {
        this._pending.set(layer, unionRegion(this._pending.get(layer) ?? null, changed));
      }
    }
  }
  /** Regenerates what was painted: synchronously when cheap, otherwise once the stroke ends */
  private flushPending() {
    const foliage = this.foliage;
    if (!foliage || this._pending.size === 0) {
      return;
    }
    let changed = false;
    for (const [layer, region] of [...this._pending]) {
      const index = foliage.indexOfLayer(layer);
      this._pending.delete(layer);
      if (index < 0) {
        continue;
      }
      if (foliageLayerIsAsync(layer) || countFoliageCandidates(layer, region) > SYNC_CANDIDATE_BUDGET) {
        this._deferred.set(layer, unionRegion(this._deferred.get(layer) ?? null, region));
        continue;
      }
      try {
        regenerateFoliageRegionSync(foliage, index, region);
        changed = true;
      } catch (err) {
        console.error(`Foliage brush: ${err}`);
      }
    }
    if (changed) {
      this._ctx.notifySceneChanged();
    }
    if (!this._brushing) {
      void this.flushDeferred();
    }
  }
  /** Regenerates the regions left for the worker or too large for one frame */
  private async flushDeferred() {
    const foliage = this.foliage;
    if (!foliage || this._deferred.size === 0 || this._regenerating) {
      return;
    }
    this._regenerating = true;
    try {
      for (const [layer, region] of [...this._deferred]) {
        this._deferred.delete(layer);
        const index = foliage.indexOfLayer(layer);
        if (index >= 0) {
          await regenerateFoliageRegion(foliage, index, region);
        }
      }
      this._ctx.notifySceneChanged();
    } catch (err) {
      console.error(`Foliage brush: ${err}`);
    } finally {
      this._regenerating = false;
    }
  }
  /** Finishes a stroke: regenerates what is left, and records the stroke for undo */
  private async endStroke() {
    this._brushing = false;
    const stroke = this._stroke;
    this._stroke = null;
    this.flushPending();
    await this.flushDeferred();
    const foliage = this.foliage;
    if (!foliage || !stroke || stroke.instances.size === 0) {
      return;
    }
    const before = stroke;
    const after: StrokeSnapshot = { masks: new Map(), instances: new Map() };
    for (const [layer, tiles] of before.masks) {
      const now = new Map<string, { tx: number; tz: number; cells: Uint8Array | null }>();
      for (const [key, { tx, tz }] of tiles) {
        const [copy] = layer.mask.copyTiles(this.tileRegion(layer, tx, tz));
        now.set(key, { tx, tz, cells: copy?.cells ?? null });
      }
      after.masks.set(layer, now);
    }
    for (const layer of before.instances.keys()) {
      after.instances.set(layer, {
        generated: layer.getInstances('generated'),
        manual: layer.getInstances('manual')
      });
    }
    const apply = (state: StrokeSnapshot) => {
      const target = this.foliage ?? foliage;
      for (const [layer, tiles] of state.masks) {
        layer.mask.restoreTiles([...tiles.values()]);
      }
      for (const [layer, { generated, manual }] of state.instances) {
        const index = target.indexOfLayer(layer);
        if (index >= 0) {
          target.setInstances(index, generated, 'generated');
          target.setInstances(index, manual, 'manual');
        }
      }
      eventBus.dispatchEvent('scene_changed');
      eventBus.dispatchEvent('refresh_properties');
    };
    let first = true;
    await this._ctx.executeCommand(
      new CustomCommand(
        () => {
          // The stroke is already applied when it is recorded
          if (!first) {
            apply(after);
          }
          first = false;
        },
        () => apply(before)
      ).setDesc(this.erasing ? 'Erase foliage' : 'Paint foliage')
    );
    this._ctx.refreshProperties();
  }
  render() {
    const foliage = this.foliage;
    if (!foliage) {
      return;
    }
    this.renderBrushCircle();
    if (ImGui.Begin('Foliage Brush', null, ImGui.WindowFlags.AlwaysAutoResize | ImGui.WindowFlags.NoResize)) {
      ImGui.Dummy(new ImGui.ImVec2(280, 0));
      if (foliage.numLayers === 0) {
        ImGui.TextWrapped('Add a layer in the Layers property of the foliage system to paint it.');
      } else {
        this._layerIndex = Math.min(this._layerIndex, foliage.numLayers - 1);
        const names = Array.from({ length: foliage.numLayers }, (_, i) => {
          const asset = foliage.getLayer(i)!.asset;
          return `${i}: ${asset ? asset.split('/').pop() : '<no asset>'}`;
        });
        const selected = [this._layerIndex] as [number];
        if (ImGui.Combo('Layer', selected, names)) {
          this._layerIndex = selected[0];
        }
        const layer = foliage.getLayer(this._layerIndex)!;
        ImGui.Text(`Painted ${layer.generatedCount}, placed ${layer.manualCount}`);
        const surface = layer.generation.surface;
        if (surface === 'terrain' && !foliage.terrain) {
          ImGui.TextColored(
            new ImGui.ImVec4(1, 0.7, 0.3, 1),
            'The layer grows on the terrain, but the foliage system is not under one.'
          );
        } else if (surface === 'any' && !foliage.scene?.physicsWorld) {
          ImGui.TextColored(
            new ImGui.ImVec4(1, 0.7, 0.3, 1),
            'The layer grows on any surface, which needs physics; it is not available.'
          );
        } else if (surface === 'any') {
          ImGui.TextDisabled('Grows on anything with a collider below the brush.');
        }
        const mode = [this._eraseMode ? 1 : 0] as [number];
        if (ImGui.Combo('Mode', mode, ['Paint', 'Erase'])) {
          this._eraseMode = mode[0] === 1;
        }
        const radius = [this._radius] as [number];
        if (ImGui.SliderFloat('Radius', radius, 0.5, 200, '%.1f m', ImGui.SliderFlags.Logarithmic)) {
          this._radius = radius[0];
        }
        const strength = [this._strength] as [number];
        if (ImGui.SliderFloat('Strength', strength, 0.01, 1, '%.2f')) {
          this._strength = strength[0];
        }
        const falloff = [this._falloff] as [number];
        if (ImGui.SliderFloat('Falloff', falloff, 0, 1, '%.2f')) {
          this._falloff = falloff[0];
        }
        const erasePlaced = [this._erasePlaced] as [boolean];
        if (ImGui.Checkbox('Erase placed instances too', erasePlaced)) {
          this._erasePlaced = erasePlaced[0];
        }
        const allLayers = [this._allLayers] as [boolean];
        if (ImGui.Checkbox('Erase every layer', allLayers)) {
          this._allLayers = allLayers[0];
        }
        ImGui.Separator();
        if (ImGui.Button('Regenerate layer')) {
          void this.regenerateLayer();
        }
        if (ImGui.IsItemHovered()) {
          ImGui.SetTooltip(
            'Grows the painted instances again from the mask, after changing the layer generation settings'
          );
        }
        ImGui.TextDisabled('Drag to paint, Shift to erase, [ ] to resize');
        if (this._regenerating) {
          ImGui.TextDisabled('Generating...');
        }
      }
    }
    ImGui.End();
  }
  /** Regenerates the whole current layer, as one undoable command */
  private async regenerateLayer() {
    const foliage = this.foliage;
    const layer = foliage?.getLayer(this._layerIndex);
    if (!foliage || !layer || this._regenerating) {
      return;
    }
    const before = layer.getInstances('generated');
    this._regenerating = true;
    try {
      await regenerateFoliageLayer(foliage, this._layerIndex);
    } catch (err) {
      console.error(`Foliage regenerate: ${err}`);
    } finally {
      this._regenerating = false;
    }
    const after = layer.getInstances('generated');
    const set = (data: Float32Array) => {
      const index = foliage.indexOfLayer(layer);
      if (index >= 0) {
        foliage.setInstances(index, data, 'generated');
        eventBus.dispatchEvent('scene_changed');
        eventBus.dispatchEvent('refresh_properties');
      }
    };
    let first = true;
    await this._ctx.executeCommand(
      new CustomCommand(
        () => {
          if (!first) {
            set(after);
          }
          first = false;
        },
        () => set(before)
      ).setDesc('Regenerate foliage layer')
    );
  }
  /** The brush outline, projected onto the screen, in the background of the windows */
  private renderBrushCircle() {
    const camera = this._ctx.getCamera();
    const rect = this._ctx.getViewportRect();
    const center = this._hitPos;
    if (!camera || !rect || !center) {
      return;
    }
    const vp = camera.viewProjectionMatrix;
    const drawList = ImGui.GetBackgroundDrawList();
    const color = this.erasing
      ? ImGui.GetColorU32(new ImGui.ImVec4(1, 0.35, 0.3, 1))
      : ImGui.GetColorU32(new ImGui.ImVec4(0.4, 1, 0.5, 1));
    const inner = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 0.5));
    // On the terrain when the layer grows on it, so the circle hugs the ground; on any surface,
    // flat at the height of the point under the cursor
    const layer = this.foliage?.getLayer(this._layerIndex) ?? null;
    const terrain = layer?.generation.surface === 'terrain' ? (this.foliage?.terrain ?? null) : null;
    const project = (wx: number, wz: number, wy: number) => {
      const y = terrain?.getHeightAt(wx, wz) ?? wy;
      const p = vp.transformPoint(new Vector3(wx, y, wz));
      if (p.w <= 0) {
        return null;
      }
      return new ImGui.ImVec2(
        rect[0] + ((p.x / p.w) * 0.5 + 0.5) * rect[2],
        rect[1] + (0.5 - (p.y / p.w) * 0.5) * rect[3]
      );
    };
    const ring = (r: number, col: number, thickness: number) => {
      let prev: Nullable<ImGui.ImVec2> = null;
      for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
        const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        const p = project(center.x + Math.cos(a) * r, center.z + Math.sin(a) * r, center.y);
        if (p && prev) {
          drawList.AddLine(prev, p, col, thickness);
        }
        prev = p;
      }
    };
    ring(this._radius, color, 2);
    // Where the weight starts to fall off
    const full = this._radius * (1 - this._falloff);
    if (full > 0.05 * this._radius && this._falloff > 0) {
      ring(full, inner, 1);
    }
  }
  protected onDispose() {
    super.onDispose();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyDown);
    if (this._brushing) {
      this._brushing = false;
    }
    this._foliage.dispose();
  }
}
