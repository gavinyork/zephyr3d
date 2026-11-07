# @zephyr3d/editor

`@zephyr3d/editor` is the Zephyr3D visual editor package.

It contains:

- the browser-based editor application
- the Electron desktop shell
- the embedded MCP server used by desktop builds
- the public TypeScript types for authoring editor plugins

The editor is built on top of the Zephyr3D engine packages and is intended for scene editing, asset management, scripting, terrain editing, material editing, and automation workflows.

## Highlights

- Browser-first visual editor built with TypeScript
- Scene, material, terrain, and scripting workflows in one package
- Electron desktop runtime for local projects and persistent storage
- Embedded local MCP service for agent-driven automation
- Plugin API for menus, toolbars, edit tools, property panels, and custom scene helpers

## Package Layout

- `src/`: editor source code
- `electron/`: Electron main/preload code
- `mcp/`: embedded MCP server entry
- `dist/`: build output

## Development

Build the editor:

```sh
rush build --to editor
```

Serve the browser build locally after building:

```sh
npm run serve --prefix utility/editor
```

Build and launch the Electron desktop app for development:

```sh
npm run electron:dev --prefix utility/editor
```

Install a Windows desktop shortcut for the development runtime:

```sh
npm run electron:dev:install-shortcut --prefix utility/editor
```

Launch the development runtime through the shortcut-compatible launcher:

```sh
npm run electron:dev:launch --prefix utility/editor
```

Launch the Electron app from an existing build:

```sh
npm run electron:start --prefix utility/editor
```

Create a packaged desktop build:

```sh
npm run electron:dist --prefix utility/editor
```

## Desktop Runtime

The Electron build is an additive desktop runtime for the browser editor.

- Browser builds continue to use the existing VFS abstraction and browser storage.
- Desktop builds expose a constrained preload bridge instead of direct Node.js access in renderer code.
- Editor metadata, system plugins, and local projects are stored under Electron `app.getPath('userData')/editor-storage`.

## Windows Dev Shortcut

The Windows development shortcut launches `utility/editor/scripts/launch-electron-dev.ps1`, which starts the same dev runtime as `npm run electron:dev`.

- The first launch starts the Vite dev server and the Electron shell in the background.
- Launching the shortcut again reuses the existing dev runtime when it is already running.
- If the editor window was closed accidentally while the dev runtime is still alive, launching the shortcut again opens a new Electron window against the same dev server.
- Runtime state and launcher logs are stored under `%LOCALAPPDATA%\Zephyr3DEditor\dev-runtime`. If that location is not writable, the launcher falls back to `utility/editor/.dev-runtime`.

Development shortcut update behavior:

- Changes under `utility/editor/src` update through the Vite dev server, usually with HMR or an automatic page reload.
- Changes under `utility/editor/electron`, `utility/editor/mcp`, and `utility/editor/package.json` trigger an Electron process restart.
- Changes under `libs/base`, `libs/device`, `libs/scene`, `libs/loaders`, `libs/backend-webgl`, and `libs/backend-webgpu` are wired to source in dev mode and should refresh into the running desktop editor.
- Packaged desktop builds created by `npm run electron:dist` do not track source changes automatically. Rebuild or repackage them after code changes.

## MCP Integration

Desktop builds embed a local MCP HTTP server in the same process as the editor.

- Default endpoint: `http://127.0.0.1:47231/mcp?token=<token>`
- The service binds to `127.0.0.1` only and requires the per-installation token, as the `token` query parameter or an `Authorization: Bearer <token>` header
- MCP settings are managed from `Help > Editor Settings...`, whose "Copy MCP URL" copies the full URL with the token

This makes the editor usable both as an interactive desktop tool and as an automation target for agent clients.

## Plugin API

This package also exposes the public plugin authoring types at:

```ts
import type { EditorPlugin } from '@zephyr3d/editor/editor-plugin';
```

If you are building an editor plugin outside this repository, install the package as a development dependency:

```sh
npm install --save-dev @zephyr3d/editor
```

Minimal plugin example:

```ts
import type { EditorPlugin } from '@zephyr3d/editor/editor-plugin';

const plugin: EditorPlugin = {
  id: 'com.example.editor-plugin',
  name: 'Example Editor Plugin',
  version: '0.1.0',
  activate(ctx) {
    ctx.registerMenuItems({
      location: 'main',
      parentId: 'project',
      items: [
        {
          id: 'example-editor-plugin.about',
          label: 'Example Plugin...',
          action: async () => {
            await ctx.ui.message(
              'Example Plugin',
              'This command is provided by a system plugin.'
            );
          }
        }
      ]
    });
  }
};

export default plugin;
```

The plugin API supports:

- main menu and context menu contributions
- toolbar contributions
- custom edit tools
- node proxy factories
- custom property accessors
- project storage and system plugin state/settings
- editor event subscriptions

### Desktop Plugin Development

The Electron desktop editor supports linking a plugin root directory directly for source-based development.

Recommended development setup:

- Keep a `plugin.dev.json` at the plugin root for desktop development
- Point its `entry` to a source file such as `src/index.ts`
- Declare third-party runtime packages in `plugin.dev.json.dependencies`
- Use `Project -> Plugin Manager... -> Link...` and choose the plugin root directory
- After editing source files, click `Refresh` in Plugin Manager to reload the linked plugin

In this mode:

- the editor loads plugin source directly instead of requiring a prebuilt `dist`
- missing third-party dependencies are cached under the plugin's local `libs/deps/`
- plugin refresh validates the manifest and entry dependency graph instead of scanning the entire plugin folder

For release builds, continue using the packaged `plugin.json` and built `dist` output.

## Related Links

- Repository: https://github.com/gavinyork/zephyr3d
- Documentation: https://zephyr3d.org/doc/
- Online editor: https://zephyr3d.org/editor/

## License

MIT
