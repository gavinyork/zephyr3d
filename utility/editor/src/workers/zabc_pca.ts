// ZABC PCA compression worker (browser-native)

type BinaryRef = {
  offset: number;
  length: number;
  count?: number;
};

type ZABCTrack = {
  codec?: 'fixed' | 'pca';
  node?: number;
  nodePath?: string;
  nodeName?: string;
  subMeshIndex?: number;
  times?: string | BinaryRef;
  sampleRate?: number;
  positionFrames?: Array<string | BinaryRef>;
  normalFrames?: Array<string | BinaryRef>;
  bounds?: [number, number, number, number, number, number][];
  vectorLength?: number;
  positionReference?: string | BinaryRef;
  positionComponents?: number;
  positionMean?: string | BinaryRef;
  positionBases?: string | BinaryRef;
  positionCoefficients?: string | BinaryRef;
  normalComponents?: number;
  normalMean?: string | BinaryRef;
  normalBases?: string | BinaryRef;
  normalCoefficients?: string | BinaryRef;
};

type ZABCAnimation = {
  name: string;
  tracks: ZABCTrack[];
};

type ZABCManifest = {
  version: number;
  baseModel?: string;
  animations: ZABCAnimation[];
};

type ParsedZABC = {
  manifest: ZABCManifest;
  binaryPayload: ArrayBuffer | null;
  payloadOffset: number;
};

type ZABCPreviewStats = {
  animationCount: number;
  trackCount: number;
  frameCount: number;
  sourcePayloadBytes: number;
  convertedPayloadBytes: number;
  maxPositionError: number;
  rmsPositionError: number;
};

type CompressMessage = {
  type: 'compress';
  input: ArrayBuffer;
  components: number;
  compressNormals: boolean;
};

type PreviewMessage = {
  type: 'preview';
  input: ArrayBuffer;
  components: number;
  compressNormals: boolean;
};

type WorkerMessage = CompressMessage | PreviewMessage;

type WorkerSuccess = {
  type: 'success';
  output: ArrayBuffer;
};

type WorkerPreview = {
  type: 'preview';
  stats: ZABCPreviewStats;
};

type WorkerError = {
  type: 'error';
  error: string;
};

const ZABC_MAGIC = [0x5a, 0x41, 0x42, 0x43];

class BinaryWriter {
  private readonly _payload = new Uint8Array(0);
  private _chunks: Uint8Array[] = [];
  private _length = 0;

  get length() {
    return this._length;
  }

  appendFloat32Array(values: Float32Array): BinaryRef {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    const copied = new Uint8Array(bytes);
    const ref: BinaryRef = {
      offset: this._length,
      length: copied.byteLength,
      count: values.length
    };
    this._chunks.push(copied);
    this._length += copied.byteLength;
    return ref;
  }

  buildPayload(): Uint8Array {
    if (this._chunks.length === 0) {
      return this._payload;
    }
    const payload = new Uint8Array(this._length);
    let offset = 0;
    for (const chunk of this._chunks) {
      payload.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return payload;
  }
}

function isBinaryZABC(arrayBuffer: ArrayBuffer) {
  if (arrayBuffer.byteLength < 12) {
    return false;
  }
  const magic = new Uint8Array(arrayBuffer, 0, 4);
  return (
    magic[0] === ZABC_MAGIC[0] && magic[1] === ZABC_MAGIC[1] && magic[2] === ZABC_MAGIC[2] && magic[3] === ZABC_MAGIC[3]
  );
}

function parseZABC(arrayBuffer: ArrayBuffer): ParsedZABC {
  if (isBinaryZABC(arrayBuffer)) {
    const view = new DataView(arrayBuffer);
    const version = view.getUint32(4, true);
    if (version !== 2 && version !== 3) {
      throw new Error(`Unsupported binary zabc version: ${version}`);
    }
    const manifestLength = view.getUint32(8, true);
    const manifestOffset = 12;
    const payloadOffset = manifestOffset + manifestLength;
    const manifestText = new TextDecoder().decode(arrayBuffer.slice(manifestOffset, payloadOffset));
    return {
      manifest: JSON.parse(manifestText) as ZABCManifest,
      binaryPayload: arrayBuffer,
      payloadOffset
    };
  }
  const text = new TextDecoder().decode(arrayBuffer);
  return {
    manifest: JSON.parse(text) as ZABCManifest,
    binaryPayload: null,
    payloadOffset: 0
  };
}

function decodeBase64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeFloat32Array(data: string | BinaryRef, parsed: ParsedZABC): Float32Array {
  if (typeof data === 'string') {
    const bytes = decodeBase64ToBytes(data);
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  if (!parsed.binaryPayload) {
    throw new Error('Invalid binary zabc file: missing payload');
  }
  const start = parsed.payloadOffset + data.offset;
  const end = start + data.length;
  return new Float32Array(parsed.binaryPayload.slice(start, end));
}

function decodeTimes(track: ZABCTrack, parsed: ParsedZABC): Float32Array {
  if (track.times) {
    return decodeFloat32Array(track.times, parsed);
  }
  const sampleRate = track.sampleRate && track.sampleRate > 0 ? track.sampleRate : 30;
  const frameCount = track.positionFrames?.length ?? 0;
  const times = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    times[i] = i / sampleRate;
  }
  return times;
}

function flattenRowMajor(rows: Float32Array[]) {
  if (rows.length === 0) {
    return new Float32Array(0);
  }
  const stride = rows[0].length;
  const out = new Float32Array(rows.length * stride);
  for (let r = 0; r < rows.length; r++) {
    out.set(rows[r], r * stride);
  }
  return out;
}

function buildCenteredMatrix(frames: Float32Array[]) {
  const frameCount = frames.length;
  const vectorLength = frameCount > 0 ? frames[0].length : 0;
  const mean = new Float32Array(vectorLength);
  for (let f = 0; f < frameCount; f++) {
    const frame = frames[f];
    for (let i = 0; i < vectorLength; i++) {
      mean[i] += frame[i];
    }
  }
  if (frameCount > 0) {
    const inv = 1 / frameCount;
    for (let i = 0; i < vectorLength; i++) {
      mean[i] *= inv;
    }
  }
  const centered: Float32Array[] = new Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const src = frames[f];
    const row = new Float32Array(vectorLength);
    for (let i = 0; i < vectorLength; i++) {
      row[i] = src[i] - mean[i];
    }
    centered[f] = row;
  }
  return { mean, centered, frameCount, vectorLength };
}

function dot(a: Float64Array, b: Float64Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}

function matVecSym(matrix: Float64Array, n: number, v: Float64Array, out: Float64Array) {
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const row = i * n;
    for (let j = 0; j < n; j++) {
      sum += matrix[row + j] * v[j];
    }
    out[i] = sum;
  }
}

function normalize(v: Float64Array) {
  const n = Math.sqrt(dot(v, v));
  if (n <= 1e-12) {
    return false;
  }
  const inv = 1 / n;
  for (let i = 0; i < v.length; i++) {
    v[i] *= inv;
  }
  return true;
}

function computeTopEigenSymmetric(gram: Float64Array, n: number, maxComponents: number) {
  const a = new Float64Array(gram);
  const values: number[] = [];
  const vectors: Float64Array[] = [];
  const maxIter = 80;

  for (let c = 0; c < maxComponents; c++) {
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      v[i] = ((i + 1) * (c + 3)) % 17 + 1;
    }
    normalize(v);
    const y = new Float64Array(n);

    for (let iter = 0; iter < maxIter; iter++) {
      matVecSym(a, n, v, y);
      if (!normalize(y)) {
        break;
      }
      let delta = 0;
      for (let i = 0; i < n; i++) {
        delta = Math.max(delta, Math.abs(y[i] - v[i]));
        v[i] = y[i];
      }
      if (delta < 1e-6) {
        break;
      }
    }

    matVecSym(a, n, v, y);
    const lambda = dot(v, y);
    if (!(lambda > 1e-10)) {
      break;
    }

    values.push(lambda);
    vectors.push(new Float64Array(v));

    for (let i = 0; i < n; i++) {
      const vi = v[i];
      const row = i * n;
      for (let j = 0; j < n; j++) {
        a[row + j] -= lambda * vi * v[j];
      }
    }
  }

  return { values, vectors };
}

function computePCA(frames: Float32Array[], components: number) {
  const { mean, centered, frameCount, vectorLength } = buildCenteredMatrix(frames);
  if (frameCount === 0 || vectorLength === 0) {
    return {
      mean,
      bases: [] as Float32Array[],
      coefficients: [] as Float32Array[]
    };
  }
  if (frameCount === 1) {
    return {
      mean,
      bases: [] as Float32Array[],
      coefficients: [new Float32Array(0)]
    };
  }

  const gram = new Float64Array(frameCount * frameCount);
  for (let i = 0; i < frameCount; i++) {
    const ri = centered[i];
    for (let j = i; j < frameCount; j++) {
      const rj = centered[j];
      let s = 0;
      for (let k = 0; k < vectorLength; k++) {
        s += ri[k] * rj[k];
      }
      gram[i * frameCount + j] = s;
      gram[j * frameCount + i] = s;
    }
  }

  const maxComponents = Math.max(1, Math.min(components, frameCount - 1, vectorLength));
  const eig = computeTopEigenSymmetric(gram, frameCount, maxComponents);
  const compCount = eig.values.length;
  if (compCount === 0) {
    return {
      mean,
      bases: [] as Float32Array[],
      coefficients: centered.map(() => new Float32Array(0))
    };
  }

  const singular = eig.values.map((v) => Math.sqrt(Math.max(0, v)));
  const coefficients: Float32Array[] = new Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    coefficients[f] = new Float32Array(compCount);
  }
  for (let c = 0; c < compCount; c++) {
    const u = eig.vectors[c];
    const s = singular[c];
    for (let f = 0; f < frameCount; f++) {
      coefficients[f][c] = s > 1e-8 ? u[f] * s : 0;
    }
  }

  const bases: Float32Array[] = new Array(compCount);
  for (let c = 0; c < compCount; c++) {
    const u = eig.vectors[c];
    const s = singular[c];
    const basis = new Float32Array(vectorLength);
    if (s > 1e-8) {
      const invS = 1 / s;
      for (let d = 0; d < vectorLength; d++) {
        let sum = 0;
        for (let f = 0; f < frameCount; f++) {
          sum += u[f] * centered[f][d];
        }
        basis[d] = sum * invS;
      }
    }
    bases[c] = basis;
  }

  return { mean, bases, coefficients };
}

function identityFields(track: ZABCTrack) {
  const info: Record<string, unknown> = {};
  if (track.node !== undefined) {
    info.node = track.node;
  }
  if (track.nodePath) {
    info.nodePath = track.nodePath;
  }
  if (track.nodeName) {
    info.nodeName = track.nodeName;
  }
  if (track.subMeshIndex !== undefined) {
    info.subMeshIndex = track.subMeshIndex;
  }
  return info;
}

function estimateFixedPayloadBytes(times: Float32Array, positions: Float32Array[], normals: Float32Array[] | null) {
  let total = times.byteLength;
  for (const p of positions) {
    total += p.byteLength;
  }
  if (normals) {
    for (const n of normals) {
      total += n.byteLength;
    }
  }
  return total;
}

function accumulatePcaError(
  sourceFrames: Float32Array[],
  mean: Float32Array,
  bases: Float32Array[],
  coefficients: Float32Array[],
  stats: ZABCPreviewStats
) {
  const vectorLength = mean.length;
  if (!sourceFrames.length || vectorLength === 0) {
    return;
  }
  const recon = new Float32Array(vectorLength);
  for (let frameIndex = 0; frameIndex < sourceFrames.length; frameIndex++) {
    recon.set(mean);
    const coeff = coefficients[frameIndex];
    if (coeff) {
      const compCount = Math.min(coeff.length, bases.length);
      for (let c = 0; c < compCount; c++) {
        const k = coeff[c];
        if (k === 0) {
          continue;
        }
        const basis = bases[c];
        for (let i = 0; i < vectorLength; i++) {
          recon[i] += basis[i] * k;
        }
      }
    }
    const src = sourceFrames[frameIndex];
    const count = Math.min(src.length, recon.length);
    let squared = 0;
    for (let i = 0; i < count; i++) {
      const d = recon[i] - src[i];
      const ad = Math.abs(d);
      if (ad > stats.maxPositionError) {
        stats.maxPositionError = ad;
      }
      squared += d * d;
    }
    stats.rmsPositionError += squared;
    stats.frameCount += 1;
    stats.convertedPayloadBytes += 0;
    (stats as any)._valueCount = ((stats as any)._valueCount ?? 0) + count;
  }
}

function serializeExistingPcaTrack(track: ZABCTrack, parsed: ParsedZABC, writer: BinaryWriter): ZABCTrack {
  const out: ZABCTrack = {
    ...identityFields(track),
    codec: 'pca',
    bounds: track.bounds ?? []
  };
  out.times = writer.appendFloat32Array(decodeTimes(track, parsed));
  if (track.positionReference) {
    out.positionReference = writer.appendFloat32Array(decodeFloat32Array(track.positionReference, parsed));
  }
  const positionMean = decodeFloat32Array(track.positionMean!, parsed);
  const positionBases = decodeFloat32Array(track.positionBases!, parsed);
  const positionCoefficients = decodeFloat32Array(track.positionCoefficients!, parsed);
  out.positionMean = writer.appendFloat32Array(positionMean);
  out.positionBases = writer.appendFloat32Array(positionBases);
  out.positionCoefficients = writer.appendFloat32Array(positionCoefficients);
  out.vectorLength = track.vectorLength ?? positionMean.length;
  out.positionComponents =
    track.positionComponents ??
    (out.vectorLength > 0 ? Math.floor(positionBases.length / Math.max(1, out.vectorLength)) : 0);

  if (track.normalMean && track.normalBases && track.normalCoefficients) {
    const normalMean = decodeFloat32Array(track.normalMean, parsed);
    const normalBases = decodeFloat32Array(track.normalBases, parsed);
    const normalCoefficients = decodeFloat32Array(track.normalCoefficients, parsed);
    out.normalMean = writer.appendFloat32Array(normalMean);
    out.normalBases = writer.appendFloat32Array(normalBases);
    out.normalCoefficients = writer.appendFloat32Array(normalCoefficients);
    out.normalComponents =
      track.normalComponents ??
      (out.vectorLength! > 0 ? Math.floor(normalBases.length / Math.max(1, out.vectorLength!)) : 0);
  }
  return out;
}

function compressManifest(parsed: ParsedZABC, components: number, compressNormals: boolean) {
  const writer = new BinaryWriter();
  const source = parsed.manifest;
  const outputManifest: ZABCManifest = {
    version: 3,
    baseModel: source.baseModel,
    animations: []
  };

  const stats: ZABCPreviewStats = {
    animationCount: source.animations?.length ?? 0,
    trackCount: 0,
    frameCount: 0,
    sourcePayloadBytes: 0,
    convertedPayloadBytes: 0,
    maxPositionError: 0,
    rmsPositionError: 0
  };

  for (const animation of source.animations ?? []) {
    const outTracks: ZABCTrack[] = [];
    for (const track of animation.tracks ?? []) {
      stats.trackCount += 1;
      const bytesBefore = writer.length;

      if (track.codec === 'pca') {
        const copied = serializeExistingPcaTrack(track, parsed, writer);
        outTracks.push(copied);
        stats.convertedPayloadBytes += writer.length - bytesBefore;
        continue;
      }

      const positionFramesRef = track.positionFrames ?? [];
      const positions = positionFramesRef.map((ref) => decodeFloat32Array(ref, parsed));
      const normals = track.normalFrames?.length ? track.normalFrames.map((ref) => decodeFloat32Array(ref, parsed)) : null;
      const times = decodeTimes(track, parsed);
      const bounds = track.bounds ?? [];
      stats.sourcePayloadBytes += estimateFixedPayloadBytes(times, positions, normals);

      if (positions.length === 0) {
        const fixedTrack: ZABCTrack = {
          ...identityFields(track),
          codec: 'fixed',
          times: writer.appendFloat32Array(times),
          positionFrames: [],
          normalFrames: [],
          bounds
        };
        outTracks.push(fixedTrack);
        stats.convertedPayloadBytes += writer.length - bytesBefore;
        continue;
      }

      const posPCA = computePCA(positions, components);
      const outTrack: ZABCTrack = {
        ...identityFields(track),
        codec: 'pca',
        times: writer.appendFloat32Array(times),
        bounds,
        vectorLength: positions[0].length,
        positionComponents: posPCA.bases.length,
        positionReference: writer.appendFloat32Array(positions[0]),
        positionMean: writer.appendFloat32Array(posPCA.mean),
        positionBases: writer.appendFloat32Array(flattenRowMajor(posPCA.bases)),
        positionCoefficients: writer.appendFloat32Array(flattenRowMajor(posPCA.coefficients))
      };

      if (compressNormals && normals && normals.length > 0) {
        const normalPCA = computePCA(normals, components);
        outTrack.normalComponents = normalPCA.bases.length;
        outTrack.normalMean = writer.appendFloat32Array(normalPCA.mean);
        outTrack.normalBases = writer.appendFloat32Array(flattenRowMajor(normalPCA.bases));
        outTrack.normalCoefficients = writer.appendFloat32Array(flattenRowMajor(normalPCA.coefficients));
      }

      accumulatePcaError(positions, posPCA.mean, posPCA.bases, posPCA.coefficients, stats);
      outTracks.push(outTrack);
      stats.convertedPayloadBytes += writer.length - bytesBefore;
    }
    outputManifest.animations.push({
      name: animation.name,
      tracks: outTracks
    });
  }

  const valueCount = (stats as any)._valueCount ?? 0;
  stats.rmsPositionError = valueCount > 0 ? Math.sqrt(stats.rmsPositionError / valueCount) : 0;
  delete (stats as any)._valueCount;

  const manifestBytes = new TextEncoder().encode(JSON.stringify(outputManifest));
  const payload = writer.buildPayload();
  const header = new Uint8Array(12);
  header[0] = ZABC_MAGIC[0];
  header[1] = ZABC_MAGIC[1];
  header[2] = ZABC_MAGIC[2];
  header[3] = ZABC_MAGIC[3];
  const view = new DataView(header.buffer);
  view.setUint32(4, 3, true);
  view.setUint32(8, manifestBytes.byteLength, true);

  const out = new Uint8Array(header.byteLength + manifestBytes.byteLength + payload.byteLength);
  out.set(header, 0);
  out.set(manifestBytes, header.byteLength);
  out.set(payload, header.byteLength + manifestBytes.byteLength);
  return {
    output: out.buffer,
    stats
  };
}

self.addEventListener('message', (ev: MessageEvent<WorkerMessage>) => {
  try {
    const parsed = parseZABC(ev.data.input);
    const result = compressManifest(parsed, Math.max(1, ev.data.components | 0), !!ev.data.compressNormals);
    if (ev.data.type === 'preview') {
      const msg: WorkerPreview = {
        type: 'preview',
        stats: result.stats
      };
      (self as unknown as Worker).postMessage(msg);
      return;
    }
    if (ev.data.type === 'compress') {
      const msg: WorkerSuccess = {
        type: 'success',
        output: result.output
      };
      (self as unknown as Worker).postMessage(msg, [result.output]);
      return;
    }
    throw new Error('Unsupported worker message');
  } catch (error) {
    const msg: WorkerError = {
      type: 'error',
      error: error instanceof Error ? error.message : `${error}`
    };
    (self as unknown as Worker).postMessage(msg);
  }
});
