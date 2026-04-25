import type { Nullable } from '@zephyr3d/base';
import type { Mesh, SceneNode } from '@zephyr3d/scene';

export type ClothColliderType = 'sphere' | 'capsule' | 'plane';
export const GPU_CLOTH_EDITOR_TYPE = 'gpucloth';

export type ClothColliderData = {
  type?: ClothColliderType;
  enabled?: boolean;
  bone?: string;
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  endOffsetX?: number;
  endOffsetY?: number;
  endOffsetZ?: number;
  normalX?: number;
  normalY?: number;
  normalZ?: number;
  radius?: number;
};

export type ClothScriptConfigData = {
  __editorPluginType?: string;
  enabled?: boolean;
  autoUpdate?: boolean;
  simulationMeshId?: string;
  targetMeshIds?: string[];
  targetMeshBindingDataByTarget?: string;
  targetMeshBindingSignatureByTarget?: string;
  damping?: number;
  dynamicFriction?: number;
  staticFriction?: number;
  stiffness?: number;
  poseFollow?: number;
  substeps?: number;
  gravityX?: number;
  gravityY?: number;
  gravityZ?: number;
  solverIterations?: number;
  vertexPinWeightsByTarget?: string;
  pinnedVertexIndicesByTarget?: string;
  maxNeighbors?: number;
  maxTrianglesPerVertex?: number;
  workgroupSize?: number;
  rebuildNormals?: boolean;
  colliders?: ClothColliderData[];
};

// 这部分状态只属于编辑器 UI，不属于场景配置。
// 因此使用 WeakMap 挂在宿主节点上，而不是写回 scriptConfig。
const clothUIState = new WeakMap<
  SceneNode,
  {
    bindingStatus: string;
    bindingInProgress: boolean;
  }
>();

let pluginHooks: {
  refreshProperties: () => void;
  notifySceneChanged: () => void;
} = {
  refreshProperties: () => undefined,
  notifySceneChanged: () => undefined
};

export function setGPUClothPluginHooks(hooks: typeof pluginHooks) {
  pluginHooks = hooks;
}

export function refreshGPUClothPluginUI(markSceneDirty = false) {
  pluginHooks.refreshProperties();
  if (markSceneDirty) {
    pluginHooks.notifySceneChanged();
  }
}

export function isGPUClothScript(script: string) {
  const normalized = (script ?? '').trim().toLowerCase().replace(/\\/g, '/');
  return /(^|\/)gpucloth(\.ts|\.js)?$/.test(normalized);
}

export function hasGPUClothMarker(host: Nullable<SceneNode>) {
  return String((host as any)?.scriptConfig?.__editorPluginType ?? '').trim() === GPU_CLOTH_EDITOR_TYPE;
}

export function hasScriptAttachment(host: Nullable<SceneNode>) {
  return String((host as any)?.script ?? '').trim().length > 0;
}

export function isGPUClothHost(host: Nullable<SceneNode>) {
  return (
    !!host &&
    hasScriptAttachment(host) &&
    (hasGPUClothMarker(host) || isGPUClothScript((host as any).script ?? ''))
  );
}

// GPU cloth 可能工作在 prefab 节点、普通场景节点，或者直接选中的 mesh 上。
// 这里统一解析“查找 mesh / node id 时应当搜索的作用域”。
export function resolveClothHostScope(host: SceneNode) {
  return (
    (typeof (host as any)?.getPrefabNode === 'function' && (host as any).getPrefabNode()) ||
    host.scene?.rootNode ||
    host
  );
}

export function resolveClothMeshById(host: Nullable<SceneNode>, meshId: string): Nullable<Mesh> {
  const id = String(meshId ?? '').trim();
  if (!host || !id) {
    return null;
  }
  const candidate = resolveClothHostScope(host)?.findNodeById?.(id);
  return candidate?.isMesh?.() && candidate.primitive ? candidate : null;
}

export function resolveClothMeshLabel(host: Nullable<SceneNode>, meshId: string) {
  const id = String(meshId ?? '').trim();
  if (!id) {
    return '';
  }
  const mesh = resolveClothMeshById(host, id);
  if (mesh) {
    const name = String(mesh.name ?? '').trim();
    return name || mesh.persistentId || id;
  }
  return `[Missing] ${id}`;
}

export function resolveClothSimulationMesh(host: Nullable<SceneNode>): Nullable<Mesh> {
  const simulationMeshId = String((host as any)?.scriptConfig?.simulationMeshId ?? '').trim();
  if (!host || !simulationMeshId) {
    return null;
  }
  return resolveClothMeshById(host, simulationMeshId);
}

export function collectClothTargetMeshes(host: SceneNode): Mesh[] {
  if (!host) {
    return [];
  }
  // 绘制工具始终围绕 simulation mesh 工作。
  // 如果脚本已经显式指定了 simulationMeshId，就优先使用它；否则在 mesh 节点上回退到宿主自身。
  const simulationMesh = resolveClothSimulationMesh(host);
  if (simulationMesh) {
    return [simulationMesh];
  }
  if (host.isMesh() && host.primitive) {
    return [host];
  }
  return [];
}

export function findClothPaintHost(startNode: Nullable<SceneNode>): Nullable<SceneNode> {
  let current = startNode;
  while (current) {
    if (isGPUClothHost(current) && collectClothTargetMeshes(current).length > 0) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

export function clamp01(value: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);
}

export function normalizePlaneDirection(value: number) {
  return value < 0 ? -1 : 1;
}

export function ensureClothConfig(host: SceneNode) {
  const target = host as SceneNode & { scriptConfig?: ClothScriptConfigData | null };
  target.scriptConfig ??= {};
  return target.scriptConfig as ClothScriptConfigData;
}

export function getClothUIState(host: SceneNode) {
  let state = clothUIState.get(host);
  if (!state) {
    state = {
      bindingStatus: 'Binding cache needs rebuild',
      bindingInProgress: false
    };
    clothUIState.set(host, state);
  }
  return state;
}

export function setClothBindingStatus(host: SceneNode, status: string) {
  getClothUIState(host).bindingStatus = status;
}

export function setClothBindingInProgress(host: SceneNode, value: boolean) {
  getClothUIState(host).bindingInProgress = !!value;
}

export function ensureTargetMeshIds(host: SceneNode) {
  const config = ensureClothConfig(host);
  config.targetMeshIds ??= [];
  return config.targetMeshIds;
}

export function createDefaultTargetMeshId() {
  return '';
}

export function parseStringMap(source: string): Record<string, string> {
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
      result[key] = typeof value === 'string' ? value : String(value ?? '');
    }
    return result;
  } catch {
    return {};
  }
}

export function serializeStringMap(value: Record<string, string>) {
  const entries = Object.entries(value)
    .filter(([, encoded]) => String(encoded ?? '').trim().length > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : '';
}

export function setTargetMeshBindingDataByTarget(host: SceneNode, value: Record<string, string>) {
  ensureClothConfig(host).targetMeshBindingDataByTarget = serializeStringMap(value);
}

export function getTargetMeshBindingDataByTarget(host: SceneNode) {
  return parseStringMap(String(ensureClothConfig(host).targetMeshBindingDataByTarget ?? ''));
}

export function setTargetMeshBindingSignatureByTarget(host: SceneNode, value: Record<string, string>) {
  ensureClothConfig(host).targetMeshBindingSignatureByTarget = serializeStringMap(value);
}

export function getTargetMeshBindingSignatureByTarget(host: SceneNode) {
  return parseStringMap(String(ensureClothConfig(host).targetMeshBindingSignatureByTarget ?? ''));
}

export function invalidateAllTargetBindings(host: SceneNode, status = 'Binding cache needs rebuild') {
  const config = ensureClothConfig(host);
  config.targetMeshBindingDataByTarget = '';
  config.targetMeshBindingSignatureByTarget = '';
  setClothBindingStatus(host, status);
}

// vertexPinWeightsByTarget / pinnedVertexIndicesByTarget 都是“按目标网格 id 分桶”的字符串映射。
// key 为目标 mesh 的 persistentId，value 为该 mesh 的权重编码串。
export function parsePinnedVertexMap(source: string): Record<string, string> {
  return parseStringMap(source);
}

export function serializePinnedVertexMap(value: Record<string, string>) {
  return serializeStringMap(value);
}

export function parseLegacyPinnedVertexIndices(source: string) {
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

// 新格式使用 "vertexIndex:clothWeight" 的逗号分隔串。
// 注意这里存的是 cloth weight，而运行时 GPU cloth 实际消费时会再转换成 pinned weight。
export function parseVertexWeights(source: string) {
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
    const weight = clamp01(Number(entry.slice(separator + 1).trim()));
    if (Number.isFinite(index) && index >= 0) {
      result.set(index | 0, weight);
    }
  }
  return result;
}

export function serializeVertexWeights(weights: Map<number, number>) {
  return [...weights.entries()]
    .filter(([index, weight]) => Number.isFinite(index) && index >= 0 && clamp01(weight) < 1 - 1e-4)
    .sort((a, b) => a[0] - b[0])
    .map(([index, weight]) => `${index}:${clamp01(weight).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`)
    .join(', ');
}
