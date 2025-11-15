import { configure, ZipWriter } from '@zip.js/zip.js';
import * as streamSaver from 'streamsaver';
import { ProjectService } from '../core/services/project';

export class ZipDownloader {
  private readonly _zipWriter: ZipWriter<any>;
  private readonly _downloadPromise: Promise<void>;
  private readonly _transformStream: TransformStream;
  constructor(filename: string) {
    const fileStream = streamSaver.createWriteStream(filename);
    this._transformStream = new TransformStream();
    this._downloadPromise = this._transformStream.readable.pipeTo(fileStream);
    configure({ useWebWorkers: false });
    this._zipWriter = new ZipWriter(this._transformStream.writable);
  }
  get zipWriter() {
    return this._zipWriter;
  }
  async add(filename: string, stream: ReadableStream) {
    await this._zipWriter.add(filename, stream);
  }
  async finish() {
    try {
      await this._zipWriter.close();
      await this._downloadPromise;
    } catch (err) {
      console.error('Download error:', err);
      await this._transformStream.writable.getWriter().close();
    }
  }
}

export async function exportFile(arrayBuffer: ArrayBuffer, filename: string) {
  const fileStream = streamSaver.createWriteStream(filename);
  const writer = fileStream.getWriter();

  const chunkSize = 64 * 1024;
  const uint8Array = new Uint8Array(arrayBuffer);

  for (let offset = 0; offset < uint8Array.length; offset += chunkSize) {
    const chunk = uint8Array.subarray(offset, offset + chunkSize);
    await writer.write(chunk);
  }
  await writer.close();
}

export async function exportMultipleFilesAsZip(files: string[], directories: string[], zipFilename: string) {
  const zipDownloader = new ZipDownloader(zipFilename);
  const zipWriter = zipDownloader.zipWriter;
  const fileSet: Set<string> = new Set();
  const fileList = [...files];
  for (const dir of directories) {
    const path = ProjectService.VFS.normalizePath(dir);
    const pattern = path === '/' ? '/**/*' : `${path}/**/*`;
    const subFiles = await ProjectService.VFS.glob(pattern, { includeDirs: false });
    for (const f of subFiles) {
      fileList.push(f.path);
    }
  }
  for (const f of fileList) {
    const filename = ProjectService.VFS.normalizePath(f);
    fileSet.add(filename);
  }
  // Remove common path prefix
  const uniqueFiles = Array.from(fileSet);
  const prefixes = uniqueFiles.map((f) => ProjectService.VFS.dirname(f));
  let commonPrefix = prefixes[0];
  while (commonPrefix) {
    if (prefixes.every((p) => p.startsWith(commonPrefix))) {
      break;
    }
    commonPrefix = ProjectService.VFS.dirname(commonPrefix);
  }
  if (commonPrefix && !commonPrefix.endsWith('/')) {
    commonPrefix += '/';
  }
  for (const f of uniqueFiles) {
    const content = (await ProjectService.VFS.readFile(f, { encoding: 'binary' })) as ArrayBuffer;
    await zipWriter.add(f.slice(commonPrefix.length), new Blob([content]).stream());
  }
  await zipDownloader.finish();
}
