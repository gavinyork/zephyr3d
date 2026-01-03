import { hashToVertexFormat } from './constants_webgpu';

export class VertexLayoutCache {
  private _layouts: Record<string, GPUVertexBufferLayout[]>;
  constructor() {
    this._layouts = {};
  }
  fetchVertexLayout(hash: string) {
    let layouts: GPUVertexBufferLayout[] = this._layouts[hash];
    if (!layouts) {
      layouts = [];
      hash.split(':').forEach((l) => {
        const parts = l.split('-');
        const layout = {
          arrayStride: Number(parts[0]),
          stepMode: (Number(parts[1]) ? 'instance' : 'vertex') as GPUVertexStepMode,
          attributes: [] as GPUVertexAttribute[]
        };
        for (let i = 2; i < parts.length; i += 3) {
          layout.attributes.push({
            format: hashToVertexFormat[parts[i]] as GPUVertexFormat,
            offset: Number(parts[i + 1]),
            shaderLocation: Number(parts[i + 2])
          });
        }
        layouts.push(layout);
      });
      this._layouts[hash] = layouts;
    }
    return layouts;
  }
}
