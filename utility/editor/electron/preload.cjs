const { contextBridge, ipcRenderer } = require('electron');

const FS_CHANNEL = 'zephyr-editor:fs';
const LOG_CHANNEL = 'zephyr-editor:log';

function invokeFS(operation, args) {
  return ipcRenderer.invoke(FS_CHANNEL, { operation, args });
}

contextBridge.exposeInMainWorld('zephyrEditorDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  fs: {
    makeDirectory: (scope, path, recursive) => invokeFS('makeDirectory', { scope, path, recursive }),
    readDirectory: (scope, path, options) => invokeFS('readDirectory', { scope, path, options }),
    deleteDirectory: (scope, path, recursive) => invokeFS('deleteDirectory', { scope, path, recursive }),
    readFile: (scope, path, options) => invokeFS('readFile', { scope, path, options }),
    writeFile: (scope, path, data, options) => invokeFS('writeFile', { scope, path, data, options }),
    deleteFile: (scope, path) => invokeFS('deleteFile', { scope, path }),
    exists: (scope, path) => invokeFS('exists', { scope, path }),
    stat: (scope, path) => invokeFS('stat', { scope, path }),
    move: (scope, sourcePath, targetPath, options) =>
      invokeFS('move', { scope, sourcePath, targetPath, options }),
    deleteScope: (scope) => invokeFS('deleteScope', { scope })
  }
});

window.addEventListener('error', (event) => {
  ipcRenderer.send(LOG_CHANNEL, {
    type: 'error',
    message: `${event.message || event.error}\n${event.error?.stack || ''}`
  });
});

window.addEventListener('unhandledrejection', (event) => {
  ipcRenderer.send(LOG_CHANNEL, {
    type: 'unhandledrejection',
    message: `${event.reason?.stack || event.reason || ''}`
  });
});
