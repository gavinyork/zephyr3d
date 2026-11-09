import type { Nullable } from '@zephyr3d/base';
import { DRef, Vector3, Vector4 } from '@zephyr3d/base';
import { BoundingBox } from '../../utility/bounding_volume';
import type { Scene } from '../scene';
import { SceneNode } from '../scene_node';
import { GraphNode } from '../graph_node';
import { Mesh } from '../mesh';
import { Primitive } from '../../render/primitive';
import type { ClipmapTerrain } from '../terrain-cm';
import type { MeshMaterial } from '../../material';
import { PBRMetallicRoughnessMaterial } from '../../material/pbrmr';
import type { Camera } from '../../camera';
import { Collider, NodePhysics } from '../../physics';
import type { RoadCurvePoint, RoadFrame, RoadHandleMode, RoadProjection } from './road_curve';
import { RoadCurve } from './road_curve';
import type { RoadChunkGeometry, RoadGroundSampler, RoadMeshPart, RoadStats } from './road_mesh';
import { buildRoadGeometry, measureRoad } from './road_mesh';
import { RoadShoulderMaterial } from './road_shoulder_material';

/** Alpha below which the dithered shoulder fade is fully transparent */
const SHOULDER_ALPHA_CUTOFF = 0.01;

/**
 * A control point of a {@link RoadSpline}
 *
 * @remarks
 * Changing a property of a point that belongs to a road rebuilds the road. The vectors returned
 * by the getters are the point's own: assign a new value to change them.
 * @public
 */
export class RoadControlPoint implements RoadCurvePoint {
  /** @internal */
  _owner: Nullable<RoadSpline>;
  private readonly _position: Vector3;
  private _width: number;
  private _bank: number;
  private _handleMode: RoadHandleMode;
  private readonly _inHandle: Vector3;
  private readonly _outHandle: Vector3;
  /**
   * Creates a control point
   * @param position - Position in the space of the road
   * @param width - Road width here, 0 for the road's default width
   * @param bank - Roll in degrees, positive raises the right edge
   */
  constructor(position?: Vector3, width = 0, bank = 0) {
    this._owner = null;
    this._position = position ? new Vector3(position) : new Vector3();
    this._width = Math.max(0, width);
    this._bank = bank;
    this._handleMode = 'auto';
    this._inHandle = new Vector3();
    this._outHandle = new Vector3();
  }
  /** Position in the space of the road */
  get position(): Vector3 {
    return this._position;
  }
  set position(val: Vector3) {
    this._position.set(val);
    this._changed();
  }
  /** Road width at this point in meters; 0 uses {@link RoadSpline.width} */
  get width() {
    return this._width;
  }
  set width(val: number) {
    val = Math.max(0, val);
    if (val !== this._width) {
      this._width = val;
      this._changed();
    }
  }
  /** Roll about the direction of the road in degrees, positive raises the right edge */
  get bank() {
    return this._bank;
  }
  set bank(val: number) {
    if (val !== this._bank) {
      this._bank = val;
      this._changed();
    }
  }
  /** How the handles are decided, see {@link RoadHandleMode} */
  get handleMode() {
    return this._handleMode;
  }
  set handleMode(val: RoadHandleMode) {
    if (val !== this._handleMode) {
      this._handleMode = val;
      this._changed();
    }
  }
  /** Incoming handle relative to the position, used unless the handle mode is auto */
  get inHandle(): Vector3 {
    return this._inHandle;
  }
  set inHandle(val: Vector3) {
    this._inHandle.set(val);
    this._changed();
  }
  /** Outgoing handle relative to the position, used unless the handle mode is auto */
  get outHandle(): Vector3 {
    return this._outHandle;
  }
  set outHandle(val: Vector3) {
    this._outHandle.set(val);
    this._changed();
  }
  /** A copy of the point, not belonging to any road */
  clone() {
    const other = new RoadControlPoint(this._position, this._width, this._bank);
    other._handleMode = this._handleMode;
    other._inHandle.set(this._inHandle);
    other._outHandle.set(this._outHandle);
    return other;
  }
  private _changed() {
    this._owner?.invalidate();
  }
}

/** Nodes built for one stretch of a road */
interface RoadChunk {
  surface: Mesh;
  shoulder: Nullable<Mesh>;
  collider: Nullable<SceneNode>;
}

/**
 * A road along a spline through control points, drawn as a ribbon mesh over a terrain.
 *
 * @remarks
 * The center line is a chain of cubic Bezier segments; with the default `'auto'` handles it is a
 * centripetal Catmull-Rom spline through the points. The road follows the heights of its control
 * points and the curve between them, not the ground: a terrain is meant to be shaped to the road.
 * Each side has a shoulder that runs from the road edge down to just above the ground of the
 * closest {@link ClipmapTerrain} ancestor and fades out with dithered alpha.
 *
 * The meshes and static colliders are built in chunks along the road, are not serialized and are
 * rebuilt when the road or the terrain heights change.
 *
 * Points are in the space of the road node, which is meant to be translated only.
 * @public
 */
export class RoadSpline extends GraphNode {
  private _points: RoadControlPoint[];
  private _closed: boolean;
  private _width: number;
  private _shoulderWidth: number;
  private _sampleSpacing: number;
  private _chunkLength: number;
  private _uvTileLength: number;
  private _uvTileWidth: number;
  private _surfaceTag: string;
  private _collision: boolean;
  private _friction: number;
  private _castShadow: boolean;
  private readonly _material: DRef<MeshMaterial>;
  private readonly _shoulderMaterial: DRef<MeshMaterial>;
  private readonly _fallbackMaterial: DRef<MeshMaterial>;
  private readonly _derivedShoulderMaterial: DRef<MeshMaterial>;
  private readonly _blendShoulderMaterial: DRef<RoadShoulderMaterial>;
  private _curve: Nullable<RoadCurve>;
  private _chunks: RoadChunk[];
  private _dirty: boolean;
  private _builtHeightData: unknown;
  private _builtTerrain: Nullable<ClipmapTerrain>;
  private readonly _builtOffset: Vector3;
  private _builtVirtualTexture: unknown;
  /**
   * Creates a road
   * @param scene - The scene to which the node belongs
   */
  constructor(scene: Scene) {
    super(scene);
    this._points = [];
    this._closed = false;
    this._width = 6;
    this._shoulderWidth = 1;
    this._sampleSpacing = 1;
    this._chunkLength = 64;
    this._uvTileLength = 8;
    this._uvTileWidth = 6;
    this._surfaceTag = 'gravel';
    this._collision = true;
    this._friction = 0.8;
    this._castShadow = false;
    this._material = new DRef();
    this._shoulderMaterial = new DRef();
    this._fallbackMaterial = new DRef();
    this._derivedShoulderMaterial = new DRef();
    this._blendShoulderMaterial = new DRef();
    this._curve = null;
    this._chunks = [];
    this._dirty = true;
    this._builtHeightData = null;
    this._builtTerrain = null;
    this._builtOffset = new Vector3(NaN, NaN, NaN);
    this._builtVirtualTexture = null;
  }
  /** Number of control points */
  get numPoints() {
    return this._points.length;
  }
  /**
   * Gets a control point
   * @param index - Point index
   */
  getPoint(index: number): Nullable<RoadControlPoint> {
    return this._points[index] ?? null;
  }
  /**
   * Replaces the control points; points belonging to another road are copied
   * @param points - The new points in order
   */
  setPoints(points: readonly RoadControlPoint[]) {
    for (const p of this._points) {
      p._owner = null;
    }
    this._points = points.map((p) => this.adopt(p));
    this.invalidate();
  }
  /**
   * Inserts a control point; a point belonging to another road is copied
   * @param point - The point
   * @param index - Position to insert at, appended when omitted
   * @returns Index of the point
   */
  insertPoint(point: RoadControlPoint, index?: number) {
    const at = Math.max(0, Math.min(index ?? this._points.length, this._points.length));
    this._points.splice(at, 0, this.adopt(point));
    this.invalidate();
    return at;
  }
  /**
   * Appends a control point
   * @param position - Position in the space of the road
   * @param width - Road width here, 0 for the default width
   * @param bank - Roll in degrees
   * @returns Index of the point
   */
  addPoint(position: Vector3, width = 0, bank = 0) {
    return this.insertPoint(new RoadControlPoint(position, width, bank));
  }
  /**
   * Removes a control point
   * @param index - Point index
   */
  removePoint(index: number) {
    const [p] = this._points.splice(index, 1);
    if (p) {
      p._owner = null;
      this.invalidate();
    }
  }
  /** Whether the last point connects back to the first; needs at least 3 points */
  get closed() {
    return this._closed;
  }
  set closed(val: boolean) {
    if (!!val !== this._closed) {
      this._closed = !!val;
      this.invalidate();
    }
  }
  /** Default road width in meters, for points whose width is 0. Default 6. */
  get width() {
    return this._width;
  }
  set width(val: number) {
    val = Math.max(0.1, val);
    if (val !== this._width) {
      this._width = val;
      this.invalidate();
    }
  }
  /** Width of the shoulder on each side in meters, 0 for none. Default 1. */
  get shoulderWidth() {
    return this._shoulderWidth;
  }
  set shoulderWidth(val: number) {
    val = Math.max(0, val);
    if (val !== this._shoulderWidth) {
      this._shoulderWidth = val;
      this.invalidate();
    }
  }
  /** Distance between the cross sections of the mesh in meters. Default 1. */
  get sampleSpacing() {
    return this._sampleSpacing;
  }
  set sampleSpacing(val: number) {
    val = Math.max(0.1, val);
    if (val !== this._sampleSpacing) {
      this._sampleSpacing = val;
      this.invalidate();
    }
  }
  /** Length of the stretches the road is drawn and culled in, in meters. Default 64. */
  get chunkLength() {
    return this._chunkLength;
  }
  set chunkLength(val: number) {
    val = Math.max(4, val);
    if (val !== this._chunkLength) {
      this._chunkLength = val;
      this.invalidate();
    }
  }
  /** Meters along the road per repeat of the textures. Default 8. */
  get uvTileLength() {
    return this._uvTileLength;
  }
  set uvTileLength(val: number) {
    val = Math.max(0.01, val);
    if (val !== this._uvTileLength) {
      this._uvTileLength = val;
      this.invalidate();
    }
  }
  /** Meters across the road per repeat of the textures, centered on the road. Default 6. */
  get uvTileWidth() {
    return this._uvTileWidth;
  }
  set uvTileWidth(val: number) {
    val = Math.max(0.01, val);
    if (val !== this._uvTileWidth) {
      this._uvTileWidth = val;
      this.invalidate();
    }
  }
  /** A name for the kind of surface, for game code telling roads apart. Default 'gravel'. */
  get surfaceTag() {
    return this._surfaceTag;
  }
  set surfaceTag(val: string) {
    this._surfaceTag = val ?? '';
  }
  /** Whether the road has static colliders. Default true. */
  get collision() {
    return this._collision;
  }
  set collision(val: boolean) {
    if (!!val !== this._collision) {
      this._collision = !!val;
      this.invalidate();
    }
  }
  /**
   * Friction of the colliders. Default 0.8. Ray cast vehicle wheels do not use it; their grip
   * is `Wheel.frictionSlip`, see {@link RoadSpline.ownsNode}.
   */
  get friction() {
    return this._friction;
  }
  set friction(val: number) {
    val = Math.max(0, val);
    if (val !== this._friction) {
      this._friction = val;
      for (const chunk of this._chunks) {
        for (const collider of chunk.collider?.physics?.colliders ?? []) {
          collider.friction = val;
        }
      }
    }
  }
  /** Whether the road casts shadows. Default false. */
  get castShadow() {
    return this._castShadow;
  }
  set castShadow(val: boolean) {
    this._castShadow = !!val;
    for (const chunk of this._chunks) {
      chunk.surface.castShadow = this._castShadow;
      if (chunk.shoulder) {
        chunk.shoulder.castShadow = this._castShadow;
      }
    }
  }
  /** Material of the road surface; a plain gray one when null */
  get material(): Nullable<MeshMaterial> {
    return this._material.get();
  }
  set material(val: Nullable<MeshMaterial>) {
    if (val !== this._material.get()) {
      this._material.set(val);
      this.invalidate();
    }
  }
  /**
   * Material of the shoulders. They have vertex colors whose alpha fades from 1 at the road edge
   * to 0 at the outer edge, for a material with vertex colors and dithered alpha testing.
   *
   * When null, the shoulders blend the surface material into the terrain, read from the terrain's
   * runtime virtual texture ({@link ClipmapTerrain.runtimeVirtualTexture}), if it has one and the
   * surface material is a {@link PBRMetallicRoughnessMaterial}; otherwise they fade out a copy of
   * the surface material with dithered alpha, which needs TAA to look smooth. Either is taken from
   * the surface material when the road is rebuilt.
   */
  get shoulderMaterial(): Nullable<MeshMaterial> {
    return this._shoulderMaterial.get();
  }
  set shoulderMaterial(val: Nullable<MeshMaterial>) {
    if (val !== this._shoulderMaterial.get()) {
      this._shoulderMaterial.set(val);
      this.invalidate();
    }
  }
  /** The center line, in the space of the road */
  get curve(): RoadCurve {
    if (!this._curve) {
      this._curve = new RoadCurve(this._points, this._closed, this._width);
    }
    return this._curve;
  }
  /** Length of the center line */
  get length() {
    return this.curve.length;
  }
  /** Number of stretches the road is currently drawn in */
  get numChunks() {
    return this._chunks.length;
  }
  /**
   * Samples the road in world space
   * @param s - Distance along the road
   * @param out - Receives the frame
   * @returns out
   */
  sampleAt(s: number, out: RoadFrame): RoadFrame {
    this.curve.sample(s, out);
    const m = this.worldMatrix;
    m.transformPointAffine(out.position, out.position);
    m.transformVectorAffine(out.tangent, out.tangent).inplaceNormalize();
    m.transformVectorAffine(out.right, out.right).inplaceNormalize();
    m.transformVectorAffine(out.up, out.up).inplaceNormalize();
    return out;
  }
  /**
   * The closest center line point to a world position, measured horizontally
   * @param position - World position
   * @param out - Receives the result, with the position in world space
   * @returns out, or null for a road with fewer than two points
   */
  project(position: Vector3, out: RoadProjection): Nullable<RoadProjection> {
    const local = this.invWorldMatrix.transformPointAffine(position, new Vector3());
    if (!this.curve.project(local.x, local.z, out)) {
      return null;
    }
    this.worldMatrix.transformPointAffine(out.position, out.position);
    return out;
  }
  /** Measures of how drivable the road is */
  getStats(): RoadStats {
    return measureRoad(this.curve, Math.min(this._sampleSpacing, 1), this._shoulderWidth);
  }
  /**
   * The terrain the shoulders lie on: the closest {@link ClipmapTerrain} ancestor
   */
  get terrain(): Nullable<ClipmapTerrain> {
    let node = this.parent;
    while (node) {
      if (node.isClipmapTerrain()) {
        return node;
      }
      node = node.parent;
    }
    return null;
  }
  /**
   * The nodes built for this road, to tell them apart from other scene nodes, e.g. whether a
   * wheel is on the road from its `Wheel.groundNode`
   * @param node - A scene node
   * @returns Whether the node is, or is below, a chunk of this road
   */
  ownsNode(node: Nullable<SceneNode>) {
    while (node && node !== this) {
      if (node.parent === this && node.sealed) {
        return true;
      }
      node = node.parent;
    }
    return false;
  }
  /** Schedules the road to be rebuilt; called by the methods changing it */
  invalidate() {
    this._curve = null;
    this._dirty = true;
    this.scene?.queuePerCameraUpdateNode(this);
  }
  /** {@inheritDoc SceneNode.updatePerCamera} */
  updatePerCamera(_camera: Camera, _elapsedInSeconds: number, _deltaInSeconds: number) {
    this.scene?.queuePerCameraUpdateNode(this);
    const terrain = this.terrain;
    if (terrain !== this._builtTerrain || (terrain && terrain.heightData !== this._builtHeightData)) {
      if (!terrain || terrain.heightData) {
        this._dirty = true;
      } else {
        // Rebuilt once the heights the shoulders lie on are known again
        terrain.whenHeightDataReady();
      }
    }
    const m = this.worldMatrix;
    if (terrainVirtualTexture(terrain) !== this._builtVirtualTexture) {
      // The shoulders blend into the terrain through it
      this._dirty = true;
    }
    if (m.m03 !== this._builtOffset.x || m.m13 !== this._builtOffset.y || m.m23 !== this._builtOffset.z) {
      this._dirty = true;
    }
    if (this._dirty && (!terrain || terrain.heightData)) {
      this._dirty = false;
      this.rebuild(terrain);
    }
  }
  /** @internal */
  protected _onAttached(): void {
    super._onAttached();
    this.invalidate();
  }
  /** {@inheritDoc SceneNode.onDispose} */
  protected onDispose() {
    this.clearChunks();
    for (const p of this._points) {
      p._owner = null;
    }
    this._points = [];
    this._material.dispose();
    this._shoulderMaterial.dispose();
    this._fallbackMaterial.dispose();
    this._derivedShoulderMaterial.dispose();
    this._blendShoulderMaterial.dispose();
    super.onDispose();
  }
  private adopt(point: RoadControlPoint) {
    const p = point._owner && point._owner !== this ? point.clone() : point;
    p._owner = this;
    return p;
  }
  private clearChunks() {
    for (const chunk of this._chunks) {
      chunk.surface.remove();
      chunk.surface.dispose();
      chunk.shoulder?.remove();
      chunk.shoulder?.dispose();
      chunk.collider?.remove();
      chunk.collider?.dispose();
    }
    this._chunks = [];
  }
  private rebuild(terrain: Nullable<ClipmapTerrain>) {
    this.clearChunks();
    const m = this.worldMatrix;
    this._builtTerrain = terrain;
    this._builtHeightData = terrain?.heightData ?? null;
    this._builtOffset.setXYZ(m.m03, m.m13, m.m23);
    this._builtVirtualTexture = terrainVirtualTexture(terrain);
    const ox = m.m03;
    const oy = m.m13;
    const oz = m.m23;
    const ground: Nullable<RoadGroundSampler> = terrain
      ? (x, z) => {
          const h = terrain.getHeightAt(x + ox, z + oz);
          return h === null ? null : h - oy;
        }
      : null;
    const geometry = buildRoadGeometry(this.curve, {
      spacing: this._sampleSpacing,
      chunkLength: this._chunkLength,
      shoulderWidth: this._shoulderWidth,
      uvTileLength: this._uvTileLength,
      uvTileWidth: this._uvTileWidth,
      ground
    });
    if (geometry.length === 0) {
      return;
    }
    const surfaceMaterial = this._material.get() ?? this.fallbackMaterial();
    const shoulderMaterial =
      this._shoulderMaterial.get() ??
      this.blendShoulderMaterial(surfaceMaterial, terrain) ??
      this.deriveShoulderMaterial(surfaceMaterial);
    for (let i = 0; i < geometry.length; i++) {
      this._chunks.push(this.buildChunk(i, geometry[i], surfaceMaterial, shoulderMaterial));
    }
  }
  private buildChunk(
    index: number,
    geometry: RoadChunkGeometry,
    surfaceMaterial: MeshMaterial,
    shoulderMaterial: MeshMaterial
  ): RoadChunk {
    const surface = this.createMesh(`Road surface ${index}`, geometry.surface, surfaceMaterial);
    const shoulder = geometry.shoulder
      ? this.createMesh(`Road shoulders ${index}`, geometry.shoulder, shoulderMaterial)
      : null;
    let collider: Nullable<SceneNode> = null;
    if (this._collision) {
      collider = new SceneNode(this.scene!);
      collider.sealed = true;
      collider.name = `Road collider ${index}`;
      collider.parent = this;
      const c = new Collider();
      c.shape = 'mesh';
      c.friction = this._friction;
      c.setMeshData(geometry.colliderPositions, geometry.colliderIndices);
      collider.physics = new NodePhysics({ colliders: [c] });
    }
    return { surface, shoulder, collider };
  }
  private createMesh(name: string, part: RoadMeshPart, material: MeshMaterial) {
    const primitive = new Primitive();
    primitive.createAndSetVertexBuffer('position_f32x3', part.positions);
    primitive.createAndSetVertexBuffer('normal_f32x3', part.normals);
    primitive.createAndSetVertexBuffer('tangent_f32x4', part.tangents);
    primitive.createAndSetVertexBuffer('tex0_f32x2', part.uvs);
    if (part.colors) {
      primitive.createAndSetVertexBuffer('diffuse_f32x4', part.colors);
    }
    primitive.createAndSetIndexBuffer(part.indices);
    primitive.primitiveType = 'triangle-list';
    primitive.indexCount = part.indices.length;
    primitive.setBoundingVolume(new BoundingBox(part.min, part.max));
    const mesh = new Mesh(this.scene!, primitive, material);
    mesh.sealed = true;
    mesh.name = name;
    mesh.castShadow = this._castShadow;
    mesh.gpuPickable = false;
    // A thin ribbon on the terrain adds nothing to the distance field
    mesh.sdfMode = 'none';
    mesh.parent = this;
    // Built in updatePerCamera, after the frame update that refreshes the matrices meshes draw with
    mesh.syncDrawableTransform();
    return mesh;
  }
  private fallbackMaterial() {
    let material = this._fallbackMaterial.get();
    if (!material) {
      const m = new PBRMetallicRoughnessMaterial();
      m.albedoColor = new Vector4(0.42, 0.4, 0.37, 1);
      m.metallic = 0;
      m.roughness = 0.95;
      material = m;
      this._fallbackMaterial.set(material);
    }
    return material;
  }
  /**
   * The surface material blended into the terrain through its runtime virtual texture, or null
   * when the terrain has none or the surface material is not a metallic-roughness PBR one
   */
  private blendShoulderMaterial(surface: MeshMaterial, terrain: Nullable<ClipmapTerrain>) {
    const source = surface.coreMaterial;
    if (!terrainVirtualTexture(terrain) || !(source instanceof PBRMetallicRoughnessMaterial)) {
      return null;
    }
    let material = this._blendShoulderMaterial.get();
    if (!material) {
      material = new RoadShoulderMaterial();
      this._blendShoulderMaterial.set(material);
    }
    (material as PBRMetallicRoughnessMaterial).copyFrom(source);
    // Opaque: the terrain weight comes from the vertex alpha, not coverage
    material.vertexColor = false;
    material.alphaCutoff = 0;
    material.alphaDither = false;
    material.alphaToCoverage = false;
    material.blendMode = 'none';
    material.setTerrain(terrain);
    return material;
  }
  /** A copy of the surface material with vertex colors and dithered alpha testing */
  private deriveShoulderMaterial(surface: MeshMaterial) {
    const source = surface.coreMaterial;
    let material = this._derivedShoulderMaterial.get();
    if (material && material.constructor === source.constructor) {
      material.copyFrom(source);
    } else {
      material = source.clone();
      this._derivedShoulderMaterial.set(material);
    }
    if ('vertexColor' in material) {
      (material as MeshMaterial & { vertexColor: boolean }).vertexColor = true;
    }
    material.alphaCutoff = SHOULDER_ALPHA_CUTOFF;
    material.alphaDither = true;
    return material;
  }
}

/** The runtime virtual texture a terrain is shaded from, null when it has none in use */
function terrainVirtualTexture(terrain: Nullable<ClipmapTerrain>) {
  return terrain?.material?.virtualTextureUsed ? terrain.runtimeVirtualTextureData : null;
}
