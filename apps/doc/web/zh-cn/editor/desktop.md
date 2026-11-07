# 桌面编辑器

Zephyr3d Editor 除了浏览器版本，也提供基于 Electron 的桌面运行环境。桌面版复用同一套编辑器 UI 和项目工作流，但额外提供本地文件系统、系统插件目录、MCP 服务和内置 LLM Chat 能力。

浏览器版本适合快速体验和轻量编辑；桌面版本更适合真实项目开发、自动化集成和 AI 辅助编辑。

## 运行方式

桌面版安装包可以从 [GitHub Releases](https://github.com/gavinyork/zephyr3d/releases) 下载。

### 从源码运行（开发者）

需要完整的仓库，并先构建编辑器（`npm run build --prefix utility/editor`），再启动桌面编辑器：

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

在浏览器版本中，项目和编辑器数据主要保存在 IndexedDB 中。桌面版本会把编辑器元数据、系统插件和项目数据保存到 Electron 用户数据目录下的 `editor-storage` 中（`app.getPath('userData')/editor-storage`）。Windows 免安装 zip 版从可写的解压目录运行时，会改用 `<exe 所在目录>/userdata`。

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
http://127.0.0.1:47231/mcp?token=<token>
```

MCP 服务只绑定到 `127.0.0.1`，并且要求一个**访问令牌**：每次安装会生成一个令牌，请求必须带上 `?token=<token>` 查询参数，或 `Authorization: Bearer <token>` 请求头，否则会被拒绝。

在编辑器菜单 `Help > Editor Settings...`（仅桌面版）的 MCP Service 区域可以启用或关闭服务、修改端口、查看运行状态，并用 **Copy MCP URL** 复制带令牌的完整地址。**配置外部客户端时请直接粘贴这个地址**，下面示例中的 `<token>` 需要替换成实际令牌。启用状态、端口和令牌保存在 Electron 用户数据目录中。

自动化场景（无界面运行、CI 中的 Agent）可以设置环境变量 `ZEPHYR_EDITOR_MCP_TOKEN` 固定令牌。

推荐的外部 Agent 连接顺序：

1. `initialize`
2. `tools/list`
3. 调用 `editor_wait_ready`
4. 调用 `editor_status`
5. 再使用 `project_*`、`scene_*`、`asset_*`、`node_*`、`mesh_*`、`material_*`、`script_*`、`terrain_*`、`foliage_*`、`sdf_*`、`gi_*` 等工具

直接访问编辑器内部的 `editor_call` 和 `editor_eval` 默认被禁用，只有用环境变量 `EDITOR_MCP_ENABLE_UNSAFE_TOOLS=1` 启动编辑器时才可调用。

如果客户端在编辑器窗口尚未连接 MCP bridge 时就调用编辑器工具，早期调用可能失败。因此自动化客户端应先等待 `editor_wait_ready`。

### Codex 配置示例

```toml
[mcp_servers.zephyr-editor]
url = "http://127.0.0.1:47231/mcp?token=<token>"
```

等价命令：

```sh
codex mcp add zephyr-editor --url http://127.0.0.1:47231/mcp?token=<token>
```

### Claude Desktop 配置示例

```json
{
  "mcpServers": {
    "zephyr-editor": {
      "url": "http://127.0.0.1:47231/mcp?token=<token>"
    }
  }
}
```

如果在编辑器设置中修改了端口，外部 MCP 客户端配置也需要同步更新。连接被拒绝时，先确认地址里带了令牌。

## LLM Chat

桌面版底部面板包含 `Assistant` 标签页，用于和 LLM 进行项目上下文相关的对话。该功能只在桌面运行时可用，浏览器版本不会直接提供本地 LLM Chat 能力。

LLM 配置位于 `Help > Editor Settings...`：

| 设置 | 含义 |
| --- | --- |
| `Provider` | `OpenAI`、`Anthropic`，或 `Custom`（任意 OpenAI 兼容服务） |
| `Base URL` | LLM 服务入口。OpenAI-compatible 服务通常使用 `/v1` 根地址，或直接填写 `/chat/completions` 地址 |
| `Model` | 使用的模型名称。旁边的 `Fetch` 按钮可从服务端拉取可用模型列表 |
| `Temperature` | 回复随机性 |
| `Max Output Tokens` | 单次回复最大输出长度 |
| `Enable Tool Calling` | 允许模型调用编辑器工具 |
| `Require Tool Approval` | 工具调用前要求用户确认 |
| `Unlimited Tool Steps` / `Max Tool Steps` | 一次对话中模型最多可以连续调用多少次工具 |
| `API Key` | 保存当前 provider 的密钥；`Clear Stored API Key` 清除已保存的密钥 |

API Key 由 Electron 主进程保存，不写入项目文件。系统不支持密钥加密时，对话框会警告密钥将以明文保存。

同一对话框中的 `Default RHI` 选择编辑器启动时使用的渲染后端，下次启动生效。启用工具调用后，Assistant 可以围绕当前项目执行编辑器操作，例如查询项目、读取资源、创建节点、修改材质或运行受支持的生成任务。开启 `Require Tool Approval` 时，涉及工具调用的步骤会先出现在 Assistant 时间线中，等待用户批准或拒绝。

## 使用建议

- 普通浏览和文档体验优先使用 Web 版本。
- 真实项目开发、需要本地目录访问、插件开发或自动化控制时使用桌面版本。
- 连接外部 Agent 前先在桌面编辑器设置中确认 MCP 服务处于 Running 状态。
- 使用 LLM Chat 修改项目时建议开启工具审批，尤其是在批量创建、删除或覆盖资产前。
