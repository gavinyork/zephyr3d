# Zephyr3D Editor Desktop

This Electron shell is an additive desktop runtime for the existing browser editor.

- Browser builds keep using IndexedDB through `IndexedDBFS`.
- Desktop builds expose a constrained preload bridge at `window.zephyrEditorDesktop`.
- In desktop mode, editor metadata, system plugins, and projects are stored under Electron `app.getPath('userData')/editor-storage`.
- On packaged Windows zip builds, the app automatically switches `userData` to `<exe-dir>/userdata` when running from an unpacked writable folder without an installer uninstaller alongside it.
- Renderer code still talks to the existing `VFS` abstraction, so editor features do not need direct Node access.
- Electron builds now embed the MCP server in the same process. The MCP host runs in a worker thread and is exposed as a local TCP service using MCP Streamable HTTP.

Development:

```sh
npm run build --prefix utility/editor
npm run electron:start --prefix utility/editor
```

Windows development shortcut:

```sh
npm run electron:dev:install-shortcut --prefix utility/editor
```

This creates a desktop shortcut named `Zephyr3D Editor (Dev).lnk` that launches the development runtime without opening a terminal window.

Packaging:

```sh
npm run electron:dist --prefix utility/editor
```

## Agent MCP Usage

The Electron app is both:

- a desktop editor window
- and a local MCP HTTP server

The editor owns the MCP service lifecycle. Users launch the editor first, then point agent clients at the local MCP URL.

Recommended startup order for agents:

1. `initialize`
2. `tools/list`
3. `tools/call` with `editor_wait_ready`
4. `tools/call` with `editor_status`
5. then use `project_*`, `asset_*`, `editor_*`, `node_*`, `mesh_*`, `material_*`

If the agent skips `editor_wait_ready`, early editor tool calls may fail before the renderer finishes connecting to the embedded bridge.

## Editor Settings

Electron does not use a native application menu for MCP management anymore.

Use the in-editor ImGui menu instead:

- `Editor > Editor Settings...`

The service binds to `127.0.0.1` only. The default URL is:

```text
http://127.0.0.1:47231/mcp
```

MCP enablement and port changes persist under Electron `app.getPath('userData')`.

## Claude Desktop Example

If the client supports URL-based MCP servers, point it at the local editor endpoint. A typical JSON example is:

```json
{
  "mcpServers": {
    "zephyr-editor": {
      "url": "http://127.0.0.1:47231/mcp"
    }
  }
}
```

## Codex Example

`Codex` supports URL-based MCP servers. Example:

```toml
[mcp_servers.zephyr-editor]
url = "http://127.0.0.1:47231/mcp"
```

Equivalent CLI registration:

```sh
codex mcp add zephyr-editor --url http://127.0.0.1:47231/mcp
```

If the user changes the port in editor settings, the MCP client config must be updated to match.

## Optional Environment Variables

- `ZEPHYR_EDITOR_DEVICE=webgl2|webgpu`
- `ZEPHYR_EDITOR_DEVTOOLS=1`
- `ZEPHYR_PREVIEW_DEVTOOLS=1`
- `ZEPHYR_EDITOR_LOG_PATH=<absolute path>`
- `ZEPHYR_EDITOR_SCREENSHOT_PATH=<absolute path>`
- `ZEPHYR_EDITOR_PORTABLE=1`
- `ZEPHYR_EDITOR_PORTABLE_DIR=<absolute path>`

`ZEPHYR_EDITOR_PORTABLE=1` forces portable mode and stores user data under `<exe-dir>/userdata`.

`ZEPHYR_EDITOR_PORTABLE_DIR` overrides the portable data directory explicitly.

The log and screenshot variables are useful for automation and smoke tests.
