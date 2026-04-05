import { base64ToUint8Array, Vector3 } from '@zephyr3d/base';
import { BoundingBox } from '@zephyr3d/scene';
import type { ModelImporter } from './importer';
import {
  type AssetAnimationData,
  type AssetGeometryCacheAnimationTrack,
  SharedModel
} from './model';
import { ResourceService } from '../core/services/resource';

type ZABCCacheTrackJSON = {
  node?: number;
  nodePath?: string;
  nodeName?: string;
  subMeshIndex: number;
  times?: string | ZABCBinaryBufferRef;
  sampleRate?: number;
  positionFrames: Array<string | ZABCBinaryBufferRef>;
  normalFrames?: Array<string | ZABCBinaryBufferRef>;
  bounds: [number, number, number, number, number, number][];
};

type ZABCAnimationJSON = {
  name: string;
  tracks: ZABCCacheTrackJSON[];
};

type ZABCFileJSON = {
  version: number;
  baseModel: string;
  animations: ZABCAnimationJSON[];
};

type ZABCBinaryBufferRef = {
  offset: number;
  length: number;
  count?: number;
};

type ParsedZABC = {
  content: ZABCFileJSON;
  binaryPayload: ArrayBuffer | null;
  payloadOffset: number;
};

export class ZABCImporter implements ModelImporter {
  async import(data: Blob, model: SharedModel) {
    const parsed = await this.parseZABC(data);
    const content = parsed.content;
    if (!content?.baseModel) {
      throw new Error('Invalid zabc file: baseModel is required');
    }
    const baseModelPath = model.VFS.normalizePath(model.VFS.join(model.pathName, content.baseModel));
    const importedBase = await ResourceService.importModel(model.VFS, baseModelPath);
    model.copyFrom(importedBase);
    this.attachAnimations(model, parsed);
  }

  private attachAnimations(model: SharedModel, parsed: ParsedZABC) {
    for (const animation of parsed.content.animations ?? []) {
      const tracks: AssetAnimationData['tracks'] = [];
      const nodes = [];
      for (const track of animation.tracks ?? []) {
        const targetNode = this.findTargetNode(model, track);
        if (!targetNode) {
          console.error(
            `zabc track target not found: node=${track.node}, nodePath=${track.nodePath}, nodeName=${track.nodeName}`
          );
          continue;
        }
        const cacheTrack: AssetGeometryCacheAnimationTrack = {
          node: targetNode,
          type: 'geometry-cache',
          subMeshIndex: track.subMeshIndex ?? 0,
          times: this.decodeTimes(track),
          frames: track.positionFrames.map((positionsRef, index) => ({
            positions: this.decodeFloat32Array(positionsRef, parsed),
            normals: track.normalFrames?.[index] ? this.decodeFloat32Array(track.normalFrames[index], parsed) : null,
            boundingBox: this.decodeBoundingBox(track.bounds[index])
          }))
        };
        tracks.push(cacheTrack);
        if (nodes.indexOf(targetNode) < 0) {
          nodes.push(targetNode);
        }
      }
      model.addAnimation({
        name: animation.name ?? 'GeometryCache',
        tracks,
        skeletons: [],
        nodes
      });
    }
  }

  private decodeFloat32Array(data: string | ZABCBinaryBufferRef, parsed: ParsedZABC) {
    if (typeof data === 'string') {
      const bytes = base64ToUint8Array(data);
      return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    if (!parsed.binaryPayload) {
      throw new Error('Invalid binary zabc file: missing payload');
    }
    const start = parsed.payloadOffset + data.offset;
    const end = start + data.length;
    return new Float32Array(parsed.binaryPayload.slice(start, end));
  }

  private decodeBoundingBox(values: [number, number, number, number, number, number]) {
    return new BoundingBox(
      new Vector3(values[0], values[1], values[2]),
      new Vector3(values[3], values[4], values[5])
    );
  }

  private decodeTimes(track: ZABCCacheTrackJSON) {
    if (track.times) {
      return this.decodeFloat32Array(track.times, this._currentParsed!);
    }
    const sampleRate = track.sampleRate && track.sampleRate > 0 ? track.sampleRate : 30;
    const times = new Float32Array(track.positionFrames.length);
    for (let i = 0; i < times.length; i++) {
      times[i] = i / sampleRate;
    }
    return times;
  }

  private async parseZABC(data: Blob) {
    const arrayBuffer = await data.arrayBuffer();
    if (this.isBinaryZABC(arrayBuffer)) {
      return this.parseBinaryZABC(arrayBuffer);
    }
    return this.parseLegacyZABC(arrayBuffer);
  }

  private _currentParsed: ParsedZABC | null = null;

  private parseLegacyZABC(arrayBuffer: ArrayBuffer) {
    const text = new TextDecoder().decode(arrayBuffer);
    try {
      const parsed: ParsedZABC = {
        content: JSON.parse(text) as ZABCFileJSON,
        binaryPayload: null,
        payloadOffset: 0
      };
      this._currentParsed = parsed;
      return parsed;
    } catch (err) {
      const sizeMB = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(2);
      throw new Error(
        `Failed to parse zabc JSON (blob=${sizeMB} MB, text=${text.length} chars): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private parseBinaryZABC(arrayBuffer: ArrayBuffer) {
    const view = new DataView(arrayBuffer);
    const version = view.getUint32(4, true);
    if (version !== 2) {
      throw new Error(`Unsupported binary zabc version: ${version}`);
    }
    const manifestLength = view.getUint32(8, true);
    const manifestOffset = 12;
    const payloadOffset = manifestOffset + manifestLength;
    const manifestText = new TextDecoder().decode(arrayBuffer.slice(manifestOffset, payloadOffset));
    const parsed: ParsedZABC = {
      content: JSON.parse(manifestText) as ZABCFileJSON,
      binaryPayload: arrayBuffer,
      payloadOffset
    };
    this._currentParsed = parsed;
    return parsed;
  }

  private isBinaryZABC(arrayBuffer: ArrayBuffer) {
    if (arrayBuffer.byteLength < 12) {
      return false;
    }
    const magic = new Uint8Array(arrayBuffer, 0, 4);
    return magic[0] === 0x5a && magic[1] === 0x41 && magic[2] === 0x42 && magic[3] === 0x43;
  }

  private findTargetNode(model: SharedModel, track: ZABCCacheTrackJSON) {
    if (typeof track.node === 'number') {
      return model.nodes[track.node] ?? null;
    }
    if (track.nodePath) {
      for (const candidatePath of this.getNodePathCandidates(track.nodePath)) {
        for (const root of model.scenes.flatMap((scene) => scene.rootNodes)) {
          const node = this.findNodeByPath(root, candidatePath);
          if (node) {
            return node;
          }
        }
      }
    }
    if (track.nodeName) {
      for (const candidateName of this.getNodeNameCandidates(track.nodeName)) {
        const node = model.nodes.find((item) => item?.name === candidateName) ?? null;
        if (node) {
          return node;
        }
      }
    }
    return null;
  }

  private getNodePathCandidates(path: string) {
    const normalized = this.normalizeNodePath(path);
    const candidates = [normalized];
    if (normalized.endsWith('Shape')) {
      candidates.push(normalized.slice(0, -'Shape'.length));
    }
    const parts = normalized.split('/');
    const last = parts.length > 0 ? parts[parts.length - 1] : '';
    if (last.endsWith('Shape') && parts.length > 1) {
      parts[parts.length - 1] = last.slice(0, -'Shape'.length);
      candidates.push(parts.join('/'));
      parts.pop();
      candidates.push(parts.join('/'));
    }
    return candidates.filter((value, index, array) => !!value && array.indexOf(value) === index);
  }

  private getNodeNameCandidates(name: string) {
    const candidates = [name];
    if (name.endsWith('Shape')) {
      candidates.push(name.slice(0, -'Shape'.length));
    }
    return candidates.filter((value, index, array) => !!value && array.indexOf(value) === index);
  }

  private findNodeByPath(
    node: SharedModel['nodes'][number],
    normalizedTrackPath: string,
    currentPath = ''
  ): SharedModel['nodes'][number] | null {
    if (!node) {
      return null;
    }
    const path = currentPath ? `${currentPath}/${node.name || ''}` : node.name || '';
    const normalizedCurrent = this.normalizeNodePath(path);
    if (normalizedCurrent === normalizedTrackPath) {
      return node;
    }
    for (const child of node.children) {
      const found: SharedModel['nodes'][number] | null = this.findNodeByPath(child, normalizedTrackPath, path);
      if (found) {
        return found;
      }
    }
    return null;
  }

  private normalizeNodePath(path: string) {
    return path
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .join('/');
  }
}
