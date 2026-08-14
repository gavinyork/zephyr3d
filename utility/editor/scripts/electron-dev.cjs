const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const {
  clearRuntimeStateIfOwned,
  ensureRuntimeStateDir,
  getRuntimeLogFilePath,
  readRuntimeState,
  writeRuntimeState
} = require('./dev-runtime-state.cjs');

const projectRoot = path.resolve(__dirname, '..');
const explicitDevUrl = process.env.ZEPHYR_EDITOR_ELECTRON_URL || '';
const devHost = process.env.ZEPHYR_EDITOR_DEV_HOST || 'localhost';
const parsedPort = Number.parseInt(process.env.ZEPHYR_EDITOR_DEV_PORT || '8000', 10);
const devPort = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 8000;
const requestedDevUrl = `http://${devHost}:${devPort}`;
const vitePackageJsonPath = require.resolve('vite/package.json', { paths: [projectRoot] });
const viteCliPath = path.resolve(path.dirname(vitePackageJsonPath), 'bin', 'vite.js');
const electronBinary = require('electron');
const watchExtensions = new Set(['.cjs', '.js', '.json', '.mjs']);
const watchTargets = [
  {
    label: 'electron',
    kind: 'directory',
    path: path.join(projectRoot, 'electron'),
    recursive: true
  },
  {
    label: 'mcp',
    kind: 'directory',
    path: path.join(projectRoot, 'mcp'),
    recursive: true
  },
  {
    label: 'package.json',
    kind: 'file',
    path: path.join(projectRoot, 'package.json'),
    recursive: false
  }
];
const watchStartupSilenceMs = 1500;

let devUrl = explicitDevUrl || requestedDevUrl;
let serverProcess = null;
let electronProcess = null;
let shuttingDown = false;
let restartingElectron = false;
let restartTimer = null;
let restartPromise = null;
let pendingRestartReason = '';
const fileWatchers = [];
const runtimeLogPath = getRuntimeLogFilePath(projectRoot);
const runtimeStateDir = ensureRuntimeStateDir(projectRoot);

function log(message) {
  process.stdout.write(`[electron:dev] ${message}\n`);
  try {
    fs.appendFileSync(runtimeLogPath, `[${new Date().toISOString()}] [electron:dev] ${message}\n`, 'utf8');
  } catch {
    // Ignore diagnostic log write failures.
  }
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function relativeProjectPath(filePath) {
  const relativePath = path.relative(projectRoot, filePath);
  return relativePath || path.basename(filePath);
}

function extractDevServerUrl(line) {
  const normalizedLine = stripAnsi(line).trim();
  if (!normalizedLine) {
    return '';
  }
  const localMatch = normalizedLine.match(/\bLocal:\s*(https?:\/\/\S+)/i);
  if (localMatch) {
    return localMatch[1].replace(/[),;]+$/, '').replace(/\/$/, '');
  }
  if (/Network:/i.test(normalizedLine)) {
    return '';
  }
  const urlMatch = normalizedLine.match(/\bhttps?:\/\/\S+/i);
  return urlMatch ? urlMatch[0].replace(/[),;]+$/, '').replace(/\/$/, '') : '';
}

function pipeOutput(stream, target, onLine) {
  if (!stream) {
    return;
  }
  let buffer = '';
  stream.on('data', (chunk) => {
    const text = chunk.toString();
    target.write(text);
    buffer += stripAnsi(text).replace(/\r/g, '\n');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      onLine(line);
    }
  });
  stream.on('end', () => {
    if (buffer) {
      onLine(buffer);
    }
  });
}

function waitForChildExit(child, timeoutMs = 15000) {
  if (!child || child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const finalize = () => {
      clearTimeout(timer);
      child.off('error', finalize);
      resolve();
    };
    const timer = setTimeout(finalize, timeoutMs);
    child.once('exit', finalize);
    child.once('error', finalize);
  });
}

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }

  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true
      });
      killer.on('close', () => resolve());
      killer.on('error', () => resolve());
    });
  }

  child.kill('SIGTERM');
  return Promise.resolve();
}

function closeWatchers() {
  while (fileWatchers.length > 0) {
    const watcher = fileWatchers.pop();
    try {
      watcher?.close();
    } catch {
      // Ignore watcher shutdown errors during cleanup/restart.
    }
  }
}

async function cleanup(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  closeWatchers();
  await Promise.all([terminateChild(electronProcess), terminateChild(serverProcess)]);
  clearRuntimeStateIfOwned(projectRoot, process.pid);
  process.exit(exitCode);
}

function persistRuntimeState() {
  const current = readRuntimeState(projectRoot);
  if (current?.runnerPid && current.runnerPid !== process.pid) {
    return;
  }
  writeRuntimeState(projectRoot, {
    version: 1,
    status: shuttingDown ? 'stopping' : 'running',
    editorRoot: projectRoot,
    runnerPid: process.pid,
    serverPid: serverProcess?.pid ?? null,
    electronPid: electronProcess?.pid ?? null,
    devUrl,
    logPath: runtimeLogPath,
    updatedAt: new Date().toISOString()
  });
}

function waitForDevServer(rawUrl, timeoutMs) {
  const url = new URL(rawUrl);
  const client = url.protocol === 'https:' ? https : http;
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const request = client.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
          resolve();
          return;
        }
        schedule(new Error(`Unexpected HTTP status: ${response.statusCode}`));
      });

      request.on('error', schedule);
      request.setTimeout(2000, () => {
        request.destroy(new Error('Timed out while waiting for dev server'));
      });
    };

    const schedule = (error) => {
      if (Date.now() >= deadline) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      setTimeout(tryOnce, 300);
    };

    tryOnce();
  });
}

async function startDevServer() {
  log(`Starting Vite dev server near ${requestedDevUrl}`);
  const detectedUrl = await new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const handleOutputLine = (line) => {
      const resolvedUrl = extractDevServerUrl(line);
      if (resolvedUrl) {
        finishResolve(resolvedUrl);
      }
    };

    serverProcess = spawn(
      process.execPath,
      [viteCliPath, '--configLoader', 'runner', '--host', devHost, '--port', String(devPort)],
      {
        cwd: projectRoot,
        stdio: ['inherit', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          BROWSER: 'none'
        }
      }
    );

    pipeOutput(serverProcess.stdout, process.stdout, handleOutputLine);
    pipeOutput(serverProcess.stderr, process.stderr, handleOutputLine);
    persistRuntimeState();

    serverProcess.on('error', finishReject);
    serverProcess.on('exit', (code) => {
      if (!shuttingDown) {
        if (!settled) {
          finishReject(new Error(`Vite dev server exited before becoming ready (code ${code ?? 0})`));
          return;
        }
        if (electronProcess?.exitCode === null) {
          log(`Vite dev server exited unexpectedly with code ${code ?? 0}`);
          void cleanup(code ?? 1);
        }
      }
    });
  });

  devUrl = detectedUrl;
  if (devUrl !== requestedDevUrl) {
    log(`Requested ${requestedDevUrl}, Vite selected ${devUrl}`);
  } else {
    log(`Vite dev server ready at ${devUrl}`);
  }
  persistRuntimeState();
}

function startElectron() {
  log(`Launching Electron against ${devUrl}`);
  const electronEnv = {
    ...process.env,
    ZEPHYR_EDITOR_ELECTRON_URL: devUrl
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, ['.', ...process.argv.slice(2)], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: electronEnv
  });

  electronProcess = child;
  persistRuntimeState();

  child.on('error', (error) => {
    console.error(error);
    void cleanup(1);
  });

  child.on('exit', (code) => {
    if (electronProcess === child) {
      electronProcess = null;
    }
    persistRuntimeState();
    if (!shuttingDown) {
      if (restartingElectron) {
        return;
      }
      void cleanup(code ?? 0);
    }
  });
}

async function performElectronRestart(reason) {
  if (shuttingDown) {
    return;
  }

  log(`Restarting Electron (${reason})`);
  const currentElectron = electronProcess;
  if (currentElectron && currentElectron.exitCode === null && !currentElectron.killed) {
    restartingElectron = true;
    await Promise.all([terminateChild(currentElectron), waitForChildExit(currentElectron)]);
    if (electronProcess === currentElectron) {
      electronProcess = null;
    }
    restartingElectron = false;
  }

  if (!shuttingDown) {
    startElectron();
  }
  persistRuntimeState();
}

function queueElectronRestart(reason) {
  pendingRestartReason = reason || pendingRestartReason || 'main-process change';
  if (restartPromise) {
    return restartPromise;
  }

  restartPromise = (async () => {
    while (pendingRestartReason && !shuttingDown) {
      const currentReason = pendingRestartReason;
      pendingRestartReason = '';
      await performElectronRestart(currentReason);
    }
  })().finally(() => {
    restartPromise = null;
  });

  return restartPromise;
}

function shouldRestartForWatchChange(spec, filename) {
  if (spec.kind === 'file') {
    return true;
  }
  const changedName = typeof filename === 'string' ? filename : filename?.toString?.() || '';
  if (!changedName) {
    return true;
  }
  return watchExtensions.has(path.extname(changedName).toLowerCase());
}

function resolveWatchChangePath(spec, filename) {
  const changedName = typeof filename === 'string' ? filename : filename?.toString?.() || '';
  if (!changedName || spec.kind === 'file') {
    return spec.path;
  }
  return path.join(spec.path, changedName);
}

function scheduleElectronRestart(reason) {
  if (shuttingDown) {
    return;
  }
  pendingRestartReason = reason || 'main-process change';
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  restartTimer = setTimeout(() => {
    restartTimer = null;
    const currentReason = pendingRestartReason || 'main-process change';
    pendingRestartReason = '';
    void queueElectronRestart(currentReason);
  }, 200);
}

function startWatchers() {
  closeWatchers();
  log('Watching Electron main-process files for restart');
  for (const spec of watchTargets) {
    try {
      const readyAt = Date.now() + watchStartupSilenceMs;
      const watcher = fs.watch(
        spec.path,
        {
          recursive: spec.kind === 'directory' && spec.recursive && (process.platform === 'win32' || process.platform === 'darwin')
        },
        (_eventType, filename) => {
          if (Date.now() < readyAt) {
            return;
          }
          if (!shouldRestartForWatchChange(spec, filename)) {
            return;
          }
          const changedPath = relativeProjectPath(resolveWatchChangePath(spec, filename));
          scheduleElectronRestart(`changed ${changedPath}`);
        }
      );
      watcher.on('error', (error) => {
        log(`Watcher error on ${spec.label}: ${error?.message || error}`);
      });
      fileWatchers.push(watcher);
    } catch (error) {
      log(`Watcher setup failed for ${spec.label}: ${error?.message || error}`);
    }
  }
}

async function main() {
  persistRuntimeState();
  if (!explicitDevUrl) {
    await startDevServer();
  } else {
    log(`Using external dev server ${devUrl}`);
    persistRuntimeState();
  }

  await waitForDevServer(devUrl, 120000);
  startElectron();
  startWatchers();
  log(`Runtime state is tracked under ${runtimeStateDir}`);
}

process.on('SIGINT', () => {
  void cleanup(0);
});

process.on('SIGTERM', () => {
  void cleanup(0);
});

process.on('uncaughtException', (error) => {
  console.error(error);
  void cleanup(1);
});

process.on('unhandledRejection', (error) => {
  console.error(error);
  void cleanup(1);
});

main().catch((error) => {
  console.error(error);
  void cleanup(1);
});
