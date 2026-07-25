import type { WebGPUDevice } from './device';

const TIMESTAMP_QUERY_COUNT = 4096;
const TIMESTAMP_BYTES_PER_QUERY = 8;
const TIMESTAMP_QUERIES_PER_SCOPE = 2;
const TIMESTAMP_RESOLVE_STRIDE = 256;
const MAX_RESOLVED_RESULT_HISTORY = 4096;

export type TimestampQueryStatus =
  | 'pending'
  | 'resolved'
  | 'unsupported'
  | 'invalid'
  | 'auto-closed'
  | 'exhausted'
  | 'failed';

export interface TimestampQueryOptions {
  includePendingUploads?: boolean;
  allowCrossFrame?: boolean;
  strict?: boolean;
}

export type TimestampQueryHandle = number | string;

export interface TimestampQueryResult {
  id: number;
  label: string;
  frameId: number;
  durationMs: number;
  start: bigint;
  end: bigint;
  status: TimestampQueryStatus;
  autoClosed?: boolean;
  message?: string;
}

export interface TimestampQueryFilter {
  label?: string;
  frameId?: number;
}

type TimestampQueryInternalStatus = 'open' | 'ended' | 'resolving' | TimestampQueryStatus;

type TimestampQueryRecord = {
  id: number;
  label: string;
  frameId: number;
  options: Required<TimestampQueryOptions>;
  startIndex: number;
  endIndex: number;
  status: TimestampQueryInternalStatus;
  autoClosed: boolean;
  collectResult: boolean;
  result: TimestampQueryResult | null;
  waiters: Array<(result: TimestampQueryResult) => void>;
};

type TimestampResolveBatch = {
  entries: TimestampResolveEntry[];
  resolveBuffer: GPUBuffer;
  readbackBuffer: GPUBuffer;
};

type TimestampResolveEntry = {
  record: TimestampQueryRecord;
  readbackOffset: number;
};

const defaultTimestampQueryOptions: Required<TimestampQueryOptions> = {
  includePendingUploads: true,
  allowCrossFrame: false,
  strict: false
};

export class WebGPUTimestampQueryManager {
  private readonly _device: WebGPUDevice;
  private readonly _supported: boolean;
  private readonly _querySet: GPUQuerySet | null;
  private readonly _freeQueryPairs: number[];
  private readonly _records: Map<number, TimestampQueryRecord>;
  private readonly _openRecords: Map<number, TimestampQueryRecord>;
  private readonly _endedRecords: TimestampQueryRecord[];
  private readonly _pendingSubmitBatches: TimestampResolveBatch[];
  private readonly _resolvedResults: TimestampQueryResult[];
  private _nextId: number;
  private _frameQueryId: number;

  constructor(device: WebGPUDevice) {
    this._device = device;
    this._supported = device.device.features.has('timestamp-query');
    this._querySet = this._supported
      ? device.device.createQuerySet({
          type: 'timestamp',
          count: TIMESTAMP_QUERY_COUNT
        })
      : null;
    this._freeQueryPairs = [];
    for (let i = TIMESTAMP_QUERY_COUNT - 2; i >= 0; i -= 2) {
      this._freeQueryPairs.push(i);
    }
    this._records = new Map();
    this._openRecords = new Map();
    this._endedRecords = [];
    this._pendingSubmitBatches = [];
    this._resolvedResults = [];
    this._nextId = 0;
    this._frameQueryId = 0;
  }

  get supported() {
    return this._supported;
  }

  begin(label?: string, options?: TimestampQueryOptions): number {
    return this.beginRecord(label, options, true);
  }

  beginFrame(): void {
    if (this._frameQueryId === 0) {
      this._frameQueryId = this.beginRecord('', undefined, false);
    }
  }

  endFrame(): Promise<TimestampQueryResult> | null {
    if (this._frameQueryId === 0) {
      return null;
    }
    const id = this._frameQueryId;
    this._frameQueryId = 0;
    this.end(id);
    const result = this.resolve(id);
    if (this._records.get(id)?.result) {
      this._records.delete(id);
    }
    return result;
  }

  private beginRecord(
    label: string | undefined,
    options: TimestampQueryOptions | undefined,
    collectResult: boolean
  ): number {
    if (!this._supported || !this._querySet) {
      return 0;
    }
    const id = ++this._nextId;
    const resolvedOptions = { ...defaultTimestampQueryOptions, ...(options ?? {}) };
    const startIndex = this._freeQueryPairs.pop();
    if (startIndex === undefined) {
      const result = this.createResult(
        id,
        label ?? '',
        this._device.frameInfo.frameCounter,
        0n,
        0n,
        'exhausted',
        false,
        'GPU timestamp query pool exhausted'
      );
      this._records.set(id, {
        id,
        label: result.label,
        frameId: result.frameId,
        options: resolvedOptions,
        startIndex: -1,
        endIndex: -1,
        status: 'exhausted',
        autoClosed: false,
        collectResult,
        result,
        waiters: []
      });
      if (collectResult) {
        this.pushResolvedResult(result);
      }
      return id;
    }
    const record: TimestampQueryRecord = {
      id,
      label: label ?? '',
      frameId: this._device.frameInfo.frameCounter,
      options: resolvedOptions,
      startIndex,
      endIndex: startIndex + 1,
      status: 'open',
      autoClosed: false,
      collectResult,
      result: null,
      waiters: []
    };
    this._records.set(id, record);
    this._openRecords.set(id, record);
    this._device.commandQueue.insertTimestampMarker(
      this._querySet,
      record.startIndex,
      record.options.includePendingUploads
    );
    return id;
  }

  end(id: number): void {
    if (!this._supported) {
      return;
    }
    const record = this._records.get(id);
    if (!record) {
      this.reportInvalidEnd(id, 'endTimestampQuery() ignored: invalid query id');
      return;
    }
    if (record.status !== 'open') {
      if (record.status !== 'exhausted' && record.status !== 'unsupported') {
        this.reportInvalidEnd(id, 'endTimestampQuery() ignored: query is not open');
      }
      return;
    }
    this.endRecord(record, false);
  }

  autoCloseOpenScopes(): void {
    for (const record of Array.from(this._openRecords.values())) {
      if (!record.options.allowCrossFrame) {
        this.endRecord(record, true);
      }
    }
  }

  createResolveCommandBuffer(): GPUCommandBuffer | null {
    if (!this._querySet || this._endedRecords.length === 0) {
      return null;
    }
    const records = this._endedRecords.splice(0);
    const entries = records.map((record, index) => {
      record.status = 'resolving';
      return {
        record,
        readbackOffset: index * TIMESTAMP_RESOLVE_STRIDE
      };
    });
    const byteLength = entries.length * TIMESTAMP_RESOLVE_STRIDE;
    const resolveBuffer = this._device.device.createBuffer({
      label: 'timestamp-query-resolve',
      size: byteLength,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
    });
    const readbackBuffer = this._device.device.createBuffer({
      label: 'timestamp-query-readback',
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const encoder = this._device.device.createCommandEncoder({ label: 'timestamp-query-resolve' });
    for (const entry of entries) {
      encoder.resolveQuerySet(
        this._querySet,
        entry.record.startIndex,
        TIMESTAMP_QUERIES_PER_SCOPE,
        resolveBuffer,
        entry.readbackOffset
      );
    }
    encoder.copyBufferToBuffer(resolveBuffer, 0, readbackBuffer, 0, byteLength);
    this._pendingSubmitBatches.push({
      entries,
      resolveBuffer,
      readbackBuffer
    });
    return encoder.finish();
  }

  onSubmitted(): void {
    const batches = this._pendingSubmitBatches.splice(0);
    for (const batch of batches) {
      batch.readbackBuffer
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          this.completeBatch(batch);
        })
        .catch((err) => {
          this.failBatch(batch, err instanceof Error ? err.message : String(err));
        });
    }
  }

  poll(query: TimestampQueryHandle): TimestampQueryResult | null {
    if (!this._supported) {
      return this.createUnsupportedResult(query);
    }
    const record = this.findRecord(query);
    if (!record) {
      return this.createInvalidResult(query, 'Timestamp query not found');
    }
    return record.result;
  }

  resolve(query: TimestampQueryHandle): Promise<TimestampQueryResult> {
    if (!this._supported) {
      return Promise.resolve(this.createUnsupportedResult(query));
    }
    const record = this.findRecord(query);
    if (!record) {
      return Promise.resolve(this.createInvalidResult(query, 'Timestamp query not found'));
    }
    if (record.result) {
      return Promise.resolve(record.result);
    }
    return new Promise<TimestampQueryResult>((resolve) => {
      record.waiters.push(resolve);
    });
  }

  collect(filter?: TimestampQueryFilter): TimestampQueryResult[] {
    return this._resolvedResults.filter((result) => {
      return (
        (filter?.label === undefined || result.label === filter.label) &&
        (filter?.frameId === undefined || result.frameId === filter.frameId)
      );
    });
  }

  private endRecord(record: TimestampQueryRecord, autoClosed: boolean): void {
    if (!this._querySet) {
      return;
    }
    record.autoClosed = autoClosed;
    this._openRecords.delete(record.id);
    this._device.commandQueue.insertTimestampMarker(
      this._querySet,
      record.endIndex,
      record.options.includePendingUploads
    );
    record.status = 'ended';
    this._endedRecords.push(record);
    if (autoClosed) {
      console.warn(`GPU timestamp query '${record.label}' was automatically closed at frame end`);
    }
  }

  private completeBatch(batch: TimestampResolveBatch): void {
    const values = new BigUint64Array(batch.readbackBuffer.getMappedRange());
    for (const entry of batch.entries) {
      const record = entry.record;
      const valueOffset = entry.readbackOffset / TIMESTAMP_BYTES_PER_QUERY;
      const start = values[valueOffset];
      const end = values[valueOffset + 1];
      const duration = end >= start ? end - start : 0n;
      const result = this.createResult(
        record.id,
        record.label,
        record.frameId,
        start,
        end,
        record.autoClosed ? 'auto-closed' : 'resolved',
        record.autoClosed
      );
      result.durationMs = Number(duration) / 1000000;
      record.status = result.status;
      record.result = result;
      this.freeQueryPair(record.startIndex);
      this.resolveWaiters(record);
      this.completeRecord(record, result);
    }
    batch.readbackBuffer.unmap();
    batch.readbackBuffer.destroy();
    batch.resolveBuffer.destroy();
  }

  private failBatch(batch: TimestampResolveBatch, message: string): void {
    for (const entry of batch.entries) {
      const record = entry.record;
      const result = this.createResult(
        record.id,
        record.label,
        record.frameId,
        0n,
        0n,
        'failed',
        record.autoClosed,
        message
      );
      record.status = 'failed';
      record.result = result;
      this.freeQueryPair(record.startIndex);
      this.resolveWaiters(record);
      this.completeRecord(record, result);
    }
    batch.readbackBuffer.destroy();
    batch.resolveBuffer.destroy();
  }

  private freeQueryPair(startIndex: number): void {
    if (startIndex >= 0 && this._freeQueryPairs.indexOf(startIndex) < 0) {
      this._freeQueryPairs.push(startIndex);
    }
  }

  private resolveWaiters(record: TimestampQueryRecord): void {
    for (const resolve of record.waiters.splice(0)) {
      resolve(record.result!);
    }
  }

  private completeRecord(record: TimestampQueryRecord, result: TimestampQueryResult): void {
    if (record.collectResult) {
      this.pushResolvedResult(result);
    } else {
      this._records.delete(record.id);
    }
  }

  private pushResolvedResult(result: TimestampQueryResult): void {
    this._resolvedResults.push(result);
    while (this._resolvedResults.length > MAX_RESOLVED_RESULT_HISTORY) {
      const oldResult = this._resolvedResults.shift();
      if (oldResult) {
        const oldRecord = this._records.get(oldResult.id);
        if (oldRecord?.result === oldResult) {
          this._records.delete(oldResult.id);
        }
      }
    }
  }

  private reportInvalidEnd(id: number, message: string): void {
    const record = this._records.get(id);
    if (record?.options.strict) {
      throw new Error(message);
    }
    console.warn(message);
  }

  private findRecord(query: TimestampQueryHandle): TimestampQueryRecord | null {
    if (typeof query === 'number') {
      return this._records.get(query) ?? null;
    }
    let latest: TimestampQueryRecord | null = null;
    for (const record of this._records.values()) {
      if (record.label === query) {
        latest = record;
      }
    }
    return latest;
  }

  private createUnsupportedResult(query: TimestampQueryHandle): TimestampQueryResult {
    return this.createResult(
      typeof query === 'number' ? query : 0,
      typeof query === 'string' ? query : '',
      this._device.frameInfo.frameCounter,
      0n,
      0n,
      'unsupported',
      false,
      'GPU timestamp queries are not supported by this WebGPU device'
    );
  }

  private createInvalidResult(query: TimestampQueryHandle, message: string): TimestampQueryResult {
    return this.createResult(
      typeof query === 'number' ? query : 0,
      typeof query === 'string' ? query : '',
      this._device.frameInfo.frameCounter,
      0n,
      0n,
      'invalid',
      false,
      message
    );
  }

  private createResult(
    id: number,
    label: string,
    frameId: number,
    start: bigint,
    end: bigint,
    status: TimestampQueryStatus,
    autoClosed: boolean,
    message?: string
  ): TimestampQueryResult {
    return {
      id,
      label,
      frameId,
      durationMs: 0,
      start,
      end,
      status,
      autoClosed: autoClosed || undefined,
      message
    };
  }
}
