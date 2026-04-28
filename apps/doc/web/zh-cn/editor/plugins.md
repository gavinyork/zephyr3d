# 编辑器插件

## 概述

编辑器插件用于扩展 Zephyr3d Editor 本身。一个插件可以添加：

- 主菜单和右键菜单项
- 工具栏按钮
- 自定义编辑工具
- 自定义属性面板访问器
- 插件设置与持久化状态

当前界面入口是 `Project -> Plugin Manager...`，用于管理安装的所有编辑器插件；这些插件保存在编辑器的全局数据库中，并在同一浏览器配置下对所有本地项目可见。

---

## 安装与管理

打开 `Project -> Plugin Manager...`，然后可以使用以下操作：

- `Install...`：从 `.zip` 插件包安装
- `Install Folder...`：从未打包的插件目录安装
- `New Template...`：在编辑器里生成一个起步模板插件

插件安装后，可以继续：

- 通过插件列表前的复选框启用或禁用
- 使用 `Browse Files...` 查看和编辑插件文件
- 使用 `Install Package...` 安装第三方 npm 依赖
- 使用 `Settings...` 配置插件暴露出的设置项
- 将插件从编辑器中移除

---

## 插件目录结构

推荐使用带 `plugin.json` 清单文件的多文件插件包，清单位于插件根目录：

```text
my-editor-plugin/
  plugin.json
  index.ts
  icons/
    tool.svg
  utils/
    commands.ts
```

示例 `plugin.json`：

```json
{
  "id": "com.example.demo-plugin",
  "name": "Demo Plugin",
  "version": "0.1.0",
  "description": "Example editor plugin for Zephyr3d.",
  "entry": "index.ts"
}
```

清单字段说明：

- `id`：必填，且必须全局唯一
- `entry`：必填，表示插件入口模块的相对路径
- `name`、`version`、`description`：可选，但建议填写
- `dependencies`：可选，声明插件使用的第三方包

---

## 最小插件示例

从 `@zephyr3d/editor/editor-plugin` 导入插件类型，并默认导出插件定义：

```ts
import type { EditorPluginDefinition } from '@zephyr3d/editor/editor-plugin';
import { SceneNode } from '@zephyr3d/scene';

const plugin: EditorPluginDefinition = {
  activate(ctx) {
    ctx.registerMenuItems({
      location: 'main',
      items: [
        {
          id: 'com.example.demo-plugin.menu',
          label: 'Demo Plugin',
          subMenus: [
            {
              id: 'com.example.demo-plugin.about',
              label: 'About...',
              action: async () => {
                await ctx.ui.message('Demo Plugin', 'The plugin is active.');
              }
            }
          ]
        }
      ]
    });

    ctx.registerMenuItems({
      location: 'scene-hierarchy',
      items: (menuCtx) => [
        {
          id: 'com.example.demo-plugin.add-empty-child',
          label: 'Add Empty Child',
          visible: () => menuCtx.target instanceof SceneNode,
          action: async () => {
            if (!(menuCtx.target instanceof SceneNode) || !menuCtx.scene) {
              return;
            }
            await menuCtx.scene.commands.addChildNode(menuCtx.target, SceneNode);
            menuCtx.scene.refreshProperties();
            menuCtx.scene.notifySceneChanged();
          }
        }
      ]
    });
  }
};

export default plugin;
```

---

## 插件 API

`EditorPluginContext` 是传给 `activate(ctx)` 的主入口对象。

常用能力包括：

- `ctx.project`：读写项目文件、创建目录、打开代码文件
- `ctx.system`：保存插件级的全局状态与设置
- `ctx.ui`：显示消息框、确认框，以及项目文件/目录选择器
- `ctx.registerMenuItems(...)`：注册菜单项
- `ctx.registerToolbarItem(...)`：注册工具栏按钮
- `ctx.registerEditTool(...)`：注册自定义场景编辑工具
- `ctx.registerPropertyAccessors(...)`：扩展属性面板
- `ctx.on(...)`：监听编辑器事件，例如场景打开、选择变化、节点变化
- `ctx.log(...)`：输出插件日志

菜单贡献函数会收到 `EditorMenuContext`，其中包含：

- `scene`：场景相关菜单里可用
- `assets`：资源浏览器相关菜单里可用
- `target`：当前被点击的节点、文件或其他目标对象

如果你直接修改了场景数据，记得调用：

- `ctx.refreshProperties()`
- `ctx.notifySceneChanged()`

---

## 场景命令

涉及场景结构或可撤销编辑时，建议通过 `EditorSceneContext.commands` 操作。

内置命令辅助方法包括：

- `addChildNode()`
- `addShapeNode()`
- `instantiatePrefab()`
- `deleteNode()`
- `reparentNode()`
- `cloneNode()`
- `executeCommand()`
- `executeUserCallback()`

这个 API 会出现在带场景语义的上下文里，例如 `menuCtx.scene` 和 `editCtx.scene`。

示例：

```ts
await menuCtx.scene.commands.executeCommand(new MyCustomCommand(...));
```

如果只是一次临时的可撤销操作，也可以直接使用：

```ts
await menuCtx.scene.commands.executeUserCallback(
  async () => {
    target.visible = false;
  },
  async () => {
    target.visible = true;
  }
);
```

---

## 设置与状态

插件可以在定义对象上声明设置结构：

```ts
const plugin: EditorPluginDefinition = {
  settings: {
    endpoint: {
      type: 'string',
      label: 'API Endpoint',
      description: 'Base URL used by the plugin.'
    },
    autoSync: {
      type: 'boolean',
      label: 'Auto Sync',
      default: true
    }
  },
  activate(ctx) {
    // ...
  }
};
```

运行时可用：

- `ctx.system.getSettings()` / `ctx.system.saveSettings()`：保存插件级全局设置
- `ctx.system.getState()` / `ctx.system.saveState()`：保存插件级全局状态
- `ctx.project.getSettings()` / `ctx.project.saveSettings()`：保存项目级数据

跨项目共享的配置适合放在 `ctx.system`，只属于当前项目的数据适合放在 `ctx.project`。

---

## 第三方包

如果插件需要 npm 包：

1. 打开 `Project -> Plugin Manager...`
2. 选中目标插件
3. 点击 `Install Package...`
4. 输入包名或版本声明，例如 `nanoid` 或 `nanoid@5`

安装完成后即可直接导入：

```ts
import { nanoid } from 'nanoid';
```

已安装包的版本会同步记录到 `plugin.json` 的 `dependencies` 字段中。

