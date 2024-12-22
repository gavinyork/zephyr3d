// worker.ts
import { ZipWriter, BlobWriter, BlobReader } from '@zip.js/zip.js';

interface WorkerMessage {
  type: 'compress';
  files: {
    path: string;
    file: File;
  }[];
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

self.addEventListener('message', async (e: MessageEvent<WorkerMessage>) => {
  if (e.data.type === 'compress') {
    try {
      const zipBlob = await compressFiles(e.data.files);
      self.postMessage({ type: 'success', data: zipBlob });
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});
