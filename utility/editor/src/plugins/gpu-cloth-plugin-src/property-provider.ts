import type { PropertyAccessor, Mesh } from '@zephyr3d/scene';
import { SceneNode } from '@zephyr3d/scene';
import { createGPUClothWrapBindingData } from '@zephyr3d/scene';
import type { EditorPluginContext } from '@zephyr3d/editor/editor-plugin';
import {
  ensureClothConfig,
  ensureTargetMeshIds,
  createDefaultTargetMeshId,
  getTargetMeshBindingDataByTarget,
  getTargetMeshBindingSignatureByTarget,
  getClothUIState,
  invalidateAllTargetBindings,
  refreshGPUClothPluginUI,
  resolveClothMeshById,
  resolveClothMeshLabel,
  setClothBindingInProgress,
  setClothBindingStatus,
  setGPUClothPluginHooks,
  setTargetMeshBindingDataByTarget,
  setTargetMeshBindingSignatureByTarget,
  isGPUClothHost
} from './shared';

type ScriptHost = SceneNode;

let pluginContext: EditorPluginContext | null = null;

function refresh(markSceneDirty = true) {
  if (pluginContext) {
    pluginContext.refreshProperties();
    if (markSceneDirty) {
      pluginContext.notifySceneChanged();
    }
  } else {
    refreshGPUClothPluginUI(markSceneDirty);
  }
}

// 这里保留 property provider 的原因不是为了声明常规配置项。
// 常规配置已经迁移到运行时脚本里的 @scriptProp。
// provider 现在只负责“绑定缓存重建”这类编辑器增强功能。
async function bindTargetMeshes(host: SceneNode) {
  const uiState = getClothUIState(host);
  if (uiState.bindingInProgress) {
    return;
  }
  const config = ensureClothConfig(host);
  const simulationMesh =
    resolveClothMeshById(host, String(config.simulationMeshId ?? '').trim()) ||
    (host.isMesh() && host.primitive ? (host as Mesh) : null);
  if (!simulationMesh) {
    setClothBindingStatus(host, 'Set Simulation Mesh before binding.');
    refresh(false);
    return;
  }
  const targetMeshIds = ensureTargetMeshIds(host)
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => !!entry);
  if (targetMeshIds.length === 0) {
    setClothBindingStatus(host, 'Add at least one Target Mesh before binding.');
    refresh(false);
    return;
  }

  setClothBindingInProgress(host, true);
  setClothBindingStatus(host, 'Binding target meshes...');
  refresh(false);

  let successCount = 0;
  const failedTargets: string[] = [];
  const nextBindingDataByTarget = getTargetMeshBindingDataByTarget(host);
  const nextBindingSignatureByTarget = getTargetMeshBindingSignatureByTarget(host);
  try {
    for (const meshId of targetMeshIds) {
      const targetMesh = resolveClothMeshById(host, meshId);
      if (!targetMesh || targetMesh === simulationMesh) {
        delete nextBindingDataByTarget[meshId];
        delete nextBindingSignatureByTarget[meshId];
        failedTargets.push(resolveClothMeshLabel(host, meshId));
        continue;
      }
      try {
        const data = await createGPUClothWrapBindingData(simulationMesh, targetMesh);
        nextBindingDataByTarget[meshId] = JSON.stringify(data);
        nextBindingSignatureByTarget[meshId] =
          `${data.version}:${data.vertexCount}:${data.sourceVertexCount}:${data.influenceCount}`;
        successCount++;
      } catch (err) {
        delete nextBindingDataByTarget[meshId];
        delete nextBindingSignatureByTarget[meshId];
        failedTargets.push(
          `${resolveClothMeshLabel(host, meshId)}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } finally {
    setClothBindingInProgress(host, false);
  }

  if (successCount > 0 && failedTargets.length === 0) {
    setClothBindingStatus(host, `Bound ${successCount} target mesh(es).`);
  } else if (successCount > 0) {
    setClothBindingStatus(
      host,
      `Bound ${successCount} target mesh(es), ${failedTargets.length} failed: ${failedTargets.join('; ')}`
    );
  } else {
    setClothBindingStatus(host, failedTargets[0] || 'Binding failed.');
  }
  setTargetMeshBindingDataByTarget(host, nextBindingDataByTarget);
  setTargetMeshBindingSignatureByTarget(host, nextBindingSignatureByTarget);
  refresh(false);
}

function createBindingCommandAccessor(): PropertyAccessor<any> {
  return {
    name: 'Binding',
    type: 'command',
    options: {
      group: 'Cloth/Binding'
    },
    get(this: ScriptHost, value: any) {
      const state = getClothUIState(this);
      value.str[0] = state.bindingInProgress ? 'Binding...' : 'Bind';
      value.str[1] = 'Clear';
    },
    command(this: ScriptHost, index) {
      if (index === 0) {
        if (!getClothUIState(this).bindingInProgress) {
          void bindTargetMeshes(this);
        }
      } else {
        invalidateAllTargetBindings(this, 'Binding cache cleared.');
        refresh();
      }
      return true;
    }
  };
}

export function createGPUClothPropertyAccessors(host: unknown): PropertyAccessor<any>[] {
  if (!(host instanceof SceneNode) || !isGPUClothHost(host)) {
    return [];
  }
  // targetMeshIds 数组在首次挂载但尚未展开属性面板时，可能仍为空。
  // 这里补一个空条目，只是为了让“绑定”工作流有稳定的编辑入口。
  if (ensureTargetMeshIds(host).length === 0) {
    ensureTargetMeshIds(host).push(createDefaultTargetMeshId());
  }
  const state = getClothUIState(host);
  return [
    {
      name: 'BindingStatus',
      type: 'string',
      readonly: true,
      options: {
        group: 'Cloth/Binding'
      },
      isPersistent() {
        return false;
      },
      get(this: ScriptHost, value: any) {
        value.str[0] = state.bindingStatus;
      }
    },
    createBindingCommandAccessor()
  ];
}

export function initGPUClothPropertyProvider(ctx: EditorPluginContext) {
  pluginContext = ctx;
  // 共享 hooks 让 shared.ts 中的辅助逻辑也能触发编辑器刷新，而不必直接依赖 ctx。
  setGPUClothPluginHooks({
    refreshProperties: () => ctx.refreshProperties(),
    notifySceneChanged: () => ctx.notifySceneChanged()
  });
  ctx.registerPropertyAccessors('gpu-cloth-properties', createGPUClothPropertyAccessors);
}
