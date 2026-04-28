# Editor Plugins

## Overview

Editor plugins extend the Zephyr3d Editor itself. A plugin can add:

- Main menu items and context menu items
- Toolbar buttons
- Custom edit tools
- Custom property accessors
- Plugin settings and persistent state

The current UI entry is `Project -> Plugin Manager...`. Despite the name, this panel manages externally installed editor plugins stored in the editor's global database and shared by all local projects in the same browser profile.

---

## Installing Plugins

Open `Project -> Plugin Manager...`, then use one of the following actions:

- `Install...` to install a packaged plugin from a `.zip` file
- `Install Folder...` to install an unpacked plugin folder
- `New Template...` to generate a starter plugin package inside the editor

After a plugin is installed you can:

- Enable or disable it with the checkbox in the plugin list
- Open `Browse Files...` to inspect or edit plugin files
- Open `Install Package...` to add a third-party npm dependency
- Open `Settings...` if the plugin exposes a settings schema
- Remove the plugin from the editor

---

## Package Layout

The recommended format is a multi-file plugin package with a `plugin.json` manifest at the package root:

```text
my-editor-plugin/
  plugin.json
  index.ts
  icons/
    tool.svg
  utils/
    commands.ts
```

Example `plugin.json`:

```json
{
  "id": "com.example.demo-plugin",
  "name": "Demo Plugin",
  "version": "0.1.0",
  "description": "Example editor plugin for Zephyr3d.",
  "entry": "index.ts"
}
```

Manifest fields:

- `id`: required and must be unique
- `entry`: required, relative path to the plugin entry module
- `name`, `version`, `description`: optional but recommended
- `dependencies`: optional third-party packages used by the plugin

---

## Minimal Plugin

Import plugin types from `@zephyr3d/editor/editor-plugin` and export a default plugin definition:

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

## Plugin API

`EditorPluginContext` is the main entry point passed to `activate(ctx)`.

Common capabilities:

- `ctx.project`: read and write project files, create directories, open code files
- `ctx.system`: save plugin-global state and settings
- `ctx.ui`: show messages, confirmations, and project file/folder pickers
- `ctx.registerMenuItems(...)`: contribute menu items
- `ctx.registerToolbarItem(...)`: contribute toolbar buttons
- `ctx.registerEditTool(...)`: register custom scene edit tools
- `ctx.registerPropertyAccessors(...)`: extend the property panel
- `ctx.on(...)`: listen to editor events such as scene open, selection change, and node updates
- `ctx.log(...)`: write plugin logs

Menu contributions receive an `EditorMenuContext` with:

- `scene`: available in scene-related menus
- `assets`: available in asset browser menus
- `target`: the clicked node, file, or other target object

When you mutate scene data directly, call:

- `ctx.refreshProperties()`
- `ctx.notifySceneChanged()`

---

## Scene Commands

Scene-related operations should go through `EditorSceneContext.commands`.

Available helpers include:

- `addChildNode()`
- `addShapeNode()`
- `instantiatePrefab()`
- `deleteNode()`
- `reparentNode()`
- `cloneNode()`
- `executeCommand()`
- `executeUserCallback()`

This API is available from scene-aware contexts such as `menuCtx.scene` and `editCtx.scene`.

Example:

```ts
await menuCtx.scene.commands.executeCommand(new MyCustomCommand(...));
```

For quick undoable operations without a dedicated command class:

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

## Settings And State

Plugins can declare a settings schema on the definition:

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

At runtime:

- `ctx.system.getSettings()` / `ctx.system.saveSettings()` store plugin-global settings
- `ctx.system.getState()` / `ctx.system.saveState()` store plugin-global state data
- `ctx.project.getSettings()` / `ctx.project.saveSettings()` store project-specific data

Use system settings for values shared across projects, and project settings for values that belong to the current project.

---

## Third-Party Packages

If a plugin needs an npm package:

1. Open `Project -> Plugin Manager...`
2. Select the plugin
3. Click `Install Package...`
4. Enter a package spec such as `nanoid` or `nanoid@5`

After installation you can import the package directly:

```ts
import { nanoid } from 'nanoid';
```

Installed package versions are tracked in `plugin.json` under `dependencies`.

