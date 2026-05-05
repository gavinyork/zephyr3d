const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, net, protocol, shell } = require('electron');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { Worker } = require('worker_threads');

const FS_CHANNEL = 'zephyr-editor:fs';
const LOG_CHANNEL = 'zephyr-editor:log';
const SETTINGS_CHANNEL = 'zephyr-editor:settings';
const EDITOR_PROTOCOL = 'zephyr-editor';
const MCP_HTTP_PATH = '/mcp';
const DEFAULT_MCP_SERVICE_PORT = Number(process.env.ZEPHYR_EDITOR_MCP_SERVER_PORT || 47231);
const MAX_MCP_HTTP_BODY_BYTES = 16 * 1024 * 1024;
const MCP_CONFIG_FILE = 'mcp-config.json';
const EDITOR_GLOBAL_CONFIG_FILE = 'editor-config.json';
const DEFAULT_EDITOR_RHI = 'webgpu';
const SUPPORTED_EDITOR_RHIS = new Set(['webgpu', 'webgl2', 'webgl']);

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
  defaultRHI: DEFAULT_EDITOR_RHI
};

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

function rejectPendingRpcRequests(error) {
  for (const pending of pendingRpcRequests.values()) {
    pending.reject(error);
  }
  pendingRpcRequests.clear();
}

function sendRpcToMcpWorker(message) {
  if (!mcpWorker) {
    return Promise.reject(new Error('Embedded MCP worker is not running'));
  }
  const requestId = nextRpcRequestId++;
  return new Promise((resolve, reject) => {
    pendingRpcRequests.set(requestId, { resolve, reject });
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

async function loadMcpServiceConfig() {
  const filePath = mcpConfigPath();
  const loaded = await fs
    .readFile(filePath, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
  mcpServiceConfig = {
    enabled: typeof loaded?.enabled === 'boolean' ? loaded.enabled : true,
    port: sanitizeMcpServicePort(loaded?.port)
  };
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
    defaultRHI: sanitizeEditorRHI(loaded?.defaultRHI)
  };
}

async function saveEditorGlobalConfig() {
  const filePath = editorGlobalConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(editorGlobalConfig, null, 2)}\n`, 'utf8');
}

function getConfiguredMcpServiceUrl(port = mcpServiceConfig.port) {
  return `http://127.0.0.1:${port}${MCP_HTTP_PATH}`;
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
    defaultRHI: sanitizeEditorRHI(editorGlobalConfig.defaultRHI)
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
    port: nextPort
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
    await saveEditorGlobalConfig();
  }
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
    writeStderrLine(`[mcp:http-start-failed] ${message}`);
    void writeDiagnosticLog(`[mcp:http-start-failed] ${message}`);
    if (interactive) {
      dialog.showErrorBox('Failed to Start MCP Service', message);
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

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#1f1f1f',
    icon: editorIconPath(),
    webPreferences: editorWebPreferences()
  });
  mainWindowRef = mainWindow;
  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
  });
  mainWindow.maximize();

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
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    const lineText = `[renderer:load-failed] ${errorCode} ${errorDescription}: ${validatedURL}`;
    writeStderrLine(lineText);
    writeDiagnosticLog(lineText);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const lineText = `[renderer:gone] ${details.reason} exitCode=${details.exitCode}`;
    writeStderrLine(lineText);
    writeDiagnosticLog(lineText);
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

  const devUrl = process.env.ZEPHYR_EDITOR_ELECTRON_URL;
  const device = getConfiguredEditorRHI();
  if (devUrl) {
    mainWindow.loadURL(buildEditorLaunchUrl(devUrl, device));
  } else {
    mainWindow.loadURL(buildEditorLaunchUrl(`${EDITOR_PROTOCOL}://app/index.html`, device));
  }

  if (process.env.ZEPHYR_EDITOR_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
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
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
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
  const root = await getScopeRoot(args.scope);
  switch (operation) {
    case 'makeDirectory': {
      const { target } = toPhysicalPath(root, args.path);
      await fs.mkdir(target, { recursive: !!args.recursive });
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
    default:
      throw new Error(`Unknown settings operation: ${payload.operation}`);
  }
});

ipcMain.on(LOG_CHANNEL, (_event, payload) => {
  const lineText = `[renderer:${payload?.type || 'log'}] ${payload?.message || ''}`;
  writeStderrLine(lineText);
  writeDiagnosticLog(lineText);
});

app.whenReady()
  .then(async () => {
    await loadMcpServiceConfig();
    await loadEditorGlobalConfig();
    registerEditorProtocol();
    await startEmbeddedMcpWorker();
    rebuildApplicationMenu();
    createWindow();
    if (mcpServiceConfig.enabled) {
      await startLocalMcpService({ persistEnabled: false, interactive: true }).catch(() => undefined);
    }

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await startEmbeddedMcpWorker();
        rebuildApplicationMenu();
        createWindow();
      }
    });
  })
  .catch((err) => {
    writeStderrLine(`[app:startup-failed] ${err?.stack || err}`);
    void writeDiagnosticLog(`[app:startup-failed] ${err?.stack || err}`);
    app.exit(1);
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
