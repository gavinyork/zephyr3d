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

## Headless Mode

Two headless modes are available for automation and agent workflows:

### One-shot capture (automated testing / golden images)

```sh
electron . --headless --project <id> --screenshot <out.png> [options]
```

Boots a hidden window, opens the project in preview mode (runtime scripts enabled),
renders exactly N deterministic frames with a fixed timestep, writes the PNG and exits.

Options: `--scene <vfs-path>` (default: project startup scene), `--frames <N>` (default 64),
`--fixed-dt <ms>` (default 16.6667; `0` = wall clock), `--width`/`--height` (default 1280x720),
`--device webgpu|webgl2|webgl`, `--timeout <ms>` (default 120000).

Exit codes: `0` success, `1` failure, `2` usage error, `4` timeout, `5` renderer crash/load failure.
A sidecar log is written to `<out.png>.log` (unless `ZEPHYR_EDITOR_LOG_PATH` is set).
This supersedes the `ZEPHYR_EDITOR_SCREENSHOT_PATH` smoke-test flow for capture purposes.

In dev mode the same flags pass through the dev runner:

```sh
npm run electron:dev -- --headless --project <id> --frames 64 --screenshot out.png
```

### Persistent headless MCP service (agent workflows)

```sh
electron . --headless [--mcp-port <port>] [--width <px>] [--height <px>] [--device <rhi>]
```

Runs the full editor with a hidden window; all MCP tools work exactly as in interactive
mode. With `--mcp-port` the TCP MCP service is force-enabled on that port and startup
fails hard (exit 1) if the port is taken. The hidden window's frame loop is paced by
timers (~60fps) because rAF never fires for windows that were never shown.

Notes:

- Headless runs skip the single-instance lock and can execute beside an interactive
  editor (Chromium session data is isolated per run). Concurrent writes to the same
  project from two instances are unsupported.
- Screenshots ride the next real frame; per-frame engine state (history ping-pong,
  frame counter) advances exactly once per frame, never extra for a capture.
- Deterministic captures are near-pixel-identical across runs on the same machine
  (async asset arrival can leave sub-LSB temporal residue at edges); golden-image
  comparison should use per-machine baselines with a small tolerance.

## Optional Environment Variables

- `ZEPHYR_EDITOR_DEVICE=webgl2|webgpu`
- `ZEPHYR_EDITOR_DEVTOOLS=1`
- `ZEPHYR_EDITOR_LOG_PATH=<absolute path>`
- `ZEPHYR_EDITOR_SCREENSHOT_PATH=<absolute path>`
- `ZEPHYR_EDITOR_PORTABLE=1`
- `ZEPHYR_EDITOR_PORTABLE_DIR=<absolute path>`

`ZEPHYR_EDITOR_PORTABLE=1` forces portable mode and stores user data under `<exe-dir>/userdata`.

`ZEPHYR_EDITOR_PORTABLE_DIR` overrides the portable data directory explicitly.

The log and screenshot variables are useful for automation and smoke tests.
