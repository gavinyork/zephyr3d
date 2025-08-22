import type { FileMetadata } from '../vfs';

export interface HttpDirectoryReaderContext {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  toURL: (path: string) => string;
  normalizePath: (path: string) => string;
  joinPath: (...parts: string[]) => string;
  guessMimeType: (name: string) => string | undefined;
}

export interface HttpDirectoryReader {
  readonly name: string;
  canHandle?(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<boolean> | boolean;
  readOnce(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<FileMetadata[]>;
}
