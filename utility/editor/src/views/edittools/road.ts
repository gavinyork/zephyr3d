/**
 * Edit tool of a RoadSpline: drag its control points over the terrain, add, insert and delete
 * points, set the width and bank of one, and fit the road profile and the terrain to the road.
 *
 * Points are picked on the screen, within a few pixels of where they are drawn. A dragged point
 * keeps its height above the ground; Alt+drag moves it up and down instead. In Add mode a click on
 * the ground appends a point; Ctrl+click inserts one where the road passes nearest. Delete removes
 * the selected point. Every change is one undoable command.
 */
import { Disposable, DRef, Vector3 } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import { RoadControlPoint, RoadSpline, createRoadFrame } from '@zephyr3d/scene';
import type { RoadStats } from '@zephyr3d/scene';
import { ImGui } from '@zephyr3d/imgui';
import type { EditTool, EditToolContext } from './edittool';
import type { MenuItemOptions } from '../../components/menubar';
import type { ToolBarItem } from '../../components/toolbar';
import { CustomCommand } from '../../commands/scenecommands';
import type { Command } from '../../core/command';
import { eventBus } from '../../core/eventbus';
import { fitTerrainToRoad } from '../../helpers/roadterrain';
import { fitRoadProfileOf } from '../../helpers/mcproad';
import { summarizeTerrainBase } from '../../helpers/roadbase';

/** Screen distance in pixels within which a control point is picked */
const PICK_RADIUS = 10;
/** Grade above which the center line is drawn in warning color */
const WARN_GRADE = 0.12;
/** Seconds between refreshes of the road measures shown in the panel */
const STATS_INTERVAL = 0.25;
/** Most samples of the drawn center line */
const MAX_LINE_SAMPLES = 600;

type PointList = RoadControlPoint[];

type Drag = {
  index: number;
  before: PointList;
  /** Height of the point above the ground when the drag started, kept while it moves */
  aboveGround: number;
  /** Alt+drag: up and down instead of over the ground */
  vertical: boolean;
  startMouseY: number;
  startY: number;
  moved: boolean;
};

export class RoadEditTool extends Disposable implements EditTool {
  private readonly _road: DRef<RoadSpline>;
  private readonly _ctx: EditToolContext;
  private _addMode: boolean;
  private _selected: number;
  private _hover: number;
  /** Mouse position on the canvas, CSS pixels */
  private _mouse: Nullable<[number, number]>;
  private _drag: Nullable<Drag>;
  /** Points before an edit made in the panel, until the widget lets go */
  private _panelEdit: Nullable<PointList>;
  private _stats: Nullable<RoadStats>;
  private _statsAge: number;
  private _busy: boolean;
  private _message: string;
  private readonly _onKeyDown: (evt: KeyboardEvent) => void;
  constructor(road: RoadSpline, ctx: EditToolContext) {
    super();
    this._road = new DRef(road);
    this._ctx = ctx;
    this._addMode = road.numPoints < 2;
    this._selected = -1;
    this._hover = -1;
    this._mouse = null;
    this._drag = null;
    this._panelEdit = null;
    this._stats = null;
    this._statsAge = Infinity;
    this._busy = false;
    this._message = '';
    // Edit tools are not sent keyboard events
    this._onKeyDown = (evt: KeyboardEvent) => {
      const target = evt.target as Nullable<HTMLElement>;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (typing || ImGui.GetIO().WantTextInput) {
        return;
      }
      if ((evt.key === 'Delete' || evt.key === 'Backspace') && this._selected >= 0 && !this._drag) {
        this.deletePoint(this._selected);
        evt.preventDefault();
      } else if (evt.key === 'Escape') {
        this._selected = -1;
        this._addMode = false;
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }
  private get road() {
    return this._road.get();
  }
  getTarget() {
    return this.road;
  }
  getSubMenuItems(): MenuItemOptions[] {
    return [];
  }
  getToolBarItems(): ToolBarItem[] {
    return [];
  }
  handleKeyboardEvent(_evt: KeyboardEvent): boolean {
    return false;
  }
  handlePointerEvent(evt: PointerEvent, _hitObject: any, _hitPos: Vector3): boolean {
    const road = this.road;
    if (!road) {
      return false;
    }
    this._mouse = [evt.offsetX, evt.offsetY];
    if (evt.type === 'pointermove') {
      if (this._drag) {
        this.dragTo(evt);
        return true;
      }
      this._hover = this.pickPoint();
      return false;
    }
    if (evt.type === 'pointerup') {
      if (this._drag) {
        this.endDrag();
        return true;
      }
      return false;
    }
    if (evt.type !== 'pointerdown' || evt.button !== 0) {
      return false;
    }
    const picked = this.pickPoint();
    if (picked >= 0) {
      this._selected = picked;
      this.beginDrag(picked, evt);
      return true;
    }
    if (this._addMode || evt.ctrlKey) {
      const ground = this.groundUnderMouse();
      if (ground) {
        if (evt.ctrlKey && road.numPoints >= 2) {
          this.insertPoint(ground);
        } else {
          this.appendPoint(ground);
        }
      }
      return true;
    }
    // A click away from the points only drops the selection; the tool keeps the clicks so they
    // do not select something else under the road
    this._selected = -1;
    return true;
  }
  update(dt: number) {
    const road = this.road;
    if (!road) {
      return;
    }
    if (this._selected >= road.numPoints) {
      this._selected = road.numPoints - 1;
    }
    this._statsAge += dt > 0 ? dt : 1 / 60;
    if (this._statsAge >= STATS_INTERVAL) {
      this._statsAge = 0;
      this._stats = road.numPoints >= 2 ? road.getStats() : null;
    }
  }
  render() {
    const road = this.road;
    if (!road) {
      return;
    }
    this.renderOverlay(road);
    this.renderPanel(road);
  }

  // -------------------------------------------------------------------------------------------
  // Points

  private snapshot(): PointList {
    const road = this.road!;
    return Array.from({ length: road.numPoints }, (_, i) => road.getPoint(i)!.clone());
  }
  /** Sets the points of the road, found again by id so commands outlive this tool */
  private setPoints(points: PointList) {
    const node = this.findRoad();
    if (node) {
      node.setPoints(points.map((p) => p.clone()));
      eventBus.dispatchEvent('scene_changed');
      eventBus.dispatchEvent('refresh_properties');
    }
  }
  private findRoad() {
    const road = this.road;
    const node = road?.scene?.findNodeById(road.persistentId);
    return node instanceof RoadSpline ? node : null;
  }
  /**
   * Records a change of the points as a command
   * @param applied - Whether the change is made already (a drag); otherwise the command makes it
   */
  private commit(before: PointList, after: PointList, desc: string, applied: boolean) {
    let skip = applied;
    void this._ctx.executeCommand(
      new CustomCommand(
        () => {
          if (skip) {
            skip = false;
            eventBus.dispatchEvent('scene_changed');
            return;
          }
          this.setPoints(after);
        },
        () => this.setPoints(before)
      ).setDesc(desc)
    );
  }
  /** World position of a point */
  private pointWorld(index: number) {
    const road = this.road!;
    return road.worldMatrix.transformPointAffine(road.getPoint(index)!.position, new Vector3());
  }
  private toLocal(world: Vector3) {
    return this.road!.invWorldMatrix.transformPointAffine(world, new Vector3());
  }
  private groundAt(x: number, z: number) {
    return this.road!.terrain?.getHeightAt(x, z) ?? null;
  }
  private appendPoint(ground: Vector3) {
    const before = this.snapshot();
    const after = before.map((p) => p.clone());
    after.push(new RoadControlPoint(this.toLocal(ground)));
    this._selected = after.length - 1;
    this.commit(before, after, 'Add road point', false);
  }
  /** Inserts a point at a ground position, between the points around where the road passes nearest */
  private insertPoint(ground: Vector3) {
    const road = this.road!;
    const projection = road.project(ground, { s: 0, lateral: 0, distance: 0, position: new Vector3() });
    if (!projection) {
      this.appendPoint(ground);
      return;
    }
    let index = 0;
    while (index < road.numPoints && road.curve.getPointS(index) <= projection.s) {
      index++;
    }
    if (road.closed && index >= road.numPoints) {
      // Past the last point of a loop: on the closing segment
      index = road.numPoints;
    } else if (!road.closed) {
      index = Math.min(Math.max(index, 1), road.numPoints - 1);
    }
    // At the height of the road there, so the profile does not jump
    const position = new Vector3(ground.x, projection.position.y, ground.z);
    const before = this.snapshot();
    const after = before.map((p) => p.clone());
    after.splice(index, 0, new RoadControlPoint(this.toLocal(position)));
    this._selected = index;
    this.commit(before, after, 'Insert road point', false);
  }
  private deletePoint(index: number) {
    const before = this.snapshot();
    if (index < 0 || index >= before.length) {
      return;
    }
    const after = before.map((p) => p.clone());
    after.splice(index, 1);
    this._selected = Math.min(index, after.length - 1);
    this.commit(before, after, 'Delete road point', false);
  }
  private beginDrag(index: number, evt: PointerEvent) {
    const world = this.pointWorld(index);
    const ground = this.groundAt(world.x, world.z);
    this._drag = {
      index,
      before: this.snapshot(),
      aboveGround: ground === null ? 0 : world.y - ground,
      vertical: evt.altKey,
      startMouseY: evt.offsetY,
      startY: world.y,
      moved: false
    };
  }
  private dragTo(evt: PointerEvent) {
    const drag = this._drag!;
    const road = this.road!;
    const point = road.getPoint(drag.index);
    if (!point) {
      this._drag = null;
      return;
    }
    const world = this.pointWorld(drag.index);
    if (drag.vertical) {
      const camera = this._ctx.getCamera();
      const rect = this._ctx.getViewportRect();
      if (!camera || !rect) {
        return;
      }
      // Meters per pixel at the distance of the point
      const distance = Vector3.distance(camera.getWorldPosition(), world);
      const perPixel = (2 * distance * camera.getTanHalfFovy()) / rect[3];
      world.y = drag.startY + (drag.startMouseY - evt.offsetY) * perPixel;
    } else {
      const ground = this.groundUnderMouse();
      if (!ground) {
        return;
      }
      world.setXYZ(ground.x, ground.y + drag.aboveGround, ground.z);
    }
    point.position = this.toLocal(world);
    drag.moved = true;
  }
  private endDrag() {
    const drag = this._drag!;
    this._drag = null;
    if (drag.moved) {
      this.commit(drag.before, this.snapshot(), 'Move road point', true);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Picking

  /** Screen position of a world point in canvas pixels, null behind the camera */
  private project(p: Vector3): Nullable<[number, number]> {
    const camera = this._ctx.getCamera();
    const rect = this._ctx.getViewportRect();
    if (!camera || !rect) {
      return null;
    }
    const c = camera.viewProjectionMatrix.transformPoint(p);
    if (c.w <= 0) {
      return null;
    }
    return [rect[0] + ((c.x / c.w) * 0.5 + 0.5) * rect[2], rect[1] + (0.5 - (c.y / c.w) * 0.5) * rect[3]];
  }
  /** The control point drawn under the mouse, -1 for none */
  private pickPoint() {
    const road = this.road;
    const mouse = this._mouse;
    if (!road || !mouse) {
      return -1;
    }
    let best = -1;
    let bestD = PICK_RADIUS;
    for (let i = 0; i < road.numPoints; i++) {
      const s = this.project(this.pointWorld(i));
      if (s) {
        const d = Math.hypot(s[0] - mouse[0], s[1] - mouse[1]);
        if (d <= bestD) {
          best = i;
          bestD = d;
        }
      }
    }
    return best;
  }
  /**
   * Where the mouse ray meets the terrain, marched on the CPU heights so a drag follows the mouse
   * without waiting for the GPU pick; on the plane of the road without a terrain
   */
  private groundUnderMouse(): Nullable<Vector3> {
    const camera = this._ctx.getCamera();
    const rect = this._ctx.getViewportRect();
    const mouse = this._mouse;
    const road = this.road;
    if (!camera || !rect || !mouse || !road) {
      return null;
    }
    const ray = camera.constructRay(mouse[0] - rect[0], mouse[1] - rect[1]);
    const o = ray.origin;
    const d = ray.direction;
    const terrain = road.terrain;
    if (!terrain) {
      const y = road.worldMatrix.m13;
      const t = Math.abs(d.y) > 1e-6 ? (y - o.y) / d.y : -1;
      return t > 0 ? new Vector3(o.x + d.x * t, y, o.z + d.z * t) : null;
    }
    const above = (t: number) => {
      const g = terrain.getHeightAt(o.x + d.x * t, o.z + d.z * t);
      return g === null ? null : o.y + d.y * t - g;
    };
    const far = Math.min(camera.getFarPlane(), 5000);
    let t0 = 0;
    let a0 = above(0);
    for (let t = 0.25; t < far; t += Math.max(0.25, t * 0.01)) {
      const a = above(t);
      if (a !== null && a <= 0 && a0 !== null && a0 > 0) {
        let lo = t0;
        let hi = t;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) * 0.5;
          const m = above(mid);
          if (m !== null && m > 0) {
            lo = mid;
          } else {
            hi = mid;
          }
        }
        const x = o.x + d.x * hi;
        const z = o.z + d.z * hi;
        return new Vector3(x, terrain.getHeightAt(x, z) ?? o.y + d.y * hi, z);
      }
      t0 = t;
      a0 = a;
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Drawing

  private renderOverlay(road: RoadSpline) {
    const drawList = ImGui.GetBackgroundDrawList();
    const white = ImGui.GetColorU32(new ImGui.ImVec4(1, 1, 1, 0.85));
    const edge = ImGui.GetColorU32(new ImGui.ImVec4(1, 0.85, 0.3, 0.8));
    const warn = ImGui.GetColorU32(new ImGui.ImVec4(1, 0.3, 0.25, 1));
    if (road.numPoints >= 2 && road.length > 0) {
      const narrowed = this._stats?.narrowed ?? [];
      const count = Math.min(MAX_LINE_SAMPLES, Math.max(2, Math.ceil(road.length / 2)));
      const frame = createRoadFrame();
      let prev: Nullable<
        [Nullable<[number, number]>, Nullable<[number, number]>, Nullable<[number, number]>]
      > = null;
      for (let k = 0; k <= count; k++) {
        const s = (road.length * k) / count;
        road.sampleAt(s, frame);
        const half = frame.width * 0.5;
        const c = frame.position;
        const r = frame.right;
        const left = this.project(new Vector3(c.x - r.x * half, c.y - r.y * half, c.z - r.z * half));
        const right = this.project(new Vector3(c.x + r.x * half, c.y + r.y * half, c.z + r.z * half));
        const center = this.project(c);
        const t = frame.tangent;
        const steep = Math.abs(t.y) > WARN_GRADE * Math.hypot(t.x, t.z);
        const tight = narrowed.some(([a, b]) => s >= a && s <= b);
        if (prev) {
          const line = (
            a: Nullable<[number, number]>,
            b: Nullable<[number, number]>,
            col: number,
            w: number
          ) => {
            if (a && b) {
              drawList.AddLine(new ImGui.ImVec2(a[0], a[1]), new ImGui.ImVec2(b[0], b[1]), col, w);
            }
          };
          line(prev[0], left, tight ? warn : edge, tight ? 2.5 : 1.5);
          line(prev[2], right, tight ? warn : edge, tight ? 2.5 : 1.5);
          line(prev[1], center, steep ? warn : white, steep ? 2.5 : 1);
        }
        prev = [left, center, right];
      }
    }
    for (let i = 0; i < road.numPoints; i++) {
      const s = this.project(this.pointWorld(i));
      if (!s) {
        continue;
      }
      const at = new ImGui.ImVec2(s[0], s[1]);
      const selected = i === this._selected;
      const fill = selected
        ? ImGui.GetColorU32(new ImGui.ImVec4(1, 0.55, 0.1, 1))
        : ImGui.GetColorU32(new ImGui.ImVec4(0.2, 0.75, 1, 1));
      drawList.AddCircleFilled(at, selected ? 7 : 5, fill, 16);
      if (i === this._hover || selected) {
        drawList.AddCircle(at, selected ? 9 : 8, white, 16, 1.5);
      }
    }
  }
  private renderPanel(road: RoadSpline) {
    if (ImGui.Begin('Road', null, ImGui.WindowFlags.AlwaysAutoResize | ImGui.WindowFlags.NoResize)) {
      ImGui.Dummy(new ImGui.ImVec2(300, 0));
      ImGui.Text(`Length ${road.length.toFixed(1)} m, ${road.numPoints} points`);
      const stats = this._stats;
      if (stats) {
        const radius = Number.isFinite(stats.minRadius) ? `${stats.minRadius.toFixed(1)} m` : 'straight';
        ImGui.Text(`Tightest bend ${radius}, steepest grade ${(stats.maxGrade * 100).toFixed(1)}%`);
        if (stats.narrowed.length > 0) {
          ImGui.TextColored(
            new ImGui.ImVec4(1, 0.5, 0.4, 1),
            `${stats.narrowed.length} bend(s) too tight for the width (red edges)`
          );
        }
      }
      const add = [this._addMode] as [boolean];
      if (ImGui.Checkbox('Add points', add)) {
        this._addMode = add[0];
      }
      ImGui.TextDisabled('Drag a point to move it, Alt+drag to raise it');
      ImGui.TextDisabled('Add points: click the ground to append');
      ImGui.TextDisabled('Ctrl+click: insert where the road passes nearest');
      ImGui.TextDisabled('Delete: remove the selected point');
      ImGui.Separator();
      this.renderPointEditor(road);
      ImGui.Separator();
      this.renderFitting(road);
    }
    ImGui.End();
  }
  /** Width, bank and height of the selected point; each widget edit is one command */
  private renderPointEditor(road: RoadSpline) {
    const index = this._selected;
    const point = index >= 0 ? road.getPoint(index) : null;
    if (!point) {
      ImGui.TextDisabled('Click a point to edit it');
      return;
    }
    const world = this.pointWorld(index);
    ImGui.Text(`Point ${index}: (${world.x.toFixed(1)}, ${world.y.toFixed(2)}, ${world.z.toFixed(1)})`);
    const track = (desc: string) => {
      if (ImGui.IsItemActivated()) {
        this._panelEdit = this.snapshot();
      }
      if (ImGui.IsItemDeactivatedAfterEdit() && this._panelEdit) {
        this.commit(this._panelEdit, this.snapshot(), desc, true);
        this._panelEdit = null;
      }
    };
    const ground = this.groundAt(world.x, world.z);
    if (ground !== null) {
      const height = [world.y - ground] as [number];
      if (ImGui.DragFloat('Above ground', height, 0.01, -50, 50, '%.2f m')) {
        world.y = ground + height[0];
        point.position = this.toLocal(world);
      }
      track('Edit road point height');
    }
    const width = [point.width] as [number];
    if (ImGui.DragFloat('Width', width, 0.05, 0, 100, point.width > 0 ? '%.2f m' : 'road width')) {
      point.width = Math.max(0, width[0]);
    }
    track('Edit road point width');
    const bank = [point.bank] as [number];
    if (ImGui.SliderFloat('Bank', bank, -30, 30, '%.1f deg')) {
      point.bank = bank[0];
    }
    track('Edit road point bank');
    if (ImGui.Button('Delete point')) {
      this.deletePoint(index);
    }
  }
  /** Profile and terrain fitting, run as commands */
  private renderFitting(road: RoadSpline) {
    if (!road.terrain) {
      ImGui.TextDisabled('Put the road under a terrain to fit it');
      return;
    }
    const run = (command: Command<void>) => this._ctx.executeCommand(command);
    const go = (label: string, tip: string, action: () => Promise<{ err: Nullable<string> } & object>) => {
      if (ImGui.Button(label) && !this._busy && road.numPoints >= 2) {
        this._busy = true;
        this._message = `${label}...`;
        action()
          .then((r) => {
            this._message = r.err ? `${label} failed: ${r.err}` : `${label}: done`;
            const result = (r as { result?: Record<string, unknown> }).result;
            if (!r.err && result && typeof result.texels_changed === 'number') {
              this._message = `${label}: ${result.texels_changed} texels, cut ${result.max_cut} m, fill ${result.max_fill} m`;
            }
          })
          .catch((err) => {
            this._message = `${label} failed: ${err instanceof Error ? err.message : err}`;
          })
          .finally(() => {
            this._busy = false;
          });
      }
      if (ImGui.IsItemHovered()) {
        ImGui.SetTooltip(tip);
      }
    };
    go('Fit profile', 'Set the point heights to a smooth profile of the ground, at most 12% grade', () =>
      fitRoadProfileOf(road, {}, run)
    );
    ImGui.SameLine();
    go(
      'Fit terrain',
      'Shape the terrain to the road: a bench under it and rounded cut and fill slopes, grass and foliage cleared. Starts again from the original ground each time',
      () => fitTerrainToRoad(road, { action: 'apply' }, run)
    );
    const base = summarizeTerrainBase(road.terrainBase);
    if (base?.tiles) {
      ImGui.TextDisabled(`Original ground kept: ${base.tiles} tiles`);
      go(
        'Restore terrain',
        'Put the original ground back and forget it (removed foliage stays removed)',
        () => fitTerrainToRoad(road, { action: 'restore' }, run)
      );
      ImGui.SameLine();
      go(
        'Commit terrain',
        'Forget the original ground: the terrain as it is becomes the ground the next fit starts from',
        () => fitTerrainToRoad(road, { action: 'commit' }, run)
      );
    }
    if (this._message) {
      ImGui.TextWrapped(this._message);
    }
  }
  protected onDispose() {
    super.onDispose();
    window.removeEventListener('keydown', this._onKeyDown);
    if (this._drag) {
      this.endDrag();
    }
    this._road.dispose();
  }
}
