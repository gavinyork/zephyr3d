import { isWebGL2 } from './utils';
import { WebGLEnum } from './webgl_enum';
import type { ITimer } from '@zephyr3d/device';
import type { WebGLDevice } from './device_webgl';
import type { Nullable } from '@zephyr3d/base';

const GPU_DISJOINT_EXT = 0x8fbb;
const TIME_ELAPSED_EXT = 0x88bf;

const enum QueryState {
  QUERY_STATE_NONE = 0,
  QUERY_STATE_QUERYING = 1,
  QUERY_STATE_FINISHED = 2
}

interface TimerQuery {
  createQuery: () => unknown;
  deleteQuery: (query: Nullable<WebGLQuery>) => void;
  isQuery: (query: Nullable<WebGLQuery>) => boolean;
  beginQuery: (target: number, query: WebGLQuery) => void;
  endQuery: (target: number) => void;
  getQuery: (target: number, pname: number) => unknown;
  getQueryObject: (query: WebGLQuery, pname: number) => unknown;
  queryCounter: (query: unknown, target: number) => void;
}

export class GPUTimer implements ITimer {
  private readonly _device: WebGLDevice;
  private readonly _query: unknown;
  private _state: QueryState;
  private readonly _timerQuery: Nullable<TimerQuery>;
  private _gpuTime: Nullable<number>;
  constructor(device: WebGLDevice) {
    this._device = device;
    this._state = QueryState.QUERY_STATE_NONE;
    this._timerQuery = null;
    this._gpuTime = null;
    const gl = this._device.context;
    if (isWebGL2(gl)) {
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (ext) {
        this._timerQuery = {
          createQuery: gl.createQuery.bind(gl),
          deleteQuery: gl.deleteQuery.bind(gl),
          beginQuery: gl.beginQuery.bind(gl),
          endQuery: gl.endQuery.bind(gl),
          isQuery: gl.isQuery.bind(gl),
          getQuery: gl.getQuery.bind(gl),
          getQueryObject: gl.getQueryParameter.bind(gl),
          queryCounter: ext.queryCounterEXT.bind(ext)
        };
      }
    } else {
      const ext = gl.getExtension('EXT_disjoint_timer_query');
      if (ext) {
        this._timerQuery = {
          createQuery: ext.createQueryEXT.bind(ext),
          deleteQuery: ext.deleteQueryEXT.bind(ext),
          beginQuery: ext.beginQueryEXT.bind(ext),
          endQuery: ext.endQueryEXT.bind(ext),
          isQuery: ext.isQueryEXT.bind(ext),
          getQuery: ext.getQueryEXT.bind(ext),
          getQueryObject: ext.getQueryObjectEXT.bind(ext),
          queryCounter: ext.queryCounterEXT.bind(ext)
        };
      }
    }
    this._query = this._timerQuery ? this._timerQuery.createQuery() : null;
  }
  get gpuTimerSupported() {
    return !!this._query;
  }
  begin() {
    if (this._state === QueryState.QUERY_STATE_QUERYING) {
      this.end();
    }
    if (this._query) {
      this._timerQuery!.beginQuery(TIME_ELAPSED_EXT, this._query);
    }
    this._gpuTime = null;
    this._state = QueryState.QUERY_STATE_QUERYING;
  }
  end() {
    if (this._state === QueryState.QUERY_STATE_QUERYING) {
      if (this._query) {
        this._timerQuery!.endQuery(TIME_ELAPSED_EXT);
      }
      this._state = QueryState.QUERY_STATE_FINISHED;
    }
  }
  ended(): boolean {
    return this._state !== QueryState.QUERY_STATE_QUERYING;
  }
  elapsed(): number {
    if (this._state === QueryState.QUERY_STATE_FINISHED) {
      if (
        this._gpuTime === null &&
        this._query &&
        this._timerQuery!.getQueryObject(this._query, WebGLEnum.QUERY_RESULT_AVAILABLE)
      ) {
        const gpuTimerDisjoint = this._device.context.getParameter(GPU_DISJOINT_EXT);
        if (!gpuTimerDisjoint) {
          this._gpuTime =
            Number(this._timerQuery!.getQueryObject(this._query, WebGLEnum.QUERY_RESULT)) / 1000000;
        }
      }
    }
    return this._gpuTime ?? 0;
  }
}
