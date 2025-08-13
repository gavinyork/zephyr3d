import { configure, ZipWriter } from '@zip.js/zip.js';
import * as streamSaver from 'streamsaver';

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
      this._transformStream.writable.getWriter().close();
    }
  }
}
