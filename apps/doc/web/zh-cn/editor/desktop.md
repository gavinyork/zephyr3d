# 桌面编辑器

Zephyr3d Editor 除了浏览器版本，也提供基于 Electron 的桌面运行环境。桌面版复用同一套编辑器 UI 和项目工作流，但额外提供本地文件系统、系统插件目录、MCP 服务和内置 LLM Chat 能力。

浏览器版本适合快速体验和轻量编辑；桌面版本更适合真实项目开发、自动化集成和 AI 辅助编辑。

## 运行方式

开发环境中可以通过以下命令启动桌面编辑器：

```sh
npm run electron:start --prefix utility/editor
```

打包桌面应用：

```sh
npm run electron:dist --prefix utility/editor
```

Windows 开发环境也可以创建桌面快捷方式：

```sh
npm run electron:dev:install-shortcut --prefix utility/editor
```

桌面版通过受限的 preload bridge 暴露 `window.zephyrEditorDesktop`，渲染进程仍然通过编辑器的 VFS 抽象访问数据，不需要业务代码直接访问 Node.js API。

## 本地项目与插件

在浏览器版本中，项目和编辑器数据主要保存在 IndexedDB 中。桌面版本会把编辑器元数据、系统插件和项目数据保存到 Electron 的用户数据目录下，默认位置由 `app.getPath('userData')` 决定。

桌面运行时支持：

- 选择本地目录创建或打开项目。
- 在内容浏览器中通过系统文件管理器定位资源。
- 使用本地文件系统作为项目 VFS。
- 连接本地系统插件目录，便于插件开发和调试。

这使桌面编辑器更适合和现有源码仓库、素材目录、构建脚本以及版本控制流程配合使用。

## MCP 服务

桌面编辑器内置 MCP 服务。应用启动后，Electron 主进程会管理 MCP worker，并通过本地 HTTP 服务暴露给支持 MCP 的外部客户端。

默认 MCP 地址：

```text
http://127.0.0.1:47231/mcp
```

MCP 服务只绑定到 `127.0.0.1`。可以在编辑器菜单 `Editor > Editor Settings...` 中启用或关闭服务、修改端口，并复制 MCP URL。启用状态和端口配置会保存在 Electron 用户数据目录中。

推荐的外部 Agent 连接顺序：

1. `initialize`
2. `tools/list`
3. 调用 `editor_wait_ready`
4. 调用 `editor_status`
5. 再使用 `project_*`、`asset_*`、`editor_*`、`node_*`、`mesh_*`、`material_*` 等工具

如果客户端在编辑器窗口尚未连接 MCP bridge 时就调用编辑器工具，早期调用可能失败。因此自动化客户端应先等待 `editor_wait_ready`。

### Codex 配置示例

```toml
[mcp_servers.zephyr-editor]
url = "http://127.0.0.1:47231/mcp"
```

等价命令：

```sh
codex mcp add zephyr-editor --url http://127.0.0.1:47231/mcp
```

### Claude Desktop 配置示例

```json
{
  "mcpServers": {
    "zephyr-editor": {
      "url": "http://127.0.0.1:47231/mcp"
    }
  }
}
```

如果在编辑器设置中修改了端口，外部 MCP 客户端配置也需要同步更新。

## LLM Chat

桌面版底部面板包含 `Assistant` 标签页，用于和 LLM 进行项目上下文相关的对话。该功能只在桌面运行时可用，浏览器版本不会直接提供本地 LLM Chat 能力。

LLM 配置位于 `Editor > Editor Settings...`：

| 设置 | 含义 |
| --- | --- |
| `Provider` | 当前可使用 OpenAI 或自定义 OpenAI-compatible 服务；Anthropic 入口保留但嵌入式 Assistant 尚未实现 |
| `Base URL` | LLM 服务入口。OpenAI-compatible 服务通常使用 `/v1` 根地址，或直接填写 `/chat/completions` 地址 |
| `Model` | 使用的模型名称 |
| `Temperature` | 回复随机性 |
| `Max Output Tokens` | 单次回复最大输出长度 |
| `Enable Tool Calling` | 允许模型调用编辑器工具 |
| `Require Tool Approval` | 工具调用前要求用户确认 |
| `API Key` | 保存当前 provider 的密钥 |

API Key 由 Electron 主进程保存，不写入项目文件。启用工具调用后，Assistant 可以围绕当前项目执行编辑器操作，例如查询项目、读取资源、创建节点、修改材质或运行受支持的生成任务。开启 `Require Tool Approval` 时，涉及工具调用的步骤会先出现在 Assistant 时间线中，等待用户批准或拒绝。

## 使用建议

- 普通浏览和文档体验优先使用 Web 版本。
- 真实项目开发、需要本地目录访问、插件开发或自动化控制时使用桌面版本。
- 连接外部 Agent 前先在桌面编辑器设置中确认 MCP 服务处于 Running 状态。
- 使用 LLM Chat 修改项目时建议开启工具审批，尤其是在批量创建、删除或覆盖资产前。
