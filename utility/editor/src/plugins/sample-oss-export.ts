import type { EditorPlugin } from '@zephyr3d/editor/editor-plugin';
export const sampleOSSExportPlugin: EditorPlugin = {
  id: 'zephyr3d.sample.oss-export',
  name: 'Sample OSS Export',
  version: '1.0.0',
  description: 'Example system plugin that contributes the Export to OSS menu item.',
  activate(ctx) {
    ctx.registerMenuItems({
      location: 'main',
      parentId: 'project',
      items: [
        {
          id: 'sample-export-oss',
          label: 'Export to OSS...',
          enabled: ({ scene }) => !!scene?.editor.currentProject,
          action: async () => {
            const projectName = ctx.editor.currentProject?.name ?? 'Current Project';
            await ctx.ui.message(
              'Export to OSS',
              [
                `This menu item is now provided by the sample plugin 'zephyr3d.sample.oss-export'.`,
                '',
                `Project: ${projectName}`,
                '',
                'Use this plugin as the integration point for your business-specific upload flow,',
                'such as STS credential exchange, object storage path rules, manifest generation,',
                'and post-upload URL publishing.'
              ].join('\n'),
              520,
              0
            );
          }
        }
      ]
    });
  }
};

export const sampleOSSExportPluginSource = `import type { EditorPlugin } from '@zephyr3d/editor/editor-plugin';

const plugin: EditorPlugin = {
  id: 'zephyr3d.sample.oss-export',
  name: 'Sample OSS Export',
  version: '1.0.0',
  description: 'Example system plugin that contributes the Export to OSS menu item.',
  activate(ctx) {
    ctx.registerMenuItems({
      location: 'main',
      parentId: 'project',
      items: [
        {
          id: 'sample-export-oss',
          label: 'Export to OSS...',
          enabled: ({ scene }) => !!scene?.editor.currentProject,
          action: async () => {
            const projectName = ctx.editor.currentProject?.name ?? 'Current Project';
            await ctx.ui.message(
              'Export to OSS',
              [
                "This menu item is now provided by the sample plugin 'zephyr3d.sample.oss-export'.",
                '',
                \`Project: \${projectName}\`,
                '',
                'Use this plugin as the integration point for your business-specific upload flow,',
                'such as STS credential exchange, object storage path rules, manifest generation,',
                'and post-upload URL publishing.'
              ].join('\\n'),
              520,
              0
            );
          }
        }
      ]
    });
  }
};

export default plugin;
`;
