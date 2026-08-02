const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, net, protocol, safeStorage, shell } = require('electron');
const { execFile } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { Worker } = require('worker_threads');

const FS_CHANNEL = 'zephyr-editor:fs';
const FS_EVENT_CHANNEL = 'zephyr-editor:fs-event';
const LOG_CHANNEL = 'zephyr-editor:log';
const SETTINGS_CHANNEL = 'zephyr-editor:settings';
const ASSISTANT_EVENT_CHANNEL = 'zephyr-editor:assistant-event';
const HEADLESS_CHANNEL = 'zephyr-editor:headless';
const EDITOR_PROTOCOL = 'zephyr-editor';
const MCP_HTTP_PATH = '/mcp';
const DEFAULT_MCP_SERVICE_PORT = Number(process.env.ZEPHYR_EDITOR_MCP_SERVER_PORT || 47231);
const MAX_MCP_HTTP_BODY_BYTES = 16 * 1024 * 1024;
const MCP_CONFIG_FILE = 'mcp-config.json';
const EDITOR_GLOBAL_CONFIG_FILE = 'editor-config.json';
const LLM_SECRETS_FILE = 'llm-secrets.json';
const DEFAULT_EDITOR_RHI = 'webgpu';
const SUPPORTED_EDITOR_RHIS = new Set(['webgpu', 'webgl2', 'webgl']);
const ASSISTANT_STORAGE_DIR = 'assistant';
const ASSISTANT_SESSIONS_FILE = 'sessions.json';
const PORTABLE_USER_DATA_DIR = 'userdata';
const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_LLM_MODEL = 'gpt-4.1-mini';
const DEFAULT_OPENAI_COMPAT_CHAT_PATH = '/chat/completions';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_MAX_ASSISTANT_TOOL_STEPS = Math.max(
  1,
  Number.parseInt(
    process.env.ZEPHYR_EDITOR_MAX_ASSISTANT_TOOL_STEPS || '32',
    10
  ) || 32
);
const MAX_ASSISTANT_IMAGE_BYTES = 10 * 1024 * 1024;
// Pending tool approvals auto-reject after this long so an unattended
// approval prompt cannot hang a run forever.
const ASSISTANT_TOOL_APPROVAL_TIMEOUT_MS = Math.max(
  10000,
  Number.parseInt(process.env.ZEPHYR_EDITOR_ASSISTANT_APPROVAL_TIMEOUT_MS || '300000', 10) || 300000
);
// Max tool-produced screenshots kept as images in the LLM context; older ones
// collapse to text placeholders so multi-step visual runs do not exhaust the
// provider context window with stale base64 payloads.
const MAX_ASSISTANT_CONTEXT_SCREENSHOTS = 2;
const ASSISTANT_SCREENSHOT_OMITTED_TEXT =
  '[An earlier editor screenshot was omitted here to save context. Take a new screenshot if you need to re-inspect the scene.]';
// Symbol-keyed marker survives on in-memory chat entries but is invisible to
// JSON.stringify, so request payloads stay clean.
const ASSISTANT_SYNTHETIC_IMAGE_KEY = Symbol('assistantSyntheticImageEntry');
// Per-tool-result cap when replaying persisted history into LLM context.
const MAX_ASSISTANT_TOOL_RESULT_CHARS = 4000;
// Rough context budget (chars/4 heuristic + flat image estimate). Oldest
// conversation blocks are collapsed once the estimate exceeds this.
const ASSISTANT_CONTEXT_TOKEN_BUDGET = Math.max(
  8000,
  Number.parseInt(process.env.ZEPHYR_EDITOR_ASSISTANT_CONTEXT_TOKENS || '80000', 10) || 80000
);
const ASSISTANT_IMAGE_TOKEN_ESTIMATE = 1100;
function buildAssistantSystemPrompt(settings) {
  const lines = [
    'You are the embedded AI assistant of the Zephyr3D editor. You help the user inspect and edit the open project: scene graph, nodes, materials, meshes, cameras, assets, procedural models, and runtime scripts.',
    '',
    'Workflow:',
    'Inspect first: use read-only tools (scene_get_root_node, node_get_children, node_get_properties, scene_get_selected_nodes, camera_get_active, asset_read_directory, material_get_properties) to ground yourself before changing anything.',
    'Then act with the most direct tool for the job: node/scene property edits, material edits (clone built-ins first, they are read-only), shape_create_node or mesh_create for primitives, model_generate_begin for procedural geometry, camera_look_at to frame targets.',
    'Then verify: after completing a batch of mutating scene changes, call editor_screenshot and visually confirm the result before concluding.',
    'A scene checkpoint is taken automatically before your first mutating call in each run; if your edits go wrong, call scene_restore to roll the scene back to that checkpoint (or scene_checkpoint to snapshot manually before risky changes).',
    'Screenshot images are delivered to you as follow-up user messages containing the image; inspect them and correct any visual discrepancies (wrong color, position, scale, missing objects) instead of assuming the change worked.',
    'Only the most recent screenshots stay in context as images; take a fresh editor_screenshot rather than referring back to an omitted one.',
    '',
    'Scene editing rules:',
    'Prefer the simplest non-script solution. If the goal can be achieved by changing existing scene, node, light, camera, material, mesh, or component property values, choose property edits instead of writing a script.',
    'Treat new or modified scripts as the last resort unless the user explicitly asks for a script or the task genuinely requires runtime behavior such as per-frame updates, event handling, conditional logic, or stateful interactions.',
    'If the current selection or target is ambiguous, ask the user instead of guessing.',
    '',
    'Scripting rules (when a script is genuinely needed):',
    'Before creating, modifying, or attaching a script, inspect the current target with script_get_context or script_list_attachments.',
    'When unsure about a Zephyr3D API name, signature, or usage pattern, query the bundled declaration docs with docs_search_types and docs_get_type_symbol before guessing; prefer entries from @zephyr3d/scene or @zephyr3d/base.',
    'Treat script_template_source returned by script_get_context as the canonical reference for lifecycle hooks, RuntimeScript usage, host binding, and scriptProp usage, and follow its patterns.',
    'Prefer imports from @zephyr3d/scene and @zephyr3d/base instead of guessing local globals.',
    'Before modifying an existing script file, read it first with script_read_source.',
    'After creating or modifying a script file, run script_diagnostics on it and fix any errors before attaching it or concluding.',
    'Do not call script_write_source and node_attach_script or scene_attach_script in the same tool batch; wait for script_diagnostics first.',
    'Use script_write_source to create or update script assets under /assets, then attach with node_attach_script or scene_attach_script.',
    ''
  ];
  if (settings?.requireToolApproval) {
    lines.push(
      'Mutating tool calls require explicit user approval in the editor UI. Before your first mutating call for a task, state a concise plan of what you will change so the user can approve the calls confidently. Read-only inspection needs no approval or plan.'
    );
  } else {
    lines.push(
      'Tool approval is disabled, so your mutating calls execute immediately. Be conservative: state briefly what you are about to change, make changes in small verifiable batches, and check the result with read-only tools and editor_screenshot.'
    );
  }
  return lines.join('\n');
}
// Auto-approval whitelist for the embedded assistant. Derived at runtime from
// the MCP tool catalog's annotations.readOnlyHint (single source of truth in
// editor-mcp-server.mjs); tools without the hint require approval.
let assistantReadonlyToolNames = new Set();
const IMAGE_FILE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

function envFlagEnabled(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function canWriteDirectory(dirPath) {
  try {
    fsSync.mkdirSync(dirPath, { recursive: true });
    fsSync.accessSync(dirPath, fsSync.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function hasWindowsUninstaller(execDir) {
  try {
    const entries = fsSync.readdirSync(execDir);
    return entries.some((entry) => /^uninstall .*\.exe$/i.test(entry));
  } catch {
    return false;
  }
}

function resolvePortableUserDataRoot() {
  const explicitPortableDir = typeof process.env.ZEPHYR_EDITOR_PORTABLE_DIR === 'string'
    ? process.env.ZEPHYR_EDITOR_PORTABLE_DIR.trim()
    : '';
  if (explicitPortableDir) {
    return path.resolve(explicitPortableDir);
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.resolve(process.env.PORTABLE_EXECUTABLE_DIR, PORTABLE_USER_DATA_DIR);
  }
  if (envFlagEnabled('ZEPHYR_EDITOR_PORTABLE', false)) {
    return path.resolve(path.dirname(process.execPath), PORTABLE_USER_DATA_DIR);
  }
  if (process.platform === 'win32' && app.isPackaged) {
    const execDir = path.dirname(process.execPath);
    if (!hasWindowsUninstaller(execDir) && canWriteDirectory(execDir)) {
      return path.resolve(execDir, PORTABLE_USER_DATA_DIR);
    }
  }
  return '';
}

function configurePortableAppPaths() {
  const portableRoot = resolvePortableUserDataRoot();
  if (!portableRoot) {
    return;
  }
  fsSync.mkdirSync(portableRoot, { recursive: true });
  const sessionDir = path.join(portableRoot, 'session');
  const logsDir = path.join(portableRoot, 'logs');
  fsSync.mkdirSync(sessionDir, { recursive: true });
  fsSync.mkdirSync(logsDir, { recursive: true });
  app.setPath('userData', portableRoot);
  app.setPath('sessionData', sessionDir);
  app.setAppLogsPath(logsDir);
}

configurePortableAppPaths();

const HEADLESS_USAGE = [
  'Usage:',
  '  electron . --headless [--width <px>] [--height <px>] [--device <rhi>] [--mcp-port <port>]',
  '      Run the editor as a persistent headless MCP service (hidden window).',
  '  electron . --headless --project <id> --screenshot <out.png> [options]',
  '      One-shot capture: open the project in preview mode, render N deterministic',
  '      frames, write the screenshot and exit.',
  '',
  'One-shot options:',
  '  --project <id>       project id (required)',
  '  --scene <vfs-path>   scene to open; defaults to the project startup scene',
  '  --frames <N>         frames to render before capture (default 64)',
  '  --fixed-dt <ms>      fixed timestep in milliseconds; 0 = wall clock (default 16.6667)',
  '  --width <px>         content width (default 1280)',
  '  --height <px>        content height (default 720)',
  '  --device <rhi>       webgpu | webgl2 | webgl',
  '  --screenshot <path>  output PNG path (presence selects one-shot mode)',
  '  --timeout <ms>       whole-run watchdog (default 120000)',
  '',
  'Exit codes: 0 success, 1 failure, 2 usage error, 4 timeout, 5 renderer crash/load failure.'
].join('\n');

function parseHeadlessCli(argv) {
  if (!argv.includes('--headless')) {
    return null;
  }
  const fail = (message) => {
    writeStderrLine(`[headless] ${message}`);
    writeStderrLine(HEADLESS_USAGE);
    app.exit(2);
    return { valid: false };
  };
  const readString = (flag) => {
    const index = argv.indexOf(flag);
    if (index < 0) {
      return null;
    }
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.startsWith('--')) {
      throw new Error(`missing value for ${flag}`);
    }
    return value;
  };
  const readNumber = (flag, fallback, { min = -Infinity } = {}) => {
    const raw = readString(flag);
    if (raw === null) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min) {
      throw new Error(`invalid value for ${flag}: ${raw}`);
    }
    return value;
  };
  try {
    const screenshotPath = readString('--screenshot');
    const oneShot = screenshotPath !== null;
    const project = readString('--project');
    if (oneShot && !project) {
      return fail('--screenshot requires --project');
    }
    const device = readString('--device');
    if (device && !SUPPORTED_EDITOR_RHIS.has(device.toLowerCase())) {
      return fail(`unsupported --device: ${device}`);
    }
    const config = {
      valid: true,
      oneShot,
      project,
      scene: readString('--scene'),
      frames: Math.floor(readNumber('--frames', 64, { min: 1 })),
      fixedDt: readNumber('--fixed-dt', 1000 / 60, { min: 0 }),
      width: Math.floor(readNumber('--width', oneShot ? 1280 : 1440, { min: 16 })),
      height: Math.floor(readNumber('--height', oneShot ? 720 : 960, { min: 16 })),
      device: device ? device.toLowerCase() : null,
      screenshotPath: oneShot ? path.resolve(screenshotPath) : null,
      timeoutMs: Math.floor(readNumber('--timeout', 120000, { min: 1000 })),
      mcpPort: readString('--mcp-port') !== null ? Math.floor(readNumber('--mcp-port', 0, { min: 1 })) : null
    };
    if (config.mcpPort !== null && (config.mcpPort < 1 || config.mcpPort > 65535)) {
      return fail(`invalid --mcp-port: ${config.mcpPort}`);
    }
    if (config.device) {
      // getConfiguredEditorRHI() gives the env var priority, so this covers
      // both the launch URL and the persistent-mode window.
      process.env.ZEPHYR_EDITOR_DEVICE = config.device;
    }
    if (config.oneShot && !process.env.ZEPHYR_EDITOR_LOG_PATH) {
      // Free sidecar log: writeDiagnosticLog() and the renderer console
      // forwarding already write to this path.
      process.env.ZEPHYR_EDITOR_LOG_PATH = `${config.screenshotPath}.log`;
    }
    return config;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

const headlessConfig = parseHeadlessCli(process.argv);
let headlessWatchdog = null;
let headlessSessionDir = null;

if (headlessConfig?.valid) {
  // backgroundThrottling:false alone is not enough: Chromium also throttles
  // rAF for occluded/hidden windows at the browser-process level, and on
  // Windows the native occlusion tracker marks hidden windows as occluded,
  // which drops rAF to ~1Hz.
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

let hasSingleInstanceLock = true;
if (!headlessConfig) {
  hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
  }
} else if (headlessConfig.valid) {
  // Share userData (projects live in userData/editor-storage) but isolate
  // Chromium's lock-sensitive session data in a per-run temp dir so a headless
  // run can execute beside an interactive editor without the single-instance
  // lock. Concurrent writes to the same project from two instances are
  // unsupported.
  headlessSessionDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'zephyr-headless-'));
  const logsDir = path.join(headlessSessionDir, 'logs');
  fsSync.mkdirSync(logsDir, { recursive: true });
  app.setPath('sessionData', headlessSessionDir);
  app.setAppLogsPath(logsDir);
}

// Compile WebGPU shaders with DXC instead of FXC on the Dawn D3D12 backend.
// Chrome enables this via server-side field trials, which Electron never
// receives, and FXC generates markedly slower code for loop-heavy shaders
// (measured: SSGI trace pass 70ms with FXC vs ~35ms with DXC on RDNA3).
// Dawn ignores the toggle on GPUs without DXIL/SM6 support. Merged with any
// user-provided --enable-dawn-features value instead of overriding it.
{
  const userDawnFeatures = app.commandLine.getSwitchValue('enable-dawn-features');
  const dawnFeatures = userDawnFeatures
    ? userDawnFeatures.split(',').includes('use_dxc')
      ? userDawnFeatures
      : `${userDawnFeatures},use_dxc`
    : 'use_dxc';
  app.commandLine.appendSwitch('enable-dawn-features', dawnFeatures);
}
writeStderrLine(
  `[app:boot] pid=${process.pid} ppid=${process.ppid} lock=${hasSingleInstanceLock} packaged=${app.isPackaged} execPath=${process.execPath} argv=${JSON.stringify(process.argv)}`
);
void writeDiagnosticLog(
  `[app:boot] pid=${process.pid} ppid=${process.ppid} lock=${hasSingleInstanceLock} packaged=${app.isPackaged} execPath=${process.execPath} argv=${JSON.stringify(process.argv)}`
);

let mcpWorker = null;
let mcpBridgeInfo = null;
let mcpStartupPromise = null;
let mcpWorkerStopping = false;
let nextRpcRequestId = 1;
let mainWindowRef = null;
let mcpServiceServer = null;
let mcpServiceStartPromise = null;
const pendingRpcRequests = new Map();
let mcpServiceConfig = {
  enabled: true,
  port: DEFAULT_MCP_SERVICE_PORT
};
let editorGlobalConfig = {
  defaultRHI: DEFAULT_EDITOR_RHI,
  llm: {
    provider: 'openai',
    baseUrl: DEFAULT_LLM_BASE_URL,
    model: DEFAULT_LLM_MODEL,
    temperature: 0.2,
    maxOutputTokens: 4096,
    maxToolSteps: DEFAULT_MAX_ASSISTANT_TOOL_STEPS,
    toolCalling: true,
    requireToolApproval: true
  }
};
let llmSecrets = {
  providers: {}
};
let assistantSessions = [];
const assistantRuns = new Map();
const assistantPendingToolApprovals = new Map();
let nextFsWatchId = 1;
const fsWatchers = new Map();
const fsWatchersBySender = new Map();

function editorWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false
  };
}

function editorIconPath() {
  return path.join(__dirname, 'icon.ico');
}

async function writeDiagnosticLog(message) {
  const logPath = process.env.ZEPHYR_EDITOR_LOG_PATH;
  if (logPath) {
    await fs.appendFile(logPath, `${message}\n`).catch(() => undefined);
  }
}

async function pathExists(filePath) {
  return await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

function writeStderrLine(message) {
  process.stderr.write(`${message}\n`);
}

async function execFileText(file, args) {
  return await new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(`${stdout || ''}${stderr || ''}`);
    });
  });
}

async function getWindowsListeningPortOwner(port) {
  if (process.platform !== 'win32' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  const netstatOutput = await execFileText('netstat.exe', ['-ano', '-p', 'tcp']).catch(() => '');
  if (!netstatOutput) {
    return null;
  }
  const lines = netstatOutput.split(/\r?\n/);
  const suffix = `:${port}`;
  const matchedLine = lines.find((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) {
      return false;
    }
    return parts[0].toUpperCase() === 'TCP' && parts[1].endsWith(suffix) && parts[3].toUpperCase() === 'LISTENING';
  });
  if (!matchedLine) {
    return null;
  }
  const parts = matchedLine.trim().split(/\s+/);
  const pid = Number.parseInt(parts[4], 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return {
      pid: null,
      processName: '',
      executablePath: '',
      commandLine: '',
      raw: matchedLine.trim()
    };
  }
  const psScript = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
    "if ($p) {",
    "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "  [pscustomobject]@{",
    "    ProcessId = $p.ProcessId",
    "    Name = $p.Name",
    "    ExecutablePath = $p.ExecutablePath",
    "    CommandLine = $p.CommandLine",
    "  } | ConvertTo-Json -Compress",
    "}"
  ].join('; ');
  const processOutput = await execFileText('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    psScript
  ]).catch(() => '');
  let processInfo = null;
  if (processOutput.trim()) {
    try {
      processInfo = JSON.parse(processOutput.trim());
    } catch {
      processInfo = null;
    }
  }
  return {
    pid,
    processName: typeof processInfo?.Name === 'string' ? processInfo.Name : '',
    executablePath: typeof processInfo?.ExecutablePath === 'string' ? processInfo.ExecutablePath : '',
    commandLine: typeof processInfo?.CommandLine === 'string' ? processInfo.CommandLine : '',
    raw: matchedLine.trim()
  };
}

function formatWindowsPortOwner(owner) {
  if (!owner) {
    return '';
  }
  const parts = [];
  if (owner.pid) {
    parts.push(`pid=${owner.pid}`);
  }
  if (owner.processName) {
    parts.push(`name=${owner.processName}`);
  }
  if (owner.executablePath) {
    parts.push(`path=${owner.executablePath}`);
  }
  if (owner.commandLine) {
    parts.push(`cmd=${owner.commandLine}`);
  }
  if (owner.raw) {
    parts.push(`netstat="${owner.raw}"`);
  }
  return parts.join(' ');
}

function rejectPendingRpcRequests(error) {
  for (const pending of pendingRpcRequests.values()) {
    pending.reject(error);
  }
  pendingRpcRequests.clear();
}

const MCP_WORKER_RPC_TIMEOUT_MS = 180000;

function sendRpcToMcpWorker(message) {
  if (!mcpWorker) {
    return Promise.reject(new Error('Embedded MCP worker is not running'));
  }
  const requestId = nextRpcRequestId++;
  return new Promise((resolve, reject) => {
    // Bound the main<->worker leg so a hung worker cannot stall HTTP MCP
    // requests (and assistant tool calls) forever.
    const timer = setTimeout(() => {
      if (pendingRpcRequests.delete(requestId)) {
        reject(new Error(`Embedded MCP worker request timed out: ${message?.method ?? 'rpc'}`));
      }
    }, MCP_WORKER_RPC_TIMEOUT_MS);
    pendingRpcRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      }
    });
    mcpWorker.postMessage({
      type: 'rpc',
      requestId,
      message
    });
  });
}

async function sendRpcNotificationToMcpWorker(message) {
  if (!mcpWorker) {
    throw new Error('Embedded MCP worker is not running');
  }
  mcpWorker.postMessage({
    type: 'rpcNotification',
    message
  });
}

function sanitizeMcpServicePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_MCP_SERVICE_PORT;
}

function mcpConfigPath() {
  return path.join(app.getPath('userData'), MCP_CONFIG_FILE);
}

function sanitizeMcpServiceToken(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{16,128}$/.test(normalized) ? normalized : '';
}

async function loadMcpServiceConfig() {
  const filePath = mcpConfigPath();
  const loaded = await fs
    .readFile(filePath, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
  // Env override pins the token for automation (headless/CI agents);
  // otherwise a persisted per-installation token is generated once.
  const envToken = sanitizeMcpServiceToken(process.env.ZEPHYR_EDITOR_MCP_TOKEN);
  const token = envToken || sanitizeMcpServiceToken(loaded?.token);
  mcpServiceConfig = {
    enabled: typeof loaded?.enabled === 'boolean' ? loaded.enabled : true,
    port: sanitizeMcpServicePort(loaded?.port),
    token: token || crypto.randomBytes(16).toString('hex')
  };
  if (!envToken && !sanitizeMcpServiceToken(loaded?.token)) {
    await saveMcpServiceConfig().catch(() => {});
  }
}

async function saveMcpServiceConfig() {
  const filePath = mcpConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(mcpServiceConfig, null, 2)}\n`, 'utf8');
}

function sanitizeEditorRHI(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SUPPORTED_EDITOR_RHIS.has(normalized) ? normalized : DEFAULT_EDITOR_RHI;
}

function sanitizeLlmProvider(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'anthropic' || normalized === 'custom' ? normalized : 'openai';
}

function sanitizeLlmBaseUrl(value, provider = 'openai') {
  const fallback =
    provider === 'openai'
      ? DEFAULT_LLM_BASE_URL
      : provider === 'anthropic'
        ? DEFAULT_ANTHROPIC_BASE_URL
        : '';
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return fallback;
  }
  try {
    const url = new URL(normalized);
    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function sanitizeLlmModel(value, provider = 'openai') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized) {
    return normalized;
  }
  return provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_LLM_MODEL;
}

function sanitizeLlmTemperature(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0.2;
  }
  return Math.max(0, Math.min(2, num));
}

function sanitizeLlmMaxOutputTokens(value) {
  const num = Number(value);
  if (!Number.isInteger(num)) {
    return 4096;
  }
  return Math.max(128, Math.min(65536, num));
}

function sanitizeLlmMaxToolSteps(value) {
  if (value === null) {
    return null;
  }
  const num = Number(value);
  if (!Number.isInteger(num)) {
    return DEFAULT_MAX_ASSISTANT_TOOL_STEPS;
  }
  return Math.max(1, Math.min(1000000, num));
}

function sanitizeLlmSettings(value) {
  const provider = sanitizeLlmProvider(value?.provider);
  return {
    provider,
    baseUrl: sanitizeLlmBaseUrl(value?.baseUrl, provider),
    model: sanitizeLlmModel(value?.model, provider),
    temperature: sanitizeLlmTemperature(value?.temperature),
    maxOutputTokens: sanitizeLlmMaxOutputTokens(value?.maxOutputTokens),
    maxToolSteps: sanitizeLlmMaxToolSteps(value?.maxToolSteps),
    toolCalling: value?.toolCalling !== false,
    requireToolApproval: value?.requireToolApproval !== false
  };
}

function editorGlobalConfigPath() {
  return path.join(app.getPath('userData'), EDITOR_GLOBAL_CONFIG_FILE);
}

async function loadEditorGlobalConfig() {
  const filePath = editorGlobalConfigPath();
  const loaded = await fs
    .readFile(filePath, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
  editorGlobalConfig = {
    defaultRHI: sanitizeEditorRHI(loaded?.defaultRHI),
    llm: sanitizeLlmSettings(loaded?.llm)
  };
}

async function saveEditorGlobalConfig() {
  const filePath = editorGlobalConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(editorGlobalConfig, null, 2)}\n`, 'utf8');
}

function llmSecretsPath() {
  return path.join(app.getPath('userData'), LLM_SECRETS_FILE);
}

function assistantStorageDirPath() {
  return path.join(app.getPath('userData'), ASSISTANT_STORAGE_DIR);
}

function assistantSessionsPath() {
  return path.join(assistantStorageDirPath(), ASSISTANT_SESSIONS_FILE);
}

function assistantSessionMessagesPath(sessionId) {
  return path.join(assistantStorageDirPath(), `${sessionId}.messages.json`);
}

function encryptSecret(text) {
  if (!text) {
    return '';
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(text, 'utf8').toString('base64');
  }
  return safeStorage.encryptString(text).toString('base64');
}

function decryptSecret(payload) {
  if (!payload) {
    return '';
  }
  const buffer = Buffer.from(String(payload), 'base64');
  if (!safeStorage.isEncryptionAvailable()) {
    return buffer.toString('utf8');
  }
  try {
    return safeStorage.decryptString(buffer);
  } catch {
    return '';
  }
}

function findInvalidHttpHeaderValueChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 255 || code === 0x00 || code === 0x0a || code === 0x0d) {
      return { index: i, code };
    }
  }
  return null;
}

function normalizeLlmApiKey(apiKey) {
  let normalized = typeof apiKey === 'string' ? apiKey.trim() : '';
  normalized = normalized.replace(/^Bearer\s+/i, '').trim();
  if (!normalized) {
    throw new Error('API key must not be empty');
  }
  const invalidChar = findInvalidHttpHeaderValueChar(normalized);
  if (invalidChar) {
    throw new Error(
      `API key contains an unsupported character at index ${invalidChar.index} (code ${invalidChar.code}). ` +
        'API keys used in HTTP headers must contain only header-safe characters; please paste the raw key only.'
    );
  }
  return normalized;
}

async function loadLlmSecrets() {
  const filePath = llmSecretsPath();
  const loaded = await fs
    .readFile(filePath, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
  llmSecrets = {
    providers: loaded?.providers && typeof loaded.providers === 'object' ? loaded.providers : {}
  };
}

async function saveLlmSecrets() {
  const filePath = llmSecretsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(llmSecrets, null, 2)}\n`, 'utf8');
}

function hasLlmApiKeyConfigured(provider) {
  const record = llmSecrets.providers?.[sanitizeLlmProvider(provider)];
  return !!(record && typeof record.apiKey === 'string' && decryptSecret(record.apiKey));
}

async function setLlmApiKey(provider, apiKey) {
  const normalizedProvider = sanitizeLlmProvider(provider);
  const normalizedKey = normalizeLlmApiKey(apiKey);
  llmSecrets.providers[normalizedProvider] = {
    apiKey: encryptSecret(normalizedKey),
    updatedAt: new Date().toISOString()
  };
  await saveLlmSecrets();
  return true;
}

async function clearLlmApiKey(provider) {
  const normalizedProvider = sanitizeLlmProvider(provider);
  delete llmSecrets.providers[normalizedProvider];
  await saveLlmSecrets();
  return true;
}

function getLlmApiKey(provider) {
  const normalizedProvider = sanitizeLlmProvider(provider);
  const record = llmSecrets.providers?.[normalizedProvider];
  return record?.apiKey ? decryptSecret(record.apiKey) : '';
}

async function ensureAssistantStorageDir() {
  await fs.mkdir(assistantStorageDirPath(), { recursive: true });
}

function sanitizeAssistantSessionSummary(value) {
  return {
    id: typeof value?.id === 'string' ? value.id : `as_${Date.now().toString(36)}`,
    title:
      typeof value?.title === 'string' && value.title.trim()
        ? value.title.trim()
        : 'New Session',
    createdAt: typeof value?.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    messageCount: Number.isInteger(value?.messageCount) ? value.messageCount : 0,
    active: !!value?.active,
    scopeId: normalizeAssistantScopeId(value?.scopeId)
  };
}

function normalizeAssistantScopeId(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function guessImageMimeType(filePath) {
  const ext = path.extname(typeof filePath === 'string' ? filePath : '').toLowerCase();
  return IMAGE_FILE_MIME_TYPES[ext] || 'application/octet-stream';
}

function sanitizeAssistantAttachment(value) {
  const mimeType = typeof value?.mimeType === 'string' ? value.mimeType.trim() : '';
  const dataUrl = typeof value?.dataUrl === 'string' ? value.dataUrl.trim() : '';
  if (!mimeType.startsWith('image/')) {
    return null;
  }
  if (!dataUrl.startsWith(`data:${mimeType};base64,`)) {
    return null;
  }
  return {
    id:
      typeof value?.id === 'string' && value.id.trim()
        ? value.id.trim()
        : `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name:
      typeof value?.name === 'string' && value.name.trim()
        ? value.name.trim()
        : `image_${Date.now().toString(36)}`,
    mimeType,
    dataUrl
  };
}

function sanitizeAssistantToolCalls(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls = [];
  for (const item of value) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const name = typeof item?.function?.name === 'string' ? item.function.name.trim() : '';
    if (!id || !name) {
      continue;
    }
    calls.push({
      id,
      type: 'function',
      function: {
        name,
        arguments:
          typeof item.function.arguments === 'string'
            ? item.function.arguments
            : JSON.stringify(item.function.arguments ?? {})
      }
    });
  }
  return calls;
}

function sanitizeAssistantMessage(value) {
  const role = ['system', 'user', 'assistant', 'tool'].includes(value?.role) ? value.role : 'assistant';
  const status = ['pending', 'complete', 'error'].includes(value?.status) ? value.status : 'complete';
  const attachments = Array.isArray(value?.attachments)
    ? value.attachments.map(sanitizeAssistantAttachment).filter(Boolean)
    : [];
  const toolCalls = role === 'assistant' ? sanitizeAssistantToolCalls(value?.toolCalls) : [];
  const toolCallId = role === 'tool' && typeof value?.toolCallId === 'string' ? value.toolCallId.trim() : '';
  const toolName = role === 'tool' && typeof value?.toolName === 'string' ? value.toolName.trim() : '';
  const message = {
    id: typeof value?.id === 'string' ? value.id : `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    content: typeof value?.content === 'string' ? value.content : String(value?.content ?? ''),
    attachments,
    createdAt: typeof value?.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    status,
    synthetic: !!value?.synthetic
  };
  if (toolCalls.length) {
    message.toolCalls = toolCalls;
  }
  if (toolCallId) {
    message.toolCallId = toolCallId;
  }
  if (toolName) {
    message.toolName = toolName;
  }
  return message;
}

async function loadAssistantSessions() {
  await ensureAssistantStorageDir();
  const loaded = await fs
    .readFile(assistantSessionsPath(), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => []);
  assistantSessions = Array.isArray(loaded) ? loaded.map(sanitizeAssistantSessionSummary) : [];
}

async function saveAssistantSessions() {
  await ensureAssistantStorageDir();
  await fs.writeFile(assistantSessionsPath(), `${JSON.stringify(assistantSessions, null, 2)}\n`, 'utf8');
}

async function readAssistantSessionMessages(sessionId, scopeId) {
  const session = findAssistantSession(sessionId, scopeId);
  if (!session) {
    throw new Error(`Unknown assistant session: ${sessionId}`);
  }
  const normalizedSessionId = session.id;
  await ensureAssistantStorageDir();
  const loaded = await fs
    .readFile(assistantSessionMessagesPath(normalizedSessionId), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => []);
  return Array.isArray(loaded) ? loaded.map(sanitizeAssistantMessage) : [];
}

async function writeAssistantSessionMessages(sessionId, messages) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId) {
    throw new Error('sessionId is required');
  }
  await ensureAssistantStorageDir();
  await fs.writeFile(
    assistantSessionMessagesPath(normalizedSessionId),
    `${JSON.stringify(messages, null, 2)}\n`,
    'utf8'
  );
}

function sendAssistantEvent(payload) {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return;
  }
  mainWindowRef.webContents.send(ASSISTANT_EVENT_CHANNEL, payload);
}

function getAssistantRun(sessionId) {
  return assistantRuns.get(sessionId) ?? null;
}

function setAssistantRun(sessionId, run) {
  assistantRuns.set(sessionId, run);
}

function clearAssistantRun(sessionId) {
  assistantRuns.delete(sessionId);
}

function clearPendingAssistantToolApproval(callId, approved = false, emitResolved = false) {
  const pending = assistantPendingToolApprovals.get(callId);
  if (!pending) {
    return false;
  }
  assistantPendingToolApprovals.delete(callId);
  if (emitResolved) {
    sendAssistantEvent({
      type: 'tool_call_approval_resolved',
      sessionId: pending.sessionId,
      callId,
      approved
    });
  }
  return pending;
}

function findAssistantSession(sessionId, scopeId) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId) {
    return null;
  }
  const normalizedScopeId = scopeId === undefined ? undefined : normalizeAssistantScopeId(scopeId);
  return (
    assistantSessions.find(
      (session) =>
        session.id === normalizedSessionId &&
        (normalizedScopeId === undefined || (session.scopeId ?? null) === normalizedScopeId)
    ) ?? null
  );
}

async function createAssistantSession(title, scopeId) {
  const session = sanitizeAssistantSessionSummary({
    id: `as_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: typeof title === 'string' && title.trim() ? title.trim() : 'New Session',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    active: false,
    scopeId
  });
  assistantSessions.unshift(session);
  await saveAssistantSessions();
  await writeAssistantSessionMessages(session.id, []);
  sendAssistantEvent({ type: 'session_updated', session });
  return session;
}

async function listAssistantSessions(scopeId) {
  const normalizedScopeId = normalizeAssistantScopeId(scopeId);
  return assistantSessions.filter((session) => (session.scopeId ?? null) === normalizedScopeId);
}

async function renameAssistantSession(sessionId, title, scopeId) {
  const session = findAssistantSession(sessionId, scopeId);
  if (!session) {
    throw new Error(`Unknown assistant session: ${sessionId}`);
  }
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  if (normalizedTitle) {
    session.title = normalizedTitle.slice(0, 120);
    session.updatedAt = new Date().toISOString();
    await saveAssistantSessions();
    sendAssistantEvent({ type: 'session_updated', session });
  }
  return session;
}

async function deleteAssistantSession(sessionId, scopeId) {
  const session = findAssistantSession(sessionId, scopeId);
  if (!session) {
    return false;
  }
  if (session.active || getAssistantRun(session.id)) {
    throw new Error('Cannot delete a session while a run is active; cancel the run first');
  }
  assistantSessions = assistantSessions.filter((item) => item.id !== session.id);
  await saveAssistantSessions();
  await fs.rm(assistantSessionMessagesPath(session.id), { force: true }).catch(() => {});
  sendAssistantEvent({
    type: 'session_deleted',
    sessionId: session.id,
    scopeId: session.scopeId ?? null
  });
  return true;
}

function createAssistantMessage(role, content, status = 'complete', options = {}) {
  const normalizedContent = typeof content === 'string' ? content : String(content ?? '');
  const attachments = Array.isArray(options.attachments)
    ? options.attachments.map(sanitizeAssistantAttachment).filter(Boolean)
    : [];
  const toolCalls = sanitizeAssistantToolCalls(options.toolCalls);
  if (!normalizedContent.trim() && !attachments.length && !toolCalls.length && status !== 'pending') {
    throw new Error('Assistant message content must not be empty');
  }
  return sanitizeAssistantMessage({
    id: options.id,
    role,
    content: normalizedContent,
    attachments,
    createdAt: options.createdAt,
    status,
    synthetic: options.synthetic,
    toolCalls,
    toolCallId: options.toolCallId,
    toolName: options.toolName
  });
}

function emitAssistantMessageStarted(sessionId, message) {
  sendAssistantEvent({ type: 'message_started', sessionId, message });
}

function emitAssistantMessageDelta(sessionId, messageId, delta, content) {
  if (!delta) {
    return;
  }
  sendAssistantEvent({
    type: 'message_delta',
    sessionId,
    messageId,
    delta,
    content
  });
}

function emitAssistantMessageCompleted(sessionId, messageId, content, status = 'complete') {
  sendAssistantEvent({
    type: 'message_completed',
    sessionId,
    messageId,
    content,
    status
  });
}

async function appendAssistantMessage(sessionId, role, content, status = 'complete', options = {}) {
  const session = findAssistantSession(sessionId);
  if (!session) {
    throw new Error(`Unknown assistant session: ${sessionId}`);
  }
  const messages = await readAssistantSessionMessages(sessionId);
  const message = createAssistantMessage(role, content, status, options);
  messages.push(message);
  await writeAssistantSessionMessages(sessionId, messages);
  session.updatedAt = new Date().toISOString();
  session.messageCount = messages.length;
  await saveAssistantSessions();
  sendAssistantEvent({ type: 'message_added', sessionId, message });
  sendAssistantEvent({ type: 'session_updated', session });
  return message;
}

function assertAssistantRunActive(run, sessionId) {
  if (!run || run.cancelled || run.sessionId !== sessionId) {
    throw new Error('Assistant run was cancelled');
  }
}

function getOpenAiCompatibleChatUrl(provider, baseUrl) {
  const normalizedProvider = sanitizeLlmProvider(provider);
  const normalizedBaseUrl = sanitizeLlmBaseUrl(baseUrl, normalizedProvider);
  if (!normalizedBaseUrl) {
    throw new Error('LLM base URL is not configured');
  }
  return normalizedBaseUrl.endsWith('/chat/completions')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${DEFAULT_OPENAI_COMPAT_CHAT_PATH}`;
}

async function callEmbeddedMcp(method, params) {
  const rpcResponse = await sendRpcToMcpWorker({
    jsonrpc: '2.0',
    id: `assistant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    method,
    params
  });
  if (rpcResponse?.error) {
    throw new Error(rpcResponse.error.message || String(rpcResponse.error));
  }
  return rpcResponse?.result ?? null;
}

async function listAssistantMcpTools() {
  const result = await callEmbeddedMcp('tools/list', {});
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  const validTools = tools.filter((tool) => typeof tool?.name === 'string' && tool.name.trim());
  assistantReadonlyToolNames = new Set(
    validTools.filter((tool) => tool?.annotations?.readOnlyHint === true).map((tool) => tool.name)
  );
  return validTools;
}

function convertMcpToolToOpenAiTool(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.inputSchema ?? { type: 'object', properties: {} }
    }
  };
}

async function waitForAssistantToolApproval(sessionId, callId, tool, args) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const pending = clearPendingAssistantToolApproval(callId, false, true);
      if (pending) {
        resolve(false);
      }
    }, ASSISTANT_TOOL_APPROVAL_TIMEOUT_MS);
    assistantPendingToolApprovals.set(callId, {
      sessionId,
      tool,
      args,
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      }
    });
    sendAssistantEvent({
      type: 'tool_call_approval_requested',
      sessionId,
      callId,
      tool,
      args
    });
  });
}

async function callAssistantTool(sessionId, run, name, rawArguments, settings) {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName) {
    throw new Error('Tool name is required');
  }
  let parsedArguments = {};
  if (typeof rawArguments === 'string' && rawArguments.trim()) {
    try {
      parsedArguments = JSON.parse(rawArguments);
    } catch (err) {
      throw new Error(`Tool arguments for ${name} are not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (rawArguments && typeof rawArguments === 'object') {
    parsedArguments = rawArguments;
  }
  const callId = `tool_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  if (settings.requireToolApproval && !assistantReadonlyToolNames.has(normalizedName)) {
    const approved = await waitForAssistantToolApproval(sessionId, callId, normalizedName, parsedArguments);
    assertAssistantRunActive(run, sessionId);
    if (!approved) {
      throw new Error(`Tool approval was denied for ${normalizedName}`);
    }
  }
  sendAssistantEvent({
    type: 'tool_call_started',
    sessionId,
    callId,
    tool: normalizedName,
    args: parsedArguments
  });
  const result = await callEmbeddedMcp('tools/call', {
    name: normalizedName,
    arguments: parsedArguments
  });
  const isError = !!result?.isError;
  sendAssistantEvent({
    type: 'tool_call_finished',
    sessionId,
    callId,
    tool: normalizedName,
    result,
    isError
  });
  assertAssistantRunActive(run, sessionId);
  return result;
}

function truncateAssistantToolContent(content) {
  const normalized = typeof content === 'string' ? content : String(content ?? '');
  if (normalized.length <= MAX_ASSISTANT_TOOL_RESULT_CHARS) {
    return normalized;
  }
  const omitted = normalized.length - MAX_ASSISTANT_TOOL_RESULT_CHARS;
  return `${normalized.slice(0, MAX_ASSISTANT_TOOL_RESULT_CHARS)}\n…[tool result truncated, ${omitted} characters omitted]`;
}

// Guarantees the OpenAI-compatible pairing invariant on replayed history:
// every assistant tool_call id gets exactly one tool response before the next
// assistant message, and tool messages never appear without a matching call
// (cancelled runs and legacy sessions violate both).
function repairAssistantToolCallPairing(chat) {
  const result = [];
  let openIds = new Map();
  const closeOpenIds = () => {
    for (const [id, toolName] of openIds) {
      result.push({
        role: 'tool',
        tool_call_id: id,
        content: `[No result was recorded for tool call ${toolName || id}; the run may have been cancelled.]`
      });
    }
    openIds = new Map();
  };
  for (const entry of chat) {
    if (entry.role === 'assistant') {
      closeOpenIds();
      result.push(entry);
      if (Array.isArray(entry.tool_calls)) {
        for (const call of entry.tool_calls) {
          openIds.set(call.id, call.function?.name || '');
        }
      }
      continue;
    }
    if (entry.role === 'tool') {
      if (openIds.has(entry.tool_call_id)) {
        openIds.delete(entry.tool_call_id);
        result.push(entry);
      } else if (typeof entry.content === 'string' && entry.content.trim()) {
        result.push({
          role: 'system',
          content: `Earlier tool result:\n${entry.content}`
        });
      }
      continue;
    }
    result.push(entry);
  }
  closeOpenIds();
  return result;
}

function normalizeAssistantHistoryToChatMessages(messages) {
  const chat = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      const content = truncateAssistantToolContent(message.content);
      if (message.toolCallId) {
        chat.push({
          role: 'tool',
          tool_call_id: message.toolCallId,
          content
        });
      } else if (content.trim()) {
        // Legacy sessions stored tool output without call ids; replay as a
        // system note so the evidence survives even without strict pairing.
        chat.push({
          role: 'system',
          content: `Earlier tool result${message.toolName ? ` (${message.toolName})` : ''}:\n${content}`
        });
      }
      continue;
    }
    if (!['system', 'user', 'assistant'].includes(message.role)) {
      continue;
    }
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
    if (!message.content && !attachments.length && !toolCalls.length) {
      continue;
    }
    if (message.role === 'user' && attachments.length) {
      const content = [];
      if (message.content) {
        content.push({
          type: 'text',
          text: message.content
        });
      }
      for (const attachment of attachments) {
        content.push({
          type: 'image_url',
          image_url: {
            url: attachment.dataUrl
          }
        });
      }
      const entry = {
        role: message.role,
        content
      };
      if (message.synthetic) {
        entry[ASSISTANT_SYNTHETIC_IMAGE_KEY] = true;
      }
      chat.push(entry);
      continue;
    }
    if (message.role === 'assistant' && toolCalls.length) {
      chat.push({
        role: 'assistant',
        content: message.content || '',
        tool_calls: toolCalls
      });
      continue;
    }
    chat.push({
      role: message.role,
      content: message.content
    });
  }
  return repairAssistantToolCallPairing(chat);
}

function extractToolResultImageAttachments(toolName, toolResult) {
  const blocks = Array.isArray(toolResult?.content) ? toolResult.content : [];
  const attachments = [];
  for (const block of blocks) {
    if (block?.type !== 'image' || typeof block.data !== 'string' || !block.data) {
      continue;
    }
    const mimeType = typeof block.mimeType === 'string' && block.mimeType.startsWith('image/')
      ? block.mimeType
      : 'image/png';
    attachments.push({
      name: `${toolName}_${attachments.length + 1}.${mimeType.split('/')[1] || 'png'}`,
      mimeType,
      dataUrl: `data:${mimeType};base64,${block.data}`
    });
  }
  return attachments;
}

function buildSyntheticScreenshotChatEntry(text, attachments) {
  const entry = {
    role: 'user',
    content: [
      { type: 'text', text },
      ...attachments.map((attachment) => ({
        type: 'image_url',
        image_url: { url: attachment.dataUrl }
      }))
    ]
  };
  entry[ASSISTANT_SYNTHETIC_IMAGE_KEY] = true;
  return entry;
}

function enforceAssistantScreenshotBudget(conversation, maxImages = MAX_ASSISTANT_CONTEXT_SCREENSHOTS) {
  const imageEntries = conversation.filter(
    (entry) => entry?.[ASSISTANT_SYNTHETIC_IMAGE_KEY] && Array.isArray(entry.content)
  );
  const excess = imageEntries.length - maxImages;
  for (let i = 0; i < excess; i++) {
    imageEntries[i].content = ASSISTANT_SCREENSHOT_OMITTED_TEXT;
  }
}

function estimateAssistantChatEntryTokens(entry) {
  let tokens = 8;
  if (typeof entry?.content === 'string') {
    tokens += Math.ceil(entry.content.length / 4);
  } else if (Array.isArray(entry?.content)) {
    for (const item of entry.content) {
      if (item?.type === 'text' && typeof item.text === 'string') {
        tokens += Math.ceil(item.text.length / 4);
      } else if (item?.type === 'image_url') {
        tokens += ASSISTANT_IMAGE_TOKEN_ESTIMATE;
      }
    }
  }
  if (Array.isArray(entry?.tool_calls)) {
    for (const call of entry.tool_calls) {
      tokens += Math.ceil(
        ((call?.function?.name?.length ?? 0) + (call?.function?.arguments?.length ?? 0)) / 4 + 8
      );
    }
  }
  return tokens;
}

// Collapses the oldest conversation blocks into a single truncation notice
// when the estimated token count exceeds the budget. A block starts at a real
// user message or an assistant message and carries its trailing tool results,
// synthetic screenshots, and injected system notes, so dropping whole blocks
// can never orphan a tool_call pairing. Index 0 (system prompt) is always kept.
function enforceAssistantContextBudget(conversation, budgetTokens = ASSISTANT_CONTEXT_TOKEN_BUDGET) {
  let total = 0;
  for (const entry of conversation) {
    total += estimateAssistantChatEntryTokens(entry);
  }
  if (total <= budgetTokens) {
    return;
  }
  const blocks = [];
  for (let i = 1; i < conversation.length; i++) {
    const entry = conversation[i];
    const startsBlock =
      entry.role === 'assistant' || (entry.role === 'user' && !entry[ASSISTANT_SYNTHETIC_IMAGE_KEY]);
    if (startsBlock || !blocks.length) {
      blocks.push({ start: i, end: i + 1, tokens: 0 });
    } else {
      blocks[blocks.length - 1].end = i + 1;
    }
    blocks[blocks.length - 1].tokens += estimateAssistantChatEntryTokens(entry);
  }
  let droppedEntries = 0;
  let droppedBlocks = 0;
  // Always keep at least the last two blocks (latest user request + reply).
  while (blocks.length - droppedBlocks > 2 && total > budgetTokens) {
    const block = blocks[droppedBlocks];
    total -= block.tokens;
    droppedEntries += block.end - block.start;
    droppedBlocks++;
  }
  if (!droppedEntries) {
    return;
  }
  conversation.splice(1, droppedEntries, {
    role: 'system',
    content: `[Context truncated: ${droppedEntries} earlier messages were omitted to fit the context window. Re-inspect the scene with read-only tools if you need details from before this point.]`
  });
}

function extractOpenAiTextDelta(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item?.type === 'text' && typeof item.text === 'string') {
          return item.text;
        }
        return '';
      })
      .join('');
  }
  if (content?.type === 'text' && typeof content.text === 'string') {
    return content.text;
  }
  return '';
}

function mergeOpenAiStreamToolCall(target, delta) {
  const index = Number.isInteger(delta?.index) ? delta.index : target.length;
  while (target.length <= index) {
    target.push({
      id: '',
      type: 'function',
      function: {
        name: '',
        arguments: ''
      }
    });
  }
  const current = target[index];
  if (typeof delta?.id === 'string' && delta.id) {
    current.id = delta.id;
  }
  if (typeof delta?.type === 'string' && delta.type) {
    current.type = delta.type;
  }
  if (typeof delta?.function?.name === 'string' && delta.function.name) {
    current.function.name += delta.function.name;
  }
  if (typeof delta?.function?.arguments === 'string' && delta.function.arguments) {
    current.function.arguments += delta.function.arguments;
  }
}

function processOpenAiStreamEventBlock(block, message, callbacks) {
  const normalized = block.replace(/\r/g, '');
  const dataLines = normalized
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  if (!dataLines.length) {
    return false;
  }
  const data = dataLines.join('\n');
  if (!data || data === '[DONE]') {
    return data === '[DONE]';
  }
  const payload = JSON.parse(data);
  const choice = payload?.choices?.[0];
  const delta = choice?.delta ?? {};
  if (typeof delta.role === 'string' && delta.role) {
    message.role = delta.role;
  }
  const textDelta = extractOpenAiTextDelta(delta.content);
  if (textDelta) {
    message.content += textDelta;
    callbacks?.onTextDelta?.(textDelta, message.content);
  }
  if (Array.isArray(delta.tool_calls)) {
    for (const toolCallDelta of delta.tool_calls) {
      mergeOpenAiStreamToolCall(message.tool_calls, toolCallDelta);
    }
  }
  return false;
}

async function readOpenAiCompatibleChatStream(response, callbacks) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error('Streaming response body is not readable');
  }
  const decoder = new TextDecoder();
  const message = {
    role: 'assistant',
    content: '',
    tool_calls: []
  };
  let buffer = '';
  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      const separatorLength = buffer.startsWith('\r\n\r\n', boundary) ? 4 : 2;
      buffer = buffer.slice(boundary + separatorLength);
      finished = processOpenAiStreamEventBlock(block, message, callbacks);
      if (finished) {
        break;
      }
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail && !finished) {
    processOpenAiStreamEventBlock(tail, message, callbacks);
  }
  return {
    role: message.role,
    content: message.content,
    tool_calls: message.tool_calls.filter((toolCall) => toolCall?.function?.name)
  };
}

async function invokeOpenAiCompatibleChat(settings, messages, tools, signal, callbacks) {
  const rawApiKey = getLlmApiKey(settings.provider);
  if (!rawApiKey) {
    throw new Error(`No API key configured for provider ${settings.provider}`);
  }
  const apiKey = normalizeLlmApiKey(rawApiKey);
  const response = await fetch(getOpenAiCompatibleChatUrl(settings.provider, settings.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: settings.temperature,
      max_tokens: settings.maxOutputTokens,
      messages,
      stream: true,
      tools: settings.toolCalling ? tools : undefined,
      tool_choice: settings.toolCalling && tools.length ? 'auto' : undefined
    }),
    signal
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload?.error?.message ||
      payload?.message ||
      `LLM request failed with status ${response.status}`;
    throw new Error(message);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return await readOpenAiCompatibleChatStream(response, callbacks);
  }
  const payload = await response.json().catch(() => null);
  const choice = payload?.choices?.[0]?.message;
  if (!choice) {
    throw new Error('LLM response did not include a message choice');
  }
  return choice;
}

function getAnthropicMessagesUrl(baseUrl) {
  const normalized = sanitizeLlmBaseUrl(baseUrl, 'anthropic') || DEFAULT_ANTHROPIC_BASE_URL;
  return normalized.endsWith('/v1/messages') ? normalized : `${normalized}/v1/messages`;
}

function convertMcpToolToAnthropicTool(tool) {
  return {
    name: tool.name,
    description: tool.description ?? '',
    input_schema: tool.inputSchema ?? { type: 'object', properties: {} }
  };
}

function dataUrlToAnthropicImageBlock(url) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(typeof url === 'string' ? url : '');
  if (!match || !match[2]) {
    return null;
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: match[1], data: match[2] }
  };
}

function convertChatContentToAnthropicBlocks(content) {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  const blocks = [];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item?.type === 'text' && typeof item.text === 'string' && item.text) {
        blocks.push({ type: 'text', text: item.text });
      } else if (item?.type === 'image_url') {
        const image = dataUrlToAnthropicImageBlock(item.image_url?.url);
        if (image) {
          blocks.push(image);
        }
      }
    }
  }
  return blocks;
}

function parseAssistantToolCallInput(argsText) {
  if (typeof argsText !== 'string' || !argsText.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(argsText);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Converts the loop's OpenAI-style conversation into Anthropic Messages API
// shape. Index-0 system becomes the top-level system prompt; interleaved
// system notes become user-side <system-note> text (portable across models
// that lack mid-conversation system role support). Consecutive same-role
// entries merge, and tool_result blocks are hoisted to the front of their
// user message as the API requires.
function buildAnthropicRequestMessages(conversation) {
  const systemBlocks = [];
  const messages = [];
  const pushBlocks = (role, blocks) => {
    if (!blocks.length) {
      return;
    }
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
    } else {
      messages.push({ role, content: [...blocks] });
    }
  };
  conversation.forEach((entry, index) => {
    if (entry.role === 'system') {
      const text = typeof entry.content === 'string' ? entry.content : String(entry.content ?? '');
      if (index === 0) {
        systemBlocks.push({ type: 'text', text });
      } else if (text) {
        pushBlocks('user', [{ type: 'text', text: `<system-note>\n${text}\n</system-note>` }]);
      }
      return;
    }
    if (entry.role === 'assistant') {
      const blocks = convertChatContentToAnthropicBlocks(entry.content);
      if (Array.isArray(entry.tool_calls)) {
        for (const call of entry.tool_calls) {
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.function?.name || '',
            input: parseAssistantToolCallInput(call.function?.arguments)
          });
        }
      }
      pushBlocks('assistant', blocks);
      return;
    }
    if (entry.role === 'tool') {
      pushBlocks('user', [
        {
          type: 'tool_result',
          tool_use_id: entry.tool_call_id,
          content: typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content ?? null)
        }
      ]);
      return;
    }
    pushBlocks('user', convertChatContentToAnthropicBlocks(entry.content));
  });
  for (const message of messages) {
    if (message.role === 'user' && message.content.some((block) => block.type === 'tool_result')) {
      message.content = [
        ...message.content.filter((block) => block.type === 'tool_result'),
        ...message.content.filter((block) => block.type !== 'tool_result')
      ];
    }
  }
  if (messages.length && messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: [{ type: 'text', text: '(session resumed)' }] });
  }
  // Prompt caching: one breakpoint after tools+system, one on the newest turn
  // so each loop step reuses the previous step's prefix.
  if (systemBlocks.length) {
    systemBlocks[systemBlocks.length - 1].cache_control = { type: 'ephemeral' };
  }
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.content.length) {
    lastMessage.content[lastMessage.content.length - 1].cache_control = { type: 'ephemeral' };
  }
  return { system: systemBlocks, messages };
}

function processAnthropicStreamEventBlock(block, state, callbacks) {
  const normalized = block.replace(/\r/g, '');
  const dataLines = normalized
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  if (!dataLines.length) {
    return false;
  }
  const data = dataLines.join('\n');
  if (!data) {
    return false;
  }
  const payload = JSON.parse(data);
  switch (payload?.type) {
    case 'content_block_start': {
      const contentBlock = payload.content_block;
      state.blocks[payload.index] =
        contentBlock?.type === 'tool_use'
          ? { type: 'tool_use', id: contentBlock.id || '', name: contentBlock.name || '', inputJson: '' }
          : { type: contentBlock?.type || 'text' };
      break;
    }
    case 'content_block_delta': {
      const delta = payload.delta;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
        state.content += delta.text;
        callbacks?.onTextDelta?.(delta.text, state.content);
      } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const blockState = state.blocks[payload.index];
        if (blockState?.type === 'tool_use') {
          blockState.inputJson += delta.partial_json;
        }
      }
      break;
    }
    case 'message_delta':
      if (payload.delta?.stop_reason) {
        state.stopReason = payload.delta.stop_reason;
      }
      break;
    case 'message_stop':
      return true;
    case 'error':
      throw new Error(payload.error?.message || 'Anthropic stream error');
  }
  return false;
}

function finalizeAnthropicStreamState(state) {
  return {
    role: 'assistant',
    content: state.content,
    tool_calls: Object.keys(state.blocks)
      .map((key) => state.blocks[key])
      .filter((block) => block.type === 'tool_use' && block.name)
      .map((block) => ({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: block.inputJson || '{}' }
      })),
    stop_reason: state.stopReason
  };
}

async function readAnthropicChatStream(response, callbacks) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error('Streaming response body is not readable');
  }
  const decoder = new TextDecoder();
  const state = { content: '', blocks: {}, stopReason: null };
  let buffer = '';
  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      const separatorLength = buffer.startsWith('\r\n\r\n', boundary) ? 4 : 2;
      buffer = buffer.slice(boundary + separatorLength);
      finished = processAnthropicStreamEventBlock(block, state, callbacks);
      if (finished) {
        break;
      }
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }
  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail && !finished) {
    processAnthropicStreamEventBlock(tail, state, callbacks);
  }
  return finalizeAnthropicStreamState(state);
}

function normalizeAnthropicMessageToChatMessage(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  let text = '';
  const toolCalls = [];
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    } else if (block?.type === 'tool_use') {
      toolCalls.push({
        id: block.id || '',
        type: 'function',
        function: { name: block.name || '', arguments: JSON.stringify(block.input ?? {}) }
      });
    }
  }
  return { role: 'assistant', content: text, tool_calls: toolCalls, stop_reason: payload?.stop_reason };
}

async function invokeAnthropicChat(settings, conversation, mcpTools, signal, callbacks) {
  const rawApiKey = getLlmApiKey('anthropic');
  if (!rawApiKey) {
    throw new Error('No API key configured for provider anthropic');
  }
  const apiKey = normalizeLlmApiKey(rawApiKey);
  const { system, messages } = buildAnthropicRequestMessages(conversation);
  const tools = settings.toolCalling ? mcpTools.map(convertMcpToolToAnthropicTool) : [];
  if (tools.length) {
    tools[tools.length - 1].cache_control = { type: 'ephemeral' };
  }
  // Current Anthropic models reject `temperature`; `thinking` is intentionally
  // omitted (defaults to adaptive on models that support it).
  const response = await fetch(getAnthropicMessagesUrl(settings.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: settings.maxOutputTokens,
      system: system.length ? system : undefined,
      messages,
      stream: true,
      tools: tools.length ? tools : undefined
    }),
    signal
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload?.error?.message ||
      payload?.message ||
      `LLM request failed with status ${response.status}`;
    throw new Error(message);
  }
  const contentType = response.headers.get('content-type') || '';
  const message = contentType.includes('text/event-stream')
    ? await readAnthropicChatStream(response, callbacks)
    : normalizeAnthropicMessageToChatMessage(await response.json().catch(() => null));
  if (message.stop_reason === 'refusal') {
    message.tool_calls = [];
    if (!message.content?.trim()) {
      message.content =
        'The model declined this request (safety refusal). Please rephrase the request or try a different approach.';
    }
  }
  return message;
}

// Lists model ids from the configured provider (GET /models for
// OpenAI-compatible endpoints, GET /v1/models for Anthropic) using the stored
// API key for that provider.
async function listLlmModels(providerRaw, baseUrlRaw) {
  const provider = sanitizeLlmProvider(providerRaw);
  const rawApiKey = getLlmApiKey(provider);
  if (!rawApiKey) {
    throw new Error(`No API key configured for provider ${provider}; save the API key first`);
  }
  const apiKey = normalizeLlmApiKey(rawApiKey);
  let url;
  let headers;
  if (provider === 'anthropic') {
    const baseUrl = sanitizeLlmBaseUrl(baseUrlRaw, 'anthropic') || DEFAULT_ANTHROPIC_BASE_URL;
    url = `${baseUrl.replace(/\/$/, '')}/v1/models?limit=100`;
    headers = { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION };
  } else {
    const baseUrl = sanitizeLlmBaseUrl(baseUrlRaw, provider);
    if (!baseUrl) {
      throw new Error('LLM base URL is not configured');
    }
    url = `${baseUrl.replace(/\/$/, '')}/models`;
    headers = { Authorization: `Bearer ${apiKey}` };
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.error?.message ||
        payload?.message ||
        `Model list request failed with status ${response.status}`
    );
  }
  const payload = await response.json().catch(() => null);
  return (Array.isArray(payload?.data) ? payload.data : [])
    .map((model) => (typeof model?.id === 'string' ? model.id.trim() : ''))
    .filter(Boolean)
    .sort();
}

async function invokeAssistantChat(settings, conversation, mcpTools, signal, callbacks) {
  if (settings.provider === 'anthropic') {
    return await invokeAnthropicChat(settings, conversation, mcpTools, signal, callbacks);
  }
  const openAiTools = settings.toolCalling ? mcpTools.map(convertMcpToolToOpenAiTool) : [];
  return await invokeOpenAiCompatibleChat(settings, conversation, openAiTools, signal, callbacks);
}

function extractAssistantTextContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item?.type === 'text' && typeof item.text === 'string') {
          return item.text;
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function isScriptAttachToolName(name) {
  return name === 'node_attach_script' || name === 'scene_attach_script';
}

function getScriptWritePathFromToolResult(toolResult) {
  const path = toolResult?.structuredContent?.path ?? toolResult?.path;
  return typeof path === 'string' && path.trim() ? path.trim() : '';
}

function getScriptDiagnosticsErrorCount(toolResult) {
  const summary = toolResult?.structuredContent?.summary ?? toolResult?.summary;
  const count = Number(summary?.errorCount);
  return Number.isFinite(count) ? count : 0;
}

async function tryCollectAssistantContextTool(name, args = {}) {
  try {
    const result = await callEmbeddedMcp('tools/call', {
      name,
      arguments: { timeout_ms: 3000, ...args }
    });
    if (result?.isError) {
      return null;
    }
    return result?.structuredContent ?? null;
  } catch {
    return null;
  }
}

function compactJsonForAssistantContext(value, maxChars = 1200) {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') {
      return '';
    }
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  } catch {
    return '';
  }
}

// Collects a compact editor-state snapshot at run start so the model does not
// spend tool steps rediscovering basics. Every probe is best-effort: when the
// editor bridge is not ready (no window, no project) the section is skipped.
async function buildAssistantEditorContextEntry() {
  const sections = [];
  const [status, project, selected, camera, root] = await Promise.all([
    tryCollectAssistantContextTool('editor_status'),
    tryCollectAssistantContextTool('project_get_current'),
    tryCollectAssistantContextTool('scene_get_selected_nodes'),
    tryCollectAssistantContextTool('camera_get_active'),
    tryCollectAssistantContextTool('scene_get_root_node')
  ]);
  if (status) {
    sections.push(`editor_status: ${compactJsonForAssistantContext(status)}`);
  }
  if (project) {
    sections.push(`current_project: ${compactJsonForAssistantContext(project)}`);
  }
  if (root?.node?.id) {
    sections.push(`scene_root: ${compactJsonForAssistantContext(root.node)}`);
    const children = await tryCollectAssistantContextTool('node_get_children', {
      parent: root.node.id
    });
    if (children?.subNodes) {
      sections.push(`scene_root_children: ${compactJsonForAssistantContext(children.subNodes, 2000)}`);
    }
  }
  if (selected) {
    sections.push(`selected_nodes: ${compactJsonForAssistantContext(selected)}`);
  }
  if (camera) {
    sections.push(`active_camera: ${compactJsonForAssistantContext(camera)}`);
  }
  if (!sections.length) {
    return null;
  }
  return {
    role: 'system',
    content: `Editor state snapshot, auto-collected when this run started (it changes as you edit; re-query with read-only tools when in doubt):\n${sections.join('\n')}`
  };
}

async function runAssistantLoop(sessionId, run) {
  const session = findAssistantSession(sessionId);
  if (!session) {
    throw new Error(`Unknown assistant session: ${sessionId}`);
  }
  const settings = sanitizeLlmSettings(editorGlobalConfig.llm);
  const tools = settings.toolCalling ? await listAssistantMcpTools() : [];
  const history = await readAssistantSessionMessages(sessionId);
  const conversation = [
    {
      role: 'system',
      content: buildAssistantSystemPrompt(settings)
    },
    ...normalizeAssistantHistoryToChatMessages(history)
  ];
  if (settings.toolCalling && tools.length) {
    // Appended after history (not at index 1) so context-budget truncation of
    // old blocks never drops the fresh snapshot.
    const contextEntry = await buildAssistantEditorContextEntry();
    if (contextEntry) {
      conversation.push(contextEntry);
    }
  }
  const maxToolSteps = settings.maxToolSteps;
  for (let step = 0; maxToolSteps === null || step < maxToolSteps; step++) {
    assertAssistantRunActive(run, sessionId);
    enforceAssistantScreenshotBudget(conversation);
    enforceAssistantContextBudget(conversation);
    const streamedMessage = createAssistantMessage('assistant', '', 'pending');
    let hasStreamedText = false;
    let streamedContent = '';
    let message;
    try {
      message = await invokeAssistantChat(
        settings,
        conversation,
        tools,
        run.abortController.signal,
        {
          onTextDelta(delta, content) {
            if (!hasStreamedText) {
              hasStreamedText = true;
              emitAssistantMessageStarted(sessionId, streamedMessage);
            }
            streamedContent = content;
            emitAssistantMessageDelta(sessionId, streamedMessage.id, delta, content);
          }
        }
      );
    } catch (err) {
      if (hasStreamedText && streamedContent.trim()) {
        emitAssistantMessageCompleted(sessionId, streamedMessage.id, streamedContent, 'error');
      }
      throw err;
    }
    const textContent = extractAssistantTextContent(message.content);
    const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .filter((toolCall) => toolCall?.function?.name)
      .map((toolCall, index) =>
        toolCall.id ? toolCall : { ...toolCall, id: `call_${streamedMessage.id}_${index}` }
      );
    if (textContent) {
      if (!hasStreamedText) {
        emitAssistantMessageStarted(sessionId, streamedMessage);
        emitAssistantMessageDelta(sessionId, streamedMessage.id, textContent, textContent);
      }
      emitAssistantMessageCompleted(sessionId, streamedMessage.id, textContent, 'complete');
    }
    if (textContent || toolCalls.length) {
      await appendAssistantMessage(sessionId, 'assistant', textContent, 'complete', {
        id: streamedMessage.id,
        createdAt: streamedMessage.createdAt,
        toolCalls
      });
      // A single conversation entry carries both the text and the tool calls;
      // pushing them separately would duplicate the text in later requests.
      conversation.push(
        toolCalls.length
          ? { role: 'assistant', content: textContent || '', tool_calls: toolCalls }
          : { role: 'assistant', content: textContent }
      );
    }
    if (!toolCalls.length) {
      return;
    }
    for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
      const toolCall = toolCalls[toolIndex];
      assertAssistantRunActive(run, sessionId);
      const toolName = toolCall?.function?.name;
      if (!toolName) {
        throw new Error('LLM tool call is missing function name');
      }
      if (
        !run.sceneCheckpointTaken &&
        assistantReadonlyToolNames.size &&
        !assistantReadonlyToolNames.has(toolName)
      ) {
        // Best-effort rollback point before this run's first mutating call;
        // scene_restore reverts to it if the edits go wrong.
        run.sceneCheckpointTaken = true;
        try {
          await callEmbeddedMcp('tools/call', {
            name: 'scene_checkpoint',
            arguments: { label: 'auto: before assistant edits', timeout_ms: 15000 }
          });
        } catch {
          // No project/scene open or checkpoint failed — proceed without one.
        }
      }
      const toolResult = await callAssistantTool(
        sessionId,
        run,
        toolName,
        toolCall.function.arguments,
        settings
      );
      const toolContent = JSON.stringify(toolResult?.structuredContent ?? toolResult ?? null, null, 2);
      await appendAssistantMessage(sessionId, 'tool', toolContent, toolResult?.isError ? 'error' : 'complete', {
        toolCallId: toolCall.id,
        toolName
      });
      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolContent
      });
      if (!toolResult?.isError) {
        const imageAttachments = extractToolResultImageAttachments(toolName, toolResult);
        if (imageAttachments.length) {
          // OpenAI-compatible tool messages are text-only, so tool-produced
          // images (e.g. editor_screenshot) ride a synthetic user message the
          // model can actually see. The persisted copy is flagged synthetic so
          // the UI does not present it as something the user typed.
          const screenshotText = `[Image result of tool call ${toolName}]`;
          await appendAssistantMessage(sessionId, 'user', screenshotText, 'complete', {
            attachments: imageAttachments,
            synthetic: true
          });
          conversation.push(buildSyntheticScreenshotChatEntry(screenshotText, imageAttachments));
          enforceAssistantScreenshotBudget(conversation);
        }
      }
      if (toolName === 'script_write_source' && !toolResult?.isError) {
        const path = getScriptWritePathFromToolResult(toolResult);
        if (path) {
          const diagnosticsResult = await callAssistantTool(
            sessionId,
            run,
            'script_diagnostics',
            JSON.stringify({ path }),
            settings
          );
          const diagnosticsContent = JSON.stringify(
            diagnosticsResult?.structuredContent ?? diagnosticsResult ?? null,
            null,
            2
          );
          conversation.push({
            role: 'system',
            content: `Automatic script_diagnostics result for ${path}:\n${diagnosticsContent}`
          });
          const hasLaterAttachTool = toolCalls
            .slice(toolIndex + 1)
            .some((call) => isScriptAttachToolName(call?.function?.name));
          if (getScriptDiagnosticsErrorCount(diagnosticsResult) > 0 && hasLaterAttachTool) {
            break;
          }
        }
      }
    }
  }
  throw new Error(`Assistant exceeded the maximum tool step limit of ${maxToolSteps}`);
}

async function cancelAssistantRun(sessionId, scopeId) {
  const session = findAssistantSession(sessionId, scopeId);
  if (!session) {
    return false;
  }
  const run = getAssistantRun(sessionId);
  let cancelled = false;
  if (run) {
    run.cancelled = true;
    run.abortController.abort();
    cancelled = true;
  }
  for (const [callId, pending] of assistantPendingToolApprovals) {
    if (pending.sessionId === sessionId) {
      assistantPendingToolApprovals.delete(callId);
      pending.reject(new Error('Assistant run was cancelled during tool approval'));
      sendAssistantEvent({
        type: 'tool_call_approval_resolved',
        sessionId,
        callId,
        approved: false
      });
      cancelled = true;
    }
  }
  return cancelled;
}

async function approveAssistantToolCall(sessionId, callId, scopeId) {
  const session = findAssistantSession(sessionId, scopeId);
  if (!session) {
    return false;
  }
  const pending = assistantPendingToolApprovals.get(callId);
  if (!pending || pending.sessionId !== sessionId) {
    return false;
  }
  clearPendingAssistantToolApproval(callId, true, true);
  pending.resolve(true);
  return true;
}

async function rejectAssistantToolCall(sessionId, callId, scopeId) {
  const session = findAssistantSession(sessionId, scopeId);
  if (!session) {
    return false;
  }
  const pending = assistantPendingToolApprovals.get(callId);
  if (!pending || pending.sessionId !== sessionId) {
    return false;
  }
  clearPendingAssistantToolApproval(callId, false, true);
  pending.reject(new Error('Tool approval was denied by the user'));
  return true;
}

async function sendAssistantMessage(sessionId, content, attachments, scopeId) {
  const session = findAssistantSession(sessionId, scopeId);
  if (!session) {
    throw new Error(`Unknown assistant session: ${sessionId}`);
  }
  if (getAssistantRun(sessionId)) {
    throw new Error('An assistant run is already active for this session');
  }
  const userMessage = await appendAssistantMessage(sessionId, 'user', content, 'complete', {
    attachments
  });
  session.active = true;
  session.updatedAt = new Date().toISOString();
  await saveAssistantSessions();
  sendAssistantEvent({ type: 'run_state', sessionId, active: true, error: null });
  sendAssistantEvent({ type: 'session_updated', session });
  const run = {
    sessionId,
    cancelled: false,
    abortController: new AbortController()
  };
  setAssistantRun(sessionId, run);
  let finalError = null;
  try {
    await runAssistantLoop(sessionId, run);
    return userMessage;
  } catch (err) {
    finalError =
      run.cancelled || err?.name === 'AbortError'
        ? 'Assistant run was cancelled'
        : err instanceof Error
          ? err.message
          : String(err);
    await appendAssistantMessage(sessionId, 'assistant', finalError, 'error');
    sendAssistantEvent({ type: 'run_state', sessionId, active: false, error: finalError });
    throw err;
  } finally {
    clearAssistantRun(sessionId);
    session.active = false;
    session.updatedAt = new Date().toISOString();
    await saveAssistantSessions();
    if (!finalError) {
      sendAssistantEvent({ type: 'run_state', sessionId, active: false, error: null });
    }
    sendAssistantEvent({ type: 'session_updated', session });
  }
}

function getConfiguredMcpServiceUrl(port = mcpServiceConfig.port) {
  const token = mcpServiceConfig.token ? `?token=${mcpServiceConfig.token}` : '';
  return `http://127.0.0.1:${port}${MCP_HTTP_PATH}${token}`;
}

function isMcpServiceRunning() {
  return !!mcpServiceServer?.listening;
}

function getGlobalSettingsPayload() {
  return {
    mcp: {
      enabled: !!mcpServiceConfig.enabled,
      port: sanitizeMcpServicePort(mcpServiceConfig.port),
      running: isMcpServiceRunning(),
      url: getConfiguredMcpServiceUrl()
    },
    defaultRHI: sanitizeEditorRHI(editorGlobalConfig.defaultRHI),
    llm: {
      ...sanitizeLlmSettings(editorGlobalConfig.llm),
      apiKeyConfigured: hasLlmApiKeyConfigured(editorGlobalConfig.llm?.provider),
      apiKeyStorageSecure: safeStorage.isEncryptionAvailable()
    }
  };
}

async function applyMcpServiceConfig(nextConfig) {
  const nextEnabled =
    typeof nextConfig?.enabled === 'boolean' ? nextConfig.enabled : !!mcpServiceConfig.enabled;
  const nextPort =
    nextConfig?.port === undefined ? sanitizeMcpServicePort(mcpServiceConfig.port) : Number(nextConfig.port);
  if (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
    throw new Error('Please enter an integer TCP port between 1 and 65535.');
  }
  const portChanged = nextPort !== mcpServiceConfig.port;
  const enabledChanged = nextEnabled !== mcpServiceConfig.enabled;
  mcpServiceConfig = {
    enabled: nextEnabled,
    port: nextPort,
    token: sanitizeMcpServiceToken(mcpServiceConfig.token) || crypto.randomBytes(16).toString('hex')
  };
  await saveMcpServiceConfig();
  if (!nextEnabled) {
    if (isMcpServiceRunning()) {
      await stopLocalMcpService({ persistEnabled: false, interactive: false });
    }
    return;
  }
  if (portChanged && isMcpServiceRunning()) {
    await restartLocalMcpService({ interactive: false });
    return;
  }
  if (enabledChanged || !isMcpServiceRunning()) {
    await startLocalMcpService({ persistEnabled: false, interactive: false });
  }
}

async function applyGlobalSettings(nextSettings) {
  if (nextSettings?.mcp) {
    await applyMcpServiceConfig(nextSettings.mcp);
  }
  if (Object.prototype.hasOwnProperty.call(nextSettings ?? {}, 'defaultRHI')) {
    editorGlobalConfig.defaultRHI = sanitizeEditorRHI(nextSettings.defaultRHI);
  }
  if (Object.prototype.hasOwnProperty.call(nextSettings ?? {}, 'llm')) {
    editorGlobalConfig.llm = sanitizeLlmSettings(nextSettings.llm);
  }
  await saveEditorGlobalConfig();
  return getGlobalSettingsPayload();
}

function getConfiguredEditorRHI() {
  return sanitizeEditorRHI(process.env.ZEPHYR_EDITOR_DEVICE || editorGlobalConfig.defaultRHI);
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isAllowedMcpOrigin(origin) {
  if (!origin || origin === 'null') {
    return true;
  }
  try {
    const url = new URL(origin);
    if (url.protocol === 'file:') {
      return true;
    }
    if (url.protocol === `${EDITOR_PROTOCOL}:` && url.host === 'app') {
      return true;
    }
    if ((url.protocol === 'http:' || url.protocol === 'https:') && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function buildMcpHttpHeaders(protocolVersion, origin, extraHeaders = {}) {
  const headers = {
    'Cache-Control': 'no-store',
    ...extraHeaders
  };
  if (protocolVersion) {
    headers['MCP-Protocol-Version'] = protocolVersion;
  }
  if (origin && isAllowedMcpOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return headers;
}

function writeMcpJsonResponse(res, statusCode, body, protocolVersion, origin, extraHeaders = {}) {
  res.writeHead(
    statusCode,
    buildMcpHttpHeaders(protocolVersion, origin, {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders
    })
  );
  res.end(JSON.stringify(body));
}

function writeMcpEmptyResponse(res, statusCode, protocolVersion, origin, extraHeaders = {}) {
  res.writeHead(statusCode, buildMcpHttpHeaders(protocolVersion, origin, extraHeaders));
  res.end();
}

function createJsonRpcError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message
    }
  };
}

function validateMcpHeaderMirrors(headers, message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.method !== 'string') {
    return;
  }
  const methodHeader = headers['mcp-method'];
  if (typeof methodHeader === 'string' && methodHeader.trim() && methodHeader !== message.method) {
    throw Object.assign(new Error('Mcp-Method header does not match request body method'), {
      statusCode: 400,
      rpcCode: -32600
    });
  }
  const nameHeader = headers['mcp-name'];
  if (typeof nameHeader !== 'string' || !nameHeader.trim()) {
    return;
  }
  let bodyName = null;
  if (message.method === 'tools/call') {
    bodyName = message.params?.name ?? null;
  } else if (message.method === 'resources/read' || message.method === 'prompts/get') {
    bodyName = message.params?.uri ?? null;
  }
  if (bodyName !== null && bodyName !== nameHeader) {
    throw Object.assign(new Error('Mcp-Name header does not match request body'), {
      statusCode: 400,
      rpcCode: -32600
    });
  }
}

async function readMcpHttpBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_MCP_HTTP_BODY_BYTES) {
      throw Object.assign(new Error(`MCP request body exceeds ${MAX_MCP_HTTP_BODY_BYTES} bytes`), {
        statusCode: 413
      });
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    throw Object.assign(new Error('MCP request body is empty'), {
      statusCode: 400,
      rpcCode: -32600
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('MCP request body is not valid JSON'), {
      statusCode: 400,
      rpcCode: -32700
    });
  }
}

function inferMcpProtocolVersion(req, body) {
  const headerVersion = req.headers['mcp-protocol-version'];
  if (typeof headerVersion === 'string' && headerVersion.trim()) {
    return headerVersion.trim();
  }
  if (!Array.isArray(body) && body?.method === 'initialize' && typeof body?.params?.protocolVersion === 'string') {
    return body.params.protocolVersion;
  }
  return '2024-11-05';
}

async function dispatchMcpHttpMessage(message, headers) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return createJsonRpcError(null, -32600, 'Invalid JSON-RPC message');
  }
  validateMcpHeaderMirrors(headers, message);
  if (typeof message.method !== 'string' || !message.method) {
    return createJsonRpcError(message.id ?? null, -32600, 'JSON-RPC request is missing method');
  }
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    await sendRpcNotificationToMcpWorker(message);
    return null;
  }
  try {
    return await sendRpcToMcpWorker(message);
  } catch (err) {
    return createJsonRpcError(message.id ?? null, -32000, err instanceof Error ? err.message : String(err));
  }
}

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Loopback + Origin checks stop browsers, but any local process could still
// reach the endpoint; the bearer token (also accepted as ?token= for MCP
// clients that cannot send headers) gates those callers.
function isAuthorizedMcpRequest(req, requestUrl) {
  const token = sanitizeMcpServiceToken(mcpServiceConfig.token);
  if (!token) {
    return true;
  }
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const queryToken = requestUrl.searchParams.get('token') || '';
  return timingSafeEqualStrings(bearer, token) || timingSafeEqualStrings(queryToken, token);
}

async function handleMcpHttpRequest(req, res) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  if (requestUrl.pathname !== MCP_HTTP_PATH) {
    writeMcpEmptyResponse(res, 404, null, origin);
    return;
  }
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    writeMcpEmptyResponse(res, 403, null, origin);
    return;
  }
  if (!isAllowedMcpOrigin(origin)) {
    writeMcpEmptyResponse(res, 403, null, origin);
    return;
  }
  if (req.method === 'OPTIONS') {
    writeMcpEmptyResponse(res, 204, null, origin, {
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Authorization'
    });
    return;
  }
  if (req.method === 'GET') {
    writeMcpEmptyResponse(res, 405, null, origin, {
      Allow: 'POST, OPTIONS'
    });
    return;
  }
  if (req.method !== 'POST') {
    writeMcpEmptyResponse(res, 405, null, origin, {
      Allow: 'POST, GET, OPTIONS'
    });
    return;
  }
  if (!isAuthorizedMcpRequest(req, requestUrl)) {
    writeMcpEmptyResponse(res, 401, null, origin);
    return;
  }
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('application/json')) {
    writeMcpEmptyResponse(res, 415, null, origin);
    return;
  }
  try {
    const body = await readMcpHttpBody(req);
    const protocolVersion = inferMcpProtocolVersion(req, body);
    const messages = Array.isArray(body) ? body : [body];
    if (messages.length === 0) {
      writeMcpJsonResponse(res, 400, createJsonRpcError(null, -32600, 'JSON-RPC batch must not be empty'), protocolVersion, origin);
      return;
    }
    const responses = [];
    for (const message of messages) {
      const response = await dispatchMcpHttpMessage(message, req.headers);
      if (response) {
        responses.push(response);
      }
    }
    if (responses.length === 0) {
      writeMcpEmptyResponse(res, 202, protocolVersion, origin);
      return;
    }
    writeMcpJsonResponse(res, 200, Array.isArray(body) ? responses : responses[0], protocolVersion, origin);
  } catch (err) {
    const protocolVersion = inferMcpProtocolVersion(req, null);
    if (err?.rpcCode) {
      writeMcpJsonResponse(
        res,
        err.statusCode ?? 400,
        createJsonRpcError(null, err.rpcCode, err.message),
        protocolVersion,
        origin
      );
      return;
    }
    writeMcpJsonResponse(
      res,
      err?.statusCode ?? 400,
      createJsonRpcError(null, -32700, err instanceof Error ? err.message : String(err)),
      protocolVersion,
      origin
    );
  }
}

function createApplicationMenu() {
  const running = isMcpServiceRunning();
  const statusText = running
    ? `Running on ${getConfiguredMcpServiceUrl()}`
    : `Stopped (configured port ${mcpServiceConfig.port})`;
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [{ role: 'quit' }]
    },
    {
      label: 'MCP',
      submenu: [
        {
          label: `Status: ${statusText}`,
          enabled: false
        },
        {
          label: 'Start MCP Service',
          enabled: !running,
          click: () => {
            void startLocalMcpService({ persistEnabled: true, interactive: true });
          }
        },
        {
          label: 'Stop MCP Service',
          enabled: running,
          click: () => {
            void stopLocalMcpService({ persistEnabled: true, interactive: true });
          }
        },
        {
          label: 'Set MCP Port...',
          click: () => {
            void promptAndApplyMcpPort();
          }
        },
        {
          label: 'Copy MCP URL',
          click: () => {
            clipboard.writeText(getConfiguredMcpServiceUrl());
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }]
    }
  ]);
}

function rebuildApplicationMenu() {
  Menu.setApplicationMenu(null);
}

async function promptForMcpPort(currentPort) {
  const channel = `zephyr-editor:mcp-port:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  return await new Promise((resolve) => {
    let settled = false;
    const promptWindow = new BrowserWindow({
      width: 420,
      height: 210,
      resizable: false,
      minimizable: false,
      maximizable: false,
      parent: mainWindowRef ?? undefined,
      modal: !!mainWindowRef,
      show: false,
      title: 'Set MCP Port',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      ipcMain.removeAllListeners(channel);
      if (!promptWindow.isDestroyed()) {
        promptWindow.close();
      }
      resolve(value);
    };
    ipcMain.once(channel, (_event, value) => {
      finish(value);
    });
    promptWindow.on('closed', () => {
      if (!settled) {
        settled = true;
        ipcMain.removeAllListeners(channel);
        resolve(null);
      }
    });
    const html = `<!doctype html>
<html>
  <body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#1f1f1f;color:#f2f2f2;">
    <form id="form" style="padding:20px;display:flex;flex-direction:column;gap:12px;">
      <div style="font-size:20px;font-weight:600;">Set MCP Port</div>
      <label for="port">Local TCP port</label>
      <input id="port" type="number" min="1" max="65535" value="${String(currentPort)}"
        style="padding:10px;border:1px solid #555;border-radius:6px;background:#111;color:#f2f2f2;font-size:14px;" />
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
        <button type="button" id="cancel" style="padding:8px 14px;">Cancel</button>
        <button type="submit" style="padding:8px 14px;">Save</button>
      </div>
    </form>
    <script>
      const { ipcRenderer } = require('electron');
      const channel = ${JSON.stringify(channel)};
      const input = document.getElementById('port');
      document.getElementById('cancel').addEventListener('click', () => ipcRenderer.send(channel, null));
      document.getElementById('form').addEventListener('submit', (event) => {
        event.preventDefault();
        ipcRenderer.send(channel, input.value);
      });
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    </script>
  </body>
</html>`;
    void promptWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    promptWindow.once('ready-to-show', () => promptWindow.show());
  });
}

async function promptAndApplyMcpPort() {
  const value = await promptForMcpPort(mcpServiceConfig.port);
  if (value === null) {
    return;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    dialog.showErrorBox('Invalid MCP Port', 'Please enter an integer TCP port between 1 and 65535.');
    return;
  }
  if (port === mcpServiceConfig.port) {
    return;
  }
  mcpServiceConfig.port = port;
  await saveMcpServiceConfig();
  if (isMcpServiceRunning()) {
    await restartLocalMcpService({ interactive: true });
  }
  rebuildApplicationMenu();
}

async function startLocalMcpService({ persistEnabled = false, interactive = false } = {}) {
  writeStderrLine(
    `[mcp:http-start-request] pid=${process.pid} port=${mcpServiceConfig.port} running=${isMcpServiceRunning()} starting=${!!mcpServiceStartPromise}`
  );
  void writeDiagnosticLog(
    `[mcp:http-start-request] pid=${process.pid} port=${mcpServiceConfig.port} running=${isMcpServiceRunning()} starting=${!!mcpServiceStartPromise}`
  );
  if (isMcpServiceRunning()) {
    if (persistEnabled && !mcpServiceConfig.enabled) {
      mcpServiceConfig.enabled = true;
      await saveMcpServiceConfig();
      rebuildApplicationMenu();
    }
    return getConfiguredMcpServiceUrl();
  }
  if (mcpServiceStartPromise) {
    return await mcpServiceStartPromise;
  }
  const port = sanitizeMcpServicePort(mcpServiceConfig.port);
  mcpServiceConfig.port = port;
  mcpServiceStartPromise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void handleMcpHttpRequest(req, res);
    });
    const onError = (err) => {
      server.removeAllListeners();
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      server.on('error', (err) => {
        writeStderrLine(`[mcp:http-error] ${err?.stack || err}`);
        void writeDiagnosticLog(`[mcp:http-error] ${err?.stack || err}`);
      });
      mcpServiceServer = server;
      resolve(getConfiguredMcpServiceUrl());
    });
  });
  try {
    const url = await mcpServiceStartPromise;
    if (persistEnabled) {
      mcpServiceConfig.enabled = true;
      await saveMcpServiceConfig();
    }
    writeStderrLine(`[mcp:http-started] ${url}`);
    void writeDiagnosticLog(`[mcp:http-started] ${url}`);
    return url;
  } catch (err) {
    if (persistEnabled) {
      mcpServiceConfig.enabled = false;
      await saveMcpServiceConfig();
    }
    const message = err instanceof Error ? err.message : String(err);
    const owner = err?.code === 'EADDRINUSE' ? await getWindowsListeningPortOwner(port).catch(() => null) : null;
    const ownerDetail = formatWindowsPortOwner(owner);
    const detail = `[mcp:http-start-failed] pid=${process.pid} port=${port} code=${err?.code || ''} ${message}${ownerDetail ? ` owner=${ownerDetail}` : ''}`;
    writeStderrLine(detail);
    void writeDiagnosticLog(detail);
    if (interactive) {
      dialog.showErrorBox(
        'Failed to Start MCP Service',
        ownerDetail ? `${message}\n\nPort owner: ${ownerDetail}` : message
      );
    }
    throw err;
  } finally {
    mcpServiceStartPromise = null;
    rebuildApplicationMenu();
  }
}

async function stopLocalMcpService({ persistEnabled = false, interactive = false } = {}) {
  if (mcpServiceStartPromise) {
    await mcpServiceStartPromise.catch(() => undefined);
  }
  if (!mcpServiceServer) {
    if (persistEnabled && mcpServiceConfig.enabled) {
      mcpServiceConfig.enabled = false;
      await saveMcpServiceConfig();
      rebuildApplicationMenu();
    }
    return;
  }
  const server = mcpServiceServer;
  mcpServiceServer = null;
  try {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    if (persistEnabled) {
      mcpServiceConfig.enabled = false;
      await saveMcpServiceConfig();
    }
    writeStderrLine('[mcp:http-stopped]');
    void writeDiagnosticLog('[mcp:http-stopped]');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (interactive) {
      dialog.showErrorBox('Failed to Stop MCP Service', message);
    }
    throw err;
  } finally {
    rebuildApplicationMenu();
  }
}

async function restartLocalMcpService({ interactive = false } = {}) {
  const shouldRemainEnabled = mcpServiceConfig.enabled;
  await stopLocalMcpService({ persistEnabled: false, interactive });
  if (shouldRemainEnabled) {
    await startLocalMcpService({ persistEnabled: false, interactive });
  }
}

function startEmbeddedMcpWorker() {
  if (mcpStartupPromise) {
    return mcpStartupPromise;
  }
  mcpStartupPromise = new Promise((resolve, reject) => {
    mcpWorkerStopping = false;
    let settled = false;
    const worker = new Worker(path.join(__dirname, '..', 'mcp', 'editor-mcp-server.mjs'), {
      workerData: {
        transport: 'ipc',
        port: 0,
        editorUrl: process.env.ZEPHYR_EDITOR_ELECTRON_URL || process.env.EDITOR_URL || undefined
      }
    });
    mcpWorker = worker;
    worker.on('message', (message) => {
      if (!message || typeof message !== 'object') {
        return;
      }
      if (message.type === 'ready') {
        mcpBridgeInfo = message.bridge ?? null;
        settled = true;
        resolve(mcpBridgeInfo);
        return;
      }
      if (message.type === 'rpcResult') {
        const pending = pendingRpcRequests.get(message.requestId);
        if (pending) {
          pendingRpcRequests.delete(message.requestId);
          pending.resolve(message.response);
        }
      }
    });
    worker.once('error', (err) => {
      rejectPendingRpcRequests(err);
      mcpWorker = null;
      mcpBridgeInfo = null;
      mcpStartupPromise = null;
      if (!settled) {
        reject(err);
      } else {
        writeStderrLine(`[mcp:worker-error] ${err?.stack || err}`);
        void writeDiagnosticLog(`[mcp:worker-error] ${err?.stack || err}`);
      }
    });
    worker.once('exit', (code) => {
      const err = new Error(`Embedded MCP worker exited with code ${code}`);
      rejectPendingRpcRequests(err);
      mcpWorker = null;
      mcpBridgeInfo = null;
      mcpStartupPromise = null;
      if (!settled) {
        reject(err);
      } else if (code !== 0 && !mcpWorkerStopping) {
        writeStderrLine(`[mcp:worker-exit] ${code}`);
        void writeDiagnosticLog(`[mcp:worker-exit] ${code}`);
      }
    });
  });
  return mcpStartupPromise;
}

function buildEditorLaunchUrl(rawUrl, device) {
  const url = new URL(rawUrl);
  url.searchParams.set('desktop', 'electron');
  url.searchParams.set('device', device);
  // Run the editor with the reverse-Z depth convention (picked up by the
  // pre-module bootstrap script in index.html).
  if (process.env.ZEPHYR_EDITOR_REVERSE_Z || process.argv.includes('--reverse-z')) {
    url.searchParams.set('reverseZ', '1');
  }
  if (mcpBridgeInfo?.port) {
    url.searchParams.set('mcp', String(mcpBridgeInfo.port));
  }
  if (mcpBridgeInfo?.token) {
    url.searchParams.set('mcpToken', String(mcpBridgeInfo.token));
  }
  return url.toString();
}

function stripMcpQueryParams(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete('mcp');
    url.searchParams.delete('mcpPort');
    url.searchParams.delete('mcpToken');
    return url.toString();
  } catch {
    return rawUrl;
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: EDITOR_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function createWindow(options = {}) {
  const hidden = !!options.hidden;
  const webPreferences = editorWebPreferences();
  if (hidden) {
    // Hidden windows get their renderer throttled by default, which would
    // stall the rAF-driven render loop and any canvas capture.
    webPreferences.backgroundThrottling = false;
  }
  const mainWindow = new BrowserWindow({
    width: options.width ?? 1440,
    height: options.height ?? 960,
    minWidth: 960,
    minHeight: 640,
    show: !hidden,
    useContentSize: hidden,
    backgroundColor: '#1f1f1f',
    icon: editorIconPath(),
    webPreferences
  });
  mainWindowRef = mainWindow;
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
  });
  if (!hidden) {
    mainWindow.maximize();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalEditorUrl(url)) {
      createPreviewWindow(url);
      return { action: 'deny' };
    }
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const lineText = `[renderer:${level}] ${message} (${sourceId}:${line})`;
    writeStderrLine(lineText);
    writeDiagnosticLog(lineText);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    const lineText = `[renderer:load-failed] ${errorCode} ${errorDescription}: ${validatedURL}`;
    writeStderrLine(lineText);
    writeDiagnosticLog(lineText);
    if (headlessConfig?.oneShot && isMainFrame && errorCode !== -3 /* ERR_ABORTED */) {
      headlessExit(5);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const lineText = `[renderer:gone] ${details.reason} exitCode=${details.exitCode}`;
    writeStderrLine(lineText);
    writeDiagnosticLog(lineText);
    if (headlessConfig) {
      headlessExit(5);
    }
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    const lineText = `[renderer:preload-error] ${preloadPath}: ${error?.stack || error}`;
    writeStderrLine(lineText);
    writeDiagnosticLog(lineText);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    const screenshotPath = process.env.ZEPHYR_EDITOR_SCREENSHOT_PATH;
    if (!screenshotPath) {
      return;
    }
    setTimeout(async () => {
      try {
        const diagnostics = await mainWindow.webContents.executeJavaScript(
          `Promise.all([
            fetch('fonts/zef-16px.json').then((r) => ({ url: 'fonts/zef-16px.json', ok: r.ok, status: r.status, type: r.headers.get('content-type'), length: r.headers.get('content-length') })).catch((err) => ({ url: 'fonts/zef-16px.json', err: String(err) })),
            fetch('fonts/zef-16px.woff2').then((r) => ({ url: 'fonts/zef-16px.woff2', ok: r.ok, status: r.status, type: r.headers.get('content-type'), length: r.headers.get('content-length') })).catch((err) => ({ url: 'fonts/zef-16px.woff2', err: String(err) })),
            fetch('conf/app.json').then((r) => ({ url: 'conf/app.json', ok: r.ok, status: r.status, type: r.headers.get('content-type'), length: r.headers.get('content-length') })).catch((err) => ({ url: 'conf/app.json', err: String(err) })),
            fetch('images/logo_i.png').then((r) => ({ url: 'images/logo_i.png', ok: r.ok, status: r.status, type: r.headers.get('content-type'), length: r.headers.get('content-length') })).catch((err) => ({ url: 'images/logo_i.png', err: String(err) }))
          ]).then((resources) => ({
            href: location.href,
            readyState: document.readyState,
            resources,
            fontsStatus: document.fonts?.status,
            canvas: (() => {
              const canvas = document.querySelector('canvas');
              return canvas ? { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight } : null;
            })()
          }))`,
          true
        );
        await fs.writeFile(`${screenshotPath}.json`, JSON.stringify(diagnostics, null, 2));
        const image = await mainWindow.webContents.capturePage();
        await fs.writeFile(screenshotPath, image.toPNG());
        writeStderrLine(`[renderer:screenshot] ${screenshotPath}`);
      } catch (err) {
        writeStderrLine(`[renderer:screenshot-failed] ${err?.stack || err}`);
      }
    }, 3000);
  });

  if (options.url) {
    mainWindow.loadURL(options.url);
  } else {
    const devUrl = process.env.ZEPHYR_EDITOR_ELECTRON_URL;
    const device = getConfiguredEditorRHI();
    if (devUrl) {
      mainWindow.loadURL(buildEditorLaunchUrl(devUrl, device));
    } else {
      mainWindow.loadURL(buildEditorLaunchUrl(`${EDITOR_PROTOCOL}://app/index.html`, device));
    }
  }

  if (process.env.ZEPHYR_EDITOR_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function buildHeadlessPersistentUrl() {
  // Same URL as the interactive editor (embedded MCP worker is running, so
  // mcp/mcpToken params are included) plus the headless flag, which makes the
  // renderer pace its frame loop with timers instead of rAF (rAF stays at
  // ~1Hz for windows that were never shown).
  const base = process.env.ZEPHYR_EDITOR_ELECTRON_URL || `${EDITOR_PROTOCOL}://app/index.html`;
  const url = new URL(buildEditorLaunchUrl(base, getConfiguredEditorRHI()));
  url.searchParams.set('headless', '1');
  return url.toString();
}

function buildHeadlessOneShotUrl(config) {
  // The embedded MCP worker is not started in one-shot mode, so
  // buildEditorLaunchUrl emits no mcp/mcpToken params and the preview page
  // runs without the MCP bridge (matching the preview-window policy).
  const base = process.env.ZEPHYR_EDITOR_ELECTRON_URL || `${EDITOR_PROTOCOL}://app/index.html`;
  const url = new URL(buildEditorLaunchUrl(base, getConfiguredEditorRHI()));
  url.searchParams.set('project', config.project);
  if (config.scene) {
    url.searchParams.set('scene', config.scene);
  }
  url.searchParams.set('headless', '1');
  url.searchParams.set('frames', String(config.frames));
  url.searchParams.set('fixedDt', String(config.fixedDt));
  url.searchParams.set('dpr', '1');
  return url.toString();
}

function createPreviewWindow(url) {
  const previewWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#1f1f1f',
    icon: editorIconPath(),
    webPreferences: editorWebPreferences()
  });

  previewWindow.webContents.setWindowOpenHandler(({ url: childUrl }) => {
    if (/^https?:\/\//.test(childUrl)) {
      shell.openExternal(childUrl);
    }
    return { action: 'deny' };
  });
  previewWindow.loadURL(stripMcpQueryParams(url));
}

app.on('second-instance', () => {
  writeStderrLine(`[app:second-instance] pid=${process.pid}`);
  void writeDiagnosticLog(`[app:second-instance] pid=${process.pid}`);
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return;
  }
  if (mainWindowRef.isMinimized()) {
    mainWindowRef.restore();
  }
  mainWindowRef.focus();
});

function isInternalEditorUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === `${EDITOR_PROTOCOL}:` && url.host === 'app') {
      return true;
    }
    const devUrl = process.env.ZEPHYR_EDITOR_ELECTRON_URL;
    if (devUrl && /^https?:$/.test(url.protocol)) {
      return url.origin === new URL(devUrl).origin;
    }
  } catch {
    return false;
  }
  return false;
}

function editorDistRoot() {
  return path.join(__dirname, '..', 'dist');
}

function toEditorAssetPath(requestUrl) {
  const url = new URL(requestUrl);
  const rawPath = decodeURIComponent(url.pathname || '/');
  const normalized = path.posix.normalize(rawPath === '/' ? '/index.html' : rawPath);
  const relative = normalized.replace(/^\/+/, '');
  const root = path.resolve(editorDistRoot());
  const target = path.resolve(root, ...relative.split('/'));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Editor asset path escapes dist root: ${rawPath}`);
  }
  return target;
}

function toExtraResourcePath(requestUrl) {
  const url = new URL(requestUrl);
  const rawPath = decodeURIComponent(url.pathname || '/');
  const normalized = path.posix.normalize(rawPath);
  if (!normalized.startsWith('/vendor/')) {
    return null;
  }
  const relative = normalized.replace(/^\/+/, '');
  const root = path.resolve(process.resourcesPath, 'types');
  const target = path.resolve(root, ...relative.split('/'));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Editor type resource path escapes root: ${rawPath}`);
  }
  return target;
}

function registerEditorProtocol() {
  protocol.handle(EDITOR_PROTOCOL, async (request) => {
    let filePath = toEditorAssetPath(request.url);
    let exists = await pathExists(filePath);
    if (!exists) {
      const extraResourcePath = toExtraResourcePath(request.url);
      if (extraResourcePath && (await pathExists(extraResourcePath))) {
        filePath = extraResourcePath;
        exists = true;
      }
    }
    if (!exists) {
      return new Response('', {
        status: 404,
        statusText: 'Not Found'
      });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function storageBaseDir() {
  return path.join(app.getPath('userData'), 'editor-storage');
}

function sanitizeScopePart(value) {
  return String(value || 'default')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+$/, '_')
    .slice(0, 120);
}

async function getScopeRoot(scope) {
  let root;
  if (scope === 'meta') {
    root = path.join(storageBaseDir(), 'meta');
  } else if (scope === 'system') {
    root = path.join(storageBaseDir(), 'system');
  } else if (typeof scope === 'string' && scope.startsWith('project:')) {
    const projectScope = scope.slice('project:'.length);
    if (!projectScope || projectScope.includes('\0')) {
      throw new Error('Invalid project filesystem scope');
    }
    root = path.isAbsolute(projectScope)
      ? path.resolve(projectScope)
      : path.join(storageBaseDir(), 'projects', sanitizeScopePart(projectScope));
  } else {
    throw new Error(`Invalid filesystem scope: ${scope}`);
  }
  if (scope === 'meta' || scope === 'system' || !path.isAbsolute(root)) {
    await fs.mkdir(root, { recursive: true });
  }
  return root;
}

function normalizeVFSPath(vfsPath) {
  if (typeof vfsPath !== 'string') {
    throw new Error('VFS path must be a string');
  }
  if (vfsPath.includes('\0')) {
    throw new Error('VFS path must not contain null bytes');
  }
  const normalized = path.posix.normalize(`/${vfsPath.replace(/\\/g, '/')}`);
  return normalized === '//' ? '/' : normalized;
}

function toPhysicalPath(root, vfsPath) {
  const normalized = normalizeVFSPath(vfsPath);
  const relative = normalized.slice(1);
  const target = relative ? path.resolve(root, ...relative.split('/')) : path.resolve(root);
  const resolvedRoot = path.resolve(root);
  const relativeToRoot = path.relative(resolvedRoot, target);
  const isInsideRoot =
    relativeToRoot === '' ||
    (!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot));
  if (!isInsideRoot) {
    throw new Error(`VFS path escapes storage root: ${vfsPath}`);
  }
  return { normalized, target };
}

function isFilesystemRoot(targetPath) {
  const resolved = path.resolve(targetPath);
  return resolved === path.parse(resolved).root;
}

function toFileMetadata(vfsPath, stat) {
  return {
    name: path.posix.basename(vfsPath),
    path: vfsPath,
    size: stat.size,
    type: stat.isDirectory() ? 'directory' : 'file',
    created: stat.birthtime.toISOString(),
    modified: stat.mtime.toISOString()
  };
}

function toFileStat(stat) {
  return {
    size: stat.size,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    created: stat.birthtime.toISOString(),
    modified: stat.mtime.toISOString(),
    accessed: stat.atime.toISOString()
  };
}

async function ensureParentDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function clearDirectory(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((err) => {
    if (err?.code === 'ENOENT') {
      return [];
    }
    throw err;
  });
  for (const entry of entries) {
    await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
  }
}

async function readDirectoryRecursive(root, vfsPath, recursive, results) {
  const { target } = toPhysicalPath(root, vfsPath);
  const stat = await fs.stat(target);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${vfsPath}`);
  }
  const entries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const childPath = path.posix.normalize(path.posix.join(vfsPath, entry.name));
    const childPhysical = path.join(target, entry.name);
    const childStat = await fs.stat(childPhysical);
    results.push(toFileMetadata(childPath, childStat));
    if (recursive && entry.isDirectory()) {
      await readDirectoryRecursive(root, childPath, recursive, results);
    }
  }
}

function toBuffer(data, options) {
  if (typeof data === 'string') {
    return Buffer.from(data, options?.encoding === 'base64' ? 'base64' : 'utf8');
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  throw new Error('Unsupported file data type');
}

function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function normalizeWatchEventPath(root, filename) {
  const name = typeof filename === 'string' ? filename : filename?.toString?.() || '';
  if (!name) {
    return '/';
  }
  const relative = name.replace(/\\/g, '/');
  try {
    return toPhysicalPath(root, relative).normalized;
  } catch {
    return '/';
  }
}

function trackWatcherOwnership(senderId, watchId) {
  let watchIds = fsWatchersBySender.get(senderId);
  if (!watchIds) {
    watchIds = new Set();
    fsWatchersBySender.set(senderId, watchIds);
  }
  watchIds.add(watchId);
}

function untrackWatcherOwnership(senderId, watchId) {
  const watchIds = fsWatchersBySender.get(senderId);
  if (!watchIds) {
    return;
  }
  watchIds.delete(watchId);
  if (watchIds.size === 0) {
    fsWatchersBySender.delete(senderId);
  }
}

async function stopFSWatch(watchId) {
  const watcherState = fsWatchers.get(watchId);
  if (!watcherState) {
    return false;
  }
  fsWatchers.delete(watchId);
  untrackWatcherOwnership(watcherState.senderId, watchId);
  if (watcherState.flushTimer) {
    clearTimeout(watcherState.flushTimer);
  }
  if (watcherState.watcher) {
    watcherState.watcher.close();
  }
  return true;
}

async function stopFSWatchesForSender(senderId) {
  const watchIds = fsWatchersBySender.get(senderId);
  if (!watchIds || watchIds.size === 0) {
    return;
  }
  await Promise.all(Array.from(watchIds, (watchId) => stopFSWatch(watchId)));
}

function isWatchPathRelevant(watchPath, changedPath) {
  const normalizedWatchPath = normalizeVFSPath(watchPath || '/');
  const normalizedChangedPath = normalizeVFSPath(changedPath || '/');
  if (normalizedWatchPath === '/' || normalizedChangedPath === '/') {
    return true;
  }
  return (
    normalizedChangedPath === normalizedWatchPath ||
    normalizedChangedPath.startsWith(`${normalizedWatchPath}/`) ||
    normalizedWatchPath.startsWith(`${normalizedChangedPath}/`)
  );
}

async function createFSWatch(sender, scope, watchPath) {
  const root = await getScopeRoot(scope);
  const normalizedWatchPath = normalizeVFSPath(watchPath || '/');
  const watchId = `fswatch_${nextFsWatchId++}`;
  const watcherState = {
    id: watchId,
    root,
    scope,
    watchPath: normalizedWatchPath,
    sender,
    senderId: sender.id,
    pendingPath: normalizedWatchPath,
    flushTimer: null,
    watcher: null
  };
  const emitChange = () => {
    watcherState.flushTimer = null;
    if (sender.isDestroyed()) {
      void stopFSWatch(watchId);
      return;
    }
    sender.send(FS_EVENT_CHANNEL, {
      watchId,
      scope,
      path: watcherState.pendingPath || normalizedWatchPath,
      type: 'modified',
      itemType: 'directory'
    });
    watcherState.pendingPath = normalizedWatchPath;
  };
  const scheduleChange = (changedPath) => {
    if (!isWatchPathRelevant(normalizedWatchPath, changedPath)) {
      return;
    }
    if (
      changedPath === '/' ||
      normalizedWatchPath === '/' ||
      watcherState.pendingPath === '/' ||
      watcherState.pendingPath === normalizedWatchPath
    ) {
      watcherState.pendingPath = normalizedWatchPath === '/' ? '/' : changedPath || normalizedWatchPath;
    } else if (
      watcherState.pendingPath &&
      watcherState.pendingPath !== changedPath &&
      watcherState.pendingPath !== normalizedWatchPath
    ) {
      watcherState.pendingPath = normalizedWatchPath;
    } else {
      watcherState.pendingPath = changedPath || normalizedWatchPath;
    }
    if (watcherState.flushTimer) {
      clearTimeout(watcherState.flushTimer);
    }
    watcherState.flushTimer = setTimeout(emitChange, 120);
  };
  try {
    watcherState.watcher = fsSync.watch(root, { recursive: true }, (_eventType, filename) => {
      scheduleChange(normalizeWatchEventPath(root, filename));
    });
    watcherState.watcher.on('error', (error) => {
      console.warn(`Filesystem watcher error for ${scope}: ${error?.message || error}`);
      scheduleChange(normalizedWatchPath);
    });
  } catch (error) {
    console.warn(`Create filesystem watcher failed for ${scope}: ${error?.message || error}`);
    scheduleChange(normalizedWatchPath);
  }
  fsWatchers.set(watchId, watcherState);
  if (!fsWatchersBySender.has(sender.id)) {
    sender.once('destroyed', () => {
      void stopFSWatchesForSender(sender.id);
    });
  }
  trackWatcherOwnership(sender.id, watchId);
  return watchId;
}

async function dispatchFS(operation, args) {
  if (operation === 'pickDirectory') {
    const result = await dialog.showOpenDialog(mainWindowRef ?? undefined, {
      title: args.options?.title || 'Select Directory',
      defaultPath: args.options?.defaultPath,
      buttonLabel: args.options?.buttonLabel,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length < 1) {
      return null;
    }
    return path.resolve(result.filePaths[0]);
  }
  if (operation === 'pickFile') {
    const filters = Array.isArray(args.options?.filters)
      ? args.options.filters
          .filter((filter) => filter && typeof filter.name === 'string' && Array.isArray(filter.extensions))
          .map((filter) => ({
            name: filter.name,
            extensions: filter.extensions
              .map((ext) => String(ext || '').replace(/^\./, '').trim().toLowerCase())
              .filter(Boolean)
          }))
          .filter((filter) => filter.extensions.length > 0)
      : [];
    const result = await dialog.showOpenDialog(mainWindowRef ?? undefined, {
      title: args.options?.title || 'Select File',
      defaultPath: args.options?.defaultPath,
      buttonLabel: args.options?.buttonLabel,
      properties: ['openFile'],
      filters
    });
    if (result.canceled || result.filePaths.length < 1) {
      return null;
    }
    const pickedPath = path.resolve(result.filePaths[0]);
    const buffer = await fs.readFile(pickedPath);
    if (buffer.byteLength > MAX_ASSISTANT_IMAGE_BYTES) {
      throw new Error(`Selected file is too large (${buffer.byteLength} bytes). Limit is ${MAX_ASSISTANT_IMAGE_BYTES} bytes.`);
    }
    return {
      name: path.basename(pickedPath),
      path: pickedPath,
      size: buffer.byteLength,
      mimeType: guessImageMimeType(pickedPath),
      dataBase64: buffer.toString('base64')
    };
  }
  const root = await getScopeRoot(args.scope);
  switch (operation) {
    case 'makeDirectory': {
      const { target } = toPhysicalPath(root, args.path);
      await fs.mkdir(target, { recursive: !!args.recursive });
      return null;
    }
    case 'revealPath': {
      const { target } = toPhysicalPath(root, args.path);
      const stat = await fs.stat(target);
      if (stat.isDirectory()) {
        const errorMessage = await shell.openPath(target);
        if (errorMessage) {
          throw new Error(errorMessage);
        }
        return null;
      }
      shell.showItemInFolder(target);
      return null;
    }
    case 'readDirectory': {
      const results = [];
      await readDirectoryRecursive(root, args.path, !!args.options?.recursive, results);
      return results;
    }
    case 'deleteDirectory': {
      const { normalized, target } = toPhysicalPath(root, args.path);
      if (normalized === '/') {
        if (!args.recursive) {
          const entries = await fs.readdir(root);
          if (entries.length > 0) {
            throw new Error('Directory is not empty: /');
          }
        }
        await clearDirectory(root);
      } else {
        await fs.rm(target, { recursive: !!args.recursive, force: false });
      }
      return null;
    }
    case 'readFile': {
      const { target } = toPhysicalPath(root, args.path);
      const options = args.options ?? {};
      const buffer = await fs.readFile(target);
      const start = options.offset ?? 0;
      const end = options.length === undefined ? buffer.length : start + options.length;
      const sliced = buffer.subarray(start, end);
      if (options.encoding === 'utf8') {
        return sliced.toString('utf8');
      }
      if (options.encoding === 'base64') {
        return sliced.toString('base64');
      }
      return bufferToArrayBuffer(sliced);
    }
    case 'writeFile': {
      const { target } = toPhysicalPath(root, args.path);
      const options = args.options ?? {};
      if (options.create) {
        await ensureParentDirectory(target);
      }
      const buffer = toBuffer(args.data, options);
      if (options.append) {
        await fs.appendFile(target, buffer);
      } else {
        await fs.writeFile(target, buffer);
      }
      return null;
    }
    case 'deleteFile': {
      const { normalized, target } = toPhysicalPath(root, args.path);
      if (normalized === '/') {
        throw new Error('Cannot delete root as a file');
      }
      await fs.unlink(target);
      return null;
    }
    case 'exists': {
      const { target } = toPhysicalPath(root, args.path);
      return await fs
        .access(target)
        .then(() => true)
        .catch(() => false);
    }
    case 'stat': {
      const { target } = toPhysicalPath(root, args.path);
      return toFileStat(await fs.stat(target));
    }
    case 'move': {
      const source = toPhysicalPath(root, args.sourcePath);
      const target = toPhysicalPath(root, args.targetPath);
      if (source.normalized === '/' || target.normalized === '/') {
        throw new Error('Cannot move filesystem root');
      }
      await ensureParentDirectory(target.target);
      if (args.options?.overwrite) {
        await fs.rm(target.target, { recursive: true, force: true });
      }
      await fs.rename(source.target, target.target);
      return null;
    }
    case 'deleteScope': {
      if (path.isAbsolute(root) && isFilesystemRoot(root)) {
        throw new Error(`Refusing to delete filesystem root: ${root}`);
      }
      await fs.rm(root, { recursive: true, force: true });
      return null;
    }
    default:
      throw new Error(`Unknown filesystem operation: ${operation}`);
  }
}

ipcMain.handle(FS_CHANNEL, async (_event, payload) => {
  if (!payload || typeof payload.operation !== 'string' || !payload.args) {
    throw new Error('Invalid filesystem request');
  }
  if (payload.operation === 'watch') {
    return await createFSWatch(_event.sender, payload.args.scope, payload.args.path);
  }
  if (payload.operation === 'unwatch') {
    await stopFSWatch(payload.args.watchId);
    return null;
  }
  return await dispatchFS(payload.operation, payload.args);
});

ipcMain.handle(SETTINGS_CHANNEL, async (_event, payload) => {
  if (!payload || typeof payload.operation !== 'string' || !payload.args) {
    throw new Error('Invalid settings request');
  }
  switch (payload.operation) {
    case 'getGlobalSettings':
      return getGlobalSettingsPayload();
    case 'saveGlobalSettings':
      return await applyGlobalSettings(payload.args.settings ?? {});
    case 'copyMcpServiceUrl': {
      const url = getConfiguredMcpServiceUrl();
      clipboard.writeText(url);
      return url;
    }
    case 'toggleDevTools': {
      if (!mainWindowRef || mainWindowRef.isDestroyed()) {
        throw new Error('Main editor window is not available');
      }
      if (mainWindowRef.webContents.isDevToolsOpened()) {
        mainWindowRef.webContents.closeDevTools();
        return false;
      }
      mainWindowRef.webContents.openDevTools({ mode: 'detach' });
      return true;
    }
    case 'setLlmApiKey':
      return await setLlmApiKey(payload.args.provider, payload.args.apiKey);
    case 'clearLlmApiKey':
      return await clearLlmApiKey(payload.args.provider);
    case 'createAssistantSession':
      return await createAssistantSession(payload.args.title, payload.args.scopeId);
    case 'listAssistantSessions':
      return await listAssistantSessions(payload.args.scopeId);
    case 'getAssistantSessionMessages':
      return await readAssistantSessionMessages(payload.args.sessionId, payload.args.scopeId);
    case 'sendAssistantMessage':
      return await sendAssistantMessage(
        payload.args.sessionId,
        payload.args.content,
        payload.args.attachments,
        payload.args.scopeId
      );
    case 'cancelAssistantRun':
      return await cancelAssistantRun(payload.args.sessionId, payload.args.scopeId);
    case 'approveAssistantToolCall':
      return await approveAssistantToolCall(
        payload.args.sessionId,
        payload.args.callId,
        payload.args.scopeId
      );
    case 'rejectAssistantToolCall':
      return await rejectAssistantToolCall(
        payload.args.sessionId,
        payload.args.callId,
        payload.args.scopeId
      );
    case 'renameAssistantSession':
      return await renameAssistantSession(
        payload.args.sessionId,
        payload.args.title,
        payload.args.scopeId
      );
    case 'deleteAssistantSession':
      return await deleteAssistantSession(payload.args.sessionId, payload.args.scopeId);
    case 'listLlmModels':
      return await listLlmModels(payload.args.provider, payload.args.baseUrl);
    case 'readClipboardImage': {
      const image = clipboard.readImage();
      if (!image || image.isEmpty()) {
        return null;
      }
      const pngBuffer = image.toPNG();
      if (!pngBuffer?.length || pngBuffer.length > MAX_ASSISTANT_IMAGE_BYTES) {
        return null;
      }
      return { mimeType: 'image/png', dataBase64: pngBuffer.toString('base64') };
    }
    default:
      throw new Error(`Unknown settings operation: ${payload.operation}`);
  }
});

ipcMain.on(LOG_CHANNEL, (_event, payload) => {
  const lineText = `[renderer:${payload?.type || 'log'}] ${payload?.message || ''}`;
  writeStderrLine(lineText);
  writeDiagnosticLog(lineText);
});

ipcMain.handle(HEADLESS_CHANNEL, async (event, payload) => {
  if (!headlessConfig?.oneShot || event.sender !== mainWindowRef?.webContents) {
    return;
  }
  if (payload?.operation !== 'result') {
    return;
  }
  if (headlessWatchdog) {
    clearTimeout(headlessWatchdog);
    headlessWatchdog = null;
  }
  const result = payload.args ?? {};
  try {
    if (result.ok && typeof result.dataUrl === 'string') {
      const comma = result.dataUrl.indexOf(',');
      await fs.mkdir(path.dirname(headlessConfig.screenshotPath), { recursive: true });
      await fs.writeFile(
        headlessConfig.screenshotPath,
        Buffer.from(result.dataUrl.slice(comma + 1), 'base64')
      );
      const line = `[headless] wrote ${headlessConfig.screenshotPath} (${result.width}x${result.height})`;
      writeStderrLine(line);
      await writeDiagnosticLog(line);
      headlessExit(0);
    } else {
      const line = `[headless] renderer failed: ${result.error ?? 'unknown error'}`;
      writeStderrLine(line);
      await writeDiagnosticLog(line);
      headlessExit(1);
    }
  } catch (err) {
    const line = `[headless] failed to write screenshot: ${err?.stack || err}`;
    writeStderrLine(line);
    await writeDiagnosticLog(line);
    headlessExit(1);
  }
});

if (headlessConfig?.oneShot && headlessConfig.valid) {
  app.whenReady()
    .then(async () => {
      await loadEditorGlobalConfig();
      registerEditorProtocol();
      // No embedded MCP worker, no local MCP TCP service, no app menu:
      // the renderer reports the capture result over the headless IPC channel.
      createWindow({
        hidden: true,
        width: headlessConfig.width,
        height: headlessConfig.height,
        url: buildHeadlessOneShotUrl(headlessConfig)
      });
      headlessWatchdog = setTimeout(() => {
        const line = `[headless] timed out after ${headlessConfig.timeoutMs}ms`;
        writeStderrLine(line);
        void writeDiagnosticLog(line);
        headlessExit(4);
      }, headlessConfig.timeoutMs);
    })
    .catch((err) => {
      writeStderrLine(`[app:startup-failed] ${err?.stack || err}`);
      void writeDiagnosticLog(`[app:startup-failed] ${err?.stack || err}`);
      headlessExit(1);
    });

  app.on('window-all-closed', () => {
    // The window closed before the capture result arrived.
    headlessExit(1);
  });

  app.on('will-quit', () => {
    cleanupHeadlessSessionDir();
  });
} else if (hasSingleInstanceLock && (!headlessConfig || headlessConfig.valid)) {
  const persistentHeadless = !!headlessConfig;
  app.whenReady()
    .then(async () => {
      await loadMcpServiceConfig();
      if (persistentHeadless && headlessConfig.mcpPort !== null) {
        // In-memory override only; never persisted to mcp-config.json.
        mcpServiceConfig.port = headlessConfig.mcpPort;
        mcpServiceConfig.enabled = true;
      }
      await loadEditorGlobalConfig();
      await loadLlmSecrets();
      await loadAssistantSessions();
      registerEditorProtocol();
      await startEmbeddedMcpWorker();
      rebuildApplicationMenu();
      createWindow(
        persistentHeadless
          ? {
              hidden: true,
              width: headlessConfig.width,
              height: headlessConfig.height,
              url: buildHeadlessPersistentUrl()
            }
          : {}
      );
      if (persistentHeadless && headlessConfig.mcpPort !== null) {
        // A headless MCP service with a dead TCP endpoint is useless to
        // agents; fail hard instead of silently continuing.
        await startLocalMcpService({ persistEnabled: false, interactive: false }).catch((err) => {
          writeStderrLine(`[headless] MCP service failed to start: ${err?.message || err}`);
          headlessExit(1);
        });
      } else if (mcpServiceConfig.enabled) {
        await startLocalMcpService({ persistEnabled: false, interactive: !persistentHeadless }).catch(
          () => undefined
        );
      }

      app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          await startEmbeddedMcpWorker();
          rebuildApplicationMenu();
          createWindow(
            persistentHeadless
              ? { hidden: true, width: headlessConfig.width, height: headlessConfig.height }
              : {}
          );
        }
      });
    })
    .catch((err) => {
      writeStderrLine(`[app:startup-failed] ${err?.stack || err}`);
      void writeDiagnosticLog(`[app:startup-failed] ${err?.stack || err}`);
      headlessExit(1);
    });

  app.on('before-quit', () => {
    if (mcpServiceServer) {
      void stopLocalMcpService({ persistEnabled: false, interactive: false }).catch(() => undefined);
    }
    if (mcpWorker) {
      mcpWorkerStopping = true;
      void mcpWorker.terminate().catch(() => undefined);
    }
  });

  app.on('will-quit', () => {
    cleanupHeadlessSessionDir();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || persistentHeadless) {
      app.quit();
    }
  });
}

function cleanupHeadlessSessionDir() {
  if (!headlessSessionDir) {
    return;
  }
  try {
    fsSync.rmSync(headlessSessionDir, { recursive: true, force: true });
  } catch {
    // Best effort: Chromium may still hold files on some platforms.
  }
  headlessSessionDir = null;
}

// app.exit() skips before-quit/will-quit, so clean the temp session dir here.
function headlessExit(code) {
  cleanupHeadlessSessionDir();
  app.exit(code);
}
