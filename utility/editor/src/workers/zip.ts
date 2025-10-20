// worker.ts
import type { FileEntry } from '@zip.js/zip.js';
import { ZipWriter, BlobWriter, BlobReader, ZipReader } from '@zip.js/zip.js';

interface WorkerMessage {
  type: 'compress' | 'decompress';
  files?: {
    path: string;
    file: File;
  }[];
  zipBlob?: Blob;
}

interface ProgressMessage {
  type: 'progress';
  current: number;
  total: number;
}

async function compressFiles(files: WorkerMessage['files']): Promise<Blob> {
  const zipWriter = new ZipWriter(new BlobWriter());
  const total = files.length;
  for (let i = 0; i < files.length; i++) {
    const { path, file } = files[i];
    self.postMessage({
      type: 'progress',
      current: i + 1,
      total
    } as ProgressMessage);

    await zipWriter.add(path, new BlobReader(file));
  }
  const blob = await zipWriter.close();
  return blob;
}

async function decompressBlob(zipBlob: Blob): Promise<Map<string, Blob>> {
  const zipReader = new ZipReader(new BlobReader(zipBlob));
  const entries = await zipReader.getEntries();
  const fileMap = new Map<string, Blob>();
  const total = entries.length;
  for (let i = 0; i < total; i++) {
    const entry = entries[i];
    if (!entry.directory) {
      self.postMessage({
        type: 'progress',
        current: i + 1,
        total
      } as ProgressMessage);
      const blob = await (entry as FileEntry).getData(new BlobWriter());
      fileMap.set(`/${entry.filename}`, blob);
    }
  }
  await zipReader.close();
  return fileMap;
}

self.addEventListener('message', async (e: MessageEvent<WorkerMessage>) => {
  try {
    let result: Blob | Map<string, Blob>;

    switch (e.data.type) {
      case 'compress':
        if (!e.data.files) {
          throw new Error('No files provided for compression');
        }
        result = await compressFiles(e.data.files);
        self.postMessage({ type: 'success', data: result });
        break;

      case 'decompress':
        if (!e.data.zipBlob) {
          throw new Error('No zip blob provided for decompression');
        }
        result = await decompressBlob(e.data.zipBlob);
        self.postMessage({ type: 'success', data: result });
        break;

      default:
        throw new Error('Unknown message type');
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
