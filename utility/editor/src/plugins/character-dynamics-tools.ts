import type { EditorPlugin } from '../core/plugin';
import type { SystemPluginFileInput } from '../core/services/systemplugin';
import gpuClothPaintCommandSource from './gpu-cloth-plugin-src/paint-command.ts?raw';
import gpuClothPaintToolSource from './gpu-cloth-plugin-src/paint-tool.ts?raw';
import gpuClothPropertyProviderSource from './gpu-cloth-plugin-src/property-provider.ts?raw';
import gpuClothRuntimeTemplateSource from './gpu-cloth-plugin-src/runtime-template.ts?raw';
import gpuClothSharedSource from './gpu-cloth-plugin-src/shared.ts?raw';
import springPropertyProviderSource from './spring-plugin-src/property-provider.ts?raw';
import springRuntimeTemplateSource from './spring-plugin-src/runtime-template.ts?raw';
import springSharedSource from './spring-plugin-src/shared.ts?raw';

export const characterDynamicsToolsPluginSource = `import type { EditorPlugin } from '@zephyr3d/editor/editor-plugin';
import { SceneNode } from '@zephyr3d/scene';
import { initGPUClothPaintTool } from './gpu-cloth/paint-tool';
import { initGPUClothPropertyProvider } from './gpu-cloth/property-provider';
import { gpuClothRuntimeScriptSource } from './gpu-cloth/runtime-template';
import { isGPUClothHost } from './gpu-cloth/shared';
import { initSpringPropertyProvider } from './spring/property-provider';
import { springRuntimeScriptSource } from './spring/runtime-template';
import { isSpringHost } from './spring/shared';

const DEFAULT_GPU_CLOTH_SCRIPT_PATH = '/assets/scripts/gpucloth.ts';
const DEFAULT_SPRING_SCRIPT_PATH = '/assets/scripts/springtest.ts';

// 通过 ctx.project 访问当前工程的虚拟文件系统。
// 这里统一负责“确保脚本文件存在”，这样菜单项和右键挂载逻辑都可以复用同一套入口。
async function ensureProjectScript(
  ctx: Parameters<NonNullable<EditorPlugin['activate']>>[0],
  path: string,
  source: string
) {
  if (!ctx.editor.currentProject) {
    throw new Error('No project is currently open');
  }
  if (ctx.project.isReadOnly()) {
    throw new Error('Current project is read-only');
  }
  await ctx.project.ensureDirectory('/assets/scripts');
  if (!(await ctx.project.exists(path))) {
    await ctx.project.writeText(path, source);
  }
  return path;
}

// 挂载脚本时只设置脚本路径。
// 具体默认配置由脚本内部的 @scriptProp 装饰器声明负责，插件层不再手动注入 scriptConfig。
function initializeScriptHost(node: SceneNode, scriptPath: string) {
  node.script = scriptPath;
}

async function attachGPUClothToNode(ctx: Parameters<NonNullable<EditorPlugin['activate']>>[0], node: SceneNode) {
  const currentScript = String((node as any).script ?? '').trim();
  if (currentScript && !isGPUClothHost(node)) {
    throw new Error('Selected node already has a different script attached');
  }
  const path = await ensureProjectScript(ctx, DEFAULT_GPU_CLOTH_SCRIPT_PATH, gpuClothRuntimeScriptSource);
  initializeScriptHost(node, path);
  // 通过 PluginAPI 主动刷新属性面板，并把场景标记为已修改。
  ctx.refreshProperties();
  ctx.notifySceneChanged();
}

async function attachSpringToNode(ctx: Parameters<NonNullable<EditorPlugin['activate']>>[0], node: SceneNode) {
  const currentScript = String((node as any).script ?? '').trim();
  if (currentScript && !isSpringHost(node)) {
    throw new Error('Selected node already has a different script attached');
  }
  const path = await ensureProjectScript(ctx, DEFAULT_SPRING_SCRIPT_PATH, springRuntimeScriptSource);
  initializeScriptHost(node, path);
  ctx.refreshProperties();
  ctx.notifySceneChanged();
}

const plugin: EditorPlugin = {
  id: 'zephyr3d.character-dynamics-tools',
  name: 'Character Dynamics Tools',
  version: '1.0.0',
  description: 'Character spring and GPU cloth authoring tools implemented as an editor system plugin.',
  activate(ctx) {
    // 主菜单入口：用于创建或打开插件附带的运行时脚本模板。
    // 这里演示了最常见的 PluginAPI 用法之一：向编辑器主菜单注册顶级菜单项。
    ctx.registerMenuItems({
      location: 'main',
      items: [
        {
          id: 'zephyr3d.character-dynamics.menu',
          label: 'Character Dynamics Tools',
          subMenus: [
            {
              id: 'zephyr3d.character-dynamics.create-gpu-cloth-script',
              label: 'Create GPU Cloth Script...',
              enabled: () => !!ctx.editor.currentProject && !ctx.project.isReadOnly(),
              action: async () => {
                const path = await ensureProjectScript(ctx, DEFAULT_GPU_CLOTH_SCRIPT_PATH, gpuClothRuntimeScriptSource);
                await ctx.project.openCode(path, 'typescript');
              }
            },
            {
              id: 'zephyr3d.character-dynamics.create-spring-script',
              label: 'Create Spring Script...',
              enabled: () => !!ctx.editor.currentProject && !ctx.project.isReadOnly(),
              action: async () => {
                const path = await ensureProjectScript(ctx, DEFAULT_SPRING_SCRIPT_PATH, springRuntimeScriptSource);
                await ctx.project.openCode(path, 'typescript');
              }
            }
          ]
        }
      ]
    });

    // 场景树右键菜单入口：把脚本挂到当前节点，并复用同一个代码编辑器打开脚本文件。
    // items 使用函数形式，可以根据当前右键目标动态控制菜单文本和可用状态。
    ctx.registerMenuItems({
      location: 'scene-hierarchy',
      items: (menuCtx) => {
        const node = menuCtx.target instanceof SceneNode ? menuCtx.target : null;
        return [
          {
            id: 'zephyr3d.character-dynamics.attach-gpu-cloth',
            label: node && isGPUClothHost(node) ? 'Open GPU Cloth Script' : 'Attach GPU Cloth',
            visible: () => !!node,
            enabled: () => {
              if (!node || !ctx.editor.currentProject || ctx.project.isReadOnly()) {
                return false;
              }
              const currentScript = String((node as any).script ?? '').trim();
              return !currentScript || isGPUClothHost(node);
            },
            action: async () => {
              if (!node) {
                return;
              }
              if (!isGPUClothHost(node)) {
                await attachGPUClothToNode(ctx, node);
              }
              await ctx.project.openCode(
                String((node as any).script ?? DEFAULT_GPU_CLOTH_SCRIPT_PATH),
                'typescript'
              );
            }
          },
          {
            id: 'zephyr3d.character-dynamics.attach-spring',
            label: node && isSpringHost(node) ? 'Open Spring Script' : 'Attach Spring Dynamics',
            visible: () => !!node,
            enabled: () => {
              if (!node || !ctx.editor.currentProject || ctx.project.isReadOnly()) {
                return false;
              }
              const currentScript = String((node as any).script ?? '').trim();
              return !currentScript || isSpringHost(node);
            },
            action: async () => {
              if (!node) {
                return;
              }
              if (!isSpringHost(node)) {
                await attachSpringToNode(ctx, node);
              }
              await ctx.project.openCode(
                String((node as any).script ?? DEFAULT_SPRING_SCRIPT_PATH),
                'typescript'
              );
            }
          }
        ];
      }
    });

    // 下面三个初始化函数分别接入：
    // 1. GPU cloth 的属性面板扩展
    // 2. GPU cloth 的自定义编辑工具
    // 3. Spring 的属性扩展入口
    // 这类逻辑适合放在 activate() 中统一注册。
    initGPUClothPropertyProvider(ctx);
    initGPUClothPaintTool(ctx);
    initSpringPropertyProvider(ctx);
  }
};

export default plugin;
`;

export const characterDynamicsToolsPlugin: EditorPlugin = {
  id: 'zephyr3d.character-dynamics-tools',
  name: 'Character Dynamics Tools',
  version: '1.0.0',
  description: 'Character spring and GPU cloth authoring tools implemented as an editor system plugin.',
  activate() {}
};

export const characterDynamicsToolsPluginFiles: SystemPluginFileInput[] = [
  {
    path: 'index.ts',
    source: characterDynamicsToolsPluginSource
  },
  {
    path: 'gpu-cloth/property-provider.ts',
    source: gpuClothPropertyProviderSource
  },
  {
    path: 'gpu-cloth/paint-tool.ts',
    source: gpuClothPaintToolSource
  },
  {
    path: 'gpu-cloth/paint-command.ts',
    source: gpuClothPaintCommandSource
  },
  {
    path: 'gpu-cloth/runtime-template.ts',
    source: gpuClothRuntimeTemplateSource
  },
  {
    path: 'gpu-cloth/shared.ts',
    source: gpuClothSharedSource
  },
  {
    path: 'spring/property-provider.ts',
    source: springPropertyProviderSource
  },
  {
    path: 'spring/runtime-template.ts',
    source: springRuntimeTemplateSource
  },
  {
    path: 'spring/shared.ts',
    source: springSharedSource
  }
];
