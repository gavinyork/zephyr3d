type FileSystemDirectoryHandleLike = {
  values(): AsyncIterable<FileSystemDirectoryHandleLike | FileSystemFileHandleLike>;
};

type FileSystemFileHandleLike = {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
};

type FileSystemHandleLike = {
  kind: 'file' | 'directory';
  name: string;
};

export class FilePicker {
  static async chooseFiles(multi: boolean, accept?: string): Promise<File[]> {
    const files = await this.chooseFilesWithFileSystemAccess(!!multi, accept ?? '');
    if (files) {
      return files;
    }
    return this.pick({ multiple: !!multi, accept: accept ?? '', useFocusCancelFallback: true });
  }
  static async chooseDirectory(): Promise<File[]> {
    const files = await this.chooseDirectoryWithFileSystemAccess();
    if (files) {
      return files;
    }
    return this.pick({ multiple: false, webkitdirectory: true, useFocusCancelFallback: false });
  }

  private static async chooseFilesWithFileSystemAccess(
    multiple: boolean,
    accept: string
  ): Promise<File[] | null> {
    const showOpenFilePicker = (
      window as unknown as {
        showOpenFilePicker?: (options?: {
          multiple?: boolean;
          types?: { description?: string; accept: Record<string, string[]> }[];
        }) => Promise<FileSystemFileHandleLike[]>;
      }
    ).showOpenFilePicker;
    if (!showOpenFilePicker) {
      return null;
    }
    try {
      const handles = await showOpenFilePicker({
        multiple,
        ...this.createOpenFilePickerAcceptOptions(accept)
      });
      return Promise.all(handles.map((handle) => handle.getFile()));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return [];
      }
      console.warn(`showOpenFilePicker failed, fallback to input file picker: ${err}`);
      return null;
    }
  }

  private static async chooseDirectoryWithFileSystemAccess(): Promise<File[] | null> {
    const showDirectoryPicker = (
      window as unknown as {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
      }
    ).showDirectoryPicker;
    if (!showDirectoryPicker) {
      return null;
    }
    try {
      const root = await showDirectoryPicker();
      return this.collectDirectoryFiles(root);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return [];
      }
      console.warn(`showDirectoryPicker failed, fallback to input directory picker: ${err}`);
      return null;
    }
  }

  private static async collectDirectoryFiles(
    directory: FileSystemDirectoryHandleLike,
    parentPath = ''
  ): Promise<File[]> {
    const files: File[] = [];
    for await (const entry of directory.values()) {
      const handle = entry as FileSystemHandleLike;
      const relativePath = parentPath ? `${parentPath}/${handle.name}` : handle.name;
      if (handle.kind === 'directory') {
        files.push(
          ...(await this.collectDirectoryFiles(entry as FileSystemDirectoryHandleLike, relativePath))
        );
      } else if (handle.kind === 'file') {
        const file = await (entry as FileSystemFileHandleLike).getFile();
        files.push(this.withRelativePath(file, relativePath));
      }
    }
    return files;
  }

  private static withRelativePath(file: File, relativePath: string): File {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: relativePath.replace(/\\/g, '/')
    });
    return file;
  }

  private static createOpenFilePickerAcceptOptions(accept: string): {
    types?: { description: string; accept: Record<string, string[]> }[];
  } {
    const specs = accept
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (specs.length === 0) {
      return {};
    }

    const acceptMap: Record<string, string[]> = {};
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        (acceptMap['application/octet-stream'] ??= []).push(spec);
      } else if (spec.includes('/')) {
        acceptMap[spec] ??= [];
      }
    }
    return Object.keys(acceptMap).length > 0
      ? {
          types: [
            {
              description: 'Supported files',
              accept: acceptMap
            }
          ]
        }
      : {};
  }

  private static async pick(options: {
    multiple?: boolean;
    accept?: string;
    webkitdirectory?: boolean;
    cancelDelayMs?: number;
    useFocusCancelFallback?: boolean;
  }): Promise<File[]> {
    return new Promise((resolve) => {
      const fileInput = document.createElement('input');
      let settled = false;
      let cancelTimer = 0;
      const finish = (files: File[]) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(cancelTimer);
          if (options.useFocusCancelFallback) {
            window.removeEventListener('focus', onFocus);
          }
          fileInput.remove();
          resolve(files);
        }
      };
      const onFocus = () => {
        // Fallback for browsers that do not fire `cancel` when the picker is dismissed.
        // Do not use this for directory upload: Chromium may focus the page before its
        // secondary "upload files to this site" confirmation has completed.
        cancelTimer = window.setTimeout(() => {
          if (!fileInput.files || fileInput.files.length === 0) {
            finish([]);
          }
        }, options.cancelDelayMs ?? 300);
      };
      fileInput.type = 'file';
      fileInput.accept = options.accept ?? '';
      fileInput.multiple = !!options.multiple;
      fileInput.webkitdirectory = !!options.webkitdirectory;
      fileInput.onchange = () => {
        finish([...fileInput.files!]);
      };
      fileInput.oncancel = () => finish([]);
      if (options.useFocusCancelFallback) {
        window.setTimeout(() => {
          window.addEventListener('focus', onFocus);
        }, 0);
      }
      fileInput.click();
    });
  }
}
