import type { SharedModel } from './model';

export interface ModelImporter {
  import(data: Blob, model: SharedModel): void | Promise<void>;
}
