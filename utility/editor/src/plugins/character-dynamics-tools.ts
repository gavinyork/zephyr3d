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

export const characterDynamicsToolsPluginSource = `import OSS from 'ali-oss';
import type { EditorPlugin } from '@zephyr3d/editor/editor-plugin';
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

// 统一确保运行时脚本存在，主菜单和右键菜单都复用这一个入口。
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

type OSSPluginSettings = {
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  endpoint?: string;
  prefix?: string;
};

async function getOSSSettings(ctx: Parameters<NonNullable<EditorPlugin['activate']>>[0]) {
  return ((await ctx.system.getSettings<OSSPluginSettings>()) ?? {}) as OSSPluginSettings;
}

// OSS 导出逻辑放在插件内，便于业务方后续继续维护上传流程。
async function exportProjectToOSS(ctx: Parameters<NonNullable<EditorPlugin['activate']>>[0]) {
  if (!ctx.editor.currentProject) {
    await ctx.ui.message('Export to OSS', 'No project is currently open.');
    return;
  }

  const settings = await getOSSSettings(ctx);
  const region = settings.region?.trim() ?? '';
  const bucket = settings.bucket?.trim() ?? '';
  const accessKeyId = settings.accessKeyId?.trim() ?? '';
  const accessKeySecret = settings.accessKeySecret?.trim() ?? '';
  const endpoint = settings.endpoint?.trim() ?? '';
  const prefix = settings.prefix?.trim() ?? '';

  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    await ctx.ui.message(
      'Export to OSS',
      'OSS not configured. Open the plugin manager and configure Character Dynamics Tools settings first.'
    );
    return;
  }

  const folders = await ctx.ui.selectProjectFolders('Export to OSS', '/assets', true, 520, 620);
  console.log(folders);

  const selectedPaths = await ctx.ui.selectProjectFiles('Export to OSS', '/assets', true, null, 520, 620);
  if (!selectedPaths || selectedPaths.length === 0) {
    return;
  }

  const confirmed = await ctx.ui.confirm(
    'Export to OSS',
    \`Upload \${selectedPaths.length} item(s) to OSS?\`,
    'Upload',
    'Cancel'
  );
  if (!confirmed) {
    return;
  }

  const client = new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    endpoint: endpoint || undefined
  });
  const prefixStr = prefix ? prefix.replace(/^\\/+|\\/+$/g, '') + '/' : '';
  let uploaded = 0;

  for (const file of selectedPaths) {
    const filePath = file.meta.path;
    const content = await ctx.project.readBinary(filePath);
    const relativePath = filePath.replace(/^\\/+/, '');
    const objectKey = \`\${prefixStr}\${relativePath}\`;
    await client.put(objectKey, new Blob([content]));
    uploaded++;
    ctx.log(\`[OSS] uploaded \${uploaded}/\${selectedPaths.length}: \${objectKey}\`);
  }

  await ctx.ui.message('Export to OSS', \`Upload complete: \${uploaded} file(s) uploaded.\`);
}

// 脚本默认配置由运行时脚本内部的 @scriptProp 装饰器声明负责。
function listNodeScripts(node: SceneNode) {
  const attachments = Array.isArray((node as any).scripts)
    ? ((node as any).scripts as { script?: string }[])
    : [];
  return attachments.map((item) => String(item?.script ?? '').trim()).filter((item) => !!item);
}

function initializeScriptHost(node: SceneNode, scriptPath: string) {
  const attachments = Array.isArray((node as any).scripts) ? [...((node as any).scripts as any[])] : [];
  if (!attachments.some((item) => String(item?.script ?? '').trim() === scriptPath)) {
    attachments.push({ script: scriptPath, config: null });
    (node as any).scripts = attachments;
  }
}

async function attachGPUClothToNode(ctx: Parameters<NonNullable<EditorPlugin['activate']>>[0], node: SceneNode) {
  const path = await ensureProjectScript(ctx, DEFAULT_GPU_CLOTH_SCRIPT_PATH, gpuClothRuntimeScriptSource);
  initializeScriptHost(node, path);
  ctx.refreshProperties();
  ctx.notifySceneChanged();
}

async function attachSpringToNode(ctx: Parameters<NonNullable<EditorPlugin['activate']>>[0], node: SceneNode) {
  const path = await ensureProjectScript(ctx, DEFAULT_SPRING_SCRIPT_PATH, springRuntimeScriptSource);
  initializeScriptHost(node, path);
  ctx.refreshProperties();
  ctx.notifySceneChanged();
}

const plugin: EditorPlugin = {
  id: 'zephyr3d.character-dynamics-tools',
  name: 'Character Dynamics Tools',
  version: '1.0.0',
  description: 'Character spring, GPU cloth, and OSS export tools implemented as an editor system plugin.',
  settings: {
    region: {
      type: 'string',
      label: 'OSS Region',
      description: 'Alibaba Cloud OSS region, for example oss-cn-hangzhou.'
    },
    bucket: {
      type: 'string',
      label: 'OSS Bucket',
      description: 'Target OSS bucket name.'
    },
    accessKeyId: {
      type: 'string',
      label: 'Access Key ID',
      description: 'OSS access key id used for upload.',
      secret: true
    },
    accessKeySecret: {
      type: 'string',
      label: 'Access Key Secret',
      description: 'OSS access key secret used for upload.',
      secret: true
    },
    endpoint: {
      type: 'string',
      label: 'OSS Endpoint',
      description: 'Optional custom endpoint. Leave empty to use the default endpoint.'
    },
    prefix: {
      type: 'string',
      label: 'Object Key Prefix',
      description: 'Optional prefix added before uploaded asset paths.'
    }
  },
  activate(ctx) {
    // 主菜单入口，统一放在插件自己的顶级菜单下。
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
            },
            {
              id: 'zephyr3d.character-dynamics.export-oss',
              label: 'Export to OSS...',
              enabled: () => !!ctx.editor.currentProject,
              action: async () => {
                await exportProjectToOSS(ctx);
              }
            }
          ]
        }
      ]
    });

    // 右键菜单用于把脚本挂到当前节点，并复用同一套脚本打开逻辑。
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
              return !listNodeScripts(node).length || isGPUClothHost(node) || true;
            },
            action: async () => {
              if (!node) {
                return;
              }
              if (!isGPUClothHost(node)) {
                await attachGPUClothToNode(ctx, node);
              }
              await ctx.project.openCode(
                listNodeScripts(node).find((item) => item === DEFAULT_GPU_CLOTH_SCRIPT_PATH) ??
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
              return !listNodeScripts(node).length || isSpringHost(node) || true;
            },
            action: async () => {
              if (!node) {
                return;
              }
              if (!isSpringHost(node)) {
                await attachSpringToNode(ctx, node);
              }
              await ctx.project.openCode(
                listNodeScripts(node).find((item) => item === DEFAULT_SPRING_SCRIPT_PATH) ??
                  String((node as any).script ?? DEFAULT_SPRING_SCRIPT_PATH),
                'typescript'
              );
            }
          }
        ];
      }
    });

    // 插件激活时统一注册属性扩展和 GPU cloth 专用编辑工具。
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
  description: 'Character spring, GPU cloth, and OSS export tools implemented as an editor system plugin.',
  settings: {
    region: {
      type: 'string',
      label: 'OSS Region',
      description: 'Alibaba Cloud OSS region, for example oss-cn-hangzhou.'
    },
    bucket: {
      type: 'string',
      label: 'OSS Bucket',
      description: 'Target OSS bucket name.'
    },
    accessKeyId: {
      type: 'string',
      label: 'Access Key ID',
      description: 'OSS access key id used for upload.',
      secret: true
    },
    accessKeySecret: {
      type: 'string',
      label: 'Access Key Secret',
      description: 'OSS access key secret used for upload.',
      secret: true
    },
    endpoint: {
      type: 'string',
      label: 'OSS Endpoint',
      description: 'Optional custom endpoint. Leave empty to use the default endpoint.'
    },
    prefix: {
      type: 'string',
      label: 'Object Key Prefix',
      description: 'Optional prefix added before uploaded asset paths.'
    }
  },
  activate() {}
};

export const characterDynamicsToolsPluginDependencies = {
  'ali-oss': '^6.21.0'
} as const;

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
