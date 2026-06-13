# Desktop Editor

Zephyr3d Editor is available as a browser application and as an Electron desktop runtime. The desktop editor uses the same UI and project workflow, but adds local file-system integration, system plugin directories, an MCP service, and built-in LLM chat.

Use the browser build for quick access and lightweight editing. Use the desktop build for real project work, automation, and AI-assisted editing.

## Running It

Start the desktop editor in a development checkout:

```sh
npm run electron:start --prefix utility/editor
```

Build a packaged desktop app:

```sh
npm run electron:dist --prefix utility/editor
```

On Windows, a development desktop shortcut can be installed with:

```sh
npm run electron:dev:install-shortcut --prefix utility/editor
```

The desktop runtime exposes a constrained preload bridge at `window.zephyrEditorDesktop`. Renderer code still uses the editor VFS abstraction, so editor features do not need direct Node.js access.

## Local Projects and Plugins

In the browser build, project and editor data are primarily stored in IndexedDB. In the desktop build, editor metadata, system plugins, and project data are stored under Electron `app.getPath('userData')` by default.

The desktop runtime supports:

- Creating or opening projects from local directories.
- Revealing assets in the system file manager from the content browser.
- Using the local file system as the project VFS.
- Linking local system plugin directories for plugin development and debugging.

This makes the desktop editor a better fit for source repositories, asset folders, build scripts, and version-control workflows.

## MCP Service

The desktop editor embeds an MCP service. After the app starts, the Electron main process manages an MCP worker and exposes it to external MCP clients through a local HTTP service.

Default MCP URL:

```text
http://127.0.0.1:47231/mcp
```

The MCP service binds only to `127.0.0.1`. Use `Editor > Editor Settings...` to enable or disable the service, change the port, and copy the MCP URL. Enablement and port settings are persisted under Electron user data.

Recommended startup order for external agents:

1. `initialize`
2. `tools/list`
3. call `editor_wait_ready`
4. call `editor_status`
5. then use `project_*`, `asset_*`, `editor_*`, `node_*`, `mesh_*`, `material_*`, and related tools

If a client calls editor tools before the editor window has connected to the MCP bridge, early calls may fail. Automation clients should wait for `editor_wait_ready` first.

### Codex Example

```toml
[mcp_servers.zephyr-editor]
url = "http://127.0.0.1:47231/mcp"
```

Equivalent CLI command:

```sh
codex mcp add zephyr-editor --url http://127.0.0.1:47231/mcp
```

### Claude Desktop Example

```json
{
  "mcpServers": {
    "zephyr-editor": {
      "url": "http://127.0.0.1:47231/mcp"
    }
  }
}
```

If the port is changed in editor settings, update the external MCP client configuration as well.

## LLM Chat

The desktop build includes an `Assistant` tab in the bottom panel for project-aware LLM chat. This feature is available only in the desktop runtime; the browser build does not provide the local LLM chat bridge.

LLM settings are available under `Editor > Editor Settings...`:

| Setting | Meaning |
| --- | --- |
| `Provider` | OpenAI or a custom OpenAI-compatible service. The Anthropic entry is reserved, but the embedded Assistant does not implement it yet |
| `Base URL` | LLM endpoint. OpenAI-compatible services usually use the `/v1` root, or a direct `/chat/completions` URL |
| `Model` | Model name |
| `Temperature` | Response randomness |
| `Max Output Tokens` | Maximum output length per response |
| `Enable Tool Calling` | Allow the model to call editor tools |
| `Require Tool Approval` | Require user approval before tool calls execute |
| `API Key` | Store the API key for the selected provider |

API keys are stored by the Electron main process and are not written into project files. When tool calling is enabled, the Assistant can operate on the current project context, such as querying project state, reading assets, creating nodes, editing materials, or running supported generation tasks. When `Require Tool Approval` is enabled, tool calls appear in the Assistant timeline and wait for user approval or rejection.

## Guidance

- Use the Web build for quick browsing, demos, and documentation workflows.
- Use the desktop build for real project work, local directory access, plugin development, and automation.
- Before connecting an external agent, confirm that the MCP service is Running in desktop editor settings.
- Keep tool approval enabled when using LLM chat to modify a project, especially before bulk asset creation, deletion, or overwrite operations.
