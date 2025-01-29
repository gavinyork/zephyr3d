import { ZipWriter } from '@zip.js/zip.js';
import * as streamSaver from 'streamsaver';

export class ZipDownloader {
  private _zipWriter: ZipWriter<any>;
  private _downloadPromise: Promise<void>;
  constructor(filename: string) {
    const fileStream = streamSaver.createWriteStream(filename);
    const transformStream = new TransformStream();
    this._downloadPromise = transformStream.readable.pipeTo(fileStream);
    this._zipWriter = new ZipWriter(transformStream.writable);
  }
  get zipWriter() {
    return this._zipWriter;
  }
  async add(filename: string, stream: ReadableStream) {
    await this._zipWriter.add(filename, stream);
    stream.cancel();
  }
  async finish() {
    await this._zipWriter.close();
    await this._downloadPromise;
  }
}

export async function testDownloadZip(filename: string) {
  // 创建文件写入流
  const fileStream = streamSaver.createWriteStream(filename);

  // 创建一个 TransformStream
  const transformStream = new TransformStream();

  // 将转换流连接到文件流
  const downloadPromise = transformStream.readable.pipeTo(fileStream).catch(console.error);

  // 创建 zip 写入器
  const zipWriter = new ZipWriter(transformStream.writable);

  try {
    // 写入内容
    const helloWorldReadable = new Blob(['Hello world!']).stream();
    await zipWriter.add('hello.txt', helloWorldReadable);
    await zipWriter.close();
    await downloadPromise;
  } catch (error) {
    console.error('Error writing zip:', error);
  }
}
