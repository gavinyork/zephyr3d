type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];

type GeneratedModelSpec = {
  version?: number;
  nodes?: ProceduralNode[];
  generation?: {
    maxVertices?: number;
    generateTangents?: boolean;
    tangents?: boolean;
  };
};

type ProceduralNode =
  | BoxNode
  | CylinderNode
  | SphereNode
  | RevolveNode
  | SurfaceNode
  | CurveNode
  | MeshNode
  | CsgNode;

type BaseNode = {
  id?: string;
  type: string;
  coordinateSystem?: 'editor' | 'yUp' | 'zUp';
  coordinateRemap?: CoordinateRemap;
  position?: Vec3;
  rotation?: Vec4;
  scale?: Vec3;
  preserveWinding?: boolean;
  uv?: UVSpec;
};

type CoordinateRemap = 'none' | 'zUpToYUp' | 'yUpToZUp' | { axes?: [UVAxis, UVAxis, UVAxis] };

type UVSpec = {
  mode?: 'default' | 'normalized' | 'worldLength' | 'planar' | 'box' | 'cylindrical' | 'spherical';
  axes?: [UVAxis, UVAxis];
  axis?: PositiveUVAxis;
  origin?: Vec3;
  size?: Vec2;
  tileSize?: Vec2;
  scale?: Vec2;
  offset?: Vec2;
  flipU?: boolean;
  flipV?: boolean;
  swapUV?: boolean;
  repeat?: Vec2;
};

type PositiveUVAxis = 'x' | 'y' | 'z';
type UVAxis = PositiveUVAxis | '-x' | '-y' | '-z';

type BoxNode = BaseNode & {
  type: 'box';
  size?: Vec3;
};

type CylinderNode = BaseNode & {
  type: 'cylinder';
  radius?: number;
  height?: number;
  segments?: number;
};

type SphereNode = BaseNode & {
  type: 'sphere';
  radius?: number;
  widthSegments?: number;
  heightSegments?: number;
};

type RevolveNode = BaseNode & {
  type: 'revolve';
  profile: Vec2[];
  segments?: number;
  capTop?: boolean;
  capBottom?: boolean;
};

type SurfaceNode = BaseNode & {
  type: 'surface';
  surfaceType?: 'bezierPatch';
  controlPoints?: Vec3[];
  patches: SurfacePatchSpec[];
  segmentsU?: number;
  segmentsV?: number;
  flipWinding?: boolean;
  flipNormals?: boolean;
  normalOrientation?: 'patch' | 'outward' | 'inward';
  smoothSeams?: boolean;
  seamTolerance?: number;
  doubleSided?: boolean;
  backfaceOffset?: number;
};

type SurfacePatchSpec =
  | number[]
  | Vec3[]
  | {
      indices?: number[];
      points?: Vec3[];
      mirror?: Vec3;
      reverseU?: boolean;
      reverseV?: boolean;
      flipWinding?: boolean;
      flipNormals?: boolean;
    };

type CurveNode = BaseNode & {
  type: 'curve';
  curveType?: 'polyline' | 'bezier' | 'catmullRom' | 'nurbs';
  shape?: 'tube' | 'ribbon';
  points: Vec3[];
  degree?: number;
  knots?: number[];
  weights?: number[];
  radius?: number;
  radii?: number[];
  width?: number;
  widths?: number[];
  thickness?: number;
  thicknesses?: number[];
  up?: Vec3;
  radialSegments?: number;
  tubularSegments?: number;
  closed?: boolean;
  capStart?: boolean;
  capEnd?: boolean;
};

type MeshNode = BaseNode & {
  type: 'mesh';
  positions: Vec3[];
  normals?: Vec3[];
  uvs?: Vec2[];
  indices: number[];
};

type CsgNode = BaseNode & {
  type: 'csg';
  op: 'union' | 'difference' | 'intersection' | 'intersect';
  children?: ProceduralNode[];
  base?: ProceduralNode;
  subtract?: ProceduralNode[];
};

type MeshData = {
  positions: number[];
  normals: number[];
  uvs: number[];
  tangents: number[];
  indices: number[];
};

type CsgVertex = {
  pos: Vec3;
  normal: Vec3;
  uv: Vec2;
};

type CsgPolygon = {
  vertices: CsgVertex[];
  plane: CsgPlane;
};

type CsgPlane = {
  normal: Vec3;
  w: number;
};

type GenerateMessage = {
  type: 'generate';
  spec: GeneratedModelSpec;
  deadlineAt: number;
};

type WorkerProgress = {
  type: 'progress';
  progress: number;
};

type WorkerSuccess = {
  type: 'success';
  primitiveText: string;
  vertexCount: number;
  indexCount: number;
  boxMin: Vec3;
  boxMax: Vec3;
  uvMin: Vec2;
  uvMax: Vec2;
  hasTangents: boolean;
};

type WorkerError = {
  type: 'error';
  error: string;
};

const DEFAULT_MAX_VERTICES = 500_000;
const CSG_EPSILON = 1e-5;

self.onmessage = (event: MessageEvent<GenerateMessage>) => {
  const message = event.data;
  if (message?.type !== 'generate') {
    return;
  }
  try {
    const result = generatePrimitive(message.spec, message.deadlineAt);
    postMessage(result);
  } catch (err) {
    const response: WorkerError = {
      type: 'error',
      error: err instanceof Error ? err.message : String(err)
    };
    postMessage(response);
  }
};

function generatePrimitive(spec: GeneratedModelSpec, deadlineAt: number): WorkerSuccess {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Generated model spec must be an object');
  }
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  if (nodes.length === 0) {
    throw new Error('Generated model spec requires at least one node');
  }
  const mesh = emptyMesh();
  for (let i = 0; i < nodes.length; i++) {
    checkDeadline(deadlineAt);
    mergeMesh(mesh, tessellateNode(nodes[i], deadlineAt));
    postProgress((i + 1) / nodes.length);
  }
  if (mesh.positions.length === 0 || mesh.indices.length === 0) {
    throw new Error('Generated model produced no triangles');
  }
  const vertexCount = mesh.positions.length / 3;
  const maxVertices = spec.generation?.maxVertices ?? DEFAULT_MAX_VERTICES;
  if (vertexCount > maxVertices) {
    throw new Error(`Generated model has ${vertexCount} vertices, exceeding maxVertices ${maxVertices}`);
  }
  const generateTangents = spec.generation?.generateTangents === true || spec.generation?.tangents === true;
  if (generateTangents) {
    mesh.tangents = computeVertexTangents(mesh);
  }
  const bbox = computeBounds(mesh.positions);
  const uvBounds = computeUVBounds(mesh.uvs);
  const positions = new Float32Array(mesh.positions);
  const normals = new Float32Array(mesh.normals);
  const uvs = new Float32Array(mesh.uvs);
  const tangents = generateTangents ? new Float32Array(mesh.tangents) : null;
  const useU32 = vertexCount > 65535;
  const indices = useU32 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices);
  const vertices: Record<string, { format: string; data: string }> = {
    position: {
      format: 'position_f32x3',
      data: bytesToBase64(new Uint8Array(positions.buffer))
    },
    normal: {
      format: 'normal_f32x3',
      data: bytesToBase64(new Uint8Array(normals.buffer))
    },
    texCoord0: {
      format: 'tex0_f32x2',
      data: bytesToBase64(new Uint8Array(uvs.buffer))
    }
  };
  if (tangents) {
    vertices.tangent = {
      format: 'tangent_f32x4',
      data: bytesToBase64(new Uint8Array(tangents.buffer))
    };
  }
  const primitiveText = JSON.stringify(
    {
      type: 'Primitive',
      data: {
        vertices,
        indices: bytesToBase64(new Uint8Array(indices.buffer)),
        indexType: useU32 ? 'u32' : 'u16',
        indexCount: indices.length,
        type: 'triangle-list',
        boxMin: bbox.min,
        boxMax: bbox.max
      }
    },
    null,
    2
  );
  return {
    type: 'success',
    primitiveText,
    vertexCount,
    indexCount: indices.length,
    boxMin: bbox.min,
    boxMax: bbox.max,
    uvMin: uvBounds.min,
    uvMax: uvBounds.max,
    hasTangents: generateTangents
  };
}

function tessellateNode(node: ProceduralNode, deadlineAt: number): MeshData {
  if (!node || typeof node !== 'object') {
    throw new Error('Procedural node must be an object');
  }
  let mesh: MeshData;
  switch (node.type) {
    case 'box':
      mesh = tessellateBox(node);
      break;
    case 'cylinder':
      mesh = tessellateCylinder(node);
      break;
    case 'sphere':
      mesh = tessellateSphere(node, deadlineAt);
      break;
    case 'revolve':
      mesh = tessellateRevolve(node, deadlineAt);
      break;
    case 'surface':
      mesh = tessellateSurface(node, deadlineAt);
      break;
    case 'curve':
      mesh = tessellateCurve(node, deadlineAt);
      break;
    case 'mesh':
      mesh = tessellateMesh(node);
      break;
    case 'csg':
      mesh = tessellateCsg(node, deadlineAt);
      break;
    default:
      throw new Error(`Unsupported procedural node type: ${(node as { type?: string }).type}`);
  }
  applyTransform(mesh, node);
  if (!node.preserveWinding) {
    enforceWindingMatchesNormals(mesh);
  }
  return mesh;
}

function tessellateBox(node: BoxNode): MeshData {
  const [sx, sy, sz] = node.size ?? [1, 1, 1];
  const x = sx / 2;
  const y = sy / 2;
  const z = sz / 2;
  const faces: Array<{ n: Vec3; p: Vec3[] }> = [
    {
      n: [0, 0, 1],
      p: [
        [-x, -y, z],
        [x, -y, z],
        [x, y, z],
        [-x, y, z]
      ]
    },
    {
      n: [0, 0, -1],
      p: [
        [x, -y, -z],
        [-x, -y, -z],
        [-x, y, -z],
        [x, y, -z]
      ]
    },
    {
      n: [1, 0, 0],
      p: [
        [x, -y, z],
        [x, -y, -z],
        [x, y, -z],
        [x, y, z]
      ]
    },
    {
      n: [-1, 0, 0],
      p: [
        [-x, -y, -z],
        [-x, -y, z],
        [-x, y, z],
        [-x, y, -z]
      ]
    },
    {
      n: [0, 1, 0],
      p: [
        [-x, y, z],
        [x, y, z],
        [x, y, -z],
        [-x, y, -z]
      ]
    },
    {
      n: [0, -1, 0],
      p: [
        [-x, -y, -z],
        [x, -y, -z],
        [x, -y, z],
        [-x, -y, z]
      ]
    }
  ];
  const mesh = emptyMesh();
  for (const face of faces) {
    const base = mesh.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      pushVec3(mesh.positions, face.p[i]);
      pushVec3(mesh.normals, face.n);
      pushUV(mesh, node, i === 0 || i === 3 ? 0 : 1, i < 2 ? 0 : 1);
    }
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return mesh;
}

function tessellateCylinder(node: CylinderNode): MeshData {
  const radius = positive(node.radius, 0.5, 'cylinder.radius');
  const height = positive(node.height, 1, 'cylinder.height');
  const segments = clampInteger(node.segments ?? 32, 3, 512, 'cylinder.segments');
  const mesh = emptyMesh();
  const half = height / 2;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0: Vec3 = [Math.cos(a0) * radius, -half, Math.sin(a0) * radius];
    const p1: Vec3 = [Math.cos(a1) * radius, -half, Math.sin(a1) * radius];
    const p2: Vec3 = [Math.cos(a1) * radius, half, Math.sin(a1) * radius];
    const p3: Vec3 = [Math.cos(a0) * radius, half, Math.sin(a0) * radius];
    const n0 = normalize([p0[0], 0, p0[2]]);
    const n1 = normalize([p1[0], 0, p1[2]]);
    const base = mesh.positions.length / 3;
    for (const [p, n, uv] of [
      [p0, n0, [i / segments, 0]],
      [p1, n1, [(i + 1) / segments, 0]],
      [p2, n1, [(i + 1) / segments, 1]],
      [p3, n0, [i / segments, 1]]
    ] as Array<[Vec3, Vec3, Vec2]>) {
      pushVec3(mesh.positions, p);
      pushVec3(mesh.normals, n);
      pushUV(mesh, node, uv[0], uv[1]);
    }
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    pushTriangle(mesh, node, [[0, -half, 0], p1, p0], [0, -1, 0]);
    pushTriangle(mesh, node, [[0, half, 0], p3, p2], [0, 1, 0]);
  }
  return mesh;
}

function tessellateSphere(node: SphereNode, deadlineAt: number): MeshData {
  const radius = positive(node.radius, 0.5, 'sphere.radius');
  const widthSegments = clampInteger(node.widthSegments ?? 32, 3, 512, 'sphere.widthSegments');
  const heightSegments = clampInteger(node.heightSegments ?? 16, 2, 256, 'sphere.heightSegments');
  const mesh = emptyMesh();
  for (let y = 0; y <= heightSegments; y++) {
    checkDeadline(deadlineAt);
    const v = y / heightSegments;
    const theta = v * Math.PI;
    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const phi = u * Math.PI * 2;
      const normal: Vec3 = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi)
      ];
      pushVec3(mesh.positions, [normal[0] * radius, normal[1] * radius, normal[2] * radius]);
      pushVec3(mesh.normals, normal);
      pushUV(mesh, node, u, v);
    }
  }
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      mesh.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return mesh;
}

function tessellateRevolve(node: RevolveNode, deadlineAt: number): MeshData {
  if (!Array.isArray(node.profile) || node.profile.length < 2) {
    throw new Error('revolve.profile requires at least two [radius, height] points');
  }
  const segments = clampInteger(node.segments ?? 64, 3, 1024, 'revolve.segments');
  const profile = node.profile.map((p) => {
    if (!Array.isArray(p) || p.length !== 2 || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1]) || p[0] < 0) {
      throw new Error('revolve.profile entries must be [nonNegativeRadius, height]');
    }
    return p;
  });
  const mesh = emptyMesh();
  for (let s = 0; s <= segments; s++) {
    checkDeadline(deadlineAt);
    const u = s / segments;
    const angle = u * Math.PI * 2;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    for (let i = 0; i < profile.length; i++) {
      const [r, h] = profile[i];
      const prev = profile[Math.max(0, i - 1)];
      const next = profile[Math.min(profile.length - 1, i + 1)];
      const tangent: Vec2 = [next[0] - prev[0], next[1] - prev[1]];
      const sideNormal = normalize([tangent[1] * ca, -tangent[0], tangent[1] * sa]);
      pushVec3(mesh.positions, [r * ca, h, r * sa]);
      pushVec3(mesh.normals, sideNormal);
      pushUV(mesh, node, u, i / (profile.length - 1));
    }
  }
  for (let s = 0; s < segments; s++) {
    for (let i = 0; i < profile.length - 1; i++) {
      const a = s * profile.length + i;
      const b = (s + 1) * profile.length + i;
      mesh.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  if (node.capBottom && profile[0][0] > 0) {
    capRevolve(mesh, node, profile[0], segments, false);
  }
  if (node.capTop && profile[profile.length - 1][0] > 0) {
    capRevolve(mesh, node, profile[profile.length - 1], segments, true);
  }
  return mesh;
}

function tessellateSurface(node: SurfaceNode, deadlineAt: number): MeshData {
  if (node.surfaceType && node.surfaceType !== 'bezierPatch') {
    throw new Error(`Unsupported surface.surfaceType: ${node.surfaceType}`);
  }
  if (!Array.isArray(node.patches) || node.patches.length === 0) {
    throw new Error('surface.patches requires at least one bicubic Bezier patch');
  }
  const controlPoints = node.controlPoints?.map((point) => {
    if (!isVec3(point)) {
      throw new Error('surface.controlPoints entries must be [x, y, z]');
    }
    return point;
  });
  const segmentsU = clampInteger(node.segmentsU ?? 16, 1, 256, 'surface.segmentsU');
  const segmentsV = clampInteger(node.segmentsV ?? segmentsU, 1, 256, 'surface.segmentsV');
  const mesh = emptyMesh();
  for (const patch of node.patches) {
    checkDeadline(deadlineAt);
    const resolved = resolveBezierPatch(patch, controlPoints);
    tessellateBezierPatch(
      mesh,
      node,
      resolved.points,
      segmentsU,
      segmentsV,
      node.flipWinding !== resolved.flipWinding,
      node.flipNormals !== resolved.flipNormals,
      deadlineAt
    );
  }
  if (node.normalOrientation === 'outward' || node.normalOrientation === 'inward') {
    orientMeshBySignedVolume(mesh, node.normalOrientation);
  }
  if (node.smoothSeams !== false) {
    weldNormalsByPosition(mesh, positive(node.seamTolerance, 1e-5, 'surface.seamTolerance'));
  }
  if (node.doubleSided) {
    duplicateMeshBackfaces(mesh, nonNegative(node.backfaceOffset, 0, 'surface.backfaceOffset'));
  }
  return mesh;
}

function resolveBezierPatch(
  patch: SurfacePatchSpec,
  controlPoints?: Vec3[]
): { points: Vec3[]; flipWinding: boolean; flipNormals: boolean } {
  if (Array.isArray(patch)) {
    return {
      points: resolveBezierPatchPoints(patch, controlPoints),
      flipWinding: false,
      flipNormals: false
    };
  }
  if (!patch || typeof patch !== 'object') {
    throw new Error('surface.patches entries must be arrays or patch objects');
  }
  const source = patch.indices ?? patch.points;
  const points = resolveBezierPatchPoints(source as number[] | Vec3[], controlPoints);
  const mirror = isVec3(patch.mirror) ? patch.mirror : ([1, 1, 1] as Vec3);
  const transformed: Vec3[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const sx = patch.reverseU ? 3 - x : x;
      const sy = patch.reverseV ? 3 - y : y;
      const point = points[sy * 4 + sx];
      transformed.push([point[0] * mirror[0], point[1] * mirror[1], point[2] * mirror[2]]);
    }
  }
  return {
    points: transformed,
    flipWinding: patch.flipWinding === true,
    flipNormals: patch.flipNormals === true
  };
}

function resolveBezierPatchPoints(patch: number[] | Vec3[] | undefined, controlPoints?: Vec3[]): Vec3[] {
  if (!Array.isArray(patch) || patch.length !== 16) {
    throw new Error('surface.patches entries must contain 16 control point indices or 16 [x, y, z] points');
  }
  if (patch.every((value) => typeof value === 'number')) {
    if (!controlPoints?.length) {
      throw new Error('surface.controlPoints is required when patches use indices');
    }
    return (patch as number[]).map((index) => {
      const controlPoint = controlPoints[clampIndex(index, controlPoints.length)];
      return [controlPoint[0], controlPoint[1], controlPoint[2]] as Vec3;
    });
  }
  return (patch as Vec3[]).map((point) => {
    if (!isVec3(point)) {
      throw new Error('surface patch point entries must be [x, y, z]');
    }
    return point;
  });
}

function tessellateBezierPatch(
  mesh: MeshData,
  node: SurfaceNode,
  points: Vec3[],
  segmentsU: number,
  segmentsV: number,
  flipWinding: boolean,
  flipNormals: boolean,
  deadlineAt: number
): void {
  const base = mesh.positions.length / 3;
  for (let vIndex = 0; vIndex <= segmentsV; vIndex++) {
    checkDeadline(deadlineAt);
    const v = vIndex / segmentsV;
    for (let uIndex = 0; uIndex <= segmentsU; uIndex++) {
      const u = uIndex / segmentsU;
      const sample = evaluateBezierPatch(points, u, v);
      const normal = flipNormals ? scaleVec3(sample.normal, -1) : sample.normal;
      pushVec3(mesh.positions, sample.position);
      pushVec3(mesh.normals, normal);
      pushUV(mesh, node, u, v, 0, 1, sample.position, normal);
    }
  }
  const row = segmentsU + 1;
  for (let v = 0; v < segmentsV; v++) {
    for (let u = 0; u < segmentsU; u++) {
      const a = base + v * row + u;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      if (flipWinding) {
        mesh.indices.push(a, c, b, b, c, d);
      } else {
        mesh.indices.push(a, b, c, b, d, c);
      }
    }
  }
}

function evaluateBezierPatch(points: Vec3[], u: number, v: number): { position: Vec3; normal: Vec3 } {
  const position = evaluateBezierPatchPosition(points, u, v);
  return {
    position,
    normal: evaluateBezierPatchNormal(points, u, v)
  };
}

function evaluateBezierPatchPosition(points: Vec3[], u: number, v: number): Vec3 {
  const bu = cubicBezierBasis(u);
  const bv = cubicBezierBasis(v);
  const position: Vec3 = [0, 0, 0];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const p = points[y * 4 + x];
      const b = bu[x] * bv[y];
      position[0] += p[0] * b;
      position[1] += p[1] * b;
      position[2] += p[2] * b;
    }
  }
  return position;
}

function evaluateBezierPatchNormal(points: Vec3[], u: number, v: number): Vec3 {
  const bu = cubicBezierBasis(u);
  const bv = cubicBezierBasis(v);
  const du = cubicBezierBasisDerivative(u);
  const dv = cubicBezierBasisDerivative(v);
  const tangentU: Vec3 = [0, 0, 0];
  const tangentV: Vec3 = [0, 0, 0];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const p = points[y * 4 + x];
      const ub = du[x] * bv[y];
      const vb = bu[x] * dv[y];
      tangentU[0] += p[0] * ub;
      tangentU[1] += p[1] * ub;
      tangentU[2] += p[2] * ub;
      tangentV[0] += p[0] * vb;
      tangentV[1] += p[1] * vb;
      tangentV[2] += p[2] * vb;
    }
  }
  const analytic = normalizeOptional(cross(tangentU, tangentV));
  if (analytic) {
    return analytic;
  }
  const eps = 1e-4;
  const u0 = Math.max(0, u - eps);
  const u1 = Math.min(1, u + eps);
  const v0 = Math.max(0, v - eps);
  const v1 = Math.min(1, v + eps);
  const pu0 = evaluateBezierPatchPosition(points, u0, v);
  const pu1 = evaluateBezierPatchPosition(points, u1, v);
  const pv0 = evaluateBezierPatchPosition(points, u, v0);
  const pv1 = evaluateBezierPatchPosition(points, u, v1);
  const finiteU = subVec3(pu1, pu0);
  const finiteV = subVec3(pv1, pv0);
  return normalizeOptional(cross(finiteU, finiteV)) ?? [0, 1, 0];
}

function cubicBezierBasis(t: number): [number, number, number, number] {
  const u = 1 - t;
  return [u * u * u, 3 * t * u * u, 3 * t * t * u, t * t * t];
}

function cubicBezierBasisDerivative(t: number): [number, number, number, number] {
  const u = 1 - t;
  return [-3 * u * u, 3 * u * u - 6 * t * u, 6 * t * u - 3 * t * t, 3 * t * t];
}

function tessellateCurve(node: CurveNode, deadlineAt: number): MeshData {
  if (!Array.isArray(node.points) || node.points.length < 2) {
    throw new Error('curve.points requires at least two [x, y, z] points');
  }
  const points = node.points.map((point) => {
    if (!isVec3(point)) {
      throw new Error('curve.points entries must be [x, y, z]');
    }
    return point;
  });
  const tubularSegments = clampInteger(node.tubularSegments ?? 16, 1, 512, 'curve.tubularSegments');
  const samples = sampleCurvePath(node, points, tubularSegments, deadlineAt);
  if (samples.length < 2) {
    throw new Error('curve produced fewer than two sample points');
  }
  return node.shape === 'ribbon'
    ? tessellateCurveRibbon(node, samples, deadlineAt)
    : tessellateCurveTube(node, samples, deadlineAt);
}

function tessellateCurveTube(node: CurveNode, samples: Vec3[], deadlineAt: number): MeshData {
  const radialSegments = clampInteger(node.radialSegments ?? 12, 3, 128, 'curve.radialSegments');
  const radius = positive(node.radius, 0.05, 'curve.radius');
  const mesh = emptyMesh();
  const ringCount = samples.length;
  const pathMetrics = computePathMetrics(samples, !!node.closed);
  let normal = choosePerpendicular(computeCurveTangent(samples, 0, !!node.closed));
  let binormal = normalize(cross(computeCurveTangent(samples, 0, !!node.closed), normal));
  for (let i = 0; i < ringCount; i++) {
    checkDeadline(deadlineAt);
    const tangent = computeCurveTangent(samples, i, !!node.closed);
    normal = normalize(cross(binormal, tangent));
    binormal = normalize(cross(tangent, normal));
    const localRadius = radiusAt(node, i, ringCount, radius);
    for (let s = 0; s < radialSegments; s++) {
      const angle = (s / radialSegments) * Math.PI * 2;
      const radial = normalize(
        addVec3(scaleVec3(normal, Math.cos(angle)), scaleVec3(binormal, Math.sin(angle)))
      );
      pushVec3(mesh.positions, addVec3(samples[i], scaleVec3(radial, localRadius)));
      pushVec3(mesh.normals, radial);
      pushUV(
        mesh,
        node,
        s / radialSegments,
        i / Math.max(1, ringCount - 1),
        pathMetrics.distances[i],
        pathMetrics.totalLength
      );
    }
  }
  const segmentCount = node.closed ? ringCount : ringCount - 1;
  for (let i = 0; i < segmentCount; i++) {
    const next = (i + 1) % ringCount;
    for (let s = 0; s < radialSegments; s++) {
      const a = i * radialSegments + s;
      const b = i * radialSegments + ((s + 1) % radialSegments);
      const c = next * radialSegments + s;
      const d = next * radialSegments + ((s + 1) % radialSegments);
      mesh.indices.push(a, c, b, b, c, d);
    }
  }
  if (!node.closed && node.capStart !== false) {
    capCurveTube(
      mesh,
      node,
      samples[0],
      scaleVec3(computeCurveTangent(samples, 0, false), -1),
      0,
      radialSegments
    );
  }
  if (!node.closed && node.capEnd !== false) {
    capCurveTube(
      mesh,
      node,
      samples[ringCount - 1],
      computeCurveTangent(samples, ringCount - 1, false),
      (ringCount - 1) * radialSegments,
      radialSegments
    );
  }
  return mesh;
}

function tessellateCurveRibbon(node: CurveNode, samples: Vec3[], deadlineAt: number): MeshData {
  const mesh = emptyMesh();
  const ringCount = samples.length;
  const baseWidth = positive(node.width, 1, 'curve.width');
  const baseThickness = nonNegative(node.thickness, 0, 'curve.thickness');
  const up = isVec3(node.up) ? normalize(node.up) : ([0, 1, 0] as Vec3);
  const thick = baseThickness > 0 || !!node.thicknesses?.length;
  const pathMetrics = computePathMetrics(samples, !!node.closed);
  for (let i = 0; i < ringCount; i++) {
    checkDeadline(deadlineAt);
    const tangent = computeCurveTangent(samples, i, !!node.closed);
    let side = cross(up, tangent);
    if (Math.hypot(side[0], side[1], side[2]) < 1e-6) {
      side = choosePerpendicular(tangent);
    } else {
      side = normalize(side);
    }
    const normal = normalize(cross(tangent, side));
    const width = widthAt(node, i, ringCount, baseWidth);
    const thickness = thicknessAt(node, i, ringCount, baseThickness);
    const u = i / Math.max(1, ringCount - 1);
    const leftTop = addVec3(
      addVec3(samples[i], scaleVec3(side, -width / 2)),
      scaleVec3(normal, thickness / 2)
    );
    const rightTop = addVec3(
      addVec3(samples[i], scaleVec3(side, width / 2)),
      scaleVec3(normal, thickness / 2)
    );
    const leftBottom = addVec3(
      addVec3(samples[i], scaleVec3(side, -width / 2)),
      scaleVec3(normal, -thickness / 2)
    );
    const rightBottom = addVec3(
      addVec3(samples[i], scaleVec3(side, width / 2)),
      scaleVec3(normal, -thickness / 2)
    );
    pushVec3(mesh.positions, leftTop);
    pushVec3(mesh.normals, normal);
    pushUV(mesh, node, 0, u, pathMetrics.distances[i], pathMetrics.totalLength);
    pushVec3(mesh.positions, rightTop);
    pushVec3(mesh.normals, normal);
    pushUV(mesh, node, 1, u, pathMetrics.distances[i], pathMetrics.totalLength);
    if (thick) {
      pushVec3(mesh.positions, leftBottom);
      pushVec3(mesh.normals, scaleVec3(normal, -1));
      pushUV(mesh, node, 0, u, pathMetrics.distances[i], pathMetrics.totalLength);
      pushVec3(mesh.positions, rightBottom);
      pushVec3(mesh.normals, scaleVec3(normal, -1));
      pushUV(mesh, node, 1, u, pathMetrics.distances[i], pathMetrics.totalLength);
      pushVec3(mesh.positions, leftTop);
      pushVec3(mesh.normals, scaleVec3(side, -1));
      pushUV(mesh, node, 0, u, pathMetrics.distances[i], pathMetrics.totalLength);
      pushVec3(mesh.positions, leftBottom);
      pushVec3(mesh.normals, scaleVec3(side, -1));
      pushUV(mesh, node, 1, u, pathMetrics.distances[i], pathMetrics.totalLength);
      pushVec3(mesh.positions, rightTop);
      pushVec3(mesh.normals, side);
      pushUV(mesh, node, 0, u, pathMetrics.distances[i], pathMetrics.totalLength);
      pushVec3(mesh.positions, rightBottom);
      pushVec3(mesh.normals, side);
      pushUV(mesh, node, 1, u, pathMetrics.distances[i], pathMetrics.totalLength);
    }
  }
  const segmentCount = node.closed ? ringCount : ringCount - 1;
  for (let i = 0; i < segmentCount; i++) {
    const next = (i + 1) % ringCount;
    if (thick) {
      const a = i * 8;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      const l0 = a + 4;
      const l1 = a + 5;
      const r0 = a + 6;
      const r1 = a + 7;
      const e = next * 8;
      const f = e + 1;
      const g = e + 2;
      const h = e + 3;
      const nl0 = e + 4;
      const nl1 = e + 5;
      const nr0 = e + 6;
      const nr1 = e + 7;
      mesh.indices.push(a, e, b, b, e, f);
      mesh.indices.push(c, d, g, d, h, g);
      mesh.indices.push(l0, l1, nl0, l1, nl1, nl0);
      mesh.indices.push(r0, nr0, r1, r1, nr0, nr1);
    } else {
      const a = i * 2;
      const b = a + 1;
      const c = next * 2;
      const d = c + 1;
      mesh.indices.push(a, c, b, b, c, d);
    }
  }
  if (thick && !node.closed && node.capStart !== false) {
    const tangent = scaleVec3(computeCurveTangent(samples, 0, false), -1);
    pushRibbonCap(
      mesh,
      node,
      [mesh.positions[0], mesh.positions[1], mesh.positions[2]],
      [mesh.positions[3], mesh.positions[4], mesh.positions[5]],
      [mesh.positions[6], mesh.positions[7], mesh.positions[8]],
      [mesh.positions[9], mesh.positions[10], mesh.positions[11]],
      tangent
    );
  }
  if (thick && !node.closed && node.capEnd !== false) {
    const a = (ringCount - 1) * 8;
    const tangent = computeCurveTangent(samples, ringCount - 1, false);
    pushRibbonCap(
      mesh,
      node,
      [mesh.positions[a * 3], mesh.positions[a * 3 + 1], mesh.positions[a * 3 + 2]],
      [mesh.positions[a * 3 + 3], mesh.positions[a * 3 + 4], mesh.positions[a * 3 + 5]],
      [mesh.positions[a * 3 + 6], mesh.positions[a * 3 + 7], mesh.positions[a * 3 + 8]],
      [mesh.positions[a * 3 + 9], mesh.positions[a * 3 + 10], mesh.positions[a * 3 + 11]],
      tangent
    );
  }
  return mesh;
}

function sampleCurvePath(
  node: CurveNode,
  points: Vec3[],
  tubularSegments: number,
  deadlineAt: number
): Vec3[] {
  const curveType = node.curveType ?? 'polyline';
  const closed = !!node.closed;
  if (curveType === 'bezier') {
    if ((points.length - 1) % 3 !== 0) {
      throw new Error('bezier curve points must contain 4 + 3n control points');
    }
    const samples: Vec3[] = [];
    for (let i = 0; i + 3 < points.length; i += 3) {
      for (let s = 0; s < tubularSegments; s++) {
        checkDeadline(deadlineAt);
        samples.push(
          cubicBezier(points[i], points[i + 1], points[i + 2], points[i + 3], s / tubularSegments)
        );
      }
    }
    samples.push(points[points.length - 1]);
    return removeDuplicateConsecutivePoints(closed ? closeSamples(samples) : samples);
  }
  if (curveType === 'catmullRom') {
    const samples: Vec3[] = [];
    const spanCount = closed ? points.length : points.length - 1;
    for (let i = 0; i < spanCount; i++) {
      const p0 = points[closed ? (i - 1 + points.length) % points.length : Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const p3 = points[closed ? (i + 2) % points.length : Math.min(points.length - 1, i + 2)];
      for (let s = 0; s < tubularSegments; s++) {
        checkDeadline(deadlineAt);
        samples.push(catmullRom(p0, p1, p2, p3, s / tubularSegments));
      }
    }
    if (!closed) {
      samples.push(points[points.length - 1]);
    }
    return removeDuplicateConsecutivePoints(samples);
  }
  if (curveType === 'nurbs') {
    return sampleNurbsCurve(node, points, tubularSegments, deadlineAt);
  }
  return removeDuplicateConsecutivePoints(closed ? closeSamples(points) : points);
}

function cubicBezier(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    u * u * u * p0[2] + 3 * u * u * t * p1[2] + 3 * u * t * t * p2[2] + t * t * t * p3[2]
  ];
}

function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 *
      (2 * p1[0] +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 *
      (2 * p1[1] +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    0.5 *
      (2 * p1[2] +
        (-p0[2] + p2[2]) * t +
        (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 +
        (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3)
  ];
}

function sampleNurbsCurve(
  node: CurveNode,
  points: Vec3[],
  tubularSegments: number,
  deadlineAt: number
): Vec3[] {
  const degree = clampInteger(node.degree ?? 3, 1, Math.max(1, points.length - 1), 'curve.degree');
  const weights = node.weights ?? points.map(() => 1);
  if (weights.length !== points.length) {
    throw new Error('nurbs curve weights length must match points length');
  }
  for (const weight of weights) {
    if (!isFiniteNumber(weight) || weight <= 0) {
      throw new Error('nurbs curve weights must be positive numbers');
    }
  }
  const knots = node.knots ?? createOpenUniformKnots(points.length, degree);
  if (knots.length !== points.length + degree + 1) {
    throw new Error('nurbs curve knots length must equal points.length + degree + 1');
  }
  for (let i = 1; i < knots.length; i++) {
    if (!isFiniteNumber(knots[i]) || knots[i] < knots[i - 1]) {
      throw new Error('nurbs curve knots must be a nondecreasing number array');
    }
  }
  const start = knots[degree];
  const end = knots[knots.length - degree - 1];
  if (!(end > start)) {
    throw new Error('nurbs curve knot domain is empty');
  }
  const segments = Math.max(1, tubularSegments * Math.max(1, points.length - degree));
  const samples: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    checkDeadline(deadlineAt);
    const u = i === segments ? end : lerp(start, end, i / segments);
    samples.push(evaluateNurbs(points, weights, knots, degree, u));
  }
  return removeDuplicateConsecutivePoints(samples);
}

function evaluateNurbs(points: Vec3[], weights: number[], knots: number[], degree: number, u: number): Vec3 {
  const numerator: Vec3 = [0, 0, 0];
  let denominator = 0;
  for (let i = 0; i < points.length; i++) {
    const basis = nurbsBasis(i, degree, u, knots);
    const weightedBasis = basis * weights[i];
    numerator[0] += points[i][0] * weightedBasis;
    numerator[1] += points[i][1] * weightedBasis;
    numerator[2] += points[i][2] * weightedBasis;
    denominator += weightedBasis;
  }
  if (Math.abs(denominator) < 1e-12) {
    return [points[points.length - 1][0], points[points.length - 1][1], points[points.length - 1][2]];
  }
  return [numerator[0] / denominator, numerator[1] / denominator, numerator[2] / denominator];
}

function nurbsBasis(i: number, degree: number, u: number, knots: number[]): number {
  if (degree === 0) {
    const isInSpan = knots[i] <= u && u < knots[i + 1];
    const isEndPoint = u === knots[knots.length - 1] && u === knots[i + 1];
    return isInSpan || isEndPoint ? 1 : 0;
  }
  let value = 0;
  const leftDenominator = knots[i + degree] - knots[i];
  if (leftDenominator > 0) {
    value += ((u - knots[i]) / leftDenominator) * nurbsBasis(i, degree - 1, u, knots);
  }
  const rightDenominator = knots[i + degree + 1] - knots[i + 1];
  if (rightDenominator > 0) {
    value += ((knots[i + degree + 1] - u) / rightDenominator) * nurbsBasis(i + 1, degree - 1, u, knots);
  }
  return value;
}

function createOpenUniformKnots(pointCount: number, degree: number): number[] {
  const knotCount = pointCount + degree + 1;
  const knots: number[] = [];
  const interiorCount = knotCount - 2 * (degree + 1);
  for (let i = 0; i < knotCount; i++) {
    if (i <= degree) {
      knots.push(0);
    } else if (i >= knotCount - degree - 1) {
      knots.push(1);
    } else {
      knots.push((i - degree) / (interiorCount + 1));
    }
  }
  return knots;
}

function computeCurveTangent(samples: Vec3[], index: number, closed: boolean): Vec3 {
  const prev = samples[closed ? (index - 1 + samples.length) % samples.length : Math.max(0, index - 1)];
  const next = samples[closed ? (index + 1) % samples.length : Math.min(samples.length - 1, index + 1)];
  return normalize(subVec3(next, prev));
}

function choosePerpendicular(tangent: Vec3): Vec3 {
  const up: Vec3 = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return normalize(cross(up, tangent));
}

function radiusAt(node: CurveNode, index: number, ringCount: number, fallback: number): number {
  if (!node.radii?.length) {
    return fallback;
  }
  if (node.radii.length === ringCount) {
    return positive(node.radii[index], fallback, 'curve.radii');
  }
  const t = index / Math.max(1, ringCount - 1);
  const scaled = t * (node.radii.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(node.radii.length - 1, lo + 1);
  return positive(lerp(node.radii[lo], node.radii[hi], scaled - lo), fallback, 'curve.radii');
}

function widthAt(node: CurveNode, index: number, ringCount: number, fallback: number): number {
  if (!node.widths?.length) {
    return fallback;
  }
  if (node.widths.length === ringCount) {
    return positive(node.widths[index], fallback, 'curve.widths');
  }
  const t = index / Math.max(1, ringCount - 1);
  const scaled = t * (node.widths.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(node.widths.length - 1, lo + 1);
  return positive(lerp(node.widths[lo], node.widths[hi], scaled - lo), fallback, 'curve.widths');
}

function thicknessAt(node: CurveNode, index: number, ringCount: number, fallback: number): number {
  if (!node.thicknesses?.length) {
    return fallback;
  }
  if (node.thicknesses.length === ringCount) {
    return nonNegative(node.thicknesses[index], fallback, 'curve.thicknesses');
  }
  const t = index / Math.max(1, ringCount - 1);
  const scaled = t * (node.thicknesses.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(node.thicknesses.length - 1, lo + 1);
  return nonNegative(
    lerp(node.thicknesses[lo], node.thicknesses[hi], scaled - lo),
    fallback,
    'curve.thicknesses'
  );
}

function pushRibbonCap(
  mesh: MeshData,
  node: BaseNode,
  leftTop: Vec3,
  rightTop: Vec3,
  leftBottom: Vec3,
  rightBottom: Vec3,
  normal: Vec3
): void {
  const base = mesh.positions.length / 3;
  const n = normalize(normal);
  for (const [point, uv] of [
    [leftTop, [0, 0]],
    [rightTop, [1, 0]],
    [leftBottom, [0, 1]],
    [rightBottom, [1, 1]]
  ] as Array<[Vec3, Vec2]>) {
    pushVec3(mesh.positions, point);
    pushVec3(mesh.normals, n);
    pushUV(mesh, node, uv[0], uv[1], 0, 1, point, n);
  }
  mesh.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
}

function capCurveTube(
  mesh: MeshData,
  node: BaseNode,
  center: Vec3,
  normal: Vec3,
  ringStart: number,
  radialSegments: number
): void {
  const centerIndex = mesh.positions.length / 3;
  const n = normalize(normal);
  pushVec3(mesh.positions, center);
  pushVec3(mesh.normals, n);
  pushUV(mesh, node, 0.5, 0.5, 0, 1, center, n);
  for (let s = 0; s < radialSegments; s++) {
    const a = ringStart + s;
    const b = ringStart + ((s + 1) % radialSegments);
    mesh.indices.push(centerIndex, b, a);
  }
}

function closeSamples(samples: Vec3[]): Vec3[] {
  if (samples.length < 2 || distanceSq(samples[0], samples[samples.length - 1]) < 1e-10) {
    return samples.slice(0, -1);
  }
  return samples.slice();
}

function removeDuplicateConsecutivePoints(points: Vec3[]): Vec3[] {
  const filtered: Vec3[] = [];
  for (const point of points) {
    if (!filtered.length || distanceSq(filtered[filtered.length - 1], point) > 1e-10) {
      filtered.push(point);
    }
  }
  return filtered;
}

function computePathMetrics(samples: Vec3[], closed: boolean): { distances: number[]; totalLength: number } {
  const distances = new Array<number>(samples.length).fill(0);
  for (let i = 1; i < samples.length; i++) {
    distances[i] = distances[i - 1] + Math.sqrt(distanceSq(samples[i - 1], samples[i]));
  }
  let totalLength = distances[distances.length - 1] ?? 0;
  if (closed && samples.length > 1) {
    totalLength += Math.sqrt(distanceSq(samples[samples.length - 1], samples[0]));
  }
  return {
    distances,
    totalLength: totalLength || 1
  };
}

function tessellateMesh(node: MeshNode): MeshData {
  if (!Array.isArray(node.positions) || !Array.isArray(node.indices)) {
    throw new Error('mesh node requires positions and indices arrays');
  }
  const mesh = emptyMesh();
  for (const p of node.positions) {
    if (!isVec3(p)) {
      throw new Error('mesh.positions entries must be [x, y, z]');
    }
    pushVec3(mesh.positions, p);
  }
  for (const index of node.indices) {
    mesh.indices.push(clampIndex(index, node.positions.length));
  }
  if (node.normals?.length === node.positions.length) {
    for (const n of node.normals) {
      pushVec3(mesh.normals, normalize(n));
    }
  } else {
    mesh.normals.push(...computeVertexNormals(mesh.positions, mesh.indices));
  }
  if (node.uvs?.length === node.positions.length) {
    for (let i = 0; i < node.uvs.length; i++) {
      const uv = node.uvs[i];
      if (!Array.isArray(uv) || uv.length !== 2 || !isFiniteNumber(uv[0]) || !isFiniteNumber(uv[1])) {
        throw new Error('mesh.uvs entries must be [u, v]');
      }
      pushUV(mesh, node, uv[0], uv[1], 0, 1, node.positions[i], vec3At(mesh.normals, i));
    }
  } else {
    for (let i = 0; i < node.positions.length; i++) {
      pushUV(mesh, node, 0, 0, 0, 1, node.positions[i], vec3At(mesh.normals, i));
    }
  }
  return mesh;
}

function tessellateCsg(node: CsgNode, deadlineAt: number): MeshData {
  const childMeshes = resolveCsgChildren(node).map((child) => {
    checkDeadline(deadlineAt);
    return tessellateNode(child, deadlineAt);
  });
  let polygons = meshToCsgPolygons(childMeshes[0]);
  for (let i = 1; i < childMeshes.length; i++) {
    checkDeadline(deadlineAt);
    const rhs = meshToCsgPolygons(childMeshes[i]);
    if (node.op === 'union') {
      polygons = csgUnion(polygons, rhs, deadlineAt);
    } else if (node.op === 'intersection' || node.op === 'intersect') {
      polygons = csgIntersection(polygons, rhs, deadlineAt);
    } else {
      polygons = csgDifference(polygons, rhs, deadlineAt);
    }
  }
  const result = csgPolygonsToMesh(polygons);
  if (result.indices.length === 0) {
    throw new Error(`CSG ${node.op} produced no triangles`);
  }
  return result;
}

function resolveCsgChildren(node: CsgNode): ProceduralNode[] {
  if (node.op === 'difference') {
    const base = node.base ?? node.children?.[0];
    const subtract = node.subtract ?? node.children?.slice(1) ?? [];
    if (!base || subtract.length === 0) {
      throw new Error('csg difference requires `base` and at least one `subtract` node');
    }
    return [base, ...subtract];
  }
  const children = node.children ?? (node.base ? [node.base, ...(node.subtract ?? [])] : []);
  if (children.length < 2) {
    throw new Error(`csg ${node.op} requires at least two children`);
  }
  return children;
}

function capRevolve(mesh: MeshData, node: BaseNode, point: Vec2, segments: number, top: boolean): void {
  const center = mesh.positions.length / 3;
  const normal: Vec3 = top ? [0, 1, 0] : [0, -1, 0];
  const centerPoint: Vec3 = [0, point[1], 0];
  pushVec3(mesh.positions, centerPoint);
  pushVec3(mesh.normals, normal);
  pushUV(mesh, node, 0.5, 0.5, 0, 1, centerPoint, normal);
  const ringStart = mesh.positions.length / 3;
  for (let s = 0; s < segments; s++) {
    const angle = (s / segments) * Math.PI * 2;
    const p: Vec3 = [point[0] * Math.cos(angle), point[1], point[0] * Math.sin(angle)];
    pushVec3(mesh.positions, p);
    pushVec3(mesh.normals, normal);
    pushUV(mesh, node, 0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5, 0, 1, p, normal);
  }
  for (let s = 0; s < segments; s++) {
    const a = ringStart + s;
    const b = ringStart + ((s + 1) % segments);
    mesh.indices.push(...(top ? [center, a, b] : [center, b, a]));
  }
}

function pushTriangle(mesh: MeshData, node: BaseNode, points: [Vec3, Vec3, Vec3], normal: Vec3): void {
  const base = mesh.positions.length / 3;
  for (const point of points) {
    pushVec3(mesh.positions, point);
    pushVec3(mesh.normals, normal);
    pushUV(mesh, node, 0, 0, 0, 1, point, normal);
  }
  mesh.indices.push(base, base + 1, base + 2);
}

function csgUnion(a: CsgPolygon[], b: CsgPolygon[], deadlineAt: number): CsgPolygon[] {
  const left = new CsgNodeBsp(a);
  const right = new CsgNodeBsp(b);
  left.clipTo(right, deadlineAt);
  right.clipTo(left, deadlineAt);
  right.invert();
  right.clipTo(left, deadlineAt);
  right.invert();
  left.build(right.allPolygons(), deadlineAt);
  return left.allPolygons();
}

function csgDifference(a: CsgPolygon[], b: CsgPolygon[], deadlineAt: number): CsgPolygon[] {
  const left = new CsgNodeBsp(a);
  const right = new CsgNodeBsp(b);
  left.invert();
  left.clipTo(right, deadlineAt);
  right.clipTo(left, deadlineAt);
  right.invert();
  right.clipTo(left, deadlineAt);
  right.invert();
  left.build(right.allPolygons(), deadlineAt);
  left.invert();
  return left.allPolygons();
}

function csgIntersection(a: CsgPolygon[], b: CsgPolygon[], deadlineAt: number): CsgPolygon[] {
  const left = new CsgNodeBsp(a);
  const right = new CsgNodeBsp(b);
  left.invert();
  right.clipTo(left, deadlineAt);
  right.invert();
  left.clipTo(right, deadlineAt);
  right.clipTo(left, deadlineAt);
  left.build(right.allPolygons(), deadlineAt);
  left.invert();
  return left.allPolygons();
}

class CsgNodeBsp {
  private plane: CsgPlane | null = null;
  private front: CsgNodeBsp | null = null;
  private back: CsgNodeBsp | null = null;
  private polygons: CsgPolygon[] = [];

  constructor(polygons?: CsgPolygon[]) {
    if (polygons?.length) {
      this.build(polygons, Number.POSITIVE_INFINITY);
    }
  }

  clone(): CsgNodeBsp {
    const node = new CsgNodeBsp();
    node.plane = this.plane ? clonePlane(this.plane) : null;
    node.front = this.front?.clone() ?? null;
    node.back = this.back?.clone() ?? null;
    node.polygons = this.polygons.map(clonePolygon);
    return node;
  }

  invert(): void {
    for (const polygon of this.polygons) {
      flipPolygon(polygon);
    }
    if (this.plane) {
      flipPlane(this.plane);
    }
    this.front?.invert();
    this.back?.invert();
    const tmp = this.front;
    this.front = this.back;
    this.back = tmp;
  }

  clipPolygons(polygons: CsgPolygon[], deadlineAt: number): CsgPolygon[] {
    if (!this.plane) {
      return polygons.map(clonePolygon);
    }
    let front: CsgPolygon[] = [];
    let back: CsgPolygon[] = [];
    for (const polygon of polygons) {
      checkDeadline(deadlineAt);
      splitPolygon(this.plane, polygon, front, back, front, back);
    }
    if (this.front) {
      front = this.front.clipPolygons(front, deadlineAt);
    }
    if (this.back) {
      back = this.back.clipPolygons(back, deadlineAt);
    } else {
      back = [];
    }
    return front.concat(back);
  }

  clipTo(node: CsgNodeBsp, deadlineAt: number): void {
    this.polygons = node.clipPolygons(this.polygons, deadlineAt);
    this.front?.clipTo(node, deadlineAt);
    this.back?.clipTo(node, deadlineAt);
  }

  allPolygons(): CsgPolygon[] {
    let polygons = this.polygons.map(clonePolygon);
    if (this.front) {
      polygons = polygons.concat(this.front.allPolygons());
    }
    if (this.back) {
      polygons = polygons.concat(this.back.allPolygons());
    }
    return polygons;
  }

  build(polygons: CsgPolygon[], deadlineAt: number): void {
    if (!polygons.length) {
      return;
    }
    if (!this.plane) {
      this.plane = clonePlane(polygons[0].plane);
    }
    const front: CsgPolygon[] = [];
    const back: CsgPolygon[] = [];
    for (const polygon of polygons) {
      checkDeadline(deadlineAt);
      splitPolygon(this.plane, polygon, this.polygons, this.polygons, front, back);
    }
    if (front.length) {
      if (!this.front) {
        this.front = new CsgNodeBsp();
      }
      this.front.build(front, deadlineAt);
    }
    if (back.length) {
      if (!this.back) {
        this.back = new CsgNodeBsp();
      }
      this.back.build(back, deadlineAt);
    }
  }
}

function meshToCsgPolygons(mesh: MeshData): CsgPolygon[] {
  const polygons: CsgPolygon[] = [];
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const vertices: CsgVertex[] = [];
    for (const index of [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]) {
      const p = index * 3;
      const t = index * 2;
      vertices.push({
        pos: [mesh.positions[p], mesh.positions[p + 1], mesh.positions[p + 2]],
        normal: normalize([mesh.normals[p], mesh.normals[p + 1], mesh.normals[p + 2]]),
        uv: [mesh.uvs[t] ?? 0, mesh.uvs[t + 1] ?? 0]
      });
    }
    const polygon = createPolygon(vertices);
    if (polygon) {
      polygons.push(polygon);
    }
  }
  return polygons;
}

function csgPolygonsToMesh(polygons: CsgPolygon[]): MeshData {
  const mesh = emptyMesh();
  for (const polygon of polygons) {
    if (polygon.vertices.length < 3) {
      continue;
    }
    const base = mesh.positions.length / 3;
    for (const vertex of polygon.vertices) {
      pushVec3(mesh.positions, vertex.pos);
      pushVec3(mesh.normals, normalize(vertex.normal));
      pushRawUV(mesh, vertex.uv[0], vertex.uv[1]);
    }
    for (let i = 2; i < polygon.vertices.length; i++) {
      mesh.indices.push(base, base + i - 1, base + i);
    }
  }
  return mesh;
}

function createPolygon(vertices: CsgVertex[]): CsgPolygon | null {
  if (vertices.length < 3) {
    return null;
  }
  const plane = planeFromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
  if (!plane) {
    return null;
  }
  return {
    vertices: vertices.map(cloneVertex),
    plane
  };
}

function splitPolygon(
  plane: CsgPlane,
  polygon: CsgPolygon,
  coplanarFront: CsgPolygon[],
  coplanarBack: CsgPolygon[],
  front: CsgPolygon[],
  back: CsgPolygon[]
): void {
  const COPLANAR = 0;
  const FRONT = 1;
  const BACK = 2;
  const SPANNING = 3;
  let polygonType = 0;
  const types: number[] = [];
  for (const vertex of polygon.vertices) {
    const t = dot(plane.normal, vertex.pos) - plane.w;
    const type = t < -CSG_EPSILON ? BACK : t > CSG_EPSILON ? FRONT : COPLANAR;
    polygonType |= type;
    types.push(type);
  }
  if (polygonType === COPLANAR) {
    (dot(plane.normal, polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(clonePolygon(polygon));
  } else if (polygonType === FRONT) {
    front.push(clonePolygon(polygon));
  } else if (polygonType === BACK) {
    back.push(clonePolygon(polygon));
  } else if (polygonType === SPANNING) {
    const f: CsgVertex[] = [];
    const b: CsgVertex[] = [];
    for (let i = 0; i < polygon.vertices.length; i++) {
      const j = (i + 1) % polygon.vertices.length;
      const ti = types[i];
      const tj = types[j];
      const vi = polygon.vertices[i];
      const vj = polygon.vertices[j];
      if (ti !== BACK) {
        f.push(cloneVertex(vi));
      }
      if (ti !== FRONT) {
        b.push(cloneVertex(vi));
      }
      if ((ti | tj) === SPANNING) {
        const direction = subVec3(vj.pos, vi.pos);
        const denominator = dot(plane.normal, direction);
        if (Math.abs(denominator) > CSG_EPSILON) {
          const t = (plane.w - dot(plane.normal, vi.pos)) / denominator;
          const v = interpolateVertex(vi, vj, t);
          f.push(v);
          b.push(cloneVertex(v));
        }
      }
    }
    const fp = createPolygon(f);
    if (fp) {
      front.push(fp);
    }
    const bp = createPolygon(b);
    if (bp) {
      back.push(bp);
    }
  }
}

function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): CsgPlane | null {
  const rawNormal = cross(subVec3(b, a), subVec3(c, a));
  if (Math.hypot(rawNormal[0], rawNormal[1], rawNormal[2]) <= CSG_EPSILON) {
    return null;
  }
  const normal = normalize(rawNormal);
  return {
    normal,
    w: dot(normal, a)
  };
}

function clonePolygon(polygon: CsgPolygon): CsgPolygon {
  return {
    vertices: polygon.vertices.map(cloneVertex),
    plane: clonePlane(polygon.plane)
  };
}

function cloneVertex(vertex: CsgVertex): CsgVertex {
  return {
    pos: [vertex.pos[0], vertex.pos[1], vertex.pos[2]],
    normal: [vertex.normal[0], vertex.normal[1], vertex.normal[2]],
    uv: [vertex.uv[0], vertex.uv[1]]
  };
}

function clonePlane(plane: CsgPlane): CsgPlane {
  return {
    normal: [plane.normal[0], plane.normal[1], plane.normal[2]],
    w: plane.w
  };
}

function flipPolygon(polygon: CsgPolygon): void {
  polygon.vertices.reverse();
  for (const vertex of polygon.vertices) {
    vertex.normal = scaleVec3(vertex.normal, -1);
  }
  flipPlane(polygon.plane);
}

function flipPlane(plane: CsgPlane): void {
  plane.normal = scaleVec3(plane.normal, -1);
  plane.w = -plane.w;
}

function interpolateVertex(a: CsgVertex, b: CsgVertex, t: number): CsgVertex {
  return {
    pos: lerpVec3(a.pos, b.pos, t),
    normal: normalize(lerpVec3(a.normal, b.normal, t)),
    uv: [lerp(a.uv[0], b.uv[0], t), lerp(a.uv[1], b.uv[1], t)]
  };
}

function computeVertexNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array<number>(positions.length).fill(0);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const ab: Vec3 = [
      positions[ib] - positions[ia],
      positions[ib + 1] - positions[ia + 1],
      positions[ib + 2] - positions[ia + 2]
    ];
    const ac: Vec3 = [
      positions[ic] - positions[ia],
      positions[ic + 1] - positions[ia + 1],
      positions[ic + 2] - positions[ia + 2]
    ];
    const n = normalize(cross(ab, ac));
    for (const index of [ia, ib, ic]) {
      normals[index] += n[0];
      normals[index + 1] += n[1];
      normals[index + 2] += n[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const n = normalize([normals[i], normals[i + 1], normals[i + 2]]);
    normals[i] = n[0];
    normals[i + 1] = n[1];
    normals[i + 2] = n[2];
  }
  return normals;
}

function orientMeshBySignedVolume(mesh: MeshData, orientation: 'outward' | 'inward'): void {
  const volume = computeSignedMeshVolume(mesh);
  if (Math.abs(volume) < 1e-10) {
    orientMeshNormalsByCenter(mesh, orientation);
    return;
  }
  const shouldFlip = orientation === 'outward' ? volume < 0 : volume > 0;
  if (shouldFlip) {
    flipMeshOrientation(mesh);
  }
}

function computeSignedMeshVolume(mesh: MeshData): number {
  let volume = 0;
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const a = vec3At(mesh.positions, mesh.indices[i]);
    const b = vec3At(mesh.positions, mesh.indices[i + 1]);
    const c = vec3At(mesh.positions, mesh.indices[i + 2]);
    if (!a || !b || !c) {
      continue;
    }
    volume += dot(a, cross(b, c)) / 6;
  }
  return volume;
}

function flipMeshOrientation(mesh: MeshData): void {
  for (let i = 0; i < mesh.normals.length; i += 3) {
    mesh.normals[i] = -mesh.normals[i];
    mesh.normals[i + 1] = -mesh.normals[i + 1];
    mesh.normals[i + 2] = -mesh.normals[i + 2];
  }
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const tmp = mesh.indices[i + 1];
    mesh.indices[i + 1] = mesh.indices[i + 2];
    mesh.indices[i + 2] = tmp;
  }
}

function orientMeshNormalsByCenter(mesh: MeshData, orientation: 'outward' | 'inward'): void {
  const center = computePositionCenter(mesh.positions);
  const targetSign = orientation === 'outward' ? 1 : -1;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const direction: Vec3 = [
      mesh.positions[i] - center[0],
      mesh.positions[i + 1] - center[1],
      mesh.positions[i + 2] - center[2]
    ];
    const normal: Vec3 = [mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]];
    if (dot(direction, normal) * targetSign < 0) {
      mesh.normals[i] = -mesh.normals[i];
      mesh.normals[i + 1] = -mesh.normals[i + 1];
      mesh.normals[i + 2] = -mesh.normals[i + 2];
    }
  }
}

function weldNormalsByPosition(mesh: MeshData, tolerance: number): void {
  const buckets = new Map<string, number[]>();
  const groups: number[][] = [];
  const inv = 1 / tolerance;
  for (let vertexIndex = 0; vertexIndex < mesh.positions.length / 3; vertexIndex++) {
    const p = vertexIndex * 3;
    const bx = Math.floor(mesh.positions[p] * inv);
    const by = Math.floor(mesh.positions[p + 1] * inv);
    const bz = Math.floor(mesh.positions[p + 2] * inv);
    let group: number[] | null = null;
    for (let z = bz - 1; z <= bz + 1 && !group; z++) {
      for (let y = by - 1; y <= by + 1 && !group; y++) {
        for (let x = bx - 1; x <= bx + 1 && !group; x++) {
          const bucket = buckets.get(`${x},${y},${z}`);
          if (!bucket) {
            continue;
          }
          for (const otherIndex of bucket) {
            if (distanceSqAt(mesh.positions, vertexIndex, otherIndex) <= tolerance * tolerance) {
              group = groups.find((candidate) => candidate.includes(otherIndex)) ?? null;
              break;
            }
          }
        }
      }
    }
    if (!group) {
      group = [];
      groups.push(group);
    }
    group.push(vertexIndex);
    const key = `${bx},${by},${bz}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(vertexIndex);
    } else {
      buckets.set(key, [vertexIndex]);
    }
  }
  for (const indices of groups) {
    weldCompatibleNormals(mesh, indices);
  }
}

function distanceSqAt(positions: number[], a: number, b: number): number {
  const ia = a * 3;
  const ib = b * 3;
  const dx = positions[ia] - positions[ib];
  const dy = positions[ia + 1] - positions[ib + 1];
  const dz = positions[ia + 2] - positions[ib + 2];
  return dx * dx + dy * dy + dz * dz;
}

function weldCompatibleNormals(mesh: MeshData, indices: number[]): void {
  if (indices.length < 2) {
    return;
  }
  const sets: Array<{ indices: number[]; sum: Vec3 }> = [];
  for (const index of indices) {
    const normal = normalize(vec3At(mesh.normals, index) ?? [0, 1, 0]);
    let best: { indices: number[]; sum: Vec3 } | null = null;
    let bestDot = -Infinity;
    for (const set of sets) {
      const reference = normalizeOptional(set.sum);
      if (!reference) {
        continue;
      }
      const d = dot(reference, normal);
      if (d > bestDot) {
        bestDot = d;
        best = set;
      }
    }
    if (!best || bestDot < 0) {
      best = { indices: [], sum: [0, 0, 0] };
      sets.push(best);
    }
    best.indices.push(index);
    best.sum[0] += normal[0];
    best.sum[1] += normal[1];
    best.sum[2] += normal[2];
  }
  for (const set of sets) {
    if (set.indices.length < 2) {
      continue;
    }
    const normal = normalizeOptional(set.sum);
    if (!normal) {
      continue;
    }
    for (const index of set.indices) {
      const offset = index * 3;
      mesh.normals[offset] = normal[0];
      mesh.normals[offset + 1] = normal[1];
      mesh.normals[offset + 2] = normal[2];
    }
  }
}

function duplicateMeshBackfaces(mesh: MeshData, offset: number): void {
  const vertexCount = mesh.positions.length / 3;
  const sourceIndices = mesh.indices.slice();
  for (let i = 0; i < vertexCount; i++) {
    const p = i * 3;
    const t = i * 2;
    const n: Vec3 = normalize([mesh.normals[p], mesh.normals[p + 1], mesh.normals[p + 2]]);
    pushVec3(mesh.positions, [
      mesh.positions[p] - n[0] * offset,
      mesh.positions[p + 1] - n[1] * offset,
      mesh.positions[p + 2] - n[2] * offset
    ]);
    pushVec3(mesh.normals, [-n[0], -n[1], -n[2]]);
    pushRawUV(mesh, mesh.uvs[t] ?? 0, mesh.uvs[t + 1] ?? 0);
  }
  for (let i = 0; i + 2 < sourceIndices.length; i += 3) {
    mesh.indices.push(
      vertexCount + sourceIndices[i],
      vertexCount + sourceIndices[i + 2],
      vertexCount + sourceIndices[i + 1]
    );
  }
}

function computePositionCenter(positions: number[]): Vec3 {
  const center: Vec3 = [0, 0, 0];
  const vertexCount = positions.length / 3;
  if (vertexCount === 0) {
    return center;
  }
  for (let i = 0; i < positions.length; i += 3) {
    center[0] += positions[i];
    center[1] += positions[i + 1];
    center[2] += positions[i + 2];
  }
  return [center[0] / vertexCount, center[1] / vertexCount, center[2] / vertexCount];
}

function computeVertexTangents(mesh: MeshData): number[] {
  const vertexCount = mesh.positions.length / 3;
  const tan1 = new Array<number>(vertexCount * 3).fill(0);
  const tan2 = new Array<number>(vertexCount * 3).fill(0);
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const i0 = mesh.indices[i];
    const i1 = mesh.indices[i + 1];
    const i2 = mesh.indices[i + 2];
    const p0 = vec3At(mesh.positions, i0);
    const p1 = vec3At(mesh.positions, i1);
    const p2 = vec3At(mesh.positions, i2);
    const uv0 = vec2At(mesh.uvs, i0);
    const uv1 = vec2At(mesh.uvs, i1);
    const uv2 = vec2At(mesh.uvs, i2);
    if (!p0 || !p1 || !p2 || !uv0 || !uv1 || !uv2) {
      continue;
    }
    const x1 = p1[0] - p0[0];
    const x2 = p2[0] - p0[0];
    const y1 = p1[1] - p0[1];
    const y2 = p2[1] - p0[1];
    const z1 = p1[2] - p0[2];
    const z2 = p2[2] - p0[2];
    const s1 = uv1[0] - uv0[0];
    const s2 = uv2[0] - uv0[0];
    const t1 = uv1[1] - uv0[1];
    const t2 = uv2[1] - uv0[1];
    const determinant = s1 * t2 - s2 * t1;
    if (Math.abs(determinant) < 1e-12) {
      continue;
    }
    const r = 1 / determinant;
    const tangent: Vec3 = [(t2 * x1 - t1 * x2) * r, (t2 * y1 - t1 * y2) * r, (t2 * z1 - t1 * z2) * r];
    const bitangent: Vec3 = [(s1 * x2 - s2 * x1) * r, (s1 * y2 - s2 * y1) * r, (s1 * z2 - s2 * z1) * r];
    accumulateVec3(tan1, i0, tangent);
    accumulateVec3(tan1, i1, tangent);
    accumulateVec3(tan1, i2, tangent);
    accumulateVec3(tan2, i0, bitangent);
    accumulateVec3(tan2, i1, bitangent);
    accumulateVec3(tan2, i2, bitangent);
  }

  const tangents = new Array<number>(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    const normal = vec3At(mesh.normals, i) ?? [0, 1, 0];
    const tangent = vec3At(tan1, i) ?? [0, 0, 0];
    const bitangent = vec3At(tan2, i) ?? [0, 0, 0];
    let t = subVec3(tangent, scaleVec3(normal, dot(normal, tangent)));
    if (lengthSqVec3(t) < 1e-12) {
      t = choosePerpendicular(normal);
    } else {
      t = normalize(t);
    }
    const w = dot(cross(normal, t), bitangent) < 0 ? -1 : 1;
    const offset = i * 4;
    tangents[offset] = t[0];
    tangents[offset + 1] = t[1];
    tangents[offset + 2] = t[2];
    tangents[offset + 3] = w;
  }
  return tangents;
}

function mergeMesh(target: MeshData, source: MeshData): void {
  const base = target.positions.length / 3;
  appendNumbers(target.positions, source.positions);
  appendNumbers(target.normals, source.normals);
  appendNumbers(target.uvs, source.uvs);
  if (source.tangents.length) {
    appendNumbers(target.tangents, source.tangents);
  }
  for (const index of source.indices) {
    target.indices.push(index + base);
  }
}

function enforceWindingMatchesNormals(mesh: MeshData): void {
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const ia = mesh.indices[i] * 3;
    const ib = mesh.indices[i + 1] * 3;
    const ic = mesh.indices[i + 2] * 3;
    const ab: Vec3 = [
      mesh.positions[ib] - mesh.positions[ia],
      mesh.positions[ib + 1] - mesh.positions[ia + 1],
      mesh.positions[ib + 2] - mesh.positions[ia + 2]
    ];
    const ac: Vec3 = [
      mesh.positions[ic] - mesh.positions[ia],
      mesh.positions[ic + 1] - mesh.positions[ia + 1],
      mesh.positions[ic + 2] - mesh.positions[ia + 2]
    ];
    const faceNormal = cross(ab, ac);
    const averageNormal: Vec3 = [
      mesh.normals[ia] + mesh.normals[ib] + mesh.normals[ic],
      mesh.normals[ia + 1] + mesh.normals[ib + 1] + mesh.normals[ic + 1],
      mesh.normals[ia + 2] + mesh.normals[ib + 2] + mesh.normals[ic + 2]
    ];
    if (dot(faceNormal, averageNormal) < 0) {
      const tmp = mesh.indices[i + 1];
      mesh.indices[i + 1] = mesh.indices[i + 2];
      mesh.indices[i + 2] = tmp;
    }
  }
}

function appendNumbers(target: number[], source: number[]): void {
  for (let i = 0; i < source.length; i++) {
    target.push(source[i]);
  }
}

function pushUV(
  mesh: MeshData,
  node: BaseNode,
  u: number,
  v: number,
  distance = 0,
  totalLength = 1,
  position?: Vec3,
  normal?: Vec3
): void {
  const uv = applyUVSpec(
    node.uv,
    u,
    v,
    distance,
    totalLength,
    position ?? lastVec3(mesh.positions),
    normal ?? lastVec3(mesh.normals)
  );
  pushRawUV(mesh, uv[0], uv[1]);
}

function pushRawUV(mesh: MeshData, u: number, v: number): void {
  mesh.uvs.push(u, v);
}

function applyUVSpec(
  spec: UVSpec | undefined,
  u: number,
  v: number,
  distance: number,
  totalLength: number,
  position?: Vec3,
  normal?: Vec3
): Vec2 {
  let outU = u;
  let outV = v;
  const mode = spec?.mode ?? 'default';
  if (mode === 'worldLength') {
    outV = mapWorldLength(distance, totalLength, spec);
  } else if (mode === 'planar') {
    [outU, outV] = mapPlanarUV(position, spec);
  } else if (mode === 'box') {
    [outU, outV] = mapBoxUV(position, normal, spec);
  } else if (mode === 'cylindrical') {
    [outU, outV] = mapCylindricalUV(position, u, v, spec);
  } else if (mode === 'spherical') {
    [outU, outV] = mapSphericalUV(position, u, v, spec);
  }
  if (spec?.flipU) {
    outU = 1 - outU;
  }
  if (spec?.flipV) {
    outV = 1 - outV;
  }
  if (spec?.swapUV) {
    const tmp = outU;
    outU = outV;
    outV = tmp;
  }
  const repeat = spec?.repeat ?? [1, 1];
  const scale = spec?.scale ?? [1, 1];
  const offset = spec?.offset ?? [0, 0];
  return [outU * repeat[0] * scale[0] + offset[0], outV * repeat[1] * scale[1] + offset[1]];
}

function mapWorldLength(distance: number, totalLength: number, spec: UVSpec): number {
  if (spec.tileSize?.[1]) {
    return distance / spec.tileSize[1];
  }
  if (totalLength > 0) {
    return distance / totalLength;
  }
  return 0;
}

function mapPlanarUV(position: Vec3 | undefined, spec: UVSpec): Vec2 {
  const p = subtractOrigin(position, spec.origin);
  const axes = getUVAxes(spec.axes, ['x', 'z']);
  return normalizeProjectedUV([axisValue(p, axes[0]), axisValue(p, axes[1])], spec);
}

function mapBoxUV(position: Vec3 | undefined, normal: Vec3 | undefined, spec: UVSpec): Vec2 {
  const p = subtractOrigin(position, spec.origin);
  const n = normal && isVec3(normal) ? normal : ([0, 1, 0] as Vec3);
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) {
    return normalizeProjectedUV([p[2], p[1]], spec);
  }
  if (ay >= ax && ay >= az) {
    return normalizeProjectedUV([p[0], p[2]], spec);
  }
  return normalizeProjectedUV([p[0], p[1]], spec);
}

function mapCylindricalUV(
  position: Vec3 | undefined,
  fallbackU: number,
  fallbackV: number,
  spec: UVSpec
): Vec2 {
  if (!position) {
    return [fallbackU, fallbackV];
  }
  const p = subtractOrigin(position, spec.origin);
  const axis = getPositiveUVAxis(spec.axis, 'y');
  const radial = cylinderRadialComponents(p, axis);
  const angle = Math.atan2(radial[1], radial[0]);
  const u = (angle + Math.PI) / (Math.PI * 2);
  const length = positiveAxisValue(p, axis);
  const v = normalizeUVComponent(length, spec.tileSize?.[1], spec.size?.[1], fallbackV);
  return [u, v];
}

function mapSphericalUV(
  position: Vec3 | undefined,
  fallbackU: number,
  fallbackV: number,
  spec: UVSpec
): Vec2 {
  if (!position) {
    return [fallbackU, fallbackV];
  }
  const p = subtractOrigin(position, spec.origin);
  const axis = getPositiveUVAxis(spec.axis, 'y');
  const radial = cylinderRadialComponents(p, axis);
  const pole = positiveAxisValue(p, axis);
  const radius = Math.hypot(p[0], p[1], p[2]);
  if (radius < 1e-12) {
    return [fallbackU, fallbackV];
  }
  const angle = Math.atan2(radial[1], radial[0]);
  return [(angle + Math.PI) / (Math.PI * 2), Math.acos(Math.max(-1, Math.min(1, pole / radius))) / Math.PI];
}

function normalizeProjectedUV(value: Vec2, spec: UVSpec): Vec2 {
  return [
    normalizeUVComponent(value[0], spec.tileSize?.[0], spec.size?.[0]),
    normalizeUVComponent(value[1], spec.tileSize?.[1], spec.size?.[1])
  ];
}

function normalizeUVComponent(value: number, tileSize?: number, size?: number, fallback?: number): number {
  if (isFiniteNumber(tileSize) && tileSize > 0) {
    return value / tileSize;
  }
  if (isFiniteNumber(size) && size > 0) {
    return value / size;
  }
  return fallback ?? value;
}

function subtractOrigin(position: Vec3 | undefined, origin: Vec3 | undefined): Vec3 {
  const p = position ?? ([0, 0, 0] as Vec3);
  const o = isVec3(origin) ? origin : ([0, 0, 0] as Vec3);
  return [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
}

function axisValue(v: Vec3, axis: UVAxis): number {
  const sign = axis[0] === '-' ? -1 : 1;
  const positiveAxis = (sign < 0 ? axis.slice(1) : axis) as PositiveUVAxis;
  return positiveAxisValue(v, positiveAxis) * sign;
}

function getUVAxes(value: unknown, fallback: [UVAxis, UVAxis]): [UVAxis, UVAxis] {
  if (!Array.isArray(value) || value.length !== 2 || !isUVAxis(value[0]) || !isUVAxis(value[1])) {
    return fallback;
  }
  return [value[0], value[1]];
}

function isUVAxis(value: unknown): value is UVAxis {
  return (
    value === 'x' || value === 'y' || value === 'z' || value === '-x' || value === '-y' || value === '-z'
  );
}

function getPositiveUVAxis(value: unknown, fallback: PositiveUVAxis): PositiveUVAxis {
  return value === 'x' || value === 'y' || value === 'z' ? value : fallback;
}

function positiveAxisValue(v: Vec3, axis: PositiveUVAxis): number {
  return axis === 'x' ? v[0] : axis === 'y' ? v[1] : v[2];
}

function cylinderRadialComponents(v: Vec3, axis: PositiveUVAxis): Vec2 {
  if (axis === 'x') {
    return [v[2], v[1]];
  }
  if (axis === 'z') {
    return [v[0], v[1]];
  }
  return [v[0], v[2]];
}

function lastVec3(values: number[]): Vec3 | undefined {
  if (values.length < 3) {
    return undefined;
  }
  return [values[values.length - 3], values[values.length - 2], values[values.length - 1]];
}

function vec3At(values: number[], index: number): Vec3 | undefined {
  const offset = index * 3;
  if (offset + 2 >= values.length) {
    return undefined;
  }
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function vec2At(values: number[], index: number): Vec2 | undefined {
  const offset = index * 2;
  if (offset + 1 >= values.length) {
    return undefined;
  }
  return [values[offset], values[offset + 1]];
}

function applyTransform(mesh: MeshData, node: BaseNode): void {
  const axes = getCoordinateRemapAxes(node);
  const p = isVec3(node.position) ? node.position : [0, 0, 0];
  const s = isVec3(node.scale) ? node.scale : [1, 1, 1];
  const q = isVec4(node.rotation) ? normalizeQuat(node.rotation) : ([0, 0, 0, 1] as Vec4);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const remapped = remapVec3([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]], axes);
    const rotated = rotateVec3ByQuat([remapped[0] * s[0], remapped[1] * s[1], remapped[2] * s[2]], q);
    mesh.positions[i] = rotated[0] + p[0];
    mesh.positions[i + 1] = rotated[1] + p[1];
    mesh.positions[i + 2] = rotated[2] + p[2];
  }
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const remapped = remapVec3([mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]], axes);
    const n = normalize(rotateVec3ByQuat([remapped[0] / s[0], remapped[1] / s[1], remapped[2] / s[2]], q));
    mesh.normals[i] = n[0];
    mesh.normals[i + 1] = n[1];
    mesh.normals[i + 2] = n[2];
  }
}

function getCoordinateRemapAxes(node: BaseNode): [UVAxis, UVAxis, UVAxis] {
  const remap = node.coordinateRemap;
  if (remap === 'none') {
    return ['x', 'y', 'z'];
  }
  if (remap === 'zUpToYUp') {
    return ['x', 'z', '-y'];
  }
  if (remap === 'yUpToZUp') {
    return ['x', '-z', 'y'];
  }
  if (remap && typeof remap === 'object' && Array.isArray(remap.axes)) {
    return getCoordinateAxes(remap.axes, ['x', 'y', 'z']);
  }
  if (node.coordinateSystem === 'zUp') {
    return ['x', 'z', '-y'];
  }
  return ['x', 'y', 'z'];
}

function getCoordinateAxes(value: unknown, fallback: [UVAxis, UVAxis, UVAxis]): [UVAxis, UVAxis, UVAxis] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !isUVAxis(value[0]) ||
    !isUVAxis(value[1]) ||
    !isUVAxis(value[2])
  ) {
    return fallback;
  }
  return [value[0], value[1], value[2]];
}

function remapVec3(value: Vec3, axes: [UVAxis, UVAxis, UVAxis]): Vec3 {
  return [axisValue(value, axes[0]), axisValue(value, axes[1]), axisValue(value, axes[2])];
}

function computeBounds(positions: number[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < positions.length; i += 3) {
    min[0] = Math.min(min[0], positions[i]);
    min[1] = Math.min(min[1], positions[i + 1]);
    min[2] = Math.min(min[2], positions[i + 2]);
    max[0] = Math.max(max[0], positions[i]);
    max[1] = Math.max(max[1], positions[i + 1]);
    max[2] = Math.max(max[2], positions[i + 2]);
  }
  return { min, max };
}

function computeUVBounds(uvs: number[]): { min: Vec2; max: Vec2 } {
  const min: Vec2 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec2 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < uvs.length; i += 2) {
    min[0] = Math.min(min[0], uvs[i]);
    min[1] = Math.min(min[1], uvs[i + 1]);
    max[0] = Math.max(max[0], uvs[i]);
    max[1] = Math.max(max[1], uvs[i + 1]);
  }
  if (!Number.isFinite(min[0])) {
    return { min: [0, 0], max: [0, 0] };
  }
  return { min, max };
}

function emptyMesh(): MeshData {
  return {
    positions: [],
    normals: [],
    uvs: [],
    tangents: [],
    indices: []
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function postProgress(progress: number): void {
  const message: WorkerProgress = {
    type: 'progress',
    progress: Math.max(0, Math.min(1, progress))
  };
  postMessage(message);
}

function checkDeadline(deadlineAt: number): void {
  if (Number.isFinite(deadlineAt) && Date.now() > deadlineAt) {
    throw new Error('Generated model worker timed out');
  }
}

function positive(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!isFiniteNumber(result) || result <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return result;
}

function nonNegative(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!isFiniteNumber(result) || result < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return result;
}

function clampInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return Math.max(min, Math.min(max, value));
}

function clampIndex(value: number, vertexCount: number): number {
  if (!Number.isInteger(value) || value < 0 || value >= vertexCount) {
    throw new Error(`mesh index out of range: ${value}`);
  }
  return value;
}

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1]) &&
    isFiniteNumber(value[2])
  );
}

function isVec4(value: unknown): value is Vec4 {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1]) &&
    isFiniteNumber(value[2]) &&
    isFiniteNumber(value[3])
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pushVec3(values: number[], v: Vec3): void {
  values.push(v[0], v[1], v[2]);
}

function accumulateVec3(values: number[], index: number, v: Vec3): void {
  const offset = index * 3;
  values[offset] += v[0];
  values[offset + 1] += v[1];
  values[offset + 2] += v[2];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
}

function normalizeOptional(v: Vec3, epsilon = 1e-10): Vec3 | null {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > epsilon ? [v[0] / len, v[1] / len, v[2] / len] : null;
}

function normalizeQuat(q: Vec4): Vec4 {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len > 0 ? [q[0] / len, q[1] / len, q[2] / len, q[3] / len] : [0, 0, 0, 1];
}

function rotateVec3ByQuat(v: Vec3, q: Vec4): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const uv = cross(u, v);
  const uuv = cross(u, uv);
  return addVec3(v, addVec3(scaleVec3(uv, 2 * q[3]), scaleVec3(uuv, 2)));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec3(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distanceSq(a: Vec3, b: Vec3): number {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return x * x + y * y + z * z;
}

function lengthSqVec3(v: Vec3): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

export {};
