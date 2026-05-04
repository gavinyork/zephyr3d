const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const FS_CHANNEL = 'zephyr-editor:fs';
const LOG_CHANNEL = 'zephyr-editor:log';
const EDITOR_PROTOCOL = 'zephyr-editor';

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
  Menu.setApplicationMenu(null);
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#1f1f1f',
    icon: editorIconPath(),
    webPreferences: editorWebPreferences()
  });

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
    console.log(lineText);
    writeDiagnosticLog(lineText);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    const lineText = `[renderer:load-failed] ${errorCode} ${errorDescription}: ${validatedURL}`;
    console.error(lineText);
    writeDiagnosticLog(lineText);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const lineText = `[renderer:gone] ${details.reason} exitCode=${details.exitCode}`;
    console.error(lineText);
    writeDiagnosticLog(lineText);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    const lineText = `[renderer:preload-error] ${preloadPath}: ${error?.stack || error}`;
    console.error(lineText);
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
        console.log(`[renderer:screenshot] ${screenshotPath}`);
      } catch (err) {
        console.error('[renderer:screenshot-failed]', err);
      }
    }, 3000);
  });

  const devUrl = process.env.ZEPHYR_EDITOR_ELECTRON_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const device = process.env.ZEPHYR_EDITOR_DEVICE || 'webgl2';
    mainWindow.loadURL(`${EDITOR_PROTOCOL}://app/index.html?desktop=electron&device=${encodeURIComponent(device)}`);
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
  previewWindow.loadURL(url);
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
    root = path.join(storageBaseDir(), 'projects', sanitizeScopePart(scope.slice('project:'.length)));
  } else {
    throw new Error(`Invalid filesystem scope: ${scope}`);
  }
  await fs.mkdir(root, { recursive: true });
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

ipcMain.on(LOG_CHANNEL, (_event, payload) => {
  const lineText = `[renderer:${payload?.type || 'log'}] ${payload?.message || ''}`;
  console.log(lineText);
  writeDiagnosticLog(lineText);
});

app.whenReady().then(() => {
  registerEditorProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
